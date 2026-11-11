import { describe, expect, it } from "vitest";

import { getPairBrackets, getPillFill, getSectionPill } from "@/lib/strip-pill-model";

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

describe("getPillFill", () => {
  it("follows the pair's document order and appends hold", () => {
    expect(getPillFill("en", ["en", "ko"], false)).toEqual(["en", "ko"]);
    expect(getPillFill("ko", ["en", "ko"], true)).toEqual(["en", "ko", "hold"]);
    expect(getPillFill("ko", null, true)).toEqual(["ko", "hold"]);
    expect(getPillFill("ko", null, false)).toEqual(["ko"]);
    expect(getPillFill(null, null, false)).toEqual([]);
    expect(getPillFill(null, null, true)).toEqual(["hold"]);
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
