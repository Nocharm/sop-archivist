import { describe, expect, it } from "vitest";

import type { DocumentView, ViewUnit } from "./api-sop";
import { findShapeOfDoc, findShapeUnit, type DocShape, type PickSide } from "./doc-shape-model";
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
