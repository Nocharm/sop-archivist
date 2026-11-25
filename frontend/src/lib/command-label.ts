// 실패 알림이 부르는 명령의 이름(메시지 키) - 되돌리기 알림과 같은 이름을 쓴다(assign.step.*), 거기 없는 것만 assign.queue.act.*

import type { EditOp } from "./api-sop";

const EDIT_LABEL_KEYS: Record<EditOp["type"], string> = {
  merge: "assign.step.merge",
  split: "assign.step.cut",
  carve: "assign.step.carve",
  move_boundary: "assign.queue.act.boundary",
  unmerge: "assign.step.unmerge",
  set_layout_table: "assign.step.set_layout_table",
  set_language: "assign.step.set_language",
  switch_language: "assign.step.set_language",
  set_ref: "assign.step.set_ref",
  clear_ref: "assign.step.clear_ref",
  set_number: "assign.step.set_number",
  set_indents: "assign.step.set_indents",
  set_heading: "assign.queue.act.heading",
  attach_caption: "assign.step.attach_caption",
  detach_caption: "assign.step.detach_caption",
  set_first_row_caption: "assign.step.set_first_row_caption",
  group_figures: "assign.step.group_figures",
  ungroup_figures: "assign.step.ungroup_figures",
  clear_noise: "assign.step.clear_noise",
  reorder_pair: "assign.step.reorder_pair",
  reorder_unwrapped: "assign.step.reorder_unwrapped",
};

export function readEditLabelKey(op: Pick<EditOp, "type">): string {
  return EDIT_LABEL_KEYS[op.type];
}

export const EDIT_LABELS: readonly string[] = Object.values(EDIT_LABEL_KEYS);

/** 문장 안에 끼울 까닭 - 끝의 마침표를 뗀다 */
export function trimReason(reason: string): string {
  return reason.trim().replace(/[.。]+$/, "");
}
