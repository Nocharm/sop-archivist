// 연습 과제 열둘의 표 · 판정 · 펼칠 과제(설계 2026-11-26-practice-page §7, D9 · D10 · D22). React · fetch 없음 - 과제 칸이 렌더 중에 읽는다.
// 판정은 가짜 서버의 한 일 기록(append-only)으로 한다 - 한 번 이룬 과제는 되돌려도 남는다. 어느 줄에서 해도 된다.

import type { AssignKeyId } from "../assign-keymap";

import type { PracticeLogEntry } from "./practice-server";

export type PracticeTaskId = "pick" | "link" | "confirm" | "hold" | "unassign" | "merge" | "split" | "pair" | "unwrap" | "toc" | "undo" | "keyboard";

export interface PracticeTask {
  id: PracticeTaskId;
  titleKey: string;
  bodyKey: string;
  /** 설명서의 자리 이름(user-manual.md의 {#anchor}) */
  anchor: string;
  /** 과제 글에 그리는 글쇠 - ASSIGN_KEYS의 id, 글자는 formatAssignKey로(D19) */
  keys: readonly AssignKeyId[];
  isDone: (entry: PracticeLogEntry) => boolean;
}

type WriteEntry = Exclude<PracticeLogEntry, { act: unknown }>;

function isWrite(entry: PracticeLogEntry): entry is WriteEntry {
  return "route" in entry;
}

const isEdit = (entry: PracticeLogEntry, editType: string) => isWrite(entry) && entry.route === "edits" && entry.editType === editType;

function buildTask(id: PracticeTaskId, anchor: string, keys: readonly AssignKeyId[], isDone: PracticeTask["isDone"]): PracticeTask {
  return { id, titleKey: `practice.task.${id}.title`, bodyKey: `practice.task.${id}.body`, anchor, keys, isDone };
}

/** 과제 표(U3의 차례). 잇기와 확정은 둘 다 groups/save라 되돌리기 메타로 가른다(D22) - 잇기 길(sendLink)은 이은 New 문장을 focus_target_id로 싣고, 카드 확정 길(sendSave)은 싣지 않는다 */
export const PRACTICE_TASKS: readonly PracticeTask[] = [
  buildTask("pick", "assign", ["move_next", "move_prev"], (entry) => "act" in entry && "key" in entry.act && (entry.act.key === "move_next" || entry.act.key === "move_prev")),
  buildTask("link", "assign-destination", [], (entry) => isWrite(entry) && entry.route === "groups/save" && entry.undoOp === "link" && entry.focusTargetId !== undefined),
  buildTask("confirm", "assign-confirm", ["confirm"], (entry) => isWrite(entry) && entry.route === "groups/save" && entry.action === "confirm" && entry.focusTargetId === undefined),
  buildTask("hold", "assign-confirm", ["hold"], (entry) => isWrite(entry) && entry.route === "groups/save" && entry.action === "hold"),
  buildTask("unassign", "assign-confirm", ["clear"], (entry) => isWrite(entry) && (entry.route === "decisions/clear" || (entry.route === "decisions/bulk" && entry.action === "clear"))),
  // ⇧P의 첫걸음(짝 → 한 문장)도 merge라 짝 합치기는 빼고 센다
  buildTask("merge", "split-edit", ["merge_next"], (entry) => isEdit(entry, "merge") && isWrite(entry) && entry.isPairJoin !== true),
  buildTask("split", "split-edit", ["split"], (entry) => isEdit(entry, "split")),
  buildTask("pair", "split-pair", ["shape_mode"], (entry) => isWrite(entry) && entry.route === "pairs"),
  buildTask("unwrap", "assign-unwrap", ["table"], (entry) => isEdit(entry, "set_layout_table:unwrap")),
  buildTask("toc", "assign-toc", ["remark"], (entry) => isEdit(entry, "set_noise_reason")),
  buildTask("undo", "assign-undo", ["undo"], (entry) => isWrite(entry) && entry.route === "decisions/undo"),
  buildTask("keyboard", "assign-keys", ["help"], (entry) => "act" in entry && "click" in entry.act && entry.act.click === "keyboard-map"),
];

/** 기록에서 이룬 과제 - 기록이 append-only라 한 번 이룬 것은 남는다 */
export function listAchieved(log: readonly PracticeLogEntry[]): Set<PracticeTaskId> {
  return new Set(PRACTICE_TASKS.filter((task) => log.some(task.isDone)).map((task) => task.id));
}

/** 사람이 줄 머리를 눌러 펼친 과제 - since는 누를 때의 기록 길이(그 뒤에 이루면 다음 과제로 넘어간다) */
export interface PickedTask {
  id: PracticeTaskId;
  since: number;
}

/**
 * 펼칠 과제(D10): 누른 과제가 있고 누른 뒤 아직 이루지 않았으면 그것(이미 ✓인 과제도 다시 펼쳐 읽을 수 있다),
 * 아니면 첫 미완료(차례대로), 다 끝나면 null.
 */
export function pickOpenTask(log: readonly PracticeLogEntry[], picked: PickedTask | null): PracticeTaskId | null {
  if (picked !== null) {
    const task = PRACTICE_TASKS.find((item) => item.id === picked.id);
    if (task && !log.slice(picked.since).some(task.isDone)) return picked.id;
  }
  const achieved = listAchieved(log);
  return PRACTICE_TASKS.find((task) => !achieved.has(task.id))?.id ?? null;
}
