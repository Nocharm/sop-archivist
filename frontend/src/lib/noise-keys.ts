// 저절로 삭제된 줄에서 누른 글쇠의 뜻(쪼개기 먼저 설계 §7 R3) - 마지막으로 누른 것이 삭제된 줄이면 판단 글쇠보다 먼저 읽는다.
// U 삭제 취소 · R 사유 쓰기는 고른 줄, Shift를 함께 누르거나 블록 머리를 골랐으면 블록 전체. 삭제 · 보류 · 확정은 아무것도 하지 않는다(Old 판단을 건드리지 않게).

import type { EditOp } from "./api-sop";
import type { AssignKeyId } from "./assign-keymap";
import type { NoiseBlock } from "./toc-block-model";

export type NoiseKeyAction = { kind: "clear" | "reason"; unitIds: readonly number[] } | { kind: "none" } | null;

/** 고른 것이 삭제된 줄일 때 글쇠(assign-keymap)가 할 일 - null이면 판단 글쇠로 넘긴다 */
export function readNoiseKey(id: AssignKeyId, pick: { unitId: number | null; block: Pick<NoiseBlock, "unitIds"> } | null): NoiseKeyAction {
  if (pick === null) return null;
  if (id === "delete" || id === "hold" || id === "confirm") return { kind: "none" };
  if (id !== "clear" && id !== "clear_block" && id !== "remark" && id !== "remark_block") return null;
  const isBlock = pick.unitId === null || id === "clear_block" || id === "remark_block";
  const unitIds = isBlock || pick.unitId === null ? pick.block.unitIds : [pick.unitId];
  return { kind: id === "clear" || id === "clear_block" ? "clear" : "reason", unitIds };
}

/** 그 줄들을 되돌리는 삭제 취소가 아직 끝나지 않았나 - 그동안 누른 삭제 · 보류 · 확정 · 사유는 조용히 사라지지 않게 알린다 */
export function isRestoringLines(unsettled: readonly EditOp[], unitIds: readonly number[]): boolean {
  return unsettled.some((op) => op.type === "clear_noise" && op.unit_ids.some((id) => unitIds.includes(id)));
}
