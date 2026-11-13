// Split 키보드 - ↑↓도 K/J처럼 움직이고, 입력 중이거나 메뉴·모달이 열려 있으면 아무것도 하지 않는다.
import { describe, expect, it } from "vitest";

import { getSplitKeyAction, type SplitKeyContext } from "./split-keys";

const ctx: SplitKeyContext = { typing: false, onControl: false, layerOpen: false, hasCut: false, checked: false, canEdit: true };

function press(key: string, extra: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) {
  return { key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...extra };
}

describe("getSplitKeyAction", () => {
  it("moves with arrows and J/K", () => {
    expect(getSplitKeyAction(press("ArrowDown"), ctx)).toBe("next");
    expect(getSplitKeyAction(press("j"), ctx)).toBe("next");
    expect(getSplitKeyAction(press("ArrowUp"), ctx)).toBe("prev");
    expect(getSplitKeyAction(press("K"), ctx)).toBe("prev");
  });

  it("leaves Enter to a focused button but keeps the other keys", () => {
    expect(getSplitKeyAction(press("Enter"), { ...ctx, onControl: true })).toBeNull();
    expect(getSplitKeyAction(press("Enter"), ctx)).toBe("check");
    expect(getSplitKeyAction(press("j"), { ...ctx, onControl: true })).toBe("next");
    expect(getSplitKeyAction(press("h"), { ...ctx, onControl: true })).toBe("hold");
  });

  it("ignores keys while typing or with a layer open", () => {
    expect(getSplitKeyAction(press("ArrowDown"), { ...ctx, typing: true })).toBeNull();
    expect(getSplitKeyAction(press("ArrowDown"), { ...ctx, layerOpen: true })).toBeNull();
  });

  it("checks, unchecks, splits and holds only when they apply", () => {
    expect(getSplitKeyAction(press("Enter"), ctx)).toBe("check");
    expect(getSplitKeyAction(press("Enter"), { ...ctx, checked: true })).toBeNull();
    expect(getSplitKeyAction(press("u"), { ...ctx, checked: true })).toBe("uncheck");
    expect(getSplitKeyAction(press("s"), ctx)).toBeNull();
    expect(getSplitKeyAction(press("s"), { ...ctx, hasCut: true })).toBe("split");
    expect(getSplitKeyAction(press("h"), ctx)).toBe("hold");
    expect(getSplitKeyAction(press("Enter"), { ...ctx, canEdit: false })).toBeNull();
  });

  it("only fast-forwards with Enter while moving on after a check", () => {
    expect(getSplitKeyAction(press("Enter"), { ...ctx, advancing: true, checked: true })).toBe("skip");
    expect(getSplitKeyAction(press("Enter"), { ...ctx, advancing: true, onControl: true })).toBe("skip");
    expect(getSplitKeyAction(press("Enter"), { ...ctx, advancing: true, layerOpen: true })).toBeNull();
    expect(getSplitKeyAction(press("j"), { ...ctx, advancing: true })).toBe("next");
  });

  it("maps undo and redo with the modifier", () => {
    expect(getSplitKeyAction(press("z", { metaKey: true }), ctx)).toBe("undo");
    expect(getSplitKeyAction(press("z", { ctrlKey: true, shiftKey: true }), ctx)).toBe("redo");
    expect(getSplitKeyAction(press("ArrowDown", { altKey: true }), ctx)).toBeNull();
  });

  it("clears with Escape", () => {
    expect(getSplitKeyAction(press("Escape"), ctx)).toBe("escape");
  });
});
