/** 참조 지도의 누르기 판정 - 바탕(마디·단추가 아닌 곳)과 바탕 누르기(고름 풀기). DOM만 읽는 작은 규칙 */

const PRESSABLE_SELECTOR = ".map-node, button, a";

/** 마디·단추·링크가 아닌 곳 */
export function isMapBackground(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(PRESSABLE_SELECTOR) === null;
}

/** 누른 곳과 click이 모두 바탕일 때만 바탕 누르기다 - 마디에서 누르고 밖에서 떼면 click은 공통 조상(바탕)으로 간다 */
export function isBackgroundClick(pressTarget: EventTarget | null, clickTarget: EventTarget | null): boolean {
  return isMapBackground(pressTarget) && isMapBackground(clickTarget);
}
