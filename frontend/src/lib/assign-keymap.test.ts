import { describe, expect, it } from "vitest";

import { ASSIGN_KEYS, findAssignKey, formatAssignKey, resolveAssignKey, type AssignKeyContext, type AssignKeyId } from "./assign-keymap";

type Press = Parameters<typeof findAssignKey>[0];
const press = (key: string, extra: Partial<Press> = {}): Press => ({ key, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...extra });
const readId = (key: string, extra: Partial<Press> = {}) => {
  const hit = findAssignKey(press(key, extra));
  return hit === null ? null : `${hit.kind} ${hit.entry.id}`;
};

describe("the Assign key table", () => {
  it("needs Shift for Shift keys and hints without it", () => {
    for (const [key, id] of [["h", "hold"], ["l", "lang"], ["p", "shape_mode"], ["n", "number"], ["a", "use_ai"], ["o", "ask_order"], ["t", "table"]]) {
      expect(readId(key), key).toBe(`hint ${id}`);
      expect(readId(key.toUpperCase(), { shiftKey: true }), key).toBe(`run ${id}`);
    }
    // Caps Lock은 Shift가 아니다
    expect(readId("H")).toBe("hint hold");
  });
  it("does not run a plain key with Shift held", () => {
    for (const key of ["V", "Delete", "ArrowDown", "Enter", " ", "Escape"]) expect(readId(key, { shiftKey: true }), key).toBeNull();
  });
  it("has no M, E or Shift+D", () => {
    expect(readId("m")).toBeNull();
    expect(readId("e")).toBeNull();
    expect(readId("d")).toBeNull();
    expect(readId("D", { shiftKey: true })).toBeNull();
  });
  it("has no duplicate key and shift", () => {
    const presses = ASSIGN_KEYS.map((entry) => `${entry.key}${entry.shift ? "+shift" : ""}`);
    expect(presses.filter((item, index) => presses.indexOf(item) !== index)).toEqual([]);
  });
  it("reads Ctrl and Cmd the same", () => {
    for (const mod of [{ ctrlKey: true }, { metaKey: true }]) {
      expect(readId("ArrowRight", mod)).toBe("run part_next");
      expect(readId("ArrowLeft", mod)).toBe("run part_prev");
      expect(readId("z", mod)).toBe("run undo");
      expect(readId("Z", { ...mod, shiftKey: true })).toBe("run redo");
      // Ctrl을 함께 누른 글자는 그 글자의 글쇠가 아니다(Ctrl+A 모두 고르기 · Ctrl+Enter)
      for (const key of ["a", "h", "j", "Enter"]) expect(readId(key, mod), key).toBeNull();
    }
    expect(readId("j", { altKey: true })).toBeNull();
  });
  it("moves down with J and the down arrow, up with K and the up arrow", () => {
    expect([readId("j"), readId("ArrowDown")]).toEqual(["run move_next", "run move_next"]);
    expect([readId("K"), readId("ArrowUp")]).toEqual(["run move_prev", "run move_prev"]);
    expect(readId("Enter")).toBe("run confirm");
  });
  it("tells the deleted block from the deleted line by Shift", () => {
    expect([readId("u"), readId("U", { shiftKey: true })]).toEqual(["run clear", "run clear_block"]);
    expect([readId("r"), readId("R", { shiftKey: true })]).toEqual(["run remark", "run remark_block"]);
    expect([readId("Delete"), readId("Backspace"), readId("Enter")]).toEqual(["run delete", "run delete", "run confirm"]);
  });
  it("opens the help with ? whether or not the layout needs Shift for it", () => {
    expect(readId("?", { shiftKey: true })).toBe("run help");
    expect(readId("?")).toBe("run help");
  });
  it("writes each key the way the buttons and the help show it", () => {
    expect(formatAssignKey("hold")).toBe("⇧H");
    expect(formatAssignKey("delete")).toBe("Del · ⌫");
    expect(formatAssignKey("part_next")).toBe("Ctrl+→");
    expect(formatAssignKey("redo")).toBe("Ctrl+⇧Z");
    expect(formatAssignKey("outdent")).toBe("⇧Tab");
    expect(formatAssignKey("move_next")).toBe("J · ↓");
    expect(formatAssignKey("help")).toBe("?");
  });
});

// 무엇이든 되는 자리 - 시험마다 한 칸만 바꾼다
const OPEN: AssignKeyContext = {
  hasRow: true, hasBox: true, isDeletedLine: false, canEdit: true, hasCut: true, hasPair: true, isText: true, langReasonKey: null, shapeMode: { reasonKey: null },
  hasNumberCell: true, hasAi: true, unwrappedTableId: 7, orderReasonKey: null, tableId: null, tableReasonKey: null, isLocked: false,
};
const entryOf = (id: AssignKeyId) => ASSIGN_KEYS.find((entry) => entry.id === id)!;
const WHY = "assign.key.why";

describe("what a key does where it is pressed", () => {
  it.each<[AssignKeyId, Partial<AssignKeyContext>, string]>([
    ["ask_order", { unwrappedTableId: null }, `${WHY}.notUnwrapped`],
    ["ask_order", { orderReasonKey: "assign.unwrapAi.offTip" }, "assign.unwrapAi.offTip"],
    ["table", { unwrappedTableId: null }, `${WHY}.notTable`],
    ["table", { tableReasonKey: "assign.ctx.why.unsaved" }, "assign.ctx.why.unsaved"],
    ["go_pair", { hasPair: false }, `${WHY}.noPair`],
    ["number", { hasNumberCell: false }, `${WHY}.noNumber`],
    ["indent", { hasNumberCell: false }, `${WHY}.noNumber`],
    ["use_ai", { hasAi: false }, `${WHY}.noAi`],
    ["shape_mode", { shapeMode: null }, `${WHY}.noShape`],
    ["shape_mode", { shapeMode: { reasonKey: "split.menu.why.notAdjacent" } }, "split.menu.why.notAdjacent"],
    ["lang", { isText: false }, `${WHY}.notText`],
    ["lang", { langReasonKey: "assign.ctx.why.refLang" }, "assign.ctx.why.refLang"],
    ["split", { hasCut: false }, "split.menu.why.noCut"],
    ["hold", { hasRow: false }, `${WHY}.noRow`],
    ["remark", { hasRow: false }, `${WHY}.noRow`],
    ["clear_block", {}, `${WHY}.notDeleted`],
    ["remark_block", {}, `${WHY}.notDeleted`],
  ])("%s refuses with a reason when the place is wrong (%o)", (id, change, refuseKey) => {
    expect(resolveAssignKey(entryOf(id), { ...OPEN, ...change })).toEqual({ refuseKey });
  });
  it.each(ASSIGN_KEYS.filter(({ id }) => !["clear_block", "remark_block"].includes(id)).map((entry) => [entry.id, entry] as const))("%s runs where it can", (id, entry) => {
    expect(resolveAssignKey(entry, OPEN)).toEqual({ run: id });
  });
  it("unwraps inside a table and wraps back on an unwrapped line", () => {
    expect(resolveAssignKey(entryOf("table"), { ...OPEN, tableId: 3, unwrappedTableId: null })).toEqual({ run: "table" });
    expect(resolveAssignKey(entryOf("table"), { ...OPEN, tableId: null, unwrappedTableId: 7 })).toEqual({ run: "table" });
  });
  it("says why on a Bundle that cannot be edited, but still moves and looks", () => {
    const readOnly = { ...OPEN, canEdit: false };
    for (const id of ["hold", "lang", "shape_mode", "number", "use_ai", "ask_order", "table", "indent", "delete", "clear", "remark", "split"] as const) {
      expect(resolveAssignKey(entryOf(id), readOnly), id).toEqual({ refuseKey: "assign.ctx.why.readOnly" });
    }
    for (const id of ["move_next", "go_pair", "view", "help", "part_next", "escape"] as const) expect(resolveAssignKey(entryOf(id), readOnly), id).toEqual({ run: id });
  });
  it("waits for a box that is still changing, and leaves deleted lines alone", () => {
    for (const id of ["lang", "shape_mode", "number", "table", "ask_order", "indent", "outdent"] as const) {
      expect(resolveAssignKey(entryOf(id), { ...OPEN, isLocked: true }), id).toEqual({ refuseKey: `${WHY}.busy` });
      expect(resolveAssignKey(entryOf(id), { ...OPEN, hasRow: false, hasBox: false, isDeletedLine: true }), id).toEqual({ refuseKey: "assign.ctx.why.tocLine" });
    }
  });
  it("keeps Enter and the cut arrows to the screen - they fall back to the browser when there is nothing to do", () => {
    const nothing = { ...OPEN, hasRow: false, hasBox: false, hasCut: false, canEdit: false };
    for (const id of ["confirm", "cut_left", "cut_right"] as const) expect(resolveAssignKey(entryOf(id), nothing)).toEqual({ run: id });
  });
});
