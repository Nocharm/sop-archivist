// 쪼개기·배정 용지 오른쪽 필 칸의 순수 모델 - 절 번호 필, 필 바탕 칸 나눔, 이웃 짝 괄호.

export type PillSeg = "ko" | "en" | "hold";
export type PairBracket = "top" | "bottom" | "solo";

const NUMERIC_LABEL = /^\d+(\.\d+)*\.?$/;

/** 절 번호 필에 쓸 글자 - 숫자 번호만(제목 글자는 필에 넣기엔 길어 쓰지 않는다) */
export function getSectionPill(label: string): string | null {
  return NUMERIC_LABEL.test(label) ? label : null;
}

/** 필 바탕 칸 - 짝이면 짝의 문서 순서대로 두 칸, 보류면 끝에 한 칸 더 */
export function getPillFill(own: "ko" | "en" | null, partnerOrder: ("ko" | "en")[] | null, held: boolean): PillSeg[] {
  const segs: PillSeg[] = partnerOrder ? [...partnerOrder] : own ? [own] : [];
  if (held) segs.push("hold");
  return segs;
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
