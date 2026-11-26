import { describe, expect, it } from "vitest";

import { ApiError, type ApiRule } from "./api";
import { describeNewTableAsk, readEditAsk } from "./edit-ask-model";

function rule(detail: ApiRule): ApiError {
  const err = new ApiError(409, JSON.stringify(detail));
  err.rule = detail;
  return err;
}

describe("readEditAsk", () => {
  it("reads the New numbers from a 409", () => expect(readEditAsk(rule({ code: "confirm_required", unit_ids: [1], linked_cells: 2, held_rows: 1 }))).toEqual({ count: 1, linkedCells: 2, heldRows: 1 }));
  it("leaves an Old ask without numbers", () => expect(readEditAsk(rule({ code: "confirm_required", unit_ids: [1, 2] }))).toEqual({ count: 2, linkedCells: null, heldRows: null }));
  it("is null for another rule", () => expect(readEditAsk(rule({ code: "unit_has_decision" }))).toBeNull());
  it("is null for an error that is not an API rule", () => expect(readEditAsk(new Error("network"))).toBeNull());
});

describe("describeNewTableAsk", () => {
  it("uses the plain text when nothing was linked", () => expect(describeNewTableAsk({ count: 1, linkedCells: 0, heldRows: 0 })).toBeNull());
  it("uses the plain text for an Old ask", () => expect(describeNewTableAsk({ count: 2, linkedCells: null, heldRows: null })).toBeNull());
  it("tells both numbers when cells were linked", () =>
    expect(describeNewTableAsk({ count: 2, linkedCells: 2, heldRows: 1 })).toEqual({ bodyKey: "assign.newTable.confirmBody", values: { n: 2, m: 1 } }));
  // 표째 이은 New 표(칸 이음 0, 보류 줄 있음)는 보류만 말한다(계획 3 "정한 것" 5)
  it("tells only the held rows for a table linked as a whole", () =>
    expect(describeNewTableAsk({ count: 1, linkedCells: 0, heldRows: 3 })).toEqual({ bodyKey: "assign.newTable.confirmBodyHeld", values: { n: 0, m: 3 } }));
});
