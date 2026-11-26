// 키보드 그림 모델 - 글쇠 표(ASSIGN_KEYS)에서 뽑은 글과 종류, 한 줄의 폭 합.
import { describe, expect, it } from "vitest";

import { ASSIGN_KEYS } from "@/lib/assign-keymap";
import { buildKeyboardMap, findMapKey, GAP_CODE, isShiftCode, ROW_COLS, shouldFlashKey } from "@/lib/keyboard-map-model";
import { MESSAGES } from "@/lib/i18n-messages";

const keys = buildKeyboardMap().flat();
const byCode = (code: string) => keys.find((item) => item.code === code);

describe("keyboard map model", () => {
  it("reads both layers of a key from the key list", () => {
    expect(byCode("KeyJ")).toMatchObject({ plain: { id: "move_next", kind: "move" }, shift: { id: "merge_next", kind: "shape" }, kind: "move" });
    expect(byCode("Backquote")).toMatchObject({ plain: { id: "indent", kind: "shape" }, shift: { id: "outdent" } });
    expect(byCode("Tab")).toMatchObject({ plain: { id: "move_next" }, shift: { id: "move_prev" } });
    expect(byCode("Slash")).toMatchObject({ plain: undefined, shift: { id: "help", kind: "free" }, kind: "free" });
  });

  it("tints judge keys and keys that are only used with Shift", () => {
    expect(byCode("Enter")?.kind).toBe("judge");
    expect(byCode("Backspace")?.plain?.id).toBe("delete");
    expect(byCode("KeyH")).toMatchObject({ plain: undefined, shift: { id: "hold" }, kind: "judge" });
    expect(byCode("KeyG")).toMatchObject({ plain: { id: "go_pair", kind: "move" }, shift: { id: "multi_pick", kind: "shape" } });
    expect(byCode("ArrowLeft")?.plain).toMatchObject({ id: "cut_left", kind: "shape" });
    expect(byCode("Space")?.kind).toBe("free");
  });

  it("makes every row the same width so the rows line up", () => {
    // Act
    const widths = buildKeyboardMap().map((row) => row.reduce((sum, item) => sum + item.width, 0));

    // Assert
    expect(widths).toEqual(widths.map(() => ROW_COLS));
  });

  it("puts Esc first on the F row and the arrows in an inverted T inside the block", () => {
    // Arrange
    const rows = buildKeyboardMap().map((row) => row.filter((item) => item.code !== GAP_CODE).map((item) => item.code));

    // Assert
    expect(rows[0].slice(0, 3)).toEqual(["Escape", "F1", "F2"]);
    const start = (row: number, code: string) => buildKeyboardMap()[row].slice(0, buildKeyboardMap()[row].findIndex((item) => item.code === code)).reduce((sum, item) => sum + item.width, 0);
    expect(start(4, "ArrowUp")).toBe(start(5, "ArrowDown"));
    expect(rows[4].at(-1)).toBe("ArrowUp");
    expect(rows[5].slice(-3)).toEqual(["ArrowLeft", "ArrowDown", "ArrowRight"]);
    expect(rows.flat().filter((code) => code === "Escape")).toHaveLength(1);
  });

  it("leaves unused keys without labels", () => {
    expect(byCode("KeyQ")).toMatchObject({ plain: undefined, shift: undefined, kind: null });
    expect(byCode("CapsLock")?.kind).toBeNull();
  });

  it("lists the Ctrl combinations on the Ctrl key", () => {
    expect(byCode("ControlLeft")).toMatchObject({ kind: "free", combo: "← → Z ⇧Z" });
  });

  it("places every key-list entry on the keyboard (except Delete, which Backspace stands for, and Ctrl combos)", () => {
    // Arrange
    const placed = new Set(keys.flatMap((item) => [item.plain?.id, item.shift?.id]).filter(Boolean));

    // Act
    const missing = ASSIGN_KEYS.filter((entry) => !entry.key.startsWith("ctrl+") && !placed.has(entry.id)).map((entry) => entry.id);

    // Assert
    expect(missing, "assign-keymap.ts에 글쇠를 더했으면 keyboard-map-model.ts의 LAYOUT에 그 키가 있는지 보세요").toEqual([]);
  });

  it("has a short label in both languages for every key id", () => {
    for (const lang of ["en", "ko"] as const) {
      const messages = MESSAGES[lang] as Record<string, string>;
      for (const id of new Set(ASSIGN_KEYS.map((entry) => entry.id))) {
        expect(messages[`assign.kbd.${id}`], `${lang} assign.kbd.${id}`).toBeTruthy();
        expect(messages[`assign.kbd.${id}`].length, `${lang} assign.kbd.${id} is too long`).toBeLessThanOrEqual(lang === "en" ? 8 : 4);
      }
    }
  });

  it("finds a key by its physical code", () => {
    expect(findMapKey("Backquote")).toMatchObject({ plain: { id: "indent" }, shift: { id: "outdent" } });
    expect(findMapKey("ShiftLeft")?.cap).toBe("⇧");
    expect(isShiftCode("ShiftRight")).toBe(true);
    expect(findMapKey("F5")).toBeUndefined();
  });

  it("flashes only keys that do something on the held layer", () => {
    // Assert
    expect(shouldFlashKey(findMapKey("KeyJ")!, false)).toBe(true);
    expect(shouldFlashKey(findMapKey("KeyH")!, false)).toBe(false);
    expect(shouldFlashKey(findMapKey("KeyH")!, true)).toBe(true);
    expect(shouldFlashKey(findMapKey("KeyQ")!, true)).toBe(false);
    expect(shouldFlashKey(findMapKey("ControlLeft")!, false)).toBe(true);
  });
});
