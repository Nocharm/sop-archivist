import { describe, expect, it } from "vitest";

import { getPairBrackets, getPillWidth, getHiddenPrefixLength, getSectionHeads, getSectionLevel, getSectionPill, getTabWidths, getVisibleSkip, PILL_WIDTH_BY_LEVEL, sliceVisible } from "@/lib/strip-pill-model";

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

describe("getTabWidths", () => {
  const w = (level: number) => PILL_WIDTH_BY_LEVEL[level - 1];
  it("keeps width by level for numbered rows", () => {
    const widths = getTabWidths([
      { key: "a", part: "body", sectionLabel: "1" },
      { key: "b", part: "body", sectionLabel: "1.2" },
      { key: "c", part: "body", sectionLabel: "1.2.3" },
    ]);
    expect([widths.get("a"), widths.get("b"), widths.get("c")]).toEqual([w(1), w(2), w(3)]);
  });
  it("lets unnumbered rows follow the previous width", () => {
    const widths = getTabWidths([
      { key: "a", part: "body", sectionLabel: "1.2.3" },
      { key: "b", part: "body", sectionLabel: "" },
      { key: "c", part: "body", sectionLabel: "Scope" },
      { key: "d", part: "body", sectionLabel: "2" },
    ]);
    expect([widths.get("b"), widths.get("c"), widths.get("d")]).toEqual([w(3), w(3), w(1)]);
  });
  it("gives a part's unnumbered first row the level-1 width and resets on part change", () => {
    const widths = getTabWidths([
      { key: "a", part: "body", sectionLabel: "" },
      { key: "b", part: "body", sectionLabel: "1.2.3" },
      { key: "c", part: "footer", sectionLabel: "" },
    ]);
    expect([widths.get("a"), widths.get("c")]).toEqual([w(1), w(1)]);
  });
  it("makes a pair share its top row's width and passes it on", () => {
    const widths = getTabWidths([
      { key: "top", part: "body", sectionLabel: "1.2" },
      { key: "bottom", part: "body", sectionLabel: "1.2.3.4", pairTopOf: "top" },
      { key: "next", part: "body", sectionLabel: "" },
    ]);
    expect([widths.get("top"), widths.get("bottom"), widths.get("next")]).toEqual([w(2), w(2), w(2)]);
  });
});

describe("getHiddenPrefixLength", () => {
  it("hides the section number and the space after it", () => {
    expect(getHiddenPrefixLength("5.1 장비 점검", "5.1")).toBe(4);
    expect(getHiddenPrefixLength("5.1. 장비 점검", "5.1.")).toBe(5);
    expect(getHiddenPrefixLength("5.1. 장비 점검", "5.1")).toBe(5);
    expect(getHiddenPrefixLength("5. 시험 절차", "5.")).toBe(3);
    expect(getHiddenPrefixLength("5.1장비", "5.1")).toBe(3);
    expect(getHiddenPrefixLength("  5.1\t장비", "5.1")).toBe(6);
  });
  it("keeps text that does not start with exactly that number", () => {
    expect(getHiddenPrefixLength("5.10 제목", "5.1")).toBe(0);
    expect(getHiddenPrefixLength("5.1 제목", "5")).toBe(0);
    expect(getHiddenPrefixLength("시험 절차", "5")).toBe(0);
    expect(getHiddenPrefixLength("가. 범위", "가.")).toBe(0);
    expect(getHiddenPrefixLength("5.1", "5.1")).toBe(0); // 숨기면 빈 글
    expect(getHiddenPrefixLength("5.1 ", "5.1")).toBe(0);
  });
});

describe("sliceVisible", () => {
  it("trims a segment by the hidden prefix", () => {
    expect(sliceVisible(0, 10, 4)).toEqual({ start: 4, end: 10 });
    expect(sliceVisible(0, 3, 4)).toBeNull();
    expect(sliceVisible(6, 12, 4)).toEqual({ start: 6, end: 12 });
    expect(sliceVisible(0, 10, 0)).toEqual({ start: 0, end: 10 });
  });
});

describe("getVisibleSkip", () => {
  it("hides the number when the head unit goes past it and no cut sits in it", () => {
    expect(getVisibleSkip(3, 10, null)).toBe(3);
    expect(getVisibleSkip(3, 10, 3)).toBe(3);
    expect(getVisibleSkip(3, 10, 7)).toBe(3);
  });

  it("keeps a number-only head unit visible", () => {
    // "1. Purpose"가 "1." + " Purpose"로 나뉜 뒤 - 첫 조각이 숨길 자리 안에서 끝난다
    expect(getVisibleSkip(3, 2, null)).toBe(0);
    expect(getVisibleSkip(3, 3, null)).toBe(0);
  });

  it("reveals the number while the cut sits inside it", () => {
    expect(getVisibleSkip(3, 10, 2)).toBe(0);
    expect(getVisibleSkip(3, 10, 0)).toBe(0);
  });

  it("does nothing when there is no number to hide", () => {
    expect(getVisibleSkip(0, 10, 1)).toBe(0);
  });
});
