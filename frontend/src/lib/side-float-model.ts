// Assign 오른쪽 칸을 떼어 띄운 판의 자리 셈(설계 2026-11-25 §6 S3) - 언제 뜨는지, 창 안에 가두기, 처음 자리. 순수 계산이라 화면은 그릴 때마다 부른다.

/** 이 폭(px)부터는 두 문서와 오른쪽 칸이 나란히 들어가 늘 붙어 있다 */
export const SIDE_FLOAT_MAX_VIEW = 1440;
export const SIDE_FLOAT_WIDTH = 320;
/** 판 높이 = 창 높이의 이만큼 - 고른 줄이 바뀌어도 확정 단추가 같은 자리에 있게 늘 이 높이다 */
export const SIDE_FLOAT_MAX_HEIGHT = 0.7;
/** 머리 한 줄(접었을 때의 높이, px) - components.css `.side-float-head`와 같다 */
export const SIDE_FLOAT_HEAD = 36;
const START_MARGIN = 16;

export interface FloatPoint {
  x: number;
  y: number;
}

export interface FloatSize {
  w: number;
  h: number;
}

export function isSideFloating(viewWidth: number, wantsFloat: boolean): boolean {
  return wantsFloat && viewWidth < SIDE_FLOAT_MAX_VIEW;
}

export function getFloatHeight(viewHeight: number, isFolded: boolean): number {
  return isFolded ? SIDE_FLOAT_HEAD : Math.round(viewHeight * SIDE_FLOAT_MAX_HEIGHT);
}

/** 창 밖으로 나가지 않게 - 창이 판보다 작으면 왼쪽 위에 붙여 머리(끌기·붙이기)가 보이게 한다 */
export function clampFloat(at: FloatPoint, size: FloatSize, view: FloatSize): FloatPoint {
  return {
    x: Math.max(0, Math.min(at.x, view.w - size.w)),
    y: Math.max(0, Math.min(at.y, view.h - size.h)),
  };
}

/** 아직 끌지 않은 판의 자리 - 오른쪽 아래 */
export function getFloatStart(view: FloatSize, size: FloatSize): FloatPoint {
  return clampFloat({ x: view.w - size.w - START_MARGIN, y: view.h - size.h - START_MARGIN }, size, view);
}
