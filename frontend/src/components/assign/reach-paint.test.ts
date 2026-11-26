import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { LangProvider } from "@/lib/i18n";
import type { AssignMenuAction, AssignMenuItem } from "@/lib/assign-context-menu-model";
import type { MenuReach } from "@/lib/menu-reach-model";
import type { MenuSection } from "@/lib/menu-section-model";

import { AssignContextMenu } from "./assign-context-menu";
import { ReachPaint } from "./reach-paint";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let root: Root | null = null;

function render(node: ReturnType<typeof createElement>): HTMLDivElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root?.render(node));
  return host;
}

// 메뉴의 프레임 · 글쇠 구독을 풀어 두어야 시험이 끝난 뒤 늦게 도는 일이 없다
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  document.body.innerHTML = "";
});

const item = (action: AssignMenuAction, over: Partial<AssignMenuItem> = {}): AssignMenuItem => ({ action, enabled: true, ...over });
const cellSections: MenuSection[] = [
  { id: "cell", headKey: "assign.ctx.section.cell", headVars: { r: 2, c: 2 }, items: [item("split")] },
  { id: "table", headKey: "assign.ctx.section.table", headVars: { n: 2 }, items: [item("clear"), item("table_layout"), item("delete")] },
];

function renderMenu(readReach: (entry: AssignMenuItem) => MenuReach = () => ({ change: [], touch: [], around: [] })) {
  const anchor = document.createElement("div");
  document.body.appendChild(anchor);
  render(createElement(LangProvider, null, createElement(AssignContextMenu, { anchor, readCover: () => [], click: null, sections: cellSections, side: "old", readReach, onPick: () => undefined, onClose: () => undefined })));
}

describe("ReachPaint", () => {
  it("draws a style with the reached units", () => {
    render(createElement(ReachPaint, { side: "new", reach: { change: [70], touch: [], around: [] } }));
    const style = document.querySelector('[data-testid="assign-ctx-reach"]');
    expect(style?.tagName).toBe("STYLE");
    expect(style?.textContent).toContain('[data-pane="new"] [data-strip-unit="70"]');
  });

  it("draws nothing without a reach or when nothing is reached", () => {
    render(createElement(ReachPaint, { side: "old", reach: null }));
    expect(document.querySelector('[data-testid="assign-ctx-reach"]')).toBeNull();
    act(() => root?.render(createElement(ReachPaint, { side: "old", reach: { change: [], touch: [], around: [] } })));
    expect(document.querySelector('[data-testid="assign-ctx-reach"]')).toBeNull();
  });
});

describe("AssignContextMenu sections", () => {
  it("lists sections in order with the pinned testids", () => {
    renderMenu();
    const ids = [...document.querySelectorAll('[data-testid^="assign-ctx-"]')].map((el) => el.getAttribute("data-testid")).filter((id) => id !== "assign-ctx-menu");
    expect(ids).toEqual(["assign-ctx-section-cell", "assign-ctx-split", "assign-ctx-section-table", "assign-ctx-clear", "assign-ctx-table_layout", "assign-ctx-delete"]);
  });

  it("names the table items with their scope and keys", () => {
    renderMenu();
    expect(document.querySelector('[data-testid="assign-ctx-section-table"]')?.textContent).toBe("This table · Table 2");
    expect(document.querySelector('[data-testid="assign-ctx-section-cell"]')?.textContent).toBe("This cell · row 2, col 2");
    expect(document.querySelector('[data-testid="assign-ctx-table_layout"] kbd')?.textContent).toBe("⇧T");
  });

  it("paints the reached cells while an item is hovered and clears them when it is left", () => {
    renderMenu((entry) => (entry.action === "split" ? { change: [2], touch: [], around: [] } : { change: [], touch: [], around: [10] }));
    const split = document.querySelector('[data-testid="assign-ctx-split"]') as HTMLElement;
    act(() => split.dispatchEvent(new PointerEvent("pointerover", { bubbles: true })));
    expect(document.querySelector('[data-testid="assign-ctx-reach"]')?.textContent).toContain('data-strip-unit="2"');
    act(() => split.dispatchEvent(new PointerEvent("pointerout", { bubbles: true })));
    expect(document.querySelector('[data-testid="assign-ctx-reach"]')).toBeNull();
    const del = document.querySelector('[data-testid="assign-ctx-delete"]') as HTMLElement;
    act(() => del.focus());
    expect(document.querySelector('[data-testid="assign-ctx-reach"]')?.textContent).toContain('data-strip-unit="10"');
  });
});
