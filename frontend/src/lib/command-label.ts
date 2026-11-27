// 실패 알림 · 대기 칩이 부르는 명령의 이름(메시지 키) - 되돌리기 알림과 같은 이름을 쓴다(assign.step.*), 거기 없는 것만 assign.queue.act.*

import type { EditOp } from "./api-sop";
import { findAssignKey, type AssignKeyId } from "./assign-keymap";

// 장벽 뒤에 쌓인 글쇠의 이름 - 그 글쇠가 보낼 명령과 같은 이름. 없는 것(이동 · 나눌 선 옮기기 · 글 칸 여는 글쇠 등)은 이름 없이 수만 보인다
const KEY_LABEL_KEYS: Partial<Record<AssignKeyId, string>> = {
  confirm: "assign.step.confirm",
  delete: "assign.step.delete",
  clear: "classify.clear",
  clear_block: "classify.clear",
  hold: "assign.step.hold",
  split: "assign.step.cut",
  split_sentences: "assign.step.split_sentences",
  merge_next: "assign.step.merge",
  merge_prev: "assign.step.merge",
  lang: "assign.step.set_language",
  table: "assign.step.set_layout_table",
  indent: "assign.step.set_indents",
  outdent: "assign.step.set_indents",
  undo: "assign.queue.act.undo",
  redo: "assign.queue.act.redo",
};

/** 쌓인 글쇠(key는 readKeyName의 글자)의 이름 - 모르면 null */
export function readKeyLabelKey(press: { key: string; shift: boolean; ctrl: boolean }): string | null {
  const hit = findAssignKey({ key: press.key, shiftKey: press.shift, ctrlKey: press.ctrl, metaKey: false, altKey: false });
  return hit?.kind === "run" ? (KEY_LABEL_KEYS[hit.entry.id] ?? null) : null;
}

const EDIT_LABEL_KEYS: Record<EditOp["type"], string> = {
  merge: "assign.step.merge",
  merge_rows: "assign.step.merge_rows",
  split: "assign.step.cut",
  split_sentences: "assign.step.split_sentences",
  carve: "assign.step.carve",
  move_boundary: "assign.queue.act.boundary",
  unmerge: "assign.step.unmerge",
  set_layout_table: "assign.step.set_layout_table",
  set_layout_tables: "assign.step.set_layout_tables",
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
  set_noise_reason: "assign.step.set_noise_reason",
  start_body: "assign.step.start_body",
  reorder_pair: "assign.step.reorder_pair",
  reorder_unwrapped: "assign.step.reorder_unwrapped",
  follow_table: "assign.step.follow_table",
};

export function readEditLabelKey(op: Pick<EditOp, "type">): string {
  return EDIT_LABEL_KEYS[op.type];
}

export const EDIT_LABELS: readonly string[] = Object.values(EDIT_LABEL_KEYS);

/** 문장 안에 끼울 까닭 - 끝의 마침표를 뗀다 */
export function trimReason(reason: string): string {
  return reason.trim().replace(/[.。]+$/, "");
}
