// AI 추천 일괄 수락 모델 - 확인 창의 모양별 건수, 보낼 제안 id, 알약 메뉴의 건수를 정하는 순수 함수(설계 2026-11-19-ai-suggest-only D3, §5 3-2~3-4).

import type { AcceptItem, AcceptKind, AiSuggestion, CoverStatus } from "./api-sop";
import { HIDDEN_AI_KINDS, isOpenSuggestion } from "./ai-suggestion-model";

/** 확인 창에 보이는 모양 순서 - 받는 것(놓기·잇기·신규)이 먼저, 삭제는 따로 체크하는 줄이다 */
const SHAPE_ORDER = ["assigned", "one_to_one", "merged", "split", "table", "figure", "new", "delete", "delete_candidate"];

export interface ShapeCount {
  shape: string;
  count: number;
}

/** 모양별 건수 - 삭제는 빼고(따로 체크한다) 정해진 순서로, 모르는 모양은 뒤에 */
export function countShapes(items: readonly AcceptItem[]): ShapeCount[] {
  const counts = new Map<string, number>();
  for (const item of items) if (!item.is_delete) counts.set(item.shape, (counts.get(item.shape) ?? 0) + 1);
  const rank = (shape: string) => (SHAPE_ORDER.includes(shape) ? SHAPE_ORDER.indexOf(shape) : SHAPE_ORDER.length);
  return [...counts].map(([shape, count]) => ({ shape, count })).sort((a, b) => rank(a.shape) - rank(b.shape) || a.shape.localeCompare(b.shape));
}

export function countDeletes(items: readonly AcceptItem[]): number {
  return items.filter((item) => item.is_delete).length;
}

/** 보낼 제안 - 삭제는 체크했을 때만 */
export function pickAcceptIds(items: readonly AcceptItem[], includeDeletes: boolean): number[] {
  return items.filter((item) => includeDeletes || !item.is_delete).map((item) => item.suggestion_id);
}

/** 서버 상한씩 나눈 요청 - 나눠 보내도 같은 되돌리기 단계(step_key)로 묶는다 */
export function splitAcceptIds(ids: readonly number[], size: number): number[][] {
  const batches: number[][] = [];
  for (let start = 0; start < ids.length; start += size) batches.push(ids.slice(start, start + size));
  return batches;
}

/** 받을 수 있는가 - 고른 것이 있고, 삭제를 함께 받으면 공통 Remark가 있어야 한다(§5 3-4) */
export function canAccept(items: readonly AcceptItem[], includeDeletes: boolean): boolean {
  return pickAcceptIds(items, includeDeletes).length > 0;
}

const ACCEPT_KINDS: readonly AcceptKind[] = ["classify", "match"];

/** 알약 메뉴에서 한 번에 받을 수 있는 종류 - 숨긴 종류는 뺀다 */
export function listAcceptKinds(drafting: boolean): readonly AcceptKind[] {
  return drafting ? ACCEPT_KINDS : ACCEPT_KINDS.filter((kind) => !HIDDEN_AI_KINDS.has(kind));
}

/** 알약 메뉴의 건수 - 지금 연 Old 문서의 제안 중 아직 받을 수 있는 것(덮는 줄이 모두 안 정함)을 종류별로 센다. 받을 수 있는지의 끝은 확인 창이 서버에 묻는다 */
export function countLiveOffer(items: readonly AiSuggestion[], documentId: number | null, statusOfUnit: ReadonlyMap<number, CoverStatus>): Record<AcceptKind, number> {
  const counts: Record<AcceptKind, number> = { classify: 0, match: 0 };
  for (const item of items) {
    if (!isOpenSuggestion(item, statusOfUnit, documentId)) continue;
    if (item.kind === "classify" || item.kind === "match") counts[item.kind] += 1;
  }
  return counts;
}
