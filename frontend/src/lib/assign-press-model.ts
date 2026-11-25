// Assign 글쇠의 반복 · 쌓기 - 누르고 있어 되풀이되는 글쇠는 이동만 받고, 앞의 장벽이 끝날 때까지 쌓아 둘 글쇠를 가른다(A1-R3).

import { findAssignKey, type AssignKeyId } from "./assign-keymap";

/** edit - 고쳐 쓰기(E). 숨긴 기능이라 글쇠 목록에 없다 */
export type PressId = AssignKeyId | "edit";

// 대상이나 차례가 걸리지 않은 것 - 보기 · 탭 · 거두기는 바로 하고 되돌리기는 제 길로 쌓인다
const LIVE_IDS: ReadonlySet<PressId> = new Set<PressId>(["view", "preview", "escape", "help", "part_prev", "part_next", "undo", "redo"]);
// 누르고 있어도 되는 것 - 줄 이동과 나눌 선 옮기기
const REPEAT_IDS: ReadonlySet<PressId> = new Set<PressId>(["move_next", "move_prev", "cut_left", "cut_right"]);

/** 앞에 장벽이 있으면 쌓아 두었다가 되살릴 글쇠인가 */
export function isQueuedKey(id: PressId): boolean {
  return !LIVE_IDS.has(id);
}

/** 누르고 있어 되풀이된 것을 버릴 글쇠인가 - 판단이 줄줄이 저장되지 않게 */
export function isRepeatIgnored(id: PressId): boolean {
  return !REPEAT_IDS.has(id);
}

/** 되살렸을 때 글 칸을 여는 글쇠인가 - 그 뒤에 친 것은 열릴 글 칸의 글자라 쌓지 않는다 */
export function opensTextBox({ key, shift }: { key: string; shift: boolean }): boolean {
  if (key === "e") return true;
  const hit = findAssignKey({ key, shiftKey: shift, ctrlKey: false, metaKey: false, altKey: false });
  return hit?.kind === "run" && hit.entry.id === "number";
}
