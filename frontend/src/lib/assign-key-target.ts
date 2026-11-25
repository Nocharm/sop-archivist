// Assign에서 글쇠를 누른 자리 - Enter가 확정 단추의 것인지, 그 자리의 것인지 가린다(명세 2026-11-23-assign-feedback-2 B1-R1 · R6).

/** typing = 글 칸, layer = 모달 · 메뉴 · 고르기 목록, pop = 비모달 판과 알림(제 단추를 Enter로 누른다), paper = 용지, side = 오른쪽 칸 */
export type KeyPlace = "typing" | "layer" | "pop" | "paper" | "side" | "other";

/** 화면 단축키를 막는 층 - 그 자리 메뉴(data-link-menu)는 막지 않는다(메뉴가 떠 있어도 ↵가 확정이다) */
export const LAYER_SELECTOR = '[role="dialog"],[role="menu"]:not([data-link-menu]),[role="listbox"]';

const CONTROL_SELECTOR = 'button, a, [role="button"], [role="option"]';

export function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

export function readKeyPlace(target: EventTarget | null): KeyPlace {
  if (isTypingTarget(target)) return "typing";
  if (!(target instanceof Element)) return "other";
  if (target.closest(LAYER_SELECTOR)) return "layer";
  if (target.closest(".num-edit, .doc-dash, .spot-panel, .toast")) return "pop";
  if (target.closest(".pane-body")) return "paper";
  return target.closest('[data-testid="assign-inspector"]') ? "side" : "other";
}

/** Enter가 확정 단추인 자리인가 - 용지와 오른쪽 칸은 다른 단추에 포커스가 있어도(그 단추는 Space로 누른다), 그 밖은 단추에 있지 않을 때만. 링크는 어디서나 제 Enter다(Space로 열리지 않는다) */
export function takesPrimaryEnter(place: KeyPlace, target: EventTarget | null): boolean {
  if (target instanceof Element && target.closest("a[href]")) return false;
  if (place === "paper" || place === "side") return true;
  return place === "other" && !(target instanceof Element && target.closest(CONTROL_SELECTOR));
}

/** 마우스로 누른 뒤 포커스를 용지로 돌릴 단추인가 - 오른쪽 칸 · 위쪽 도구 줄 · 문서 머리. 메뉴 · 목록을 여는 단추는 그 글쇠가 이어지게, 용지 안의 단추와 판은 그대로 둔다 */
export function returnsToPaper(pressed: Element): boolean {
  const place = readKeyPlace(pressed);
  return (place === "side" || place === "other") && !pressed.hasAttribute("aria-haspopup");
}

/** 마우스(터치)로 누른 클릭인가 - 글쇠로 누르면 detail이 0이다 */
export function isMousePress(event: { detail: number }): boolean {
  return event.detail > 0;
}
