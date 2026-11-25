// SheetView - 서버 시트 모델을 그리기만 하는지(머리 칠은 head 칸에만, 잘린 안내, 잘린 B의 그림 자리, 띠·칩·고른 줄·확정 전 값·목차 접기).
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import type { PreviewCell, PreviewRow, PreviewSheet } from "@/lib/api-sop";
import { LangProvider } from "@/lib/i18n";

import { SheetView, type SheetViewProps } from "./sheet-view";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom에는 ResizeObserver가 없다 - 옮기기의 크기 재기는 이 시험의 대상이 아니다(lib/sheet-pan.test.ts)
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const cell = (text: string, extra: Partial<PreviewCell> = {}): PreviewCell => ({ text, faint: false, italic: false, bold: false, head: false, numeric: false, indent: 0, strike: false, tone: null, ...extra });
const row = (kind: PreviewRow["kind"], wrap: boolean, cells: PreviewCell[], extra: Partial<PreviewRow> = {}): PreviewRow => ({ kind, wrap, cells, unit_id: null, group_id: null, toc: false, deleted: false, unit_ids: [], ...extra });

function render(props: SheetViewProps): HTMLElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  act(() => createRoot(host).render(createElement(LangProvider, null, createElement(SheetView, props))));
  return host;
}

const BASE: PreviewSheet = {
  name: "A Comparison", widths: [8, 20], freeze: "A3", filter_columns: 0, image_png: null, image_row: null, total_rows: 4, truncated: false, offset: 0,
  fit_widths: null, bands: [], column_keys: null,
  rows: [
    row("status", false, [cell("Status: In progress", { bold: true }), cell("")]),
    row("header", true, [cell("Row", { head: true }), cell("")]),
    row("group_start", true, [cell("1", { numeric: true }), cell("same", { faint: true })]),
    row("in_group", true, [cell("2", { numeric: true }), cell("same", { faint: true, italic: true })]),
  ],
};

// A 시트 꼴 - Row · Location · Unit ID · Old text · New doc · Status
const KEYS = ["row", "location", "unit_id", "old_text", "new_doc", "status"];
const aRow = (no: string, unitId: number, extra: Partial<PreviewRow> = {}, status = "Confirmed"): PreviewRow =>
  row("group_start", true, [cell(no, { numeric: true }), cell(`§${no}`), cell(`OLD-1-00${no}`), cell(`text ${no}`), cell("SOP-A"), cell(status, { tone: "ok" })], { unit_id: unitId, ...extra });
const A_SHEET: PreviewSheet = {
  ...BASE, widths: [8, 26, 14, 50, 14, 12], fit_widths: [34, 108, 72, 186, 60, 92], column_keys: KEYS, total_rows: 7,
  bands: [{ label: "As-is", span: 4, tone: "asis" }, { label: "To-be", span: 1, tone: "tobe" }, { label: "Tracking", span: 1, tone: "tracking" }],
  rows: [
    row("status", false, [cell("Status: Assigning", { bold: true }), ...Array.from({ length: 5 }, () => cell(""))]),
    row("header", true, ["Row", "Location", "Unit ID", "Old text", "New doc", "Status"].map((text) => cell(text, { head: true }))),
    aRow("1", 1, { toc: true }),
    aRow("2", 2, { toc: true }),
    aRow("3", 3, { toc: true }),
    aRow("4", 4, { group_id: "G-01" }),
    aRow("5", 5, { group_id: "G-01" }, "AI suggested"),
  ],
};

describe("SheetView", () => {
  it("draws the model's decisions without re-deriving them", () => {
    const host = render({ sheet: BASE });
    const tds = Array.from(host.querySelectorAll("td"));
    expect(tds.filter((td) => td.hasAttribute("data-head")).map((td) => td.textContent)).toEqual(["Row"]);
    const groupStart = host.querySelector('tr[data-row-kind="group_start"] td') as HTMLElement;
    expect(groupStart.style.borderTop).toContain("--sheet-line-medium");
    const inGroup = host.querySelector('tr[data-row-kind="in_group"] td') as HTMLElement;
    expect(inGroup.style.borderTop).toContain("--sheet-line-thin");
    expect(host.querySelector('tr[data-row-kind="in_group"] td:nth-child(2)')?.getAttribute("style")).toContain("italic");
    // 접지 않는 줄(상태 줄)은 Excel처럼 옆 빈 칸까지 넓혀 그린다 - 폭 맞춤에서는 그 안에서 감는다
    expect((host.querySelector('tr[data-row-kind="status"] td') as HTMLTableCellElement).colSpan).toBe(2);
  });

  it("keeps the frozen rows in the head table and the rest in the moving body", () => {
    const host = render({ sheet: BASE });
    expect(Array.from(host.querySelectorAll('[data-testid="export-preview-head"] tr')).map((tr) => tr.getAttribute("data-row-kind"))).toEqual(["status", "header"]);
    expect(Array.from(host.querySelectorAll('[data-testid="export-preview-body"] tr')).map((tr) => tr.getAttribute("data-row-number"))).toEqual(["3", "4"]);
  });

  it("indents a cell by the model's indent steps", () => {
    const rows = [row("group_start", true, [cell("○"), cell("child", { indent: 1 })]), row("in_group", true, [cell("•"), cell("plain")])];
    const host = render({ sheet: { ...BASE, rows, total_rows: rows.length, freeze: null } });
    const byText = (text: string) => Array.from(host.querySelectorAll("td")).find((td) => td.textContent === text) as HTMLElement;
    expect(byText("child").style.paddingLeft).toBe("14px");
    expect(byText("plain").style.paddingLeft).toBe("");
  });

  it("puts a flow image after the last carried row when the model's image row lies past a truncated sheet", () => {
    const host = render({ sheet: { ...BASE, image_png: "AAAA", image_row: 900, total_rows: 1000, truncated: true } });
    const image = host.querySelector('[data-testid="export-preview-image"]') as HTMLElement;
    expect(image.closest("tr")?.previousElementSibling?.getAttribute("data-row-number")).toBe("4");
    expect(host.querySelector('[data-testid="export-preview-truncated"]')?.textContent).toBe("Showing the first 4 of 1000 rows. The file has every row.");
  });

  it("sizes the columns from fit_widths and draws the model's bands over the head", () => {
    const host = render({ sheet: A_SHEET });
    const widths = Array.from(host.querySelectorAll<HTMLElement>('[data-testid="export-preview-body"] col')).map((col) => col.style.width);
    expect(widths[0]).toBe("6.159%"); // 34 / 552
    const bands = Array.from(host.querySelectorAll<HTMLTableCellElement>(".sv-band"));
    expect(bands.map((band) => [band.textContent, band.colSpan, band.dataset.tone])).toEqual([["As-is", 4, "asis"], ["To-be", 1, "tobe"], ["Tracking", 1, "tracking"]]);
    const bodyCells = host.querySelectorAll<HTMLElement>('[data-testid="export-preview-body"] tr[data-row-number="6"] td');
    expect(bodyCells[4].dataset.band).toBe("tobe");
  });

  it("draws the status chip from the cell's tone, not from its text", () => {
    const host = render({ sheet: A_SHEET });
    const chips = Array.from(host.querySelectorAll<HTMLElement>('[data-testid="export-preview-body"] .sv-chip'));
    // "AI suggested" 글이어도 모델이 ok를 실었으면 ok다
    expect(chips.map((chip) => chip.dataset.tone)).toEqual(["ok", "ok", "ok"]);
  });

  it("folds a run of contents rows into one row and opens it on click", () => {
    const host = render({ sheet: A_SHEET });
    const folded = host.querySelector<HTMLElement>('[data-testid="export-preview-toc-2"]');
    expect(folded?.dataset.toc).toBe("folded");
    expect(Array.from(folded?.querySelectorAll("td") ?? []).map((td) => td.textContent)).toEqual(["1-3", "Contents · 3 lines ▸ click to expand", "OLD-1-001 …", "text 1 + 2 more lines", "SOP-A", "Confirmed"]);
    expect(host.querySelectorAll('[data-testid="export-preview-body"] tr')).toHaveLength(3);

    act(() => folded?.click());
    const opened = host.querySelector<HTMLElement>('[data-testid="export-preview-toc-2"]');
    expect(opened?.dataset.toc).toBe("open");
    expect(opened?.querySelector("td:nth-child(2)")?.textContent).toBe("§1 ▾ Collapse");
    expect(host.querySelectorAll('[data-testid="export-preview-body"] tr')).toHaveLength(5);

    act(() => opened?.click());
    expect(host.querySelector<HTMLElement>('[data-testid="export-preview-toc-2"]')?.dataset.toc).toBe("folded");
  });

  it("folds contents rows of a sheet without column keys into one line in the Text column", () => {
    const rows = [
      row("header", true, ["Section No.", "Text", "Lang"].map((text) => cell(text, { head: true }))),
      row("in_group", true, [cell(""), cell("목차 하나 ... 3"), cell("KO")], { unit_id: 1, toc: true, noise: "toc" }),
      row("in_group", true, [cell(""), cell("목차 둘 ... 4"), cell("KO")], { unit_id: 2, toc: true, noise: "toc" }),
      row("in_group", true, [cell("1."), cell("본문"), cell("KO")], { unit_id: 3 }),
    ];
    const host = render({ sheet: { ...BASE, widths: [12, 90, 6], freeze: "A2", rows, total_rows: 4 } });
    const folded = host.querySelector<HTMLElement>('[data-testid="export-preview-toc-1"]');
    expect(Array.from(folded?.querySelectorAll("td") ?? []).map((td) => td.textContent)).toEqual(["", "▸ Table of contents · 2 lines", "KO"]);
    expect(host.querySelectorAll('[data-testid="export-preview-body"] tr')).toHaveLength(2);
    act(() => folded?.click());
    expect(host.querySelector('[data-testid="export-preview-toc-1"] td:nth-child(2)')?.textContent).toContain("▾ Collapse");
  });

  it("names each folded run of automatically deleted rows", () => {
    const rows = [...A_SHEET.rows.slice(0, 2), aRow("1", 1, { toc: true, noise: "front" }), aRow("2", 2, { toc: true, noise: "front" }), aRow("3", 3, { toc: true, noise: "toc" }), aRow("4", 4, { toc: true, noise: "toc" })];
    const host = render({ sheet: { ...A_SHEET, rows, total_rows: 6 } });
    const labels = [2, 4].map((at) => host.querySelector<HTMLElement>(`[data-testid="export-preview-toc-${at}"] td:nth-child(2)`)?.textContent);
    expect(labels).toEqual(["Front matter · 2 lines ▸ click to expand", "Contents · 2 lines ▸ click to expand"]);
  });

  it("paints the picked unit and its group, and overlays the draft only on the picked row", () => {
    const host = render({ sheet: A_SHEET, selectedUnitId: 4, draft: { new_doc: "WI-9" } });
    const marks = Array.from(host.querySelectorAll<HTMLElement>('[data-testid="export-preview-body"] tr')).map((tr) => tr.dataset.mark ?? null);
    expect(marks).toEqual([null, "picked", "group"]);
    const picked = host.querySelector('tr[data-mark="picked"]') as HTMLElement;
    expect(picked.querySelector(".sv-draft")?.textContent).toBe("WI-9");
    expect(picked.querySelector(".sv-pending")?.textContent).toBe("Not confirmed yet");
    expect(host.querySelectorAll(".sv-draft")).toHaveLength(1);
  });
});
