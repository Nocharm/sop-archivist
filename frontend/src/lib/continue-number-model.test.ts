import { describe, expect, it } from "vitest";

import { countChildren, findParentNumber, planContinue, type FlowLine } from "./continue-number-model";

const line = (number: string | null, extra: Partial<FlowLine> = {}): FlowLine => ({ number, lang: "ko", kind: "sentence", tableId: null, isCell: false, ...extra });
const heading = (number: string) => line(number, { kind: "heading" });
const cell = (number: string | null) => line(number, { kind: "cell_sentence", tableId: 9, isCell: true });

describe("findParentNumber", () => {
  it("takes the heading above, or the parent of a body number when that parent is above", () => {
    expect(findParentNumber([heading("5."), cell("1")], 1)).toBe("5");
    expect(findParentNumber([heading("5"), line("5.1"), cell("1")], 2)).toBe("5");
    expect(findParentNumber([line("5.2"), cell("1")], 1)).toBe("5.2");
  });
  it("skips 1), bullets, other languages and lines inside tables", () => {
    expect(findParentNumber([heading("5"), line("1)"), line("•"), line("6", { lang: "en" }), line("7", { tableId: 3 }), cell("1")], 5)).toBe("5");
    expect(findParentNumber([cell("1")], 0)).toBeNull();
  });
});

describe("countChildren", () => {
  it("counts the biggest child of the parent in the same language", () => {
    expect(countChildren([line("5.1"), line("5.3."), line("5.9", { lang: "en" }), line("5.2.1")], "ko", "5")).toBe(3);
  });
});

describe("planContinue", () => {
  it("numbers the first-column number cells under the number above (D1)", () => {
    expect([...planContinue([heading("5"), cell("1"), cell("2"), cell("3")], 9)]).toEqual([[1, "5.1"], [2, "5.2"], [3, "5.3"]]);
  });
  it("leaves the table as it is when nothing is above", () => {
    expect(planContinue([cell("1"), cell("2")], 9).size).toBe(0);
  });
});
