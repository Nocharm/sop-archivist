// 되돌리기·다시 하기 알림 - 무엇을 거꾸로 했는지와 대상.
import { describe, expect, it } from "vitest";

import type { EditStepResult } from "./api-sop";
import { describeEditStep } from "./edit-step-model";

function makeResult(over: Partial<EditStepResult>): EditStepResult {
  return { document_revision: 1, created_unit_ids: [], retired_unit_ids: [], op: "split", boundary_unit_ids: [], confirmed: null, ...over };
}

const findId = (id: number) => (id === 7 ? "1-007" : null);

describe("describeEditStep", () => {
  it("names the structural edit that was undone", () => {
    expect(describeEditStep(makeResult({ op: "merge" }), "undo", findId)).toEqual({ key: "split.undone.what", vars: { action: "split.step.merge", target: "" } });
  });

  it("tells a check from an uncheck by the direction and the value after", () => {
    const undoCheck = makeResult({ op: "boundary", boundary_unit_ids: [7], confirmed: false });
    const redoUncheck = makeResult({ op: "boundary", boundary_unit_ids: [7], confirmed: false });
    expect(describeEditStep(undoCheck, "undo", findId).vars).toEqual({ action: "split.step.check", target: "1-007" });
    expect(describeEditStep(redoUncheck, "redo", findId).vars.action).toBe("split.step.uncheck");
  });

  it("counts units when several boundaries changed at once", () => {
    const all = makeResult({ op: "check_all", boundary_unit_ids: [1, 2, 3], confirmed: false });
    expect(describeEditStep(all, "undo", findId).vars).toEqual({ action: "split.step.check_all", target: 3 });
  });

  it("falls back to the plain message for an unknown kind", () => {
    expect(describeEditStep(makeResult({ op: "future_op" }), "redo", findId)).toEqual({ key: "split.redone", vars: {} });
  });
});
