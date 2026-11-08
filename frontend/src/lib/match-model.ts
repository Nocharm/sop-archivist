// 짝 맞추기(입구 2) 모델 - 같은 글자 후보를 한 번에 확정 요청으로 바꾸는 순수 함수.

import type { BulkMatchInput, IdenticalCandidate } from "./api-sop";

/** 한 번에 확정 요청 하나에 담는 항목 상한 - backend match.MAX_BULK_MATCH와 같은 값(넘으면 422) */
export const MAX_BULK_MATCH = 1000;

/** 후보를 상한씩 나눈 요청들 - revision은 후보 목록에 실려 오므로 후보마다 묶음을 다시 부르지 않는다 */
export function buildIdenticalBatches(candidates: IdenticalCandidate[]): BulkMatchInput[] {
  const batches: BulkMatchInput[] = [];
  for (let start = 0; start < candidates.length; start += MAX_BULK_MATCH) {
    batches.push({
      identical: candidates.slice(start, start + MAX_BULK_MATCH).map((candidate) => ({
        unit_id: candidate.unit_id,
        unit_revision: candidate.unit_revision,
        target_id: candidate.target_id,
        target_revision: candidate.target_revision,
      })),
      new: [],
    });
  }
  return batches;
}
