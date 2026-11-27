// 벗긴 표 번호 이어 매기기의 순수 모델(11-23 명세 D1) - 서버 app/sop/numbering.py find_parent_number · plan_continue의 사본이다(rule-cases.json이 대조).
// 서버는 Old 표를 벗길 때 이 규칙으로 번호를 매기고, 화면은 번호 칸 창의 연속 번호 제안(suggestUnitContinuous)에 위 번호를 쓴다.

import type { UnitLang } from "./api-sop";

/** 번호 흐름의 줄 하나(원문 차례) - tableId는 벗긴 표 덩이 안이면 그 표, 표 밖(띠 표 제목 줄 포함)이면 null. isCell은 사람이 고치지 않은 행 첫 칸의 숫자 번호 */
export interface FlowLine {
  number: string | null;
  lang: UnitLang;
  kind: string;
  tableId: number | null;
  isCell: boolean;
}

// 서버 numbering.get_section_level의 꼴("5" "5.2.")
const NUMERIC_LABEL = /^\d+(\.\d+)*\.?$/;

function getLevel(label: string): number {
  return NUMERIC_LABEL.test(label) ? label.replace(/\.$/, "").split(".").length : 0;
}

function normalize(number: string): string {
  return number.trim().replace(/\.+$/, "");
}

/**
 * index번째 줄의 위 번호 - 앞의 같은 언어 · 표 밖 숫자 번호 줄 가운데 마지막 줄. 그 줄이 제목이거나 한 마디면 그 번호,
 * 본문 번호(5.1)의 부모 번호(5)가 앞에 있으면 부모, 아니면 그 번호. "1)" · 점 기호 · 직접 번호는 건너뛴다. 없으면 null. 끝 점은 뗀다
 */
export function findParentNumber(lines: readonly FlowLine[], index: number): string | null {
  const lang = lines[index].lang;
  const outside = lines
    .slice(0, index)
    .filter((line) => line.number && line.lang === lang && line.tableId === null && getLevel(line.number) > 0)
    .map((line) => ({ number: normalize(line.number ?? ""), kind: line.kind }));
  if (outside.length === 0) return null;
  const last = outside[outside.length - 1];
  const cut = last.number.lastIndexOf(".");
  const head = cut < 0 ? "" : last.number.slice(0, cut);
  if (last.kind === "heading" || head === "") return last.number;
  return outside.some((line) => line.number === head) ? head : last.number;
}

/** lines 가운데 같은 언어의 parent.k 꼴 번호의 가장 큰 k - 없으면 0 */
export function countChildren(lines: readonly FlowLine[], lang: UnitLang, parent: string): number {
  const prefix = `${parent}.`;
  let most = 0;
  for (const line of lines) {
    if (!line.number || line.lang !== lang) continue;
    const body = normalize(line.number);
    const rest = body.slice(prefix.length);
    if (body.startsWith(prefix) && /^\d+$/.test(rest)) most = Math.max(most, Number(rest));
  }
  return most;
}

/**
 * 벗긴 표(tableId)의 숫자 칸 번호를 위 번호 아래로 잇는다 - 자리 → 새 번호, 바뀌는 줄만. 한 마디 칸은 위 번호 아래 다음 순번(5.1),
 * 여러 마디 칸은 앞머리가 직전 한 마디 칸의 옛 번호일 때 그 새 번호로 앞머리만(5.1.1), 이미 "위 번호."로 시작하면 그대로.
 * 순번은 표 앞의 같은 언어 줄(표 안팎) 가운데 가장 큰 자식 순번 다음부터, 언어마다 따로. 끝 점은 칸이 읽은 번호를 따른다
 */
export function planContinue(lines: readonly FlowLine[], tableId: number): Map<number, string> {
  const changes = new Map<number, string>();
  const first = lines.findIndex((line) => line.tableId === tableId);
  if (first < 0) return changes;
  const counts = new Map<string, number>();
  const lastSingle = new Map<UnitLang, { old: string; next: string }>();
  for (let index = first; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.tableId !== tableId || !line.isCell || !line.number || getLevel(line.number) === 0) continue;
    const parent = findParentNumber(lines, index);
    if (parent === null) continue;
    const number = line.number.trim();
    const body = normalize(number);
    if (body.startsWith(`${parent}.`)) continue;
    const dot = body.indexOf(".");
    const head = dot < 0 ? body : body.slice(0, dot);
    let changed: string;
    if (dot < 0) {
      const key = `${line.lang}\u0000${parent}`;
      const count = (counts.get(key) ?? countChildren(lines.slice(0, first), line.lang, parent)) + 1;
      counts.set(key, count);
      const next = `${parent}.${count}`;
      lastSingle.set(line.lang, { old: head, next });
      changed = next + number.slice(body.length);
    } else {
      const single = lastSingle.get(line.lang);
      if (!single || single.old !== head) continue;
      changed = single.next + number.slice(head.length);
    }
    if (changed !== line.number) changes.set(index, changed);
  }
  return changes;
}
