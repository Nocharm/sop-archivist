// 문단 번호 칸의 순수 모델 - 번호 범위를 가릴 블록 자리, 번호를 뺀 내용, "뒤 번호 따라 고치기" 미리 보기.
// 값과 내용 경계는 서버(app/sop/numbering.py)가 정해 보낸다. planFollow는 서버 plan_follow의 사본이라 규칙을 바꾸면 함께 고친다.

import type { ViewUnit } from "./api-sop";

/** 번호 한 줄에 쓸 수 있는 글자 수 - 서버 MAX_NUMBER_CHARS */
export const MAX_NUMBER_CHARS = 40;

const PART_SEPARATOR = /[.-]/;
const NUMBER_TAIL = /[.)]+$/;

/** 번호를 뺀 글("내용") - New 초안과 오른쪽 칸의 줄 글이 쓴다. 번호가 번호 칸에 없으면 글 그대로 */
export function getContent(unit: { text: string; content_start?: number }): string {
  return unit.text.slice(unit.content_start ?? 0);
}

/**
 * 단위 글의 앞 contentStart 글자(번호와 뒤 빈 글자)를 블록마다 가릴 끝 자리로 - 블록 id → 그 블록에서 이 자리 앞은 그리지 않는다.
 * 단위 글은 범위를 글자 하나(같은 블록 " ", 다른 블록 "\n")로 이은 것이라 범위 사이마다 한 글자를 센다. 번호만 든 칸 블록은 통째로 가려진다.
 */
export function getHiddenEnds(spans: ViewUnit["spans"], contentStart: number): Map<number, number> {
  const ends = new Map<number, number>();
  let offset = 0;
  for (const [blockId, start, end] of spans) {
    if (offset >= contentStart) break;
    ends.set(blockId, Math.min(end, start + contentStart - offset));
    offset += end - start + 1;
  }
  return ends;
}

function splitParts(number: string): string[] | null {
  const body = number.trim().replace(NUMBER_TAIL, "");
  const parts = body.split(PART_SEPARATOR);
  return body !== "" && parts.every((part) => part !== "") ? parts : null;
}

/** 번호의 index번째 마디만 바꾼다 - 사이 글자와 끝 글자는 그 줄이 쓰던 그대로 */
function replacePart(number: string, index: number, value: string): string {
  const stripped = number.trim();
  const body = stripped.replace(NUMBER_TAIL, "");
  const tokens = body.split(/([.-])/);
  tokens[index * 2] = value;
  return tokens.join("") + stripped.slice(body.length);
}

/** 셀 수 있는 마디의 순번 - 숫자는 그 값, 대문자 한 글자는 A=1 … */
function readCount(part: string): number | null {
  if (/^[0-9]+$/.test(part)) return Number(part);
  if (/^[A-Z]$/.test(part)) return part.charCodeAt(0) - 64;
  return null;
}

function formatCount(count: number, like: string): string | null {
  if (/^[0-9]+$/.test(like)) return String(count);
  return count >= 1 && count <= 26 ? String.fromCharCode(64 + count) : null;
}

interface FollowList {
  parent: string[];
  count: number;
  lastOld: number | null;
  renamed: [string, string] | null;
  isOpen: boolean;
}

function isSameParts(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((part, index) => part === b[index]);
}

/**
 * index번째 줄의 번호를 next로 고칠 때 뒤따라 고칠 줄(자리 → 새 번호). numbers는 같은 목록 후보의 지금 번호(문서 순서).
 * 같은 목록 = 같은 수준 · 같은 부모의 뒤 줄. 수준이나 부모가 바뀌면(6.2 → 6.1.1) 옛 목록은 빠진 자리부터 당겨 세고 새 부모 아래 뒤 줄도 차례로 센다.
 * 다시 센 줄 아래의 줄(6.3.1)은 앞머리만 따라간다. 목록 밖 번호가 나오거나 순번이 줄어들면 그 목록은 거기서 끝난다.
 */
export function planFollow(numbers: readonly (string | null)[], index: number, next: string): Map<number, string> {
  const changes = new Map<number, string>();
  const newParts = splitParts(next);
  const newCount = newParts ? readCount(newParts[newParts.length - 1]) : null;
  if (!newParts || newCount === null) return changes;
  const oldParts = splitParts(numbers[index] ?? "");
  const oldCount = oldParts ? readCount(oldParts[oldParts.length - 1]) : null;
  const isSameList = oldParts !== null && isSameParts(oldParts.slice(0, -1), newParts.slice(0, -1));
  const lists: FollowList[] = [
    {
      parent: newParts.slice(0, -1),
      count: newCount,
      lastOld: isSameList ? oldCount : null,
      renamed: oldParts && isSameList ? [oldParts[oldParts.length - 1], newParts[newParts.length - 1]] : null,
      isOpen: true,
    },
  ];
  if (oldParts && oldCount !== null && !isSameList) lists.push({ parent: oldParts.slice(0, -1), count: oldCount - 1, lastOld: oldCount, renamed: null, isOpen: true });
  for (let position = index + 1; position < numbers.length; position += 1) {
    const current = numbers[position];
    const parts = current ? splitParts(current) : null;
    if (!current || !parts) continue;
    let number = current;
    for (const list of lists) {
      if (!list.isOpen) continue;
      const depth = list.parent.length + 1;
      if (parts.length < depth || !isSameParts(parts.slice(0, depth - 1), list.parent)) {
        list.isOpen = false;
        continue;
      }
      if (parts.length > depth) {
        if (list.renamed && parts[depth - 1] === list.renamed[0]) number = replacePart(number, depth - 1, list.renamed[1]);
        continue;
      }
      const seen = readCount(parts[parts.length - 1]);
      const value = seen === null || (list.lastOld !== null && seen < list.lastOld) ? null : formatCount(list.count + 1, parts[parts.length - 1]);
      if (seen === null || value === null) {
        list.isOpen = false;
        continue;
      }
      list.count += 1;
      list.lastOld = seen;
      list.renamed = [parts[parts.length - 1], value];
      number = replacePart(number, depth - 1, value);
    }
    if (number !== current) changes.set(position, number);
    if (!lists.some((list) => list.isOpen)) break;
  }
  return changes;
}

export interface NumberPreview {
  unitId: number;
  from: string;
  to: string;
}

/** 번호 목록을 가르는 표 - 띠 표 제목 줄(표를 가리키는 제목, 서버 segment.is_band_heading)은 장마다 표가 달라도 표 밖 목록이다. */
function getListTable(unit: ViewUnit): number | null {
  return unit.kind === "heading" && unit.table_id !== null ? null : unit.table_id;
}

/**
 * 한 줄과 같은 번호 목록의 후보(문서 순서)와 그 안의 자리 - 서버 _plan_set_number와 같이 같은 언어 · 같은 표(표 밖이면 표 밖)의
 * 번호 칸 있는 단위다(띠 표 제목 줄은 표 밖으로 친다). 따라 고치기 미리 보기와 연속 번호 세기가 함께 쓴다. units는 용지 순서(원문 순)로 넘긴다.
 */
export function listNumberSiblings(units: readonly ViewUnit[], unitId: number): { siblings: ViewUnit[]; index: number } | null {
  const edited = units.find((unit) => unit.id === unitId);
  if (!edited) return null;
  const scope = getListTable(edited);
  const siblings = units.filter((unit) => unit.number !== null && unit.lang === edited.lang && getListTable(unit) === scope);
  return { siblings, index: siblings.findIndex((unit) => unit.id === unitId) };
}

/** 고칠 줄 뒤로 따라 바뀔 번호들(문서 순서) - 번호 칸이 점선으로 미리 보인다. 후보는 listNumberSiblings */
export function listFollowPreview(units: readonly ViewUnit[], unitId: number, next: string): NumberPreview[] {
  const found = listNumberSiblings(units, unitId);
  if (!found || next.trim() === "") return [];
  const { siblings: candidates, index } = found;
  const changes = planFollow(
    candidates.map((unit) => unit.number?.value ?? null),
    index,
    next.trim(),
  );
  return [...changes]
    .filter(([, to]) => to.length <= MAX_NUMBER_CHARS)
    .map(([position, to]) => ({ unitId: candidates[position].id, from: candidates[position].number?.value ?? "", to }));
}
