import { describe, expect, it } from "vitest";

import { cutSplitPieces, readSplitOffsets } from "@/lib/split-ai-tabs-model";

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
