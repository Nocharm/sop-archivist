import { describe, expect, it } from "vitest";

import type { DecisionStepResult } from "@/lib/api-sop";

import { describeDecisionStep, getAssignUndoKey, pickSaveOp, shouldDropSelectionOnStep } from "./decision-step-model";

const base: DecisionStepResult = { op: "confirm", unit_ids: [], focus_unit_id: null, focus_target_id: null, scope_label: null, can_undo: false, can_redo: true };
const key = (over: Partial<{ key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }>) => ({ key: "z", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...over });
const ok = { typing: false, layerOpen: false, canEdit: true };

describe("describeDecisionStep", () => {
  it("names one unit by its display id", () => {
    expect(describeDecisionStep({ ...base, unit_ids: [9], focus_unit_id: 9 }, "undo", () => "OLD-1-009", () => null)).toEqual({
      key: "assign.undone.what",
      vars: { action: "assign.step.confirm", target: "OLD-1-009" },
    });
  });
  it("counts several units", () => {
    const ids = Array.from({ length: 12 }, (_, i) => i + 1);
    expect(describeDecisionStep({ ...base, op: "hold", unit_ids: ids }, "redo", () => "x", () => null)).toEqual({
      key: "assign.redone.what",
      vars: { action: "assign.step.hold", target: 12 },
    });
  });
  it("names a New sentence when no unit", () => {
    expect(describeDecisionStep({ ...base, op: "mark_new", focus_target_id: 5 }, "undo", () => null, (id) => `NEW-${id}`).vars.target).toBe("NEW-5");
  });
  it("names reset scope or whole bundle", () => {
    expect(describeDecisionStep({ ...base, op: "reset", unit_ids: [1, 2], scope_label: "Doc A" }, "undo", () => "x", () => null).vars.target).toBe("Doc A");
    expect(describeDecisionStep({ ...base, op: "reset", unit_ids: [1, 2] }, "undo", () => "x", () => null).vars.target).toBe("assign.step.wholeBundle");
  });
  it("names unit edits made from Assign", () => {
    expect(describeDecisionStep({ ...base, op: "merge", unit_ids: [1, 2] }, "undo", () => "x", () => null).vars.action).toBe("assign.step.merge");
    expect(describeDecisionStep({ ...base, op: "set_language", unit_ids: [3] }, "redo", () => "x", () => null).vars.action).toBe("assign.step.set_language");
  });
});

describe("pickSaveOp", () => {
  it("picks hold, confirm, link and unlink", () => {
    expect(pickSaveOp({ action: "hold", destinationKind: "link", savedLinkIds: [], nextLinkIds: [] })).toBe("hold");
    expect(pickSaveOp({ action: "confirm", destinationKind: "new", savedLinkIds: [], nextLinkIds: [] })).toBe("confirm");
    expect(pickSaveOp({ action: "confirm", destinationKind: "link", savedLinkIds: [1], nextLinkIds: [1, 2] })).toBe("link");
  });
  it("picks unlink when a saved link target is dropped", () => {
    expect(pickSaveOp({ action: "confirm", destinationKind: "link", savedLinkIds: [1, 2], nextLinkIds: [2] })).toBe("unlink");
  });
});

describe("getAssignUndoKey", () => {
  it("maps Ctrl+Z to undo", () => {
    expect(getAssignUndoKey(key({ ctrlKey: true }), ok)).toBe("undo");
  });
  it("leaves Ctrl+Z to the text field while typing", () => {
    expect(getAssignUndoKey(key({ ctrlKey: true }), { ...ok, typing: true })).toBeNull();
  });
  it("maps Ctrl+Shift+Z and ⌘+Shift+Z to redo", () => {
    expect(getAssignUndoKey(key({ ctrlKey: true, shiftKey: true, key: "Z" }), ok)).toBe("redo");
    expect(getAssignUndoKey(key({ metaKey: true, shiftKey: true }), ok)).toBe("redo");
  });
  it("ignores plain Z, open layers and read-only", () => {
    expect(getAssignUndoKey(key({}), ok)).toBeNull();
    expect(getAssignUndoKey(key({ ctrlKey: true }), { ...ok, layerOpen: true })).toBeNull();
    expect(getAssignUndoKey(key({ ctrlKey: true }), { ...ok, canEdit: false })).toBeNull();
  });
});

describe("shouldDropSelectionOnStep", () => {
  const step = (op: string, unitIds = [4]) => ({ op, unit_ids: unitIds });
  it("drops the selection for every unit-shape edit that can retire units", () => {
    for (const op of ["cut", "carve", "merge", "unmerge", "move_boundary", "split_table_rows", "merge_table_rows", "set_layout_table", "attach_caption", "detach_caption", "set_first_row_caption", "group_figures", "ungroup_figures", "set_heading", "clear_noise"]) {
      expect(shouldDropSelectionOnStep(step(op)), op).toBe(true);
    }
  });
  it("keeps the selection for in-place edits", () => {
    for (const op of ["set_language", "set_ref", "clear_ref", "set_number"]) expect(shouldDropSelectionOnStep(step(op)), op).toBe(false);
  });
  it("keeps the selection for decision steps", () => {
    for (const op of ["confirm", "hold", "link", "unlink", "mark_new", "link_source", "confirm_identical", "delete", "move_out", "clear", "reset"]) {
      expect(shouldDropSelectionOnStep(step(op)), op).toBe(false);
    }
  });
  it("keeps the selection when no unit is involved, and treats an unknown op as retiring", () => {
    expect(shouldDropSelectionOnStep(step("set_heading", []))).toBe(false);
    expect(shouldDropSelectionOnStep(step("future_op"))).toBe(true);
  });
});
