// 시트 보기의 셈 - 옮기기 범위 · 끌기 · 휠 · 글쇠 · 고른 줄 가운데 · 위치 막대 · 열 비율 · 띠 · 넘쳐 보이는 칸 · 목차 줄 묶기 · 고른 줄과 확정 전 값.
import { describe, expect, it } from "vitest";

import type { PreviewCell, PreviewRow } from "@/lib/api-sop";

import {
  applyDrag,
  applyKey,
  buildFoldedCells,
  centreRow,
  clampOffset,
  findDraftRow,
  findPickedGroup,
  getFoldLabelKey,
  getFoldMark,
  getFrozenCount,
  getMoveRange,
  getRailMark,
  getRailThumb,
  getRowMark,
  isDragMove,
  listBandTones,
  listSheetItems,
  listShownItems,
  readDraftText,
  readWheelMove,
  spanCells,
  toColumnPercents,
  type SheetExtent,
} from "./sheet-view-model";

const EXTENT: SheetExtent = { viewWidth: 1000, viewHeight: 400, contentWidth: 1180, contentHeight: 2000 };
const cell = (text: string, extra: Partial<PreviewCell> = {}): PreviewCell => ({ text, faint: false, italic: false, bold: false, head: false, numeric: false, indent: 0, strike: false, tone: null, ...extra });
const row = (texts: string[], extra: Partial<PreviewRow> = {}): PreviewRow => ({ kind: "group_start", wrap: true, cells: texts.map((text) => cell(text)), unit_id: null, group_id: null, toc: false, deleted: false, unit_ids: [], ...extra });

describe("move range", () => {
  it("runs from 0 to content minus view, and is 0 when everything shows", () => {
    expect(getMoveRange(EXTENT)).toEqual({ x: 180, y: 1600 });
    expect(getMoveRange({ ...EXTENT, contentWidth: 800, contentHeight: 300 })).toEqual({ x: 0, y: 0 });
  });

  it("clamps an offset into the range", () => {
    expect(clampOffset({ x: -20, y: 5000 }, EXTENT)).toEqual({ x: 0, y: 1600 });
    expect(clampOffset({ x: 90, y: 300 }, EXTENT)).toEqual({ x: 90, y: 300 });
  });
});

describe("drag", () => {
  it("treats a press that moved under 3px as a click", () => {
    expect(isDragMove(2, 2)).toBe(false);
    expect(isDragMove(3, 0)).toBe(true);
  });

  it("moves the body against the pointer and stops at the edges", () => {
    // 위로 100px 끌면 아래 줄이 나온다
    expect(applyDrag({ x: 0, y: 200 }, { x: 500, y: 300 }, { x: 500, y: 200 }, EXTENT)).toEqual({ x: 0, y: 300 });
    expect(applyDrag({ x: 0, y: 0 }, { x: 500, y: 300 }, { x: 900, y: 900 }, EXTENT)).toEqual({ x: 0, y: 0 });
  });
});

describe("wheel", () => {
  it("scrolls up and down with deltaY and sideways with deltaX", () => {
    expect(readWheelMove({ deltaX: 0, deltaY: 120, deltaMode: 0, shiftKey: false }, 400)).toEqual({ x: 0, y: 120 });
    expect(readWheelMove({ deltaX: 40, deltaY: 0, deltaMode: 0, shiftKey: false }, 400)).toEqual({ x: 40, y: 0 });
  });

  it("turns Shift+wheel reported as deltaY into a sideways move", () => {
    expect(readWheelMove({ deltaX: 0, deltaY: 100, deltaMode: 0, shiftKey: true }, 400)).toEqual({ x: 100, y: 0 });
  });

  it("reads line and page delta modes", () => {
    expect(readWheelMove({ deltaX: 0, deltaY: 3, deltaMode: 1, shiftKey: false }, 400)).toEqual({ x: 0, y: 45 });
    expect(readWheelMove({ deltaX: 0, deltaY: 1, deltaMode: 2, shiftKey: false }, 400)).toEqual({ x: 0, y: 400 });
  });
});

describe("keys", () => {
  it("moves by three lines, by a page less two lines, and to either end", () => {
    const at = { x: 0, y: 500 };
    expect(applyKey("ArrowDown", at, EXTENT)).toEqual({ x: 0, y: 545 });
    expect(applyKey("PageUp", at, EXTENT)).toEqual({ x: 0, y: 130 });
    expect(applyKey("Home", at, EXTENT)).toEqual({ x: 0, y: 0 });
    expect(applyKey("End", at, EXTENT)).toEqual({ x: 0, y: 1600 });
    expect(applyKey("ArrowLeft", at, EXTENT)).toEqual({ x: 0, y: 500 });
  });

  it("ignores keys that do not move", () => {
    expect(applyKey("a", { x: 0, y: 0 }, EXTENT)).toBeNull();
    expect(applyKey("toString", { x: 0, y: 0 }, EXTENT)).toBeNull();
  });
});

describe("picked row centre and the position rail", () => {
  it("puts a row in the vertical middle of the view, clamped at the ends", () => {
    expect(centreRow(1000, 20, EXTENT)).toBe(810);
    expect(centreRow(10, 20, EXTENT)).toBe(0);
    expect(centreRow(1990, 10, EXTENT)).toBe(1600);
  });

  it("sizes the thumb from the view and hides the rail when nothing can move", () => {
    expect(getRailThumb(400, EXTENT)).toEqual({ top: 20, height: 20 });
    expect(getRailThumb(0, { ...EXTENT, contentHeight: 300 })).toBeNull();
  });

  it("marks the picked row at its middle", () => {
    expect(getRailMark(990, 20, 2000)).toBe(50);
    expect(getRailMark(10, 20, 0)).toBe(0);
  });
});

describe("columns and frozen rows", () => {
  it("turns column ratios into table percents", () => {
    const percents = toColumnPercents([1, 1, 2]);
    expect(percents).toEqual([25, 25, 50]);
    expect(toColumnPercents([0, 0])).toEqual([50, 50]);
  });

  it("reads the frozen row count from the freeze cell", () => {
    expect(getFrozenCount("A3")).toBe(2);
    expect(getFrozenCount(null)).toBe(0);
  });

  it("gives every column its band tone and null past the bands", () => {
    expect(listBandTones([{ label: "As-is", span: 2, tone: "asis" }, { label: "To-be", span: 1, tone: "tobe" }], 4)).toEqual(["asis", "asis", "tobe", null]);
  });
});

describe("spanCells", () => {
  it("lets text in a no-wrap row run over the empty cells after it, but not a numeric cell", () => {
    const status = { ...row(["Status: Assigning", "", "", "x"]), wrap: false };
    expect(spanCells(status, 4).map(({ column, span }) => [column, span])).toEqual([[0, 3], [3, 1]]);
    const numeric: PreviewRow = { ...status, cells: [cell("7", { numeric: true }), cell(""), cell("")] };
    expect(spanCells(numeric, 3).map(({ span }) => span)).toEqual([1, 1, 1]);
  });

  it("keeps one cell per column in a wrapping row", () => {
    expect(spanCells(row(["a", "", "b"]), 3).map(({ span }) => span)).toEqual([1, 1, 1]);
  });
});

describe("contents fold", () => {
  const KEYS = ["row", "location", "unit_id", "old_text", "destination"];
  const ROWS = [
    row(["Row"], { kind: "header" }),
    row(["1", "§1", "OLD-1-001", "1. Purpose ... 3", "Deleted"], { toc: true, unit_id: 1 }),
    row(["2", "§1", "OLD-1-002", "2. Scope ... 4", "Deleted"], { toc: true, unit_id: 2 }),
    row(["3", "§2", "OLD-1-003", "Body", "New SOP"], { unit_id: 3 }),
    row(["4", "§3", "OLD-1-004", "Lone", "Deleted"], { toc: true, unit_id: 4 }),
  ];

  it("folds a run of two or more contents rows into one item and leaves a lone one alone", () => {
    const items = listSheetItems(ROWS, 1, new Set(), true);
    expect(items.map((item) => (item.type === "fold" ? `fold:${item.start}+${item.rows.length}` : `row:${item.index}`))).toEqual(["fold:1+2", "row:3", "row:4"]);
  });

  it("shows every row of an opened run, each pointing at the run's first row", () => {
    const items = listSheetItems(ROWS, 1, new Set([1]), true);
    expect(items.map((item) => (item.type === "row" ? [item.index, item.tocStart] : null))).toEqual([[1, 1], [2, 1], [3, null], [4, null]]);
  });

  it("breaks the fold where the kind changes", () => {
    const rows = [
      ...["front", "front", "toc", "toc", "history"].map((noise, at) => row([String(at + 1)], { toc: true, noise, unit_id: at + 1 })),
      row(["6"], { toc: true, noise: "history", unit_id: 6 }),
    ];
    const items = listSheetItems(rows, 0, new Set(), true);
    expect(items.map((item) => (item.type === "fold" ? `fold:${item.start}+${item.rows.length}` : `row:${item.index}`))).toEqual(["fold:0+2", "fold:2+2", "fold:4+2"]);
    expect(items.map((item) => (item.type === "fold" ? getFoldLabelKey(item.rows) : null))).toEqual(["outputs.sheet.frontFolded", "outputs.sheet.tocFolded", "outputs.sheet.historyFolded"]);
  });

  it("does not fold when the sheet cannot fold", () => {
    expect(listSheetItems(ROWS, 1, new Set(), false).every((item) => item.type === "row")).toBe(true);
  });

  it("folds contents rows of a paragraph sheet into one line", () => {
    const rows = [row(["Section No."], { kind: "header" }), row(["", "목차 하나"], { toc: true, noise: "toc" }), row(["", "목차 둘"], { toc: true, noise: "toc" }), row(["1.", "본문"])];
    expect(listSheetItems(rows, 1, new Set(), true).map((item) => item.type)).toEqual(["fold", "row"]);
    expect(listSheetItems([rows[0], rows[1], rows[3]], 1, new Set(), true).map((item) => item.type)).toEqual(["row", "row"]);
  });

  it("puts the folded label in the Text column when the sheet has no column keys", () => {
    const rows = [row(["", "목차 하나", "", "", "x"], { toc: true, noise: "toc" }), row(["", "목차 둘"], { toc: true, noise: "toc" })];
    expect(buildFoldedCells(rows, [], { label: "▸ 목차 2줄", more: "" }).map((item) => item.text)).toEqual(["", "▸ 목차 2줄", "", "", "x"]);
  });

  it("writes the row range, the label, the unit ellipsis and the more-lines tail onto the first row", () => {
    const cells = buildFoldedCells(ROWS.slice(1, 3), KEYS, { label: "Contents · 2 lines", more: "+ 1 more lines" });
    expect(cells.map((item) => item.text)).toEqual(["1-2", "Contents · 2 lines", "OLD-1-001 …", "1. Purpose ... 3 + 1 more lines", "Deleted"]);
  });

  it("keeps the strike on a folded row", () => {
    const struck = ROWS.slice(1, 3).map((item) => ({ ...item, cells: item.cells.map((c, column) => (column === 3 ? { ...c, strike: true } : c)) }));
    expect(buildFoldedCells(struck, KEYS, { label: "Contents · 2 lines", more: "+ 1 more lines" })[3].strike).toBe(true);
  });
});

describe("picked row, group and draft", () => {
  const ROWS = [
    row(["1"], { unit_id: 1, group_id: "G-1" }),
    row(["2"], { unit_id: 2, group_id: "G-1" }),
    row([""], { unit_id: 2, group_id: "G-1" }), // 이어진 줄
    row(["3"], { unit_id: 3, group_id: "G-2" }),
  ];

  it("finds the picked unit's group and marks picked and same-group rows by ids only", () => {
    const group = findPickedGroup(ROWS, 2);
    expect(group).toBe("G-1");
    expect(ROWS.map((item) => getRowMark(item, 2, group))).toEqual(["group", "picked", "picked", null]);
    expect(findPickedGroup(ROWS, null)).toBeNull();
    expect(getRowMark(ROWS[0], null, null)).toBeNull();
  });

  it("hides deleted rows unless picked, and marks a picked deleted row as deleted", () => {
    const rows = [row(["1"], { unit_id: 1 }), row(["2"], { unit_id: 2, deleted: true }), row([""], { unit_id: 2, deleted: true }), row(["3"], { unit_id: 3 })];
    const items = listSheetItems(rows, 0, new Set(), false);
    const shownIndexes = (unitId: number | null) => listShownItems(items, unitId).map((item) => (item.type === "row" ? item.index : -1));
    expect(shownIndexes(null)).toEqual([0, 3]);
    expect(shownIndexes(1)).toEqual([0, 3]);
    expect(shownIndexes(2)).toEqual([0, 1, 2, 3]);
    expect(rows.map((item) => getRowMark(item, 2, null))).toEqual([null, "deleted", "deleted", null]);
  });

  it("marks a folded run picked when any of its rows is picked", () => {
    expect(getFoldMark(ROWS.slice(0, 2), 2, "G-1")).toBe("picked");
    expect(getFoldMark(ROWS.slice(0, 1), 2, "G-1")).toBe("group");
    expect(getFoldMark(ROWS.slice(3), 2, "G-1")).toBeNull();
  });

  it("overlays the draft on the picked unit's first row only, and only in draft columns", () => {
    expect(findDraftRow(ROWS, 2, { new_doc: "WI-1" })).toBe(1);
    expect(findDraftRow(ROWS, 2, undefined)).toBe(-1);
    expect(findDraftRow(ROWS, 9, {})).toBe(-1);
    expect(readDraftText({ new_doc: "WI-1" }, "new_doc")).toBe("WI-1");
    expect(readDraftText({ new_doc: "WI-1" }, "old_text")).toBeUndefined();
    expect(readDraftText(undefined, "new_doc")).toBeUndefined();
  });
});
