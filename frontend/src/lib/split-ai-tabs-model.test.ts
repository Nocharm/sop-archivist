import { describe, expect, it } from "vitest";

import { cutSplitPieces, findSplitBlock, readSplitOffsets } from "@/lib/split-ai-tabs-model";

describe("cutSplitPieces", () => {
  it("cuts the text at the suggested places, in order", () => {
    expect(cutSplitPieces("Wear gloves. Close the lid. Press START.", [27, 12])).toEqual(["Wear gloves.", "Close the lid.", "Press START."]);
  });

  it("ignores places outside the text and drops empty pieces", () => {
    expect(cutSplitPieces("Close the lid.", [0, 14, 99])).toEqual(["Close the lid."]);
    expect(cutSplitPieces("A.  B.", [2, 3])).toEqual(["A.", "B."]);
  });
});

describe("readSplitOffsets", () => {
  it("keeps only the numbers of what the answer holds", () => {
    expect(readSplitOffsets([3, "7", 12, null])).toEqual([3, 12]);
    expect(readSplitOffsets("3,12")).toEqual([]);
  });
});

describe("findSplitBlock", () => {
  const unit = (kind: string, status = "unassigned", disposition = "unassigned", suggestionKind: string | null = null) => ({ kind, status, decision: { disposition }, suggestionKind });

  it("allows a row with an unassigned sentence or one only the AI classified", () => {
    expect(findSplitBlock([unit("sentence")])).toBeNull();
    expect(findSplitBlock([unit("sentence", "confirmed", "assigned"), unit("cell_sentence")])).toBeNull();
    expect(findSplitBlock([unit("sentence", "ai_suggested", "assigned", "classify")])).toBeNull();
  });

  it("blocks headings, figures and tables", () => {
    expect(findSplitBlock([unit("heading")])).toBe("notSentence");
    expect(findSplitBlock([unit("table")])).toBe("notSentence");
  });

  it("blocks sentences a person decided or held, and match suggestions", () => {
    expect(findSplitBlock([unit("sentence", "ai_suggested", "assigned", "match")])).toBe("decided");
    expect(findSplitBlock([unit("sentence", "confirmed", "assigned"), unit("sentence", "on_hold", "unassigned")])).toBe("decided");
  });
});
