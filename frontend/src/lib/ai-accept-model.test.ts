import { describe, expect, it } from "vitest";

import { canAccept, countDeletes, countLiveOffer, countShapes, listAcceptKinds, pickAcceptIds, splitAcceptIds } from "./ai-accept-model";
import { dropHiddenSuggestions } from "./ai-suggestion-model";
import type { AcceptItem, AiSuggestion, CoverStatus } from "./api-sop";

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

  it("needs something to take - the common remark for deletes is optional", () => {
    expect(canAccept(ITEMS, true)).toBe(true);
    expect(canAccept(ITEMS, false)).toBe(true);
    expect(canAccept([item(3, "delete")], false)).toBe(false);
    expect(canAccept([item(3, "delete")], true)).toBe(true);
    expect(canAccept([], true)).toBe(false);
  });
});

describe("splitAcceptIds", () => {
  it("cuts the ids into requests of the server limit in order", () => {
    expect(splitAcceptIds([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(splitAcceptIds([], 2)).toEqual([]);
  });
});

describe("countLiveOffer", () => {
  const onUnits = (...unitIds: number[]) => ({ content: { unit_ids: unitIds } });
  const statusOf = (entries: [number, CoverStatus][]) => new Map(entries);
  const openUnits = statusOf([[1, "unassigned"], [2, "unassigned"], [3, "unassigned"], [4, "unassigned"], [9, "confirmed"]]);

  it("counts only live suggestions whose rows are open", () => {
    const items = [
      suggestion(1, "classify", onUnits(9)),
      suggestion(2, "match", onUnits(1)),
      suggestion(3, "match", { ...onUnits(2), document_id: 2 }),
      suggestion(4, "classify", { ...onUnits(3), result: "stale" }),
      suggestion(5, "classify", { ...onUnits(3), adoption: "as_is" }),
      suggestion(6, "split", onUnits(3)),
      suggestion(7, "match", onUnits(3, 4)),
      suggestion(8, "match", onUnits(77)),
      suggestion(9, "match", onUnits(2)),
    ];
    expect(countLiveOffer(items, 1, openUnits)).toEqual({ classify: 0, match: 3 });
  });

  it("drops to zero when every row is decided", () => {
    const items = [suggestion(1, "classify", onUnits(1)), suggestion(2, "match", onUnits(2))];
    expect(countLiveOffer(items, 1, new Map())).toEqual({ classify: 0, match: 0 });
  });

  it("counts nothing hidden once hidden kinds are dropped", () => {
    const items = [suggestion(1, "classify", { document_id: 7, ...onUnits(1) }), suggestion(2, "match", { document_id: 7, ...onUnits(2) })];
    expect(countLiveOffer(dropHiddenSuggestions(items, false), 7, openUnits)).toEqual({ classify: 0, match: 1 });
  });
});

describe("listAcceptKinds", () => {
  it("offers only match while drafting is hidden", () => {
    expect(listAcceptKinds(false)).toEqual(["match"]);
    expect(listAcceptKinds(true)).toEqual(["classify", "match"]);
  });
});
