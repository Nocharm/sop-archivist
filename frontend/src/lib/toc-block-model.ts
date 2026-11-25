// 저절로 삭제된 줄의 블록 모델 - 잡음 표시(noise_kind: 목차 · 본문 앞부분 · 개정 이력)가 붙은 줄이 연달아 오면 Assign 용지에서 종류마다 흐린 블록 하나로
// 접는다(MD 1 F6, 쪼개기 먼저 설계 §7 R3). 배정 줄이 아니다(classify-model isNoiseUnit) - 블록은 줄과 수, 사유, 한/영 사이 점선 자리만 계산한다.

import type { ViewTable, ViewUnit } from "./api-sop";
import { getTableNumber } from "./unwrap-model";

export type NoiseKind = "toc" | "front" | "history";

export interface TocLine {
  unitId: number;
  text: string;
  /** 바로 앞 줄과 언어가 갈려(한글 목차 → 영어 목차) 그 사이에 점선을 둔다 */
  breakBefore: boolean;
  /** 이 줄에 적은 사유 - 빈 글이면 정한 문구 */
  reason: string;
}

export interface TocBlock {
  /** 블록을 가리키는 값 - 첫 줄의 단위 id(펼침 상태·testid) */
  key: number;
  unitIds: number[];
  lines: TocLine[];
  counts: { total: number; ko: number; en: number };
}

export interface NoiseBlock extends TocBlock {
  kind: NoiseKind;
  /** 줄들의 사유 - 모두 같으면 그 글(적지 않았으면 빈 글 = 정한 문구), 갈리면 isMixed */
  reason: { text: string; isWritten: boolean; isMixed: boolean };
}

type NoiseUnit = Pick<ViewUnit, "id" | "lang" | "text" | "kind" | "group_unit_id" | "noise_kind" | "noise_reason" | "table_id">;

/** 한/영 사이에만 점선 - 중립·참조 줄은 언어가 바뀐 것으로 치지 않는다 */
const SPLIT_LANGS = new Set(["ko", "en"]);

/** 블록의 줄 - 표 · 그림은 한 줄이고 그 칸 · 캡션(묶인 단위)은 제 줄이 없다 */
function isLine(unit: Pick<ViewUnit, "group_unit_id">): boolean {
  return unit.group_unit_id === null || unit.group_unit_id === undefined;
}

/** 연달아 오는 같은 종류의 삭제된 단위(원문 순) → 블록 하나. labelOf는 줄에 보일 글(표 "표 n (r×c)", 그림 "[Figure]"). 줄이 없으면 null */
export function buildNoiseBlock<T extends NoiseUnit>(units: readonly T[], labelOf: (unit: T) => string): NoiseBlock | null {
  const own = units.filter(isLine);
  if (own.length === 0) return null;
  let previousLang: string | null = null;
  const lines = own.map((unit) => {
    const isSplit = SPLIT_LANGS.has(unit.lang);
    const breakBefore = isSplit && previousLang !== null && previousLang !== unit.lang;
    if (isSplit) previousLang = unit.lang;
    return { unitId: unit.id, text: labelOf(unit), breakBefore, reason: unit.noise_reason ?? "" };
  });
  const reasons = new Set(lines.map((line) => line.reason));
  const text = reasons.size === 1 ? lines[0].reason : "";
  return {
    key: own[0].id,
    unitIds: own.map((unit) => unit.id),
    lines,
    counts: {
      total: own.length,
      ko: own.filter((unit) => unit.lang === "ko").length,
      en: own.filter((unit) => unit.lang === "en").length,
    },
    kind: own[0].noise_kind ?? "toc",
    reason: { text, isWritten: text !== "", isMixed: reasons.size > 1 },
  };
}

type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** 블록의 사유 글 - 갈리면 그렇다는 말, 적지 않았으면 종류마다 정한 문구 */
export function readNoiseReason(block: Pick<NoiseBlock, "kind" | "reason">, t: Translate): string {
  if (block.reason.isMixed) return t("assign.noise.mixed");
  return block.reason.text || t(`assign.noise.reason.${block.kind}`);
}

/** 줄에 보일 글 - 표 "표 n (r×c)", 그림 "[Figure]", 나머지는 원문 글 */
export function describeNoiseUnit(unit: Pick<ViewUnit, "kind" | "text" | "table_id">, tables: ReadonlyMap<number, ViewTable>, t: Translate): string {
  if (unit.kind === "figure") return "[Figure]";
  const table = unit.kind === "table" && unit.table_id !== null ? tables.get(unit.table_id) : undefined;
  return table ? t("assign.noise.table", { n: getTableNumber(table), rows: table.n_rows, cols: table.n_cols }) : unit.text;
}

/** 줄 묶기 - 바로 앞 칸도 같은 종류의 삭제된 줄이면 같은 블록에 잇는다(짝 카드와 같은 자리에서 판단) */
export function shouldJoinNoiseCard(previous: NoiseKind | null, next: NoiseKind | null): boolean {
  return next !== null && previous === next;
}

/** 블록의 줄 나눔 - 결정 칸 다듬기 줄 "(한글 4 · 영어 3 · 그 뒤 1)". 언어가 같은 줄 덩어리 앞 둘은 그 언어로, 나머지는 "그 뒤"로 센다 */
export type TocPart = { part: "ko" | "en" | "after"; n: number };

export function describeTocParts(langs: readonly string[]): TocPart[] {
  const runs: Array<{ lang: string; n: number }> = [];
  for (const lang of langs) {
    const last = runs[runs.length - 1];
    // 중립·참조 줄은 바로 앞 덩어리에 붙는다
    if (last && (last.lang === lang || !SPLIT_LANGS.has(lang))) last.n += 1;
    else runs.push({ lang: SPLIT_LANGS.has(lang) ? lang : "ko", n: 1 });
  }
  const parts: TocPart[] = runs.slice(0, 2).map((run) => ({ part: run.lang === "en" ? "en" : "ko", n: run.n }));
  const after = runs.slice(2).reduce((sum, run) => sum + run.n, 0);
  return after > 0 ? [...parts, { part: "after", n: after }] : parts;
}

/** 문서 하나의 블록 - 용지 순(pos_seq, 첫 범위 시작)으로 이어진 같은 종류의 삭제된 줄 덩어리. 사이에 다른 단위(표·칸 문장 포함)가 끼거나 종류가 바뀌면 끊긴다.
 *  키는 첫 줄 단위 id - Paper가 같은 블록에 붙이는 키와 같다. 표 · 그림은 한 줄이고 그 칸 · 캡션은 세지 않는다 */
export function listNoiseBlocks(
  units: ReadonlyArray<Pick<ViewUnit, "id" | "kind" | "spans" | "pos_seq" | "noise_kind" | "group_unit_id">>,
): Array<{ key: number; kind: NoiseKind; unitIds: number[] }> {
  const order = units
    .filter(isLine)
    .sort((a, b) => a.pos_seq - b.pos_seq || (a.spans[0]?.[1] ?? 0) - (b.spans[0]?.[1] ?? 0) || a.id - b.id);
  const blocks: Array<{ key: number; kind: NoiseKind; unitIds: number[] }> = [];
  let current: { key: number; kind: NoiseKind; unitIds: number[] } | null = null;
  for (const unit of order) {
    if (unit.noise_kind == null) {
      current = null;
      continue;
    }
    if (current === null || current.kind !== unit.noise_kind) {
      current = { key: unit.id, kind: unit.noise_kind, unitIds: [] };
      blocks.push(current);
    }
    current.unitIds.push(unit.id);
  }
  return blocks;
}

/** 고른 것의 블록 - 줄을 골랐으면 그 줄이 든 블록(첫 줄을 삭제 취소해 키가 바뀌어도), 블록을 골랐으면 그 키의 줄이 든 블록 */
export function findNoiseBlock<T extends { unitIds: readonly number[] }>(blocks: readonly T[], pick: { key: number; unitId: number | null }): T | undefined {
  return blocks.find((block) => block.unitIds.includes(pick.unitId ?? pick.key));
}

const TOC_NAV_PREFIX = "toc:";
const UNIT_NAV_PREFIX = "unit:";

/** 줄 목록(↑↓·J/K)에 끼우는 목차 블록 자리 키 - 배정 줄 키(`u<id>`)와 겹치지 않는다. 남은 수·필터 수에는 들지 않는다 */
export function toTocNavKey(blockKey: number): string {
  return `${TOC_NAV_PREFIX}${blockKey}`;
}

export function readTocNavKey(navKey: string): number | null {
  return navKey.startsWith(TOC_NAV_PREFIX) ? Number(navKey.slice(TOC_NAV_PREFIX.length)) : null;
}

/** 박스(Unit) 하나의 자리 키 - 평소 J/K는 짝 줄도 박스 하나씩 밟는다(설계 2026-11-20 D3) */
export function toUnitNavKey(unitId: number): string {
  return `${UNIT_NAV_PREFIX}${unitId}`;
}

export function readUnitNavKey(navKey: string): number | null {
  return navKey.startsWith(UNIT_NAV_PREFIX) ? Number(navKey.slice(UNIT_NAV_PREFIX.length)) : null;
}

/** 줄 이동 순서 - 배정 줄과 목차 블록을 문서 순 → 원문 순으로 섞는다. position은 단위 id → [문서 순번, pos_seq, 시작].
 *  byUnit이면 줄 대신 줄의 박스마다 한 자리(toUnitNavKey, 떨어진 짝은 제 자리에), 아니면 줄 키 하나(줄의 첫 Unit 자리 - Pair view는 한 줄에 두 언어가 나란하다) */
export function buildNavKeys(
  rows: ReadonlyArray<{ key: string; unitIds: readonly number[] }>,
  blocks: ReadonlyArray<{ key: number }>,
  position: ReadonlyMap<number, readonly [number, number, number]>,
  { byUnit }: { byUnit: boolean },
): string[] {
  const far = [Number.MAX_SAFE_INTEGER, 0, 0] as const;
  const entries = [
    ...rows.flatMap((row) => (byUnit ? row.unitIds.map((unitId) => ({ key: toUnitNavKey(unitId), at: position.get(unitId) ?? far })) : [{ key: row.key, at: position.get(row.unitIds[0]) ?? far }])),
    ...blocks.map((block) => ({ key: toTocNavKey(block.key), at: position.get(block.key) ?? far })),
  ];
  // 같은 자리면 원래 순서(줄 먼저) - sort는 안정적이다
  entries.sort((a, b) => a.at[0] - b.at[0] || a.at[1] - b.at[1] || a.at[2] - b.at[2]);
  return entries.map((entry) => entry.key);
}

/** 펼친 블록 열고 닫기 - 같은 키를 다시 누르면 접는다 */
export function toggleTocOpen(open: ReadonlySet<number>, key: number): Set<number> {
  const next = new Set(open);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}
