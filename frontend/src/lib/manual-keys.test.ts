import { describe, expect, it } from "vitest";

import { getManualKeyAction, type ManualKeyContext } from "./manual-keys";

const BASE: ManualKeyContext = { typing: false, onControl: false, layerOpen: false, hasQuery: false, state: "unread" };

function press(key: string, ctx: Partial<ManualKeyContext> = {}, extra: Partial<{ code: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean }> = {}) {
  return getManualKeyAction({ key, code: "", metaKey: false, ctrlKey: false, altKey: false, ...extra }, { ...BASE, ...ctx });
}

describe("getManualKeyAction", () => {
  it("moves between pieces with J and K and opens the search with a slash", () => {
    expect(press("j")).toBe("next");
    expect(press("K")).toBe("prev");
    expect(press("/")).toBe("find");
  });

  it("leaves the arrow keys and Space to scroll the text", () => {
    expect(press("ArrowDown")).toBeNull();
    expect(press("ArrowUp")).toBeNull();
    expect(press(" ")).toBeNull();
  });

  it("marks an unread or updated piece and unmarks a read or updated one", () => {
    expect(press("Enter", { state: "unread" })).toBe("mark");
    expect(press("Enter", { state: "updated" })).toBe("mark");
    expect(press("Enter", { state: "read" })).toBeNull();
    expect(press("u", { state: "read" })).toBe("unmark");
    expect(press("u", { state: "updated" })).toBe("unmark");
    expect(press("u", { state: "unread" })).toBeNull();
  });

  it("leaves Enter to the focused button or link", () => {
    expect(press("Enter", { onControl: true })).toBeNull();
    expect(press("j", { onControl: true })).toBe("next");
  });

  it("does nothing while typing except Escape, which clears the search", () => {
    expect(press("j", { typing: true })).toBeNull();
    expect(press("/", { typing: true })).toBeNull();
    expect(press("Enter", { typing: true })).toBeNull();
    expect(press("Escape", { typing: true })).toBe("escape");
    expect(press("Escape", { hasQuery: true })).toBe("escape");
    expect(press("Escape")).toBeNull();
  });

  it("does nothing under an open menu or with a modifier key", () => {
    expect(press("j", { layerOpen: true })).toBeNull();
    expect(press("Escape", { layerOpen: true, hasQuery: true })).toBeNull();
    expect(press("j", {}, { metaKey: true })).toBeNull();
    expect(press("k", {}, { ctrlKey: true })).toBeNull();
    expect(press("u", { state: "read" }, { altKey: true })).toBeNull();
  });

  it("has nothing to mark when the search leaves no piece", () => {
    expect(press("Enter", { state: null })).toBeNull();
    expect(press("u", { state: null })).toBeNull();
    expect(press("/", { state: null })).toBe("find");
  });

  it("reads the key position when the keyboard is in Korean", () => {
    expect(press("ㅓ", {}, { code: "KeyJ" })).toBe("next");
    expect(press("ㅏ", {}, { code: "KeyK" })).toBe("prev");
    expect(press("ㅕ", { state: "read" }, { code: "KeyU" })).toBe("unmark");
    // 영문 글쇠가 그대로 오면 자리가 아니라 글자를 따른다(다른 자판 배열)
    expect(press("j", {}, { code: "KeyC" })).toBe("next");
  });
});
