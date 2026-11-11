// 쪼개기·배정 용지 조각 앞 칸의 순수 모델 - 절 번호 표시 줄, 절 번호 글자, 이웃 짝 괄호.

export type PairBracket = "top" | "bottom" | "solo";

const NUMERIC_LABEL = /^\d+(\.\d+)*\.?$/;

/** 절 번호로 쓸 글자 - 숫자 번호만(제목 글자는 필에 넣기엔 길어 쓰지 않는다) */
export function getSectionPill(label: string): string | null {
  return NUMERIC_LABEL.test(label) ? label : null;
}

/** 절 번호를 보일 줄 - 같은 부분 안에서 문서 순서로 절 번호가 앞 줄과 달라진 첫 줄. 숫자가 아닌 번호는 보이지 않고, 짝의 아래 줄(pairTopOf가 있는 줄)은 위 줄이 대표라 보이지 않는다 */
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

/** 짝이 바로 이웃한 줄이면 위·아래 괄호, 짝은 있는데 이웃하지 않으면 solo(괄호선만, 틈은 그대로). 짝 없는 줄은 맵에 없다 */
export function getPairBrackets(strips: readonly { unitId: number; partnerId: number | null }[]): Map<number, PairBracket> {
  const result = new Map<number, PairBracket>();
  strips.forEach((strip, index) => {
    if (strip.partnerId === null) return;
    const next = strips[index + 1];
    if (next && next.unitId === strip.partnerId && next.partnerId === strip.unitId) {
      result.set(strip.unitId, "top");
      result.set(next.unitId, "bottom");
    } else if (!result.has(strip.unitId)) {
      result.set(strip.unitId, "solo");
    }
  });
  return result;
}
