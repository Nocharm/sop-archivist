// 쪼개기·배정 용지 조각 앞 칸의 순수 모델 - 절 번호 표시 줄, 절 번호 글자, 이웃한 짝의 한 카드.

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

// Split은 1280px 미만에서 깊이 3 이상 탭을 46px로 CSS가 더 줄인다(styles/components.css `.split-desk .strip-lead-num`) - 모델은 화면 폭을 몰라 아래 값은 그대로다
/** 줄마다 탭 폭 - 숫자 번호가 있으면 깊이별 폭, 없는 줄(깊이 0)은 같은 부분 안의 직전 줄 폭을 따르고(부분의 첫 줄이면 1단 폭), 짝 카드의 둘째 줄부터(pairTopOf = 첫 줄의 key)는 첫 줄과 같은 폭이다. 첫 줄을 따르는 까닭: 한 카드의 탭은 첫 줄이 대표라 절 번호 글자도 첫 줄만 보이기 때문이다 */
export function getTabWidths(rows: readonly { key: string; part: string; sectionLabel: string; pairTopOf?: string | null }[]): Map<string, number> {
  const widths = new Map<string, number>();
  let part: string | null = null;
  let previous: number | null = null;
  for (const row of rows) {
    if (row.part !== part) {
      part = row.part;
      previous = null;
    }
    const level = getSectionLevel(row.sectionLabel);
    const own: number = level > 0 ? getPillWidth(level) : (previous ?? getPillWidth(1));
    const width: number = (row.pairTopOf != null ? widths.get(row.pairTopOf) : undefined) ?? own;
    widths.set(row.key, width);
    previous = width;
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
