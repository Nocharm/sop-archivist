// SheetView - 서버 시트 모델을 그리기만 하는지(머리 칠은 head 칸에만, 접힘은 row.wrap, 잘린 안내, 잘린 B의 그림 자리).
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import type { PreviewCell, PreviewRow, PreviewSheet } from "@/lib/api-sop";
import { LangProvider } from "@/lib/i18n";

import { SheetView } from "./sheet-view";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const cell = (text: string, extra: Partial<PreviewCell> = {}): PreviewCell => ({ text, faint: false, italic: false, bold: false, head: false, numeric: false, ...extra });
const row = (kind: PreviewRow["kind"], wrap: boolean, cells: PreviewCell[]): PreviewRow => ({ kind, wrap, cells });

function render(sheet: PreviewSheet): HTMLElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  act(() => createRoot(host).render(createElement(LangProvider, null, createElement(SheetView, { sheet }))));
  return host;
}

const BASE: PreviewSheet = {
  name: "A Comparison", widths: [8, 20], freeze: "A3", filter_columns: 0, image_png: null, image_row: null, total_rows: 4, truncated: false,
  rows: [
    row("status", false, [cell("Status: In progress", { bold: true }), cell("")]),
    row("header", true, [cell("Row", { head: true }), cell("")]),
    row("group_start", true, [cell("1", { numeric: true }), cell("same", { faint: true })]),
    row("in_group", true, [cell("2", { numeric: true }), cell("same", { faint: true, italic: true })]),
  ],
};

describe("SheetView", () => {
  it("draws the model's decisions without re-deriving them", () => {
    const host = render(BASE);
    const tds = Array.from(host.querySelectorAll("td"));
    expect(tds.filter((td) => td.hasAttribute("data-head")).map((td) => td.textContent)).toEqual(["Row"]);
    const groupStart = host.querySelector('tr[data-row-kind="group_start"] td') as HTMLElement;
    expect(groupStart.style.borderTop).toContain("--sheet-line-medium");
    const inGroup = host.querySelector('tr[data-row-kind="in_group"] td') as HTMLElement;
    expect(inGroup.style.borderTop).toContain("--sheet-line-thin");
    const status = host.querySelector('tr[data-row-kind="status"] td') as HTMLElement;
    expect(status.classList.contains("whitespace-pre")).toBe(true);
    expect(inGroup.classList.contains("whitespace-pre-wrap")).toBe(true);
    expect(host.querySelector('tr[data-row-kind="in_group"] td:nth-child(2)')?.getAttribute("style")).toContain("italic");
  });

  it("puts a flow image after the last carried row when the model's image row lies past a truncated sheet", () => {
    const host = render({ ...BASE, image_png: "AAAA", image_row: 900, total_rows: 1000, truncated: true });
    const image = host.querySelector('[data-testid="export-preview-image"]') as HTMLElement;
    expect(image.closest("tr")?.previousElementSibling?.getAttribute("data-row-number")).toBe("4");
    expect(host.querySelector('[data-testid="export-preview-truncated"]')?.textContent).toBe("Showing the first 4 of 1000 rows. The file has every row.");
  });
});
