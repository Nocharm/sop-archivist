import { describe, expect, it } from "vitest";

import { resolveLineParam, type LineParamInput } from "./assign-line-param";

// Unit 5012 - 문서 101의 줄. 5013 - 문서 101의 칸 문장(표의 줄 u5000에 묶인다). 6001 - 문서 102의 줄
const DOC_OF_UNIT = new Map([
  [5012, 101],
  [5013, 101],
  [6001, 102],
]);
const ROW_OF_UNIT = new Map([
  [5012, "u5012"],
  [5013, "u5000"],
  [6001, "u6001"],
]);

function resolve(doc: string | null, unit: string | null) {
  const input: LineParamInput = { doc, unit, oldDocIds: [101, 102], docOfUnit: (id) => DOC_OF_UNIT.get(id), findRowKey: (id) => ROW_OF_UNIT.get(id) };
  return resolveLineParam(input);
}

describe("resolveLineParam", () => {
  it("opens the row that holds the unit", () => {
    expect(resolve("101", "5012")).toEqual({ kind: "row", rowKey: "u5012", unitId: 5012 });
  });

  it("opens the table row for a cell sentence", () => {
    expect(resolve("101", "5013")).toEqual({ kind: "row", rowKey: "u5000", unitId: 5013 });
  });

  it("opens only the document without a unit", () => {
    expect(resolve("101", null)).toEqual({ kind: "document", docId: 101, isGone: false });
  });

  it("says the line is gone when the unit is missing, belongs to another document or is not a number", () => {
    for (const unit of ["999", "6001", "abc", "-1", "99999999999999999999", "", "5012 "]) {
      expect(resolve("101", unit), unit).toEqual({ kind: "document", docId: 101, isGone: true });
    }
  });

  it("says the line is gone when the unit is in the document but has no row", () => {
    const input: LineParamInput = { doc: "101", unit: "5012", oldDocIds: [101], docOfUnit: () => 101, findRowKey: () => undefined };
    expect(resolveLineParam(input)).toEqual({ kind: "document", docId: 101, isGone: true });
  });

  it("does nothing for a document that is not a ready Old document of this bundle", () => {
    for (const doc of ["999", "abc", "", "101 ", "-101", "00000000101", null]) {
      expect(resolve(doc, "5012"), String(doc)).toEqual({ kind: "none" });
    }
  });
});
