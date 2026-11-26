// 연습 말풍선의 자리(2026-11-27 시안 A) - 대상 상자의 오른쪽, 모자라면 아래 · 위, 화면(무대) 밖으로 나가지 않게. 순수 셈 - 재는 것은 use-target-rect.

export interface CoachBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface CoachSize {
  width: number;
  height: number;
}

/** right · below · above = 대상 옆(꼬리가 대상 쪽), center = 대상 없음(띠 아래 가운데) */
export type CoachSide = "right" | "below" | "above" | "center";

export interface CoachPlace {
  left: number;
  top: number;
  side: CoachSide;
  /** 꼬리 자리(px) - right면 카드 위에서, below · above면 카드 왼쪽에서. center면 0 */
  arrow: number;
}

/** 대상과 카드 사이(px) - 꼬리가 들어갈 틈 */
export const COACH_GAP = 12;
/** 무대 가장자리와 카드 사이(px) */
export const COACH_MARGIN = 8;
/** right일 때 대상 가운데에서 카드 위까지(px) - 꼬리가 카드 위쪽에 오게 */
const ARROW_LEAD = 22;
/** 꼬리를 카드 모서리에서 떼어 두는 거리(px) - 둥근 모서리에 걸리지 않게 */
const ARROW_INSET = 14;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

/** 무대(stage) 좌표의 대상 · 카드 크기로 카드 자리를 셈한다 - 어느 쪽에도 다 들어가지 않으면 아래에 두고 무대 안으로 당긴다 */
export function placeCoach(stage: CoachSize, target: CoachBox | null, card: CoachSize): CoachPlace {
  const maxLeft = stage.width - card.width - COACH_MARGIN;
  const maxTop = stage.height - card.height - COACH_MARGIN;
  if (target === null) return { left: clamp((stage.width - card.width) / 2, COACH_MARGIN, maxLeft), top: COACH_MARGIN + 4, side: "center", arrow: 0 };
  const centerX = target.left + target.width / 2;
  const centerY = target.top + target.height / 2;
  const right = target.left + target.width + COACH_GAP;
  if (right + card.width <= stage.width - COACH_MARGIN) {
    const top = clamp(centerY - ARROW_LEAD, COACH_MARGIN, maxTop);
    return { left: right, top, side: "right", arrow: clamp(centerY - top, ARROW_INSET, card.height - ARROW_INSET) };
  }
  const left = clamp(centerX - card.width / 2, COACH_MARGIN, maxLeft);
  const arrow = clamp(centerX - left, ARROW_INSET, card.width - ARROW_INSET);
  const below = target.top + target.height + COACH_GAP;
  if (below + card.height <= stage.height - COACH_MARGIN) return { left, top: below, side: "below", arrow };
  const above = target.top - COACH_GAP - card.height;
  if (above >= COACH_MARGIN) return { left, top: above, side: "above", arrow };
  return { left, top: clamp(below, COACH_MARGIN, maxTop), side: "below", arrow };
}
