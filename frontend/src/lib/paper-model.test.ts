// 용지 모델 - 블록 조각이 글자를 빠짐없이 덮고, 단위·블록 위치 변환이 서버 규칙(이음 글자 한 칸)과 같은지 본다.
import { describe, expect, it } from "vitest";

import type { DocumentView, ViewBlock, ViewPartGroup, ViewUnit } from "./api-sop";
import { buildContourPath, buildPaperModel, buildPaperTabs, buildRows, canSplitAt, clampSplitAt, getGapMerge, getMergeBlocker, resolveCutDrag, countUnchecked, getMarks, getTags, readWarningText, shouldRecenter, toBlockOffset, toUnitOffset } from "./paper-model";

function makeBlock(id: number, seq: number, text: string, extra: Partial<ViewBlock> = {}): ViewBlock {
  return {
    id, seq, text, part: "body", kind: "paragraph", page: 1, page_basis: "estimated", section_label: "", heading_level: null,
    table_id: null, row_index: null, col_index: null, grid_span: 1, row_span: 1, flags: [], has_image: false, part_group: extra.part ?? "body", ...extra,
  };
}

function makeUnit(id: number, spans: Array<[number, number, number]>, text: string, extra: Partial<ViewUnit> = {}): ViewUnit {
  return {
    id, display_id: `D-${id}`, kind: "sentence", spans, text, lang: "en", table_id: null, row_index: null, group_unit_id: null,
    boundary_confirmed: false, status: "unassigned", pair_id: null, pos_seq: spans[0]?.[0] ?? 0, block_id: spans[0]?.[0] ?? 0, is_edited: false, can_unmerge: false, split_suggestion_id: null, ...extra,
  };
}

function makeView(blocks: ViewBlock[], units: ViewUnit[], partGroups: ViewPartGroup[] = []): DocumentView {
  return {
    document: {} as DocumentView["document"], extraction: null, tables: [], blocks, units, pairs: [], part_groups: partGroups,
    edits: { can_undo: false, can_redo: false },
  };
}

describe("buildPaperModel", () => {
  it("covers every character with unit and gap segments", () => {
    const view = makeView([makeBlock(1, 0, "One. Two.")], [makeUnit(10, [[1, 0, 4]], "One."), makeUnit(11, [[1, 5, 9]], "Two.")]);
    const model = buildPaperModel(view);
    expect(model.segments.get(1)).toEqual([
      { start: 0, end: 4, unitId: 10 },
      { start: 4, end: 5, unitId: null },
      { start: 5, end: 9, unitId: 11 },
    ]);
    expect(model.order).toEqual([10, 11]);
  });

  it("groups table cells into rows once and keeps header and footer apart", () => {
    const blocks = [
      makeBlock(1, 0, "HEAD", { part: "header" }),
      makeBlock(2, 1, "a", { kind: "table_cell", table_id: 7, row_index: 0, col_index: 1 }),
      makeBlock(3, 2, "b", { kind: "table_cell", table_id: 7, row_index: 0, col_index: 0 }),
      makeBlock(4, 3, "FOOT", { part: "footer" }),
    ];
    const view = makeView(blocks, [makeUnit(20, [], "", { kind: "table", table_id: 7, pos_seq: 1 })]);
    view.tables = [{ id: 7, table_index: 0, parent_table_id: null, part: "body", n_rows: 1, n_cols: 2, is_layout: false }];
    const model = buildPaperModel(view);
    expect(model.header).toHaveLength(1);
    expect(model.footer).toHaveLength(1);
    expect(model.body).toHaveLength(1);
    const table = model.body[0];
    expect(table.type === "table" && table.rows[0].map((cell) => cell.text)).toEqual(["b", "a"]);
    expect(table.type === "table" && table.unitId).toBe(20);
  });
});

describe("offset conversion", () => {
  // 같은 블록 두 범위 "abc"+"ef" → 단위 글자 "abc ef"
  const spans: Array<[number, number, number]> = [[1, 0, 3], [1, 4, 6], [2, 0, 2]];

  it("maps block offsets to unit offsets with one joiner between spans", () => {
    expect(toUnitOffset(spans, 1, 0)).toBe(0);
    expect(toUnitOffset(spans, 1, 4)).toBe(4);
    expect(toUnitOffset(spans, 2, 1)).toBe(8);
    expect(toUnitOffset(spans, 3, 0)).toBeNull();
  });

  it("maps unit offsets back and refuses the joiner", () => {
    expect(toBlockOffset(spans, 5)).toEqual({ blockId: 1, offset: 5 });
    expect(toBlockOffset(spans, 3)).toBeNull();
    expect(toBlockOffset(spans, 7)).toEqual({ blockId: 2, offset: 0 });
  });

  it("only splits where both pieces keep text", () => {
    const unit = makeUnit(1, [[1, 0, 9]], "One. Two.");
    expect(canSplitAt(unit, 5)).toBe(true);
    expect(canSplitAt(unit, 0)).toBe(false);
    expect(canSplitAt(unit, 9)).toBe(false);
  });
});

describe("extraction warnings", () => {
  // 누락 글 경고는 backend ingest가 detail.snippet에 담는다 - 비어 보이면 작성자가 글을 못 보고 확인해야 한다
  it("shows the missing text the extractor flagged", () => {
    expect(readWarningText({ snippet: "빠진 문장" })).toBe("빠진 문장");
    expect(readWarningText({ table_index: "2" })).toBe("");
  });
});

// ── Split 개편(2026-11-09): 선택 윤곽, 가운데 스크롤, 태그·표시, 이웃 합치기 ──

function makeSplitUnit(over: Partial<ViewUnit> = {}): ViewUnit {
  return {
    id: 1,
    display_id: "OLD-1-001",
    kind: "sentence",
    spans: [[10, 0, 5]],
    text: "Hello",
    lang: "ko",
    table_id: null,
    row_index: null,
    group_unit_id: null,
    boundary_confirmed: false,
    status: "unassigned",
    pair_id: null,
    pos_seq: 1,
    block_id: 10,
    is_edited: false, can_unmerge: false,
    split_suggestion_id: null,
    ...over,
  };
}

describe("buildContourPath", () => {
  it("draws one padded box for a single line", () => {
    expect(buildContourPath([{ left: 10, right: 110, top: 20, bottom: 40 }])).toBe("M6,18 H114 V42 H6 V18 Z");
  });

  it("walks down the right edges and back up the left edges across lines", () => {
    const path = buildContourPath([
      { left: 60, right: 300, top: 0, bottom: 20 },
      { left: 0, right: 180, top: 24, bottom: 44 },
    ]);
    // 줄 사이 경계는 가운데(22)로 맞춘다
    expect(path).toBe("M56,-2 H304 V22 H184 V46 H-4 V22 H56 V-2 Z");
  });

  it("merges rects that sit on the same line", () => {
    const path = buildContourPath([
      { left: 0, right: 50, top: 0, bottom: 20 },
      { left: 50, right: 120, top: 1, bottom: 20 },
    ]);
    expect(path).toBe("M-4,-2 H124 V22 H-4 V-2 Z");
  });

  it("returns an empty path without rects", () => {
    expect(buildContourPath([])).toBe("");
  });
});

describe("shouldRecenter", () => {
  it("leaves a unit alone in the middle band", () => {
    expect(shouldRecenter(300, 330, 0, 900)).toBe(false);
  });

  it("recenters near the bottom or above the top", () => {
    expect(shouldRecenter(700, 730, 0, 900)).toBe(true);
    expect(shouldRecenter(60, 90, 0, 900)).toBe(true);
  });
});

describe("getTags and getMarks", () => {
  it("shows the language and hold as letter tags", () => {
    expect(getTags(makeSplitUnit({ lang: "en", status: "on_hold" }))).toEqual({ lang: "EN", hold: true });
    expect(getTags(makeSplitUnit({ lang: "neutral" }))).toEqual({ lang: null, hold: false });
  });

  it("lists icon marks in a stable order", () => {
    const unit = makeSplitUnit({ boundary_confirmed: true, pair_id: 4, is_edited: true, status: "confirmed" });
    expect(getMarks(unit)).toEqual(["edited", "pair", "classified", "checked"]);
    expect(getMarks(makeSplitUnit({ status: "ai_suggested" }))).toEqual(["ai"]);
  });
});

describe("countUnchecked", () => {
  const units = [
    makeSplitUnit({ id: 1 }),
    makeSplitUnit({ id: 2, boundary_confirmed: true }),
    makeSplitUnit({ id: 3, kind: "heading" }),
    makeSplitUnit({ id: 4, kind: "figure" }),
    makeSplitUnit({ id: 5, kind: "cell_sentence" }),
    makeSplitUnit({ id: 6, kind: "table", spans: [] }),
    makeSplitUnit({ id: 7, kind: "table_row", spans: [] }),
  ];

  it("counts text units still to check and leaves table groups to their cells", () => {
    expect(countUnchecked(units, (unit) => unit.boundary_confirmed)).toBe(4);
  });

  it("follows what the screen already painted as checked", () => {
    expect(countUnchecked(units, (unit) => unit.boundary_confirmed || unit.id === 1)).toBe(3);
    expect(countUnchecked(units, () => true)).toBe(0);
  });
});

describe("getMergeBlocker", () => {
  it("merges two body sentences and a heading with a sentence", () => {
    expect(getMergeBlocker(makeSplitUnit({ id: 1 }), makeSplitUnit({ id: 2 }))).toBeNull();
    expect(getMergeBlocker(makeSplitUnit({ id: 1, kind: "heading" }), makeSplitUnit({ id: 2 }))).toBeNull();
  });

  it("does not look at language - a KO and an EN sentence can merge", () => {
    expect(getMergeBlocker(makeSplitUnit({ id: 1, lang: "ko" }), makeSplitUnit({ id: 2, lang: "en" }))).toBeNull();
  });

  it("names the reason: kind, cell", () => {
    expect(getMergeBlocker(makeSplitUnit(), makeSplitUnit({ id: 2, kind: "figure" }))).toBe("not_text");
    expect(getMergeBlocker(makeSplitUnit(), makeSplitUnit({ id: 2, kind: "cell_sentence", table_id: 3, group_unit_id: 7 }))).toBe("cell");
    expect(getMergeBlocker(makeSplitUnit({ kind: "cell_sentence", group_unit_id: 7 }), makeSplitUnit({ id: 2, kind: "cell_sentence", group_unit_id: 8 }))).toBe("cell");
  });

  it("lets cell sentences of the same table or row group merge", () => {
    expect(getMergeBlocker(makeSplitUnit({ kind: "cell_sentence", group_unit_id: 7 }), makeSplitUnit({ id: 2, kind: "cell_sentence", group_unit_id: 7 }))).toBeNull();
  });
});

describe("buildRows", () => {
  it("gives every unit its own piece, even inside one paragraph, and swallows the blank between them", () => {
    const view = makeView([makeBlock(1, 0, "One. Two."), makeBlock(2, 1, "Three.")], [makeUnit(10, [[1, 0, 4]], "One."), makeUnit(11, [[1, 5, 9]], "Two."), makeUnit(12, [[2, 0, 6]], "Three.")]);
    const model = buildPaperModel(view);
    const rows = buildRows(model.body, model.segments);
    expect(rows.map((row) => (row.type === "piece" ? row.unitId : row.type))).toEqual([10, 11, 12]);
    expect(rows.flatMap((row) => (row.type === "piece" ? row.parts.flatMap((part) => part.segments) : []))).toEqual([
      { start: 0, end: 4, unitId: 10 },
      { start: 5, end: 9, unitId: 11 },
      { start: 0, end: 6, unitId: 12 },
    ]);
  });

  it("keeps a unit that spans paragraphs, or two ranges of one paragraph, as one piece", () => {
    const view = makeView(
      [makeBlock(1, 0, "Line one"), makeBlock(2, 1, "line two"), makeBlock(3, 2, "A B")],
      [makeUnit(10, [[1, 0, 8], [2, 0, 8]], "Line one\nline two"), makeUnit(11, [[3, 0, 1], [3, 2, 3]], "A B")],
    );
    const model = buildPaperModel(view);
    const rows = buildRows(model.body, model.segments);
    expect(rows).toHaveLength(2);
    expect(rows[0].type === "piece" && rows[0].parts.map((part) => part.block.id)).toEqual([1, 2]);
    // 같은 단위의 두 범위 사이 빈 글자는 남긴다
    expect(rows[1].type === "piece" && rows[1].parts[0].segments).toHaveLength(3);
  });

  it("keeps text no unit owns as its own piece and puts figures on their own row", () => {
    const view = makeView([makeBlock(1, 0, "Loose text"), makeBlock(2, 1, "", { kind: "figure" })], [makeUnit(20, [[2, 0, 0]], "", { kind: "figure" })]);
    const model = buildPaperModel(view);
    const rows = buildRows(model.body, model.segments);
    expect(rows.map((row) => row.type)).toEqual(["piece", "figure"]);
    expect(rows[0].type === "piece" && rows[0].unitId).toBeNull();
  });
});

describe("getGapMerge", () => {
  function build(blocks: ViewBlock[], units: ViewUnit[]) {
    const model = buildPaperModel(makeView(blocks, units));
    return { model, rows: buildRows(model.body, model.segments) };
  }

  it("always offers a merge between two text pieces, whatever their languages", () => {
    const { model, rows } = build(
      [makeBlock(1, 0, "One. Two."), makeBlock(2, 1, "셋.")],
      [makeUnit(10, [[1, 0, 4]], "One.", { boundary_confirmed: true }), makeUnit(11, [[1, 5, 9]], "Two."), makeUnit(12, [[2, 0, 2]], "셋.", { lang: "ko" })],
    );
    expect(getGapMerge(rows[0], rows[1], model.units)).toEqual({ firstId: 10, secondId: 11, blocker: null });
    expect(getGapMerge(rows[1], rows[2], model.units)).toEqual({ firstId: 11, secondId: 12, blocker: null });
  });

  it("is off with a reason next to a figure and absent between two non-text rows", () => {
    const { model, rows } = build(
      [makeBlock(1, 0, "One."), makeBlock(2, 1, "", { kind: "figure" }), makeBlock(3, 2, "", { kind: "figure" })],
      [makeUnit(10, [[1, 0, 4]], "One."), makeUnit(20, [[2, 0, 0]], "", { kind: "figure" }), makeUnit(21, [[3, 0, 0]], "", { kind: "figure" })],
    );
    expect(getGapMerge(rows[0], rows[1], model.units)).toEqual({ firstId: 10, secondId: 10, blocker: "not_text" });
    expect(getGapMerge(rows[1], rows[2], model.units)).toBeNull();
  });

  it("has no merge across part groups", () => {
    const blocks = [makeBlock(1, 0, "Head A", { part: "header", part_group: "header:1" }), makeBlock(2, 1, "Head B", { part: "header", part_group: "header:2" })];
    const units = [makeUnit(10, [[1, 0, 6]], "Head A"), makeUnit(11, [[2, 0, 6]], "Head B")];
    const model = buildPaperModel(makeView(blocks, units));
    const rows = buildRows(model.header, model.segments);
    expect(getGapMerge(rows[0], rows[1], model.units)).toBeNull();
  });
});

describe("buildPaperTabs", () => {
  function makeGroup(key: string, part: string, over: Partial<ViewPartGroup> = {}): ViewPartGroup {
    return { key, part, refs: [], block_count: 1, same_as: null, ...over };
  }

  it("shows only the body tab for a body-only document", () => {
    const view = makeView([makeBlock(1, 0, "One.")], [makeUnit(10, [[1, 0, 4]], "One.")], [makeGroup("body", "body")]);
    const tabs = buildPaperTabs(view, buildPaperModel(view));
    expect(tabs.tabs.map((tab) => tab.key)).toEqual(["body"]);
    expect(tabs.order).toEqual([10]);
  });

  it("puts each header group on its own sheet, shows a repeated one once and keeps footnotes with the footer", () => {
    const blocks = [
      makeBlock(1, 0, "Head A", { part: "header", part_group: "h1" }),
      makeBlock(2, 1, "Head B", { part: "header", part_group: "h2" }),
      makeBlock(3, 2, "Head A", { part: "header", part_group: "h3" }),
      makeBlock(4, 3, "Body."),
      makeBlock(5, 4, "Foot", { part: "footer", part_group: "f1" }),
      makeBlock(6, 5, "Note", { part: "footnote", part_group: "footnote" }),
    ];
    const units = [
      makeUnit(10, [[1, 0, 6]], "Head A"),
      makeUnit(11, [[2, 0, 6]], "Head B"),
      makeUnit(12, [[3, 0, 6]], "Head A"),
      makeUnit(13, [[4, 0, 5]], "Body."),
      makeUnit(14, [[5, 0, 4]], "Foot"),
      makeUnit(15, [[6, 0, 4]], "Note"),
    ];
    const groups = [
      makeGroup("h1", "header", { refs: [{ section: 1, type: "default" }] }),
      makeGroup("h2", "header", { refs: [{ section: 1, type: "first" }] }),
      makeGroup("h3", "header", { refs: [{ section: 2, type: "default" }], same_as: "h1" }),
      makeGroup("body", "body"),
      makeGroup("f1", "footer"),
      makeGroup("footnote", "footnote"),
    ];
    const view = makeView(blocks, units, groups);
    const tabs = buildPaperTabs(view, buildPaperModel(view));
    expect(tabs.tabs.map((tab) => tab.key)).toEqual(["body", "header", "footer"]);
    const header = tabs.tabs[1];
    expect(header.sheets.map((sheet) => sheet.key)).toEqual(["h1", "h2"]);
    // 숨긴 묶음의 구역은 보이는 쪽에 모인다
    expect(header.sheets[0].refs).toEqual([{ section: 1, type: "default" }, { section: 2, type: "default" }]);
    expect(header.unitIds).toEqual([10, 11]);
    expect(tabs.mirrors.get(10)).toEqual([12]);
    expect(tabs.tabs[2].sheets.map((sheet) => sheet.key)).toEqual(["f1", "footnote"]);
    expect(tabs.order).toEqual([13, 10, 11, 14, 15]);
    expect(tabs.tabOf.get(12)).toBe("header");
  });

  it("keeps a repeated group visible when its units were cut differently", () => {
    const blocks = [makeBlock(1, 0, "Head A. More.", { part: "header", part_group: "h1" }), makeBlock(2, 1, "Head A. More.", { part: "header", part_group: "h2" })];
    const units = [makeUnit(10, [[1, 0, 13]], "Head A. More."), makeUnit(11, [[2, 0, 7]], "Head A."), makeUnit(12, [[2, 8, 13]], "More.")];
    const view = makeView(blocks, units, [makeGroup("h1", "header"), makeGroup("h2", "header", { same_as: "h1" })]);
    const tabs = buildPaperTabs(view, buildPaperModel(view));
    expect(tabs.tabs[0].sheets.map((sheet) => sheet.key)).toEqual(["h1", "h2"]);
    expect(tabs.mirrors.size).toBe(0);
  });
});

describe("clampSplitAt and resolveCutDrag", () => {
  const unit = makeUnit(10, [[1, 0, 5], [2, 0, 5]], "Hello\nWorld");

  it("clamps to the first and last place that leaves text on both sides", () => {
    expect(clampSplitAt(unit, -3)).toBe(1);
    expect(clampSplitAt(unit, 99)).toBe(10);
    expect(clampSplitAt(unit, 4)).toBe(4);
    expect(clampSplitAt(makeUnit(11, [[1, 0, 1]], "A"), 0)).toBeNull();
  });

  it("skips leading and trailing blanks", () => {
    const padded = makeUnit(12, [[1, 0, 6]], "  ab  ");
    expect(clampSplitAt(padded, 0)).toBe(3);
    expect(clampSplitAt(padded, 6)).toBe(3);
  });

  it("follows the pointer inside the unit and stops at its ends outside it", () => {
    expect(resolveCutDrag(unit, { blockId: 1, offset: 3 })).toBe(3);
    expect(resolveCutDrag(unit, { blockId: 2, offset: 2 })).toBe(8);
    expect(resolveCutDrag(unit, "start")).toBe(1);
    expect(resolveCutDrag(unit, "end")).toBe(10);
    expect(resolveCutDrag(unit, { blockId: 9, offset: 0 })).toBeNull();
  });

  it("every place it returns is one the split accepts", () => {
    for (let at = -2; at < 14; at += 1) {
      const clamped = clampSplitAt(unit, at);
      expect(clamped !== null && canSplitAt(unit, clamped) && toBlockOffset(unit.spans, clamped) !== null).toBe(true);
    }
  });
});

describe("suggest mark", () => {
  it("marks a unit with an open AI split suggestion", () => {
    expect(getMarks(makeSplitUnit({ split_suggestion_id: 4 }))).toContain("suggest");
    expect(getMarks(makeSplitUnit())).not.toContain("suggest");
  });
});
