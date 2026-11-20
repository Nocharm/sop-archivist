// Assign 되돌리기 모델 - 저장 종류 고르기, 알림 문구, Ctrl+Z 키 해석.
import type { DecisionStepResult, SaveOp } from "@/lib/api-sop";

/** 알림 문구 - 메시지 키와 채울 값 */
export interface StepMessage {
  key: string;
  vars: Record<string, string | number>;
}

interface KeyLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** 이 저장이 어떤 일이었는지 - 보류는 hold, 잇기 목적지에서 빠진 이음이 있으면 unlink, 아니면 link·confirm */
export function pickSaveOp(input: { action: "confirm" | "hold"; destinationKind: string | null; savedLinkIds: number[]; nextLinkIds: number[] }): SaveOp {
  if (input.action === "hold") return "hold";
  if (input.destinationKind !== "link") return "confirm";
  const next = new Set(input.nextLinkIds);
  return input.savedLinkIds.some((id) => !next.has(id)) ? "unlink" : "link";
}

/** 되돌린·다시 한 일의 이름과 대상 - 단위 하나면 표시 번호, 여럿이면 수, 단위 없이 New 하나면 그 라벨, reset은 범위 이름 */
export function describeDecisionStep(
  result: DecisionStepResult,
  kind: "undo" | "redo",
  findDisplayId: (unitId: number) => string | null,
  findTargetLabel: (targetId: number) => string | null,
): StepMessage {
  const count = result.unit_ids.length;
  let target: string | number = "";
  if (result.op === "reset") target = result.scope_label ?? "assign.step.wholeBundle";
  else if (count === 1) target = findDisplayId(result.unit_ids[0]) ?? "";
  else if (count > 1) target = count;
  else if (result.focus_target_id !== null) target = findTargetLabel(result.focus_target_id) ?? "";
  return { key: `assign.${kind === "undo" ? "undone" : "redone"}.what`, vars: { action: `assign.step.${result.op}`, target } };
}

/** 제자리에서 바뀌는 편집 - Unit이 그대로라(언어·참조·번호·짝 카드 안 순서·벗긴 표 줄 순서) 하고 난 뒤에도 고른 줄이 유효하다. 이름은 편집 요청의 type과 같다 */
export const IN_PLACE_EDIT_OPS: ReadonlySet<string> = new Set(["set_language", "set_ref", "clear_ref", "set_number", "reorder_pair", "reorder_unwrapped"]);

/** 판단 저장 단계(되돌리기 기록의 op) - 판단만 바꾸고 Unit은 은퇴시키지 않는다. 되돌려도 고른 줄을 둔다 */
const DECISION_STEP_OPS: ReadonlySet<string> = new Set(["confirm", "hold", "link", "unlink", "mark_new", "link_source", "confirm_identical", "accept_ai", "delete", "move_out", "clear", "reset"]);

/** 원문 편집 단계(되돌리기 기록의 op, 자르기는 cut) - 서버는 판단이 걸린 편집을 되돌리지 않는다(confirm 없이) */
const UNIT_EDIT_STEP_OPS: ReadonlySet<string> = new Set([
  "cut", "carve", "merge", "unmerge", "move_boundary", "set_layout_table", "attach_caption", "detach_caption", "set_first_row_caption",
  "group_figures", "ungroup_figures", "set_heading", "clear_noise", ...IN_PLACE_EDIT_OPS,
]);

/**
 * 되돌리기·다시 하기가 원문 편집이었나 - 그러면 판단 · 대상(Target)이 그대로라 Old 문서 보기 · 줄만 다시 받는다(설계 2026-11-20 D2).
 * 판단 저장 단계와 모르는 op는 아니다(모두 다시 받는 안전한 쪽)
 */
export function isUnitEditStep(op: string): boolean {
  return UNIT_EDIT_STEP_OPS.has(op);
}

/**
 * 되돌리기·다시 하기가 고른 줄을 비워야 하는가 - 단위가 걸린 모양 편집(자르기·합치기·제목↔문장 등)은 Unit이 은퇴할 수 있어,
 * 고른 채 다시 받으면 없는 Unit의 묶음·후보를 부른다. 제자리 편집과 판단 저장은 두고, 모르는 op는 안전한 쪽(비움)으로 본다
 */
export function shouldDropSelectionOnStep(result: Pick<DecisionStepResult, "op" | "unit_ids">): boolean {
  return result.unit_ids.length > 0 && !IN_PLACE_EDIT_OPS.has(result.op) && !DECISION_STEP_OPS.has(result.op);
}

/** Ctrl/⌘+Z는 되돌리기, +Shift는 다시 하기 - 글자 입력 중이거나 층이 열려 있으면 브라우저·층에 맡긴다 */
export function getAssignUndoKey(event: KeyLike, ctx: { typing: boolean; layerOpen: boolean; canEdit: boolean }): "undo" | "redo" | null {
  if (ctx.typing || ctx.layerOpen || !ctx.canEdit) return null;
  if (!(event.metaKey || event.ctrlKey) || event.altKey || event.key.toLowerCase() !== "z") return null;
  return event.shiftKey ? "redo" : "undo";
}
