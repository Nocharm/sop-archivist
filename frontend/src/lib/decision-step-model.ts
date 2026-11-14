// Assign 되돌리기 모델 - 저장 종류 고르기, 알림 문구, Ctrl+Z 키 해석. Split의 edit-step-model·split-keys와 같은 모양.
import type { DecisionStepResult, SaveOp } from "@/lib/api-sop";
import type { StepMessage } from "@/lib/edit-step-model";

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

/** Ctrl/⌘+Z는 되돌리기, +Shift는 다시 하기 - 글자 입력 중이거나 층이 열려 있으면 브라우저·층에 맡긴다 */
export function getAssignUndoKey(event: KeyLike, ctx: { typing: boolean; layerOpen: boolean; canEdit: boolean }): "undo" | "redo" | null {
  if (ctx.typing || ctx.layerOpen || !ctx.canEdit) return null;
  if (!(event.metaKey || event.ctrlKey) || event.altKey || event.key.toLowerCase() !== "z") return null;
  return event.shiftKey ? "redo" : "undo";
}
