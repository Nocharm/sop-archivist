// 짝 맞추기 모델 - 같은 글자 후보를 서버 상한(1000)씩 나눠, 후보에 실린 revision으로 한 번에 확정 요청을 만든다.
import { describe, expect, it } from "vitest";

import type { IdenticalCandidate } from "./api-sop";
import { buildIdenticalBatches, MAX_BULK_MATCH } from "./match-model";

function makeCandidate(id: number): IdenticalCandidate {
  return { unit_id: id, target_id: 10_000 + id, lang: "ko", text: `문장 ${id}`, unit_revision: 2, target_revision: 3 };
}

describe("identical batches", () => {
  it("splits more than the server limit into requests of at most 1000", () => {
    const candidates = Array.from({ length: MAX_BULK_MATCH * 2 + 5 }, (_, index) => makeCandidate(index + 1));
    const batches = buildIdenticalBatches(candidates);
    expect(batches.map((batch) => batch.identical.length)).toEqual([1000, 1000, 5]);
    expect(batches.every((batch) => batch.new.length === 0)).toBe(true);
  });

  it("carries the revisions from the candidate list", () => {
    expect(buildIdenticalBatches([makeCandidate(7)])).toEqual([
      { identical: [{ unit_id: 7, unit_revision: 2, target_id: 10_007, target_revision: 3 }], new: [] },
    ]);
  });

  it("sends nothing for no candidates", () => {
    expect(buildIdenticalBatches([])).toEqual([]);
  });
});
