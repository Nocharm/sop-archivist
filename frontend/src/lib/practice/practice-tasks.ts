// 연습 과제 열둘의 표 · 판정 · 펼칠 과제 · 말풍선 대상(설계 2026-11-26-practice-page §7, D9 · D10 · D22, 말풍선 2026-11-27 시안 A). React · fetch 없음 - 말풍선 · 띠가 렌더 중에 읽는다.
// 판정은 가짜 서버의 한 일 기록(append-only)으로 한다 - 한 번 이룬 과제는 되돌려도 남는다. 어느 줄에서 해도 된다.

import type { AssignKeyId } from "../assign-keymap";

import type { PracticeLogEntry } from "./practice-server";

export type PracticeTaskId = "pick" | "link" | "confirm" | "hold" | "unassign" | "merge" | "split" | "pair" | "unwrap" | "toc" | "undo" | "keyboard";

/** 말풍선 머리의 장 이름(practice.chapter.<id>) - 순서는 자유라 잠그지 않고 이름만 단다 */
export type PracticeChapter = "basics" | "shaping" | "tidying" | "advanced";

/**
 * 말풍선이 밝게 드러낼 상자. 연습 자료(practice-fixture.json)의 Old Unit id · 목차 블록 머리 Unit id, 또는 Assign의 단추 testid.
 * lastLinked는 기록에서 마지막으로 잇거나 확정한 줄(배정 취소의 대상 - 아직 없으면 상자 없음).
 */
export type PracticeTarget = { unit: number } | { noise: number } | { testId: string } | { lastLinked: true };

export interface PracticeTask {
  id: PracticeTaskId;
  titleKey: string;
  bodyKey: string;
  chapter: PracticeChapter;
  /** 설명서의 자리 이름(user-manual.md의 {#anchor}) */
  anchor: string;
  /** 과제 글에 그리는 글쇠 - ASSIGN_KEYS의 id, 글자는 formatAssignKey로(D19) */
  keys: readonly AssignKeyId[];
  target: PracticeTarget;
  isDone: (entry: PracticeLogEntry) => boolean;
}

type WriteEntry = Exclude<PracticeLogEntry, { act: unknown }>;

function isWrite(entry: PracticeLogEntry): entry is WriteEntry {
  return "route" in entry;
}

const isEdit = (entry: PracticeLogEntry, editType: string) => isWrite(entry) && entry.route === "edits" && entry.editType === editType;

interface TaskSpec {
  chapter: PracticeChapter;
  anchor: string;
  keys: readonly AssignKeyId[];
  target: PracticeTarget;
}

function buildTask(id: PracticeTaskId, { chapter, anchor, keys, target }: TaskSpec, isDone: PracticeTask["isDone"]): PracticeTask {
  return { id, titleKey: `practice.task.${id}.title`, bodyKey: `practice.task.${id}.body`, chapter, anchor, keys, target, isDone };
}

/** 잇기 · 카드 확정의 저장(보류 빼고) - 배정 취소의 대상을 고른다 */
const isLinkOrConfirm = (entry: PracticeLogEntry): entry is WriteEntry => isWrite(entry) && entry.route === "groups/save" && entry.action === "confirm";

/**
 * 과제 표(U3의 차례). 잇기와 확정은 둘 다 groups/save라 되돌리기 메타로 가른다(D22) - 잇기 길(sendLink)은 이은 New 문장을 focus_target_id로 싣고, 카드 확정 길(sendSave)은 싣지 않는다.
 * 대상 Unit은 과제 글이 가리키는 자료의 자리다(짝은 한국어 쪽 - 박스의 첫 Unit). 자료를 다시 뽑아 id가 바뀌면 practice-tasks.test.ts가 알린다.
 */
export const PRACTICE_TASKS: readonly PracticeTask[] = [
  // 1. 목적 머리 짝 - 아무 줄이나 되지만 목차 아래 첫 상자를 가리킨다
  buildTask("pick", { chapter: "basics", anchor: "assign", keys: ["move_next", "move_prev"], target: { unit: 11 } }, (entry) => "act" in entry && "key" in entry.act && (entry.act.key === "move_next" || entry.act.key === "move_prev")),
  buildTask("link", { chapter: "basics", anchor: "assign-destination", keys: [], target: { unit: 13 } }, (entry) => isWrite(entry) && entry.route === "groups/save" && entry.undoOp === "link" && entry.focusTargetId !== undefined),
  buildTask("confirm", { chapter: "basics", anchor: "assign-confirm", keys: ["confirm"], target: { unit: 15 } }, (entry) => isLinkOrConfirm(entry) && entry.focusTargetId === undefined),
  buildTask("hold", { chapter: "tidying", anchor: "assign-confirm", keys: ["hold"], target: { unit: 17 } }, (entry) => isWrite(entry) && entry.route === "groups/save" && entry.action === "hold"),
  buildTask("unassign", { chapter: "tidying", anchor: "assign-confirm", keys: ["clear"], target: { lastLinked: true } }, (entry) => isWrite(entry) && (entry.route === "decisions/clear" || (entry.route === "decisions/bulk" && entry.action === "clear"))),
  // ⇧P의 첫걸음(짝 → 한 문장)도 merge라 짝 합치기는 빼고 센다. 대상은 끊긴 두 조각의 앞 조각
  buildTask("merge", { chapter: "shaping", anchor: "split-edit", keys: ["merge_next"], target: { unit: 20 } }, (entry) => isEdit(entry, "merge") && isWrite(entry) && entry.isPairJoin !== true),
  buildTask("split", { chapter: "shaping", anchor: "split-edit", keys: ["split"], target: { unit: 19 } }, (entry) => isEdit(entry, "split")),
  buildTask("pair", { chapter: "shaping", anchor: "split-pair", keys: ["shape_mode"], target: { unit: 24 } }, (entry) => isWrite(entry) && entry.route === "pairs"),
  buildTask("unwrap", { chapter: "advanced", anchor: "assign-unwrap", keys: ["table"], target: { unit: 28 } }, (entry) => isEdit(entry, "set_layout_table:unwrap")),
  // 목차 블록(머리 Unit 5부터) - 이미 삭제로 접혀 있다
  buildTask("toc", { chapter: "tidying", anchor: "assign-toc", keys: ["remark"], target: { noise: 5 } }, (entry) => isEdit(entry, "set_noise_reason")),
  buildTask("undo", { chapter: "tidying", anchor: "assign-undo", keys: ["undo"], target: { testId: "assign-undo" } }, (entry) => isWrite(entry) && entry.route === "decisions/undo"),
  // 도움말이 열려 있으면 그 안의 키보드 그림 단추, 닫혀 있으면 상자 없음(? 글쇠부터)
  buildTask("keyboard", { chapter: "advanced", anchor: "assign-keys", keys: ["help"], target: { testId: "assign-help-keyboard-map" } }, (entry) => "act" in entry && "click" in entry.act && entry.act.click === "keyboard-map"),
];

const OLD_PANE = '[data-testid="assign-old"]';

/** Old 용지의 Unit 상자를 찾는 차례 - 박스(piece) · 글 조각(unit) · 삭제 줄(deleted). use-assign-page.tsx가 Unit 자리를 찾는 차례와 같다 */
function listUnitSelectors(unitId: number): string[] {
  return [`${OLD_PANE} [data-testid="assign-paper-piece-${unitId}"]`, `${OLD_PANE} [data-testid="assign-paper-unit-${unitId}"]`, `${OLD_PANE} [data-testid="assign-paper-deleted-u${unitId}"]`];
}

/** 말풍선이 드러낼 상자의 고르개 - 앞에서부터 처음 찾은 것. 빈 배열이면 상자 없음(말풍선은 띠 아래 가운데) */
export function listTargetSelectors(target: PracticeTarget, log: readonly PracticeLogEntry[]): string[] {
  if ("unit" in target) return listUnitSelectors(target.unit);
  if ("noise" in target) return [`${OLD_PANE} [data-testid="assign-paper-noise-${target.noise}"]`];
  if ("testId" in target) return [`[data-testid="${target.testId}"]`];
  const last = log.findLast(isLinkOrConfirm);
  return last?.unitIds[0] === undefined ? [] : listUnitSelectors(last.unitIds[0]);
}

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

/** 건너뛰기 - 지금 과제 뒤(차례대로, 끝에서 처음으로 돌아) 아직 이루지 않은 과제. 남은 것이 지금 과제뿐이면 null */
export function pickNextTask(log: readonly PracticeLogEntry[], fromId: PracticeTaskId): PracticeTaskId | null {
  const achieved = listAchieved(log);
  const at = PRACTICE_TASKS.findIndex((task) => task.id === fromId);
  const rotated = [...PRACTICE_TASKS.slice(at + 1), ...PRACTICE_TASKS.slice(0, at)];
  return rotated.find((task) => !achieved.has(task.id))?.id ?? null;
}

/** 말풍선이 지금 보이고 있는 과제와 그때의 기록 길이 - 그 뒤에 이루면 뒤집혀 체크가 된다 */
export interface CoachSeen {
  id: PracticeTaskId | null;
  since: number;
}

export interface CoachView {
  id: PracticeTaskId | null;
  /** 보던 과제를 막 이루어 뒤집힌 채(체크) - 뒤집기가 끝나면 말풍선이 다음 과제로 옮겨 간다 */
  isDone: boolean;
}

/** 말풍선이 그릴 과제(렌더 중에 셈한다): 보던 과제를 보인 뒤에 이루었으면 그것을 뒤집힌 채로, 아니면 펼칠 과제(pickOpenTask) */
export function readCoachView(log: readonly PracticeLogEntry[], picked: PickedTask | null, seen: CoachSeen): CoachView {
  const openId = pickOpenTask(log, picked);
  if (seen.id !== null && seen.id !== openId) {
    const task = PRACTICE_TASKS.find((item) => item.id === seen.id);
    if (task && log.slice(seen.since).some(task.isDone)) return { id: seen.id, isDone: true };
  }
  return { id: openId, isDone: false };
}
