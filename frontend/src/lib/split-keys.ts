// Split 화면 단축키 판단 - 화면(page)은 이 결과대로 실행만 한다. ↑↓는 J/K와 같고, 입력 중·메뉴·모달이 열려 있으면 아무것도 하지 않는다.

export type SplitKeyAction = "next" | "prev" | "check" | "uncheck" | "split" | "hold" | "escape" | "undo" | "redo";

export interface SplitKeyContext {
  /** 글 입력 칸에 포커스가 있다 */
  typing: boolean;
  /** 메뉴·모달처럼 키를 먼저 받아야 할 층이 열려 있다 */
  layerOpen: boolean;
  /** 나눌 선이 놓여 있다 */
  hasCut: boolean;
  /** 고른 단위의 경계를 이미 확인했다 */
  checked: boolean;
  canEdit: boolean;
}

interface KeyLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export function getSplitKeyAction(event: KeyLike, ctx: SplitKeyContext): SplitKeyAction | null {
  if (ctx.typing || ctx.layerOpen) return null;
  const key = event.key.toLowerCase();
  if ((event.metaKey || event.ctrlKey) && key === "z") return ctx.canEdit ? (event.shiftKey ? "redo" : "undo") : null;
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  if (key === "j" || key === "arrowdown") return "next";
  if (key === "k" || key === "arrowup") return "prev";
  if (key === "escape") return "escape";
  if (!ctx.canEdit) return null;
  if (key === "enter") return ctx.checked ? null : "check";
  if (key === "u") return ctx.checked ? "uncheck" : null;
  if (key === "s") return ctx.hasCut ? "split" : null;
  if (key === "h") return "hold";
  return null;
}
