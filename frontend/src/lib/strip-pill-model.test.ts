import { describe, expect, it } from "vitest";

import { getPairBrackets, getPillWidth, getSectionHeads, getSectionLevel, getSectionPill, PILL_WIDTH_BY_LEVEL } from "@/lib/strip-pill-model";

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
  it("leaves partners separated by another strip out", () => {
    const result = getPairBrackets([
      { unitId: 2, partnerId: 4 },
      { unitId: 3, partnerId: null },
      { unitId: 4, partnerId: 2 },
    ]);
    expect(result.size).toBe(0);
  });
});

describe("getSectionLevel and pill width", () => {
  it("counts the dot-separated parts of numeric labels only", () => {
    expect(getSectionLevel("1")).toBe(1);
    expect(getSectionLevel("1.2")).toBe(2);
    expect(getSectionLevel("5.2.")).toBe(2);
    expect(getSectionLevel("11.11.1.1.1")).toBe(5);
    expect(getSectionLevel("Scope")).toBe(0);
    expect(getSectionLevel("")).toBe(0);
  });
  it("gives deeper levels strictly wider pills and clamps the ends", () => {
    for (let index = 1; index < PILL_WIDTH_BY_LEVEL.length; index++) expect(PILL_WIDTH_BY_LEVEL[index]).toBeGreaterThan(PILL_WIDTH_BY_LEVEL[index - 1]);
    expect(getPillWidth(0)).toBe(getPillWidth(1));
    expect(getPillWidth(2)).toBe(PILL_WIDTH_BY_LEVEL[1]);
    expect(getPillWidth(99)).toBe(PILL_WIDTH_BY_LEVEL[PILL_WIDTH_BY_LEVEL.length - 1]);
  });
});
