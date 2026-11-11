import { describe, expect, it } from "vitest";

import { getPairBrackets, getSectionHeads, getSectionPill } from "@/lib/strip-pill-model";

describe("getSectionPill", () => {
  it("returns numeric section numbers only", () => {
    expect(getSectionPill("11.11.1.1.1")).toBe("11.11.1.1.1");
    expect(getSectionPill("5.2.")).toBe("5.2.");
    expect(getSectionPill("5")).toBe("5");
    expect(getSectionPill("Scope")).toBeNull();
    expect(getSectionPill("5.2 Scope")).toBeNull();
    expect(getSectionPill("")).toBeNull();
  });
});

describe("getSectionHeads", () => {
  const unit = (unitId: number, sectionLabel: string, part = "body", pairTopOf: number | null = null) => ({ unitId, part, sectionLabel, pairTopOf });
  it("shows the first unit of each section and hides repeats", () => {
    expect([...getSectionHeads([unit(1, "5.1"), unit(2, "5.1"), unit(3, "5.2"), unit(4, "5.2"), unit(5, "5.1")])]).toEqual([1, 3, 5]);
  });
  it("resets when the part changes", () => {
    expect([...getSectionHeads([unit(1, "5.1", "top"), unit(2, "5.1", "body"), unit(3, "5.1", "body")])]).toEqual([1, 2]);
  });
  it("never shows non-numeric labels", () => {
    expect([...getSectionHeads([unit(1, "Scope"), unit(2, ""), unit(3, "5.1")])]).toEqual([3]);
  });
  it("never shows the bottom row of a pair", () => {
    expect([...getSectionHeads([unit(1, "5.1"), unit(2, "5.1", "body", 1), unit(3, "5.2"), unit(4, "5.3", "body", 3)])]).toEqual([1, 3]);
  });
});

describe("getPairBrackets", () => {
  it("brackets adjacent partners top and bottom", () => {
    const result = getPairBrackets([
      { unitId: 1, partnerId: null },
      { unitId: 2, partnerId: 3 },
      { unitId: 3, partnerId: 2 },
    ]);
    expect(result.get(2)).toBe("top");
    expect(result.get(3)).toBe("bottom");
    expect(result.has(1)).toBe(false);
  });
  it("marks partners separated by another strip solo", () => {
    const result = getPairBrackets([
      { unitId: 2, partnerId: 4 },
      { unitId: 3, partnerId: null },
      { unitId: 4, partnerId: 2 },
    ]);
    expect(result.get(2)).toBe("solo");
    expect(result.get(4)).toBe("solo");
  });
});
