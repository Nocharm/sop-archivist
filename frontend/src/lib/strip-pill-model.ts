// 쪼개기·배정 용지 조각 앞 칸의 순수 모델 - 절 번호 표시 줄, 절 번호 글자, 이웃한 짝의 한 카드.

import { getBulletIndex, getBulletLevel } from "./number-kind-model";

export type PairBracket = "top" | "middle" | "bottom";

const NUMERIC_LABEL = /^\d+(\.\d+)*\.?$/;

/** 절 번호로 쓸 글자 - 숫자 번호만(제목 글자는 필에 넣기엔 길어 쓰지 않는다) */
export function getSectionPill(label: string): string | null {
  return NUMERIC_LABEL.test(label) ? label : null;
}

/** 절 깊이 - 숫자 번호의 점으로 나뉜 마디 수("5"→1, "5.2."→2). 숫자 번호가 아니면 0 */
export function getSectionLevel(label: string): number {
  return NUMERIC_LABEL.test(label) ? label.replace(/\.$/, "").split(".").length : 0;
}

/** 깊이별 탭 폭(px), 인덱스 = 깊이 - 1. 10px mono 실측(글자당 약 4.4px, 끝 점 포함)으로 그 깊이에서 현실적으로 가장 긴 번호("11", "11.11", "11.11.1" …)가 좌우 여백 6씩을 두고 들어가는 값이다. 같은 깊이는 어디서나 같은 폭이라 들여쓰기가 깊이를 읽게 한다 */
export const PILL_WIDTH_BY_LEVEL: readonly number[] = [24, 36, 46, 54, 62, 72, 80, 90];

/** 깊이로 탭 폭 정하기 - 숫자 번호가 아닌 조각(깊이 0)은 1단 폭, 표에 없는 깊이는 마지막 폭 */
export function getPillWidth(level: number): number {
  return PILL_WIDTH_BY_LEVEL[Math.min(Math.max(level, 1), PILL_WIDTH_BY_LEVEL.length) - 1];
}

// 앞머리 번호 한 글자 폭(px) - .strip-lead-num(500 11px JetBrains Mono) 실측 6.6px. 글꼴·크기를 바꾸면 함께 고친다
const LEAD_CHAR_PX = 6.6;
// 번호 칸 안 여백(px) - .strip-lead-num 오른쪽 padding 5px에 왼쪽 숨 1px
const LEAD_PAD_PX = 6;

/** 깊이별 번호 칸 폭 - 기본은 PILL_WIDTH_BY_LEVEL이되, 받은 번호 중 그 깊이의 가장 긴 번호가 잘리지 않게 그 깊이 전체를 넓힌다(같은 깊이는 같은 폭이라 들여쓰기로 읽힌다). 숫자 번호가 아닌 글자는 세지 않는다 */
export function getLevelWidths(labels: Iterable<string>): (level: number) => number {
  const byLevel = new Map<number, number>();
  for (const label of labels) {
    const level = getSectionLevel(label);
    if (level === 0) continue;
    byLevel.set(level, Math.max(byLevel.get(level) ?? getPillWidth(level), Math.ceil(label.length * LEAD_CHAR_PX) + LEAD_PAD_PX));
  }
  return (level) => byLevel.get(level) ?? getPillWidth(level);
}

/** 화면 단계의 끝 - 깊이별 폭 표에 있는 단계까지 차이 나게 그린다 */
export const MAX_LEVEL = PILL_WIDTH_BY_LEVEL.length;

/** 단계 계산에 넣는 줄 - shift는 저장된 들여쓰기 차이(units.indent_shift), hasCell은 번호 칸이 있는 줄(표 · 그림 줄은 없다, 주지 않으면 있음) */
export interface LevelRow {
  key: string;
  part: string;
  sectionLabel: string;
  pairTopOf?: string | null;
  shift?: number;
  hasCell?: boolean;
}

/** 한 줄의 단계 - base는 셈한 단계, level은 화면 단계(base + 차이, 1–MAX_LEVEL), anchor는 번호 · 없는 줄이 단계를 빌린 줄(숫자 번호 · 점 기호 줄) */
export interface RowLevel {
  base: number;
  level: number;
  anchor: string | null;
}

function clampLevel(level: number): number {
  return Math.min(Math.max(level, 1), MAX_LEVEL);
}

/**
 * 줄마다 단계(B8 항목 7, 부분마다 문서 순서로) - 숫자 번호는 마디 수(차이를 더하지 않는다 - 단계는 번호가 정한다), 점 기호는 같은 부분 안 앞의 가장 가까운
 * 숫자 번호 깊이 + 1 + 기호 순번(getBulletLevel), 직접 번호 · 번호 없는 줄은 앞의 가장 가까운 숫자 번호 · 점 기호 줄(anchor)의 화면 단계에 차이를 더한다 -
 * 기호 줄을 옮기면 그 아래 이어 쓴 줄이 따라가고, 이어진 번호 없는 줄끼리는 서로 기대지 않는다(한 줄씩 되돌릴 수 있게). 번호 칸이 없는 줄(표 · 그림)은 직전 줄 단계,
 * 짝 카드의 둘째 줄부터(pairTopOf = 첫 줄의 key)는 첫 줄 단계다(한 카드의 탭은 첫 줄이 대표). 차이가 모두 0이면 지금까지의 "앞 줄 폭을 따름"과 같다
 */
export function getRowLevels(rows: readonly LevelRow[]): Map<string, RowLevel> {
  const levels = new Map<string, RowLevel>();
  let part: string | null = null;
  let numeric = 0;
  let anchor: { key: string; level: number } | null = null;
  let previous: number | null = null;
  for (const row of rows) {
    if (row.part !== part) {
      part = row.part;
      numeric = 0;
      anchor = null;
      previous = null;
    }
    const depth = getSectionLevel(row.sectionLabel);
    const isBullet = depth === 0 && getBulletIndex(row.sectionLabel) >= 0;
    if (depth > 0) numeric = depth;
    const top = row.pairTopOf != null ? levels.get(row.pairTopOf) : undefined;
    let own: RowLevel;
    if (top !== undefined) own = { ...top };
    else if (depth > 0) own = { base: depth, level: clampLevel(depth), anchor: null };
    else if (isBullet) {
      const base = getBulletLevel(numeric, row.sectionLabel);
      own = { base, level: clampLevel(base + (row.shift ?? 0)), anchor: null };
    } else if (row.hasCell === false) own = { base: previous ?? 1, level: previous ?? 1, anchor: null };
    else {
      const base = anchor?.level ?? 1;
      own = { base, level: clampLevel(base + (row.shift ?? 0)), anchor: anchor?.key ?? null };
    }
    levels.set(row.key, own);
    if (top === undefined && (depth > 0 || isBullet)) anchor = { key: row.key, level: own.level };
    previous = own.level;
  }
  return levels;
}

/** 줄마다 탭 폭 - 화면 단계(getRowLevels)의 깊이별 폭(getLevelWidths, 받은 줄 전체에서 그 깊이의 가장 긴 번호가 들어가게), 짝 카드의 둘째 줄부터는 첫 줄과 같은 폭 */
export function getTabWidths(rows: readonly LevelRow[], levels: ReadonlyMap<string, RowLevel> = getRowLevels(rows)): Map<string, number> {
  const getLevelWidth = getLevelWidths(rows.map((row) => row.sectionLabel));
  const widths = new Map<string, number>();
  for (const row of rows) {
    const width = (row.pairTopOf != null ? widths.get(row.pairTopOf) : undefined) ?? getLevelWidth(levels.get(row.key)?.level ?? 1);
    widths.set(row.key, width);
  }
  return widths;
}

/** 절 번호를 보일 줄 - 같은 부분 안에서 문서 순서로 절 번호가 앞 줄과 달라진 첫 줄. 숫자가 아닌 번호는 보이지 않고, 짝 카드의 둘째 줄부터(pairTopOf가 있는 줄)는 첫 줄이 대표라 보이지 않는다 */
export function getSectionHeads(units: readonly { unitId: number; part: string; sectionLabel: string; pairTopOf?: number | null }[]): Set<number> {
  const heads = new Set<number>();
  let part: string | null = null;
  let previous: string | null = null;
  for (const unit of units) {
    if (unit.part !== part) {
      part = unit.part;
      previous = null;
    }
    const isNew = unit.sectionLabel !== previous;
    previous = unit.sectionLabel;
    if (isNew && unit.pairTopOf == null && getSectionPill(unit.sectionLabel) !== null) heads.add(unit.unitId);
  }
  return heads;
}

/** 같은 짝(groupId)이 끊김 없이 이어진 줄이 둘 이상이면 한 카드 - 첫 줄 top, 끝 줄 bottom, 사이 middle. 짝이 없거나 떨어진 구성원은 맵에 없다 */
export function getPairBrackets(strips: readonly { unitId: number; groupId: number | null }[]): Map<number, PairBracket> {
  const result = new Map<number, PairBracket>();
  let start = 0;
  while (start < strips.length) {
    const { groupId } = strips[start];
    let end = start + 1;
    while (groupId !== null && end < strips.length && strips[end].groupId === groupId) end += 1;
    if (end - start > 1) {
      for (let index = start; index < end; index += 1) result.set(strips[index].unitId, index === start ? "top" : index === end - 1 ? "bottom" : "middle");
    }
    start = end;
  }
  return result;
}

/** 카드의 둘째 줄부터 → 그 카드의 첫 줄(order는 용지 순서) - 둘째 줄부터는 첫 줄의 번호 칸 폭·절 머리를 따른다. 카드가 아닌 줄과 첫 줄은 맵에 없다 */
export function getCardTops(order: readonly number[], brackets: ReadonlyMap<number, PairBracket>): Map<number, number> {
  const tops = new Map<number, number>();
  let top: number | null = null;
  for (const id of order) {
    const bracket = brackets.get(id);
    if (bracket === "top") top = id;
    else if (bracket !== undefined && top !== null) tops.set(id, top);
  }
  return tops;
}

/** 문장 앞 절 번호(과 뒤따르는 공백)의 글자 수 - 숫자 번호가 맨 앞에 정확히 그 번호로 있을 때만. 번호 뒤 점은 숫자가 이어지지 않을 때만 번호의 일부다("5"는 "5.1 제목"을 숨기지 않는다). 숨기면 빈 글이 되면 0. 표시 전용이라 원문은 그대로다 */
export function getHiddenPrefixLength(text: string, sectionLabel: string): number {
  if (getSectionPill(sectionLabel) === null) return 0;
  const number = sectionLabel.replace(/\.$/, "").replace(/\./g, "\\.");
  const match = new RegExp(`^\\s*${number}(?!\\.?\\d)\\.?\\s*`).exec(text);
  if (!match || match[0].length >= text.length) return 0;
  return match[0].length;
}

/** 실제로 숨길 앞 글자 수 - 블록 첫 조각이 번호뿐이면(끝이 숨길 자리 안) 숨기지 않아 그 조각이 사라지지 않게 하고, 나눌 선이 숨길 자리 안이면 원문을 드러내 선 자리를 보인다 */
export function getVisibleSkip(hidden: number, firstSegmentEnd: number, cutOffset: number | null): number {
  if (hidden === 0 || firstSegmentEnd <= hidden) return 0;
  if (cutOffset !== null && cutOffset < hidden) return 0;
  return hidden;
}

/** 숨긴 앞 글자(skip)만큼 조각 구간을 깎기 - 구간이 통째로 숨겨지면 null */
export function sliceVisible(start: number, end: number, skip: number): { start: number; end: number } | null {
  if (skip >= end) return null;
  return { start: Math.max(start, skip), end };
}
