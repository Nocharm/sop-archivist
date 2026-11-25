// Assign 용지 탭(본문 · 머리말 · 꼬리말 · 그림)의 순환과 뒤로 가기 - 탭을 바꿀 때마다 같은 주소의 방문 기록을 하나 더하고, 탭 이름을 그 기록의 상태에 적는다(B2-R6 · R7).
// 상태는 Next가 적은 칸을 그대로 두고 한 칸만 더한다 - Next의 칸이 없으면 뒤로 가기에서 화면을 통째로 다시 읽는다.

import type { PaperTabKey } from "./paper-model";

const PARTS: ReadonlySet<string> = new Set<PaperTabKey>(["body", "header", "footer", "figures"]);

/** 있는 탭 사이 순환 - 하나뿐이면 그대로 */
export function stepPart(keys: readonly PaperTabKey[], active: PaperTabKey, delta: -1 | 1): PaperTabKey {
  if (keys.length === 0) return active;
  return keys[(keys.indexOf(active) + delta + keys.length) % keys.length];
}

/** 방문 기록 상태에 적힌 탭 - 없으면 null(원래 뒤로 가기) */
export function readPartState(state: unknown): PaperTabKey | null {
  if (typeof state !== "object" || state === null || !("assignPart" in state)) return null;
  const part = state.assignPart;
  return typeof part === "string" && PARTS.has(part) ? (part as PaperTabKey) : null;
}

/** 지금 방문 기록 상태에 탭을 적은 것 */
export function withPartState(state: unknown, part: PaperTabKey): object {
  return { ...(typeof state === "object" ? state : null), assignPart: part };
}
