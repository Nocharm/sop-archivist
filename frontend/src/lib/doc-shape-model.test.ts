import { describe, expect, it } from "vitest";

import type { DocumentView, ViewUnit } from "./api-sop";
import { canSplitInPlace, findShapeOfDoc, findShapeUnit, pickEditTarget, type DocShape, type PickSide } from "./doc-shape-model";
import type { PaperModel, PaperTabs } from "./paper-model";

function shape(side: PickSide, docId: number, unitIds: number[]): DocShape {
  const units = new Map(unitIds.map((id) => [id, { id } as ViewUnit]));
  return { side, view: { document: { id: docId } } as DocumentView, model: { units } as unknown as PaperModel, tabs: {} as PaperTabs };
}

const old1 = shape("old", 1, [10, 11]);
const new7 = shape("new", 7, [70]);

describe("findShapeOfDoc", () => {
  it("finds the document a pair pick started in, whichever side is picked", () => {
    expect(findShapeOfDoc([old1, new7], 7)?.side).toBe("new");
    expect(findShapeOfDoc([old1, new7], 3)).toBeNull();
  });
});

describe("findShapeUnit", () => {
  it("finds the unit and the document it is in", () => {
    expect(findShapeUnit([old1, new7], 70)).toMatchObject({ shape: { side: "new" }, unit: { id: 70 } });
    expect(findShapeUnit([old1, new7], 99)).toBeNull();
  });
});

describe("pickEditTarget", () => {
  it("sends every edit to the document of the pressed box", () => {
    expect(pickEditTarget([old1, new7], { side: "new", unitId: 70 })).toEqual({ docId: 7, side: "new" });
    expect(pickEditTarget([old1, new7], { side: "old", unitId: 3 })).toEqual({ docId: 1, side: "old" });
  });
  it("is null when that side has no paper", () => expect(pickEditTarget([old1], { side: "new", unitId: 70 })).toBeNull());
});

describe("canSplitInPlace", () => {
  const cellUnit = { id: 70, kind: "cell_sentence", noise_kind: null } as ViewUnit;
  it("splits a table cell in place", () => expect(canSplitInPlace(cellUnit, new7)).toBe(true));
  it("does not split a line that is excluded or not drawn in that paper", () => {
    expect(canSplitInPlace({ ...cellUnit, noise_kind: "front" } as ViewUnit, new7)).toBe(false);
    expect(canSplitInPlace(cellUnit, old1)).toBe(false);
    expect(canSplitInPlace({ ...cellUnit, kind: "table" } as ViewUnit, new7)).toBe(false);
  });
});
