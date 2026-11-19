// 결과물 C 순서 바꾸기 - 칸 안에서 새 문장 하나를 위·아래로 옮길 수 있는지(칸 끝이면 단추를 끈다).
// 옮긴 뒤의 문서와 서버가 받는 "그 새 문서의 새 문장 전부, 새 순서대로" 목록은 c-edit-model이 짓는다.
import type { OutputCItem } from "./api-sop";

export type MoveDir = -1 | 1;

/** 옮길 수 있는가 - 칸 안에 그 줄이 있고 그 방향 이웃이 있을 때만(단추를 켤지 정한다) */
export function canMoveTarget(items: readonly OutputCItem[], targetId: number, dir: MoveDir): boolean {
  const index = items.findIndex((item) => item.target_id === targetId);
  const next = index + dir;
  return index >= 0 && next >= 0 && next < items.length;
}

/** 고른 줄에서 누른 글쇠가 한 자리 옮기기(Alt+↑·↓)인가 - 그 방향으로 옮길 수 있을 때만. null이면 기본 동작을 막지 않는다 */
export function readMoveKey(
  event: { key: string; shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean },
  state: { canUp: boolean; canDown: boolean },
): MoveDir | null {
  if (!event.altKey || event.shiftKey || event.ctrlKey || event.metaKey) return null;
  if (event.key === "ArrowUp") return state.canUp ? -1 : null;
  if (event.key === "ArrowDown") return state.canDown ? 1 : null;
  return null;
}
