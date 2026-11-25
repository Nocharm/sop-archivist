// 한 단 보기의 위치 판(짝 엿보기 · 그림 위치)이 용지 옆에 앉을지 위에 덮을지 정하는 순수 계산. 용지 폭은 어느 쪽이든 그대로다(§6 S2).

export const SPOT_MIN = 420;
export const SPOT_MAX = 600;
export const SPOT_GAP = 12;
// 용지를 덮을 때 판이 칸에서 차지할 수 있는 비율(옛 CSS의 92%와 같다)
const COVER_SHARE = 0.92;

/** `pane`(Old 칸 폭)과 `sheet`(용지 폭, px)로 판의 모양과 폭을 정한다 - 용지 옆 자리가 SPOT_MIN 이상이면 옆(aside, 용지는 왼쪽으로 붙는다), 아니면 덮기(cover, 용지는 제자리).
 * 폭이 0 이하면(탭이 바뀌어 DOM에서 떨어진 요소를 잰 것) 정하지 않는다(null) */
export function planSpotPlace(input: { pane: number; sheet: number }): { kind: "aside" | "cover"; panel: number } | null {
  if (input.pane <= 0 || input.sheet <= 0) return null;
  const room = input.pane - input.sheet - SPOT_GAP;
  if (room >= SPOT_MIN) return { kind: "aside", panel: Math.min(SPOT_MAX, room) };
  return { kind: "cover", panel: Math.min(SPOT_MAX, Math.floor(input.pane * COVER_SHARE)) };
}
