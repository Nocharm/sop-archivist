import { describe, expect, it } from "vitest";

import type { AiSuggestion } from "./api-sop";
import { buildUseDraft, findRowSuggestion, indexLiveSuggestions, readSuggestedDestination } from "./ai-suggestion-model";
import type { SentenceSlot } from "./classify-model";

function suggestion(id: number, kind: string, content: AiSuggestion["content"], extra: Partial<AiSuggestion> = {}): AiSuggestion {
  return { id, job_id: id, kind, document_id: 1, result: "applied", content, warnings: [], guideline_versions: {}, model: "", adoption: null, created_at: "", ...extra };
}

function slot(key: string, lang: "ko" | "en", sourceText: string, extra: Partial<SentenceSlot> = {}): SentenceSlot {
  return { key, target: null, lang, sourceIds: [Number(key.slice(1))], text: sourceText, sourceText, isAiPending: false, isTranslated: false, ...extra };
}

describe("indexLiveSuggestions and findRowSuggestion", () => {
  it("keeps the newest live suggestion per unit and drops stale or taken ones", () => {
    const index = indexLiveSuggestions([
      suggestion(1, "classify", { unit_ids: [10, 11] }),
      suggestion(2, "classify", { unit_ids: [10] }),
      suggestion(3, "classify", { unit_ids: [12] }, { result: "stale" }),
      suggestion(4, "match", { unit_ids: [13] }, { adoption: "rejected" }),
    ]);
    expect([...index.entries()].map(([unit, item]) => [unit, item.id])).toEqual([[10, 2], [11, 1]]);
  });

  it("offers a suggestion only on an unassigned row", () => {
    const index = indexLiveSuggestions([suggestion(1, "classify", { unit_ids: [10] })]);
    expect(findRowSuggestion([10, 11], "unassigned", index)?.id).toBe(1);
    expect(findRowSuggestion([10], "on_hold", index)).toBeNull();
    expect(findRowSuggestion([99], "unassigned", index)).toBeNull();
  });
});

describe("readSuggestedDestination", () => {
  it("reads a classify place, step or delete", () => {
    expect(readSuggestedDestination(suggestion(1, "classify", { disposition: "assigned", target_doc_id: 5, slot_key: "purpose" }))).toEqual({ kind: "slot", docId: 5, slotKey: "purpose" });
    expect(readSuggestedDestination(suggestion(1, "classify", { disposition: "assigned", target_doc_id: 6, wi_step: 2, wi_part: "instruction" }))).toEqual({ kind: "step", docId: 6, step: 2, part: "instruction" });
    expect(readSuggestedDestination(suggestion(1, "classify", { disposition: "delete" }))).toEqual({ kind: "delete" });
    expect(readSuggestedDestination(suggestion(1, "classify", { disposition: undefined }))).toBeNull();
  });

  it("links a match to the written sentences, a table only by its head sentence", () => {
    expect(readSuggestedDestination(suggestion(1, "match", { unit_ids: [10], target_ids: [70, 71], shape: "split" }))).toEqual({ kind: "link", targetIds: [70, 71] });
    expect(readSuggestedDestination(suggestion(1, "match", { unit_ids: [10], target_ids: [80, 81, 82], shape: "table" }))).toEqual({ kind: "link", targetIds: [80] });
    expect(readSuggestedDestination(suggestion(1, "match", { unit_ids: [10], target_ids: [], shape: "delete_candidate" }))).toEqual({ kind: "delete" });
    expect(readSuggestedDestination(suggestion(1, "match", { unit_ids: [], target_ids: [90], shape: "new" }))).toBeNull();
  });
});

describe("buildUseDraft", () => {
  it("fills each language's rewrite into its sentence slot", () => {
    const draft = buildUseDraft(
      suggestion(1, "classify", { change_type: "rewritten", rewrites: { ko: ["시료를 넣는다."], en: ["Put in the sample."] } }),
      [slot("u10", "ko", "시료를 넣음."), slot("u11", "en", "Put in the sample.")],
    );
    expect(draft.texts).toEqual({ u10: "시료를 넣는다." });
    expect(draft.unfilledLangs).toEqual([]);
  });

  it("leaves a split or merged rewrite to the person and says which language", () => {
    const draft = buildUseDraft(suggestion(1, "classify", { change_type: "split", rewrites: { ko: ["첫째.", "둘째."] } }), [slot("u10", "ko", "첫째와 둘째.")]);
    expect(draft.texts).toEqual({});
    expect(draft.unfilledLangs).toEqual(["ko"]);
  });

  it("fills nothing from a match - the server decides the change types from the text", () => {
    const draft = buildUseDraft(suggestion(1, "match", { target_change_types: { "70": "rewritten", "71": "merged", "72": "as_is" } }), []);
    expect(draft).toEqual({ texts: {}, unfilledLangs: [] });
  });
});
