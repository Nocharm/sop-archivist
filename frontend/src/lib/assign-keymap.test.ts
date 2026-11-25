import { describe, expect, it } from "vitest";

import { ASSIGN_KEYS, findAssignKey, formatAssignKey } from "./assign-keymap";

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
