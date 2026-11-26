// 오른쪽 칸(다듬기 · 결정)이 보일 쪽 - 마지막에 누른 쪽. 안 보이는 쪽(한 단 · Pair view)의 고름은 남되 세지 않는다(쪼개기 먼저 §8).
import type { Picks } from "./assign-focus-model";
import type { PickSide } from "./doc-shape-model";

/** keptOldId - New를 눌렀지만 Old 박스도 골라 두었으면 그 박스(오른쪽 칸 위의 "Old n 고름 · 결정 보기") */
export function readPanelSide(picks: Pick<Picks, "old" | "new" | "last">, shown: { old: boolean; new: boolean }): { side: PickSide | null; keptOldId: number | null } {
  const has = { old: shown.old && picks.old.kind !== "none", new: shown.new && picks.new.kind !== "none" };
  const other: PickSide = picks.last === "new" ? "old" : "new";
  const side = picks.last !== null && has[picks.last] ? picks.last : picks.last !== null && has[other] ? other : null;
  return { side, keptOldId: side === "new" && has.old && picks.old.kind === "unit" ? picks.old.unitId : null };
}

/**
 * 메뉴 글쇠 · Shift+F10이 우클릭 메뉴를 열 박스 - 마지막에 누른 쪽(오른쪽 칸과 같은 답). 아무것도 안 골랐으면 null.
 * cutId는 그 쪽 나눌 선의 문장 - Old 줄과 한 단으로 연 New("solo")는 그 문장에서 연다. 양 단의 New는 우클릭처럼 고른 박스에서 연다
 */
export function readMenuKeyTarget(at: { side: PickSide | null; isSolo: boolean; cutId: number | null; oldId: number | null; newId: number | null }): { pane: "old" | "new" | "solo"; unitId: number } | null {
  if (at.side === "old" && at.oldId !== null) return { pane: "old", unitId: at.cutId ?? at.oldId };
  if (at.side !== "new" || at.newId === null) return null;
  return at.isSolo ? { pane: "solo", unitId: at.cutId ?? at.newId } : { pane: "new", unitId: at.newId };
}
