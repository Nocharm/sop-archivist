import { describe, expect, it } from "vitest";

import { isRestoringLines, readNoiseKey, toNoiseKeyId, type NoiseKeyId } from "./noise-keys";

const block = { unitIds: [4, 5, 6] };
const line = { unitId: 5, block };
const head = { unitId: null, block };
const ALL: NoiseKeyId[] = ["clear", "clear_block", "remark", "remark_block", "delete", "hold", "confirm"];

describe("keys on deleted lines", () => {
  it("acts on the picked line, and on the whole block with Shift", () => {
    expect(readNoiseKey("clear", line)).toEqual({ kind: "clear", unitIds: [5] });
    expect(readNoiseKey("remark", line)).toEqual({ kind: "reason", unitIds: [5] });
    expect(readNoiseKey("clear_block", line)).toEqual({ kind: "clear", unitIds: [4, 5, 6] });
    expect(readNoiseKey("remark_block", line)).toEqual({ kind: "reason", unitIds: [4, 5, 6] });
  });
  it("acts on the whole block without Shift when the block head is picked", () => {
    expect(readNoiseKey("clear", head)).toEqual({ kind: "clear", unitIds: [4, 5, 6] });
    expect(readNoiseKey("remark", head)).toEqual({ kind: "reason", unitIds: [4, 5, 6] });
  });
  it("does nothing on delete, hold and confirm - the Old judgment stays", () => {
    for (const id of ["delete", "hold", "confirm"] as const) {
      expect(readNoiseKey(id, line), id).toEqual({ kind: "none" });
      expect(readNoiseKey(id, head), id).toEqual({ kind: "none" });
    }
  });
  it("leaves every key alone when no deleted line is picked", () => {
    for (const id of ALL) expect(readNoiseKey(id, null), id).toBeNull();
  });
  it("reads the keys, Shift told apart only where it means the block", () => {
    expect(["u", "r"].map((key) => [toNoiseKeyId(key, false), toNoiseKeyId(key, true)])).toEqual([["clear", "clear_block"], ["remark", "remark_block"]]);
    expect(["delete", "backspace", "h", "enter"].map((key) => toNoiseKeyId(key, false))).toEqual(["delete", "delete", "hold", "confirm"]);
    for (const key of ["j", "a", "e", "s", "v", "escape", "arrowleft"]) expect(toNoiseKeyId(key, false), key).toBeNull();
  });
  it("knows when the picked lines are being restored", () => {
    expect(isRestoringLines([{ type: "clear_noise", unit_ids: [5, 6] }], [4, 5])).toBe(true);
    expect(isRestoringLines([{ type: "clear_noise", unit_ids: [9] }], [4, 5])).toBe(false);
    expect(isRestoringLines([{ type: "set_noise_reason", unit_ids: [5], reason: "x" }], [5])).toBe(false);
    expect(isRestoringLines([], [5])).toBe(false);
  });
});
