import { describe, expect, it } from "vitest";

import { canAccept, countDeletes, countLiveOffer, countShapes, pickAcceptIds } from "./ai-accept-model";
import type { AcceptItem, AiSuggestion } from "./api-sop";

function item(suggestion_id: number, shape: string): AcceptItem {
  return { suggestion_id, shape, is_delete: shape === "delete" || shape === "delete_candidate" };
}

function suggestion(id: number, kind: string, extra: Partial<AiSuggestion> = {}): AiSuggestion {
  return { id, job_id: id, kind, document_id: 1, result: "applied", content: {}, warnings: [], guideline_versions: {}, model: "", adoption: null, created_at: "", ...extra };
}

const ITEMS = [item(1, "new"), item(2, "one_to_one"), item(3, "delete_candidate"), item(4, "one_to_one"), item(5, "merged")];

describe("countShapes", () => {
  it("counts the taken shapes in a fixed order and leaves deletes to their own line", () => {
    expect(countShapes(ITEMS)).toEqual([
      { shape: "one_to_one", count: 2 },
      { shape: "merged", count: 1 },
      { shape: "new", count: 1 },
    ]);
    expect(countDeletes(ITEMS)).toBe(1);
  });
});

describe("pickAcceptIds and canAccept", () => {
  it("sends deletes only when they are checked", () => {
    expect(pickAcceptIds(ITEMS, false)).toEqual([1, 2, 4, 5]);
    expect(pickAcceptIds(ITEMS, true)).toEqual([1, 2, 3, 4, 5]);
  });

  it("needs a common remark to take deletes and something to take", () => {
    expect(canAccept(ITEMS, true, "  ")).toBe(false);
    expect(canAccept(ITEMS, true, "합성 사유")).toBe(true);
    expect(canAccept(ITEMS, false, "")).toBe(true);
    expect(canAccept([item(3, "delete")], false, "")).toBe(false);
    expect(canAccept([], true, "합성 사유")).toBe(false);
  });
});

describe("countLiveOffer", () => {
  it("counts live suggestions of the open Old document by kind", () => {
    const counts = countLiveOffer([
      suggestion(1, "classify"),
      suggestion(2, "match"),
      suggestion(3, "match", { document_id: 2 }),
      suggestion(4, "classify", { result: "stale" }),
      suggestion(5, "classify", { adoption: "as_is" }),
      suggestion(6, "split"),
    ], 1);
    expect(counts).toEqual({ classify: 1, match: 1 });
  });
});
