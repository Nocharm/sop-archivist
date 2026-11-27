// 연습 과제 열넷의 표 · 판정 · 펼칠 과제 · 말풍선 대상 · 통하는 글쇠(설계 2026-11-26-practice-page §7, D9 · D10 · D22, 말풍선 2026-11-27 시안 A). React · fetch 없음 - 말풍선 · 띠 · 틀이 렌더 중과 글쇠 처리에서 읽는다.
// 판정은 가짜 서버의 한 일 기록(append-only)으로 한다 - 한 번 이룬 과제는 되돌려도 남는다. 어느 줄에서 해도 된다.
// 차례는 보기로 나눈다(2026-11-27 안내형): 양 단에서 잇기까지 → V로 한 단 → 한 단에서 확정 · 손질 → V로 양 단 → 어느 보기에서나.

import type { AssignKeyId } from "../assign-keymap";

import type { PaneView, PracticeLogEntry } from "./practice-server";

export type PracticeTaskId = "pick" | "link" | "unassign" | "view_one" | "confirm" | "hold" | "merge" | "split" | "pair" | "unwrap" | "toc" | "view_two" | "undo" | "keyboard";

/** 말풍선 머리의 장 이름(practice.chapter.<id>) - 그 과제를 하는 보기. 순서는 자유라 잠그지 않고 이름만 단다 */
export type PracticeChapter = "two" | "view" | "one" | "any";

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
  /** 그리지 않지만 그 과제를 해내는 길에 닿는 글쇠(잇기의 양쪽 고른 Enter, 나눌 선 옮기기 ← →, ⇧K 합치기) */
  allow: readonly AssignKeyId[];
  /** 그 과제를 설명하는 보기 - 지금 보기와 다르면 말풍선이 V를 먼저 안내하고 V가 통한다. null = 어느 보기에서나 */
  pane: PaneView | null;
  /** 보기 바꾸기 과제가 가는 보기 */
  switchTo: PaneView | null;
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
  allow?: readonly AssignKeyId[];
  switchTo?: PaneView;
  target: PracticeTarget;
}

/** 장이 곧 보기다 - 양 단 · 한 단 장의 과제는 그 보기에서, 보기 바꾸기 · 어느 보기 장은 보기를 따지지 않는다 */
const PANE_OF: Record<PracticeChapter, PaneView | null> = { two: "two", one: "one", view: null, any: null };

function buildTask(id: PracticeTaskId, { chapter, anchor, keys, allow = [], switchTo, target }: TaskSpec, isDone: PracticeTask["isDone"]): PracticeTask {
  return { id, titleKey: `practice.task.${id}.title`, bodyKey: `practice.task.${id}.body`, chapter, anchor, keys, allow, pane: PANE_OF[chapter], switchTo: switchTo ?? null, target, isDone };
}

const isViewAct = (entry: PracticeLogEntry, to: PaneView) => "act" in entry && "view" in entry.act && entry.act.view === to;

/** 잇기 · 카드 확정의 저장(보류 빼고) - 배정 취소의 대상을 고른다 */
const isLinkOrConfirm = (entry: PracticeLogEntry): entry is WriteEntry => isWrite(entry) && entry.route === "groups/save" && entry.action === "confirm";

/**
 * 과제 표(U3의 열둘 + 보기 바꾸기 둘, 보기로 나눈 차례). 잇기와 확정은 둘 다 groups/save라 되돌리기 메타로 가른다(D22) - 잇기 길(sendLink)은 이은 New 문장을 focus_target_id로 싣고, 카드 확정 길(sendSave)은 싣지 않는다.
 * 대상 Unit은 과제 글이 가리키는 자료의 자리다(짝은 한국어 쪽 - 박스의 첫 Unit). 자료를 다시 뽑아 id가 바뀌면 practice-tasks.test.ts가 알린다.
 * 보기: 잇기만 양 단이 꼭 필요하다(이미 쓴 New 문장을 눌러 고른다 - 설명서 #assign). 확정 · 보류 · 손질은 한 단에서도 되고 Old를 넓게 보는 편이 설명하기 쉽다.
 */
export const PRACTICE_TASKS: readonly PracticeTask[] = [
  // 양 단 - Old와 New를 나란히. 목적 머리 짝 - 아무 줄이나 되지만 목차 아래 첫 상자를 가리킨다
  buildTask("pick", { chapter: "two", anchor: "assign", keys: ["move_next", "move_prev"], target: { unit: 11 } }, (entry) => "act" in entry && "key" in entry.act && (entry.act.key === "move_next" || entry.act.key === "move_prev")),
  // 단추 줄의 잇기 대신 양쪽을 고른 채 Enter로도 잇는다(pick-bar-model) - 그래서 Enter가 통한다
  buildTask("link", { chapter: "two", anchor: "assign-destination", keys: [], allow: ["confirm"], target: { unit: 13 } }, (entry) => isWrite(entry) && entry.route === "groups/save" && entry.undoOp === "link" && entry.focusTargetId !== undefined),
  buildTask("unassign", { chapter: "two", anchor: "assign-confirm", keys: ["clear"], target: { lastLinked: true } }, (entry) => isWrite(entry) && (entry.route === "decisions/clear" || (entry.route === "decisions/bulk" && entry.action === "clear"))),
  // 보기 바꾸기 - V나 위쪽 줄의 보기 단추(연습 틀이 바뀐 보기를 적는다)
  buildTask("view_one", { chapter: "view", anchor: "assign", keys: ["view"], switchTo: "one", target: { testId: "assign-view-one" } }, (entry) => isViewAct(entry, "one")),
  // 한 단 - Old 문서 하나를 넓게. 카드 확정은 오른쪽 칸의 추천 카드라 한 단에서도 된다
  buildTask("confirm", { chapter: "one", anchor: "assign-confirm", keys: ["confirm"], target: { unit: 15 } }, (entry) => isLinkOrConfirm(entry) && entry.focusTargetId === undefined),
  buildTask("hold", { chapter: "one", anchor: "assign-confirm", keys: ["hold"], target: { unit: 17 } }, (entry) => isWrite(entry) && entry.route === "groups/save" && entry.action === "hold"),
  // ⇧P의 첫걸음(짝 → 한 문장)도 merge라 짝 합치기는 빼고 센다. 대상은 끊긴 두 조각의 앞 조각 - 뒤 조각에서 ⇧K ⇧K도 같다
  buildTask("merge", { chapter: "one", anchor: "split-edit", keys: ["merge_next"], allow: ["merge_prev"], target: { unit: 20 } }, (entry) => isEdit(entry, "merge") && isWrite(entry) && entry.isPairJoin !== true),
  // 두 번 눌러 놓은 선을 ← →로 옮긴 뒤 S
  buildTask("split", { chapter: "one", anchor: "split-edit", keys: ["split"], allow: ["cut_left", "cut_right"], target: { unit: 19 } }, (entry) => isEdit(entry, "split")),
  buildTask("pair", { chapter: "one", anchor: "split-pair", keys: ["shape_mode"], target: { unit: 24 } }, (entry) => isWrite(entry) && entry.route === "pairs"),
  buildTask("unwrap", { chapter: "one", anchor: "assign-unwrap", keys: ["table"], target: { unit: 28 } }, (entry) => isEdit(entry, "set_layout_table:unwrap")),
  // 목차 블록(머리 Unit 5부터) - 이미 삭제로 접혀 있다
  buildTask("toc", { chapter: "one", anchor: "assign-toc", keys: ["remark"], target: { noise: 5 } }, (entry) => isEdit(entry, "set_noise_reason")),
  // 양 단으로 돌아온다 - 보기는 이 브라우저에 기억되니(D18) 실제 Assign이 한 단으로 남지 않게
  buildTask("view_two", { chapter: "view", anchor: "assign", keys: ["view"], switchTo: "two", target: { testId: "assign-view-two" } }, (entry) => isViewAct(entry, "two")),
  // 어느 보기에서나
  buildTask("undo", { chapter: "any", anchor: "assign-undo", keys: ["undo"], target: { testId: "assign-undo" } }, (entry) => isWrite(entry) && entry.route === "decisions/undo"),
  // 도움말이 열려 있으면 그 안의 키보드 그림 단추, 닫혀 있으면 상자 없음(? 글쇠부터)
  buildTask("keyboard", { chapter: "any", anchor: "assign-keys", keys: ["help"], target: { testId: "assign-help-keyboard-map" } }, (entry) => "act" in entry && "click" in entry.act && entry.act.click === "keyboard-map"),
];

export function findPracticeTask(id: PracticeTaskId | null): PracticeTask | null {
  return PRACTICE_TASKS.find((task) => task.id === id) ?? null;
}

/** 과제가 바라는 보기와 지금 보기가 어긋났다 - 말풍선이 V를 먼저 안내한다. 보기를 아직 모르면(용지 전 · Pair view) 어긋나지 않은 것으로 본다 */
export function isPaneOff(task: PracticeTask, paneNow: PaneView | null): boolean {
  return task.pane !== null && paneNow !== null && paneNow !== task.pane;
}

/** 보기 바꾸기 과제인데 이미 그 보기다 - V로 나갔다가 다시 V로 온다 */
export function isAlreadyThere(task: PracticeTask, paneNow: PaneView | null): boolean {
  return task.switchTo !== null && paneNow === task.switchTo;
}

/** 말풍선이 밝힐 상자 - 보기가 어긋났으면 과제의 보기로 가는 단추(위쪽 줄), 아니면 과제의 상자 */
export function readTaskTarget(task: PracticeTask, paneNow: PaneView | null): PracticeTarget {
  return isPaneOff(task, paneNow) && task.pane !== null ? { testId: `assign-view-${task.pane}` } : task.target;
}

/** 과제가 열려 있어도 늘 통하는 글쇠 - 과제의 줄에 닿는 옮기기(J · K · 화살표 · Tab)와 창 · 선 · 고름을 거두는 Esc */
const ALWAYS_KEYS: readonly AssignKeyId[] = ["move_next", "move_prev", "escape"];

/**
 * 지금 과제에서 통하는 Assign 글쇠(2026-11-27 안내형) - 과제의 글쇠 · 그 길에 닿는 글쇠 · 늘 통하는 글쇠, 보기가 어긋났으면 V.
 * null = 막지 않는다(과제가 없다 - 다 끝냈다). 글 칸 · 창 · 메뉴 안의 글쇠는 틀이 따로 거른다(그 층의 글쇠다).
 */
export function listAllowedKeys(taskId: PracticeTaskId | null, paneNow: PaneView | null): ReadonlySet<AssignKeyId> | null {
  const task = findPracticeTask(taskId);
  if (task === null) return null;
  return new Set<AssignKeyId>([...ALWAYS_KEYS, ...task.keys, ...task.allow, ...(isPaneOff(task, paneNow) ? (["view"] as const) : [])]);
}

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
