import { describe, expect, it } from "vitest";

import { isQueuedKey, isRepeatIgnored, opensTextBox } from "./assign-press-model";

describe("held-down keys", () => {
  it("only moves repeat - a decision key held down acts once", () => {
    for (const id of ["delete", "confirm", "hold", "clear", "use_ai", "edit", "split", "undo", "indent", "part_next"] as const) expect(isRepeatIgnored(id), id).toBe(true);
    for (const id of ["move_next", "move_prev"] as const) expect(isRepeatIgnored(id), id).toBe(false);
    for (const id of ["cut_left", "cut_right"] as const) expect(isRepeatIgnored(id), id).toBe(false);
  });
});

describe("keys kept behind a barrier", () => {
  it("are the moves and everything that needs a box", () => {
    for (const id of ["delete", "confirm", "hold", "clear", "remark", "edit", "use_ai", "split", "cut_left"] as const) expect(isQueuedKey(id), id).toBe(true);
    for (const id of ["go_pair", "lang", "shape_mode", "number", "ask_order", "table", "indent", "outdent", "clear_block", "remark_block"] as const) expect(isQueuedKey(id), id).toBe(true);
    expect(isQueuedKey("move_next")).toBe(true);
    for (const id of ["view", "escape", "help", "preview", "part_next", "undo"] as const) expect(isQueuedKey(id), id).toBe(false);
  });
});

describe("keys that open a text box", () => {
  it("are E and Shift+N - what is typed after them belongs to the box", () => {
    expect(opensTextBox({ key: "e", shift: false })).toBe(true);
    expect(opensTextBox({ key: "n", shift: true })).toBe(true);
    for (const press of [{ key: "n", shift: false }, { key: "h", shift: true }, { key: "j", shift: false }]) expect(opensTextBox(press), press.key).toBe(false);
  });
});
