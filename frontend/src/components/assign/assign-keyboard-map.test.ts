// 키보드 그림 - 도움말 단추가 창을 열고, J 키가 이동 색을 달고, Esc가 닫는지.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { setHelpOpen, setHelpTab } from "@/lib/help-prefs";
import { LangProvider } from "@/lib/i18n";

import { AssignHelp } from "./assign-help";

afterEach(() => {
  setHelpOpen("assign", false);
  document.body.replaceChildren();
});

describe("Assign keyboard map", () => {
  it("opens from the help button, tints J as a move key and closes on Esc", async () => {
    // Arrange
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    setHelpTab("assign", "keys");
    setHelpOpen("assign", true);
    const root = createRoot(document.body.appendChild(document.createElement("div")));
    await act(async () => root.render(createElement(LangProvider, null, createElement(AssignHelp))));
    const find = (testId: string) => document.querySelector(`[data-testid="${testId}"]`);

    // Act
    expect(find("assign-keyboard-map")).toBeNull();
    await act(async () => (find("assign-help-keyboard-map") as HTMLElement).click());
    const keyJ = find("assign-keyboard-map-key-KeyJ");

    // Assert
    expect(find("assign-keyboard-map")).not.toBeNull();
    expect(keyJ?.getAttribute("data-kind")).toBe("move");
    expect(keyJ?.querySelector('[data-testid="assign-keyboard-map-shift-KeyJ"]')?.textContent).toMatch(/^⇧/);
    const board = find("assign-keyboard-map-board") as HTMLElement;
    await act(async () => board.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyJ", key: "j", bubbles: true })));
    expect(find("assign-keyboard-map-key-KeyJ")?.hasAttribute("data-pressed")).toBe(true);
    expect(find("assign-keyboard-map-key-KeyJ")?.hasAttribute("data-flash")).toBe(true);
    await act(async () => board.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyJ", key: "j", bubbles: true })));
    expect(find("assign-keyboard-map-key-KeyJ")?.hasAttribute("data-pressed")).toBe(false);
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(find("assign-keyboard-map")).toBeNull();
    await act(async () => root.unmount());
  });
});
