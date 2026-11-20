// 용지 모델 - 블록 조각이 글자를 빠짐없이 덮고, 단위·블록 위치 변환이 서버 규칙(이음 글자 한 칸)과 같은지 본다.
import { describe, expect, it } from "vitest";

import type { DocumentView, ViewBlock, ViewPartGroup, ViewUnit } from "./api-sop";
import type { PaperRow } from "./paper-model";
import { buildPaperModel, buildPaperTabs, buildRows, foldCaptionRows, listFigureTabUnitIds, listPartSheets, pickFigureRows, canSplitAt, clampSplitAt, getBundleHeader, getGapMerge, getMergeBlocker, hasTocLineIn, resolveCutDrag, getMarks, getTags, isBandHeading, readWarningText, resolvePickUnit, shouldRecenter, toBlockOffset, toUnitOffset } from "./paper-model";

function makeBlock(id: number, seq: number, text: string, extra: Partial<ViewBlock> = {}): ViewBlock {
  return {
    id, seq, text, part: "body", kind: "paragraph", page: 1, page_basis: "estimated", section_label: "", heading_level: null,
    table_id: null, row_index: null, col_index: null, grid_span: 1, row_span: 1, flags: [], has_image: false, part_group: extra.part ?? "body", ...extra,
  };
}

function makeUnit(id: number, spans: Array<[number, number, number]>, text: string, extra: Partial<ViewUnit> = {}): ViewUnit {
  return {
    id, display_id: `D-${id}`, kind: "sentence", spans, text, lang: "en", number: null, table_id: null, row_index: null, group_unit_id: null,
    status: "unassigned", pair_id: null, pos_seq: spans[0]?.[0] ?? 0, block_id: spans[0]?.[0] ?? 0, is_edited: false, can_unmerge: false, split_suggestion_id: null, ref: null, caption_refs: [], ...extra,
  };
}

function makeView(blocks: ViewBlock[], units: ViewUnit[], partGroups: ViewPartGroup[] = []): DocumentView {
  return {
    document: {} as DocumentView["document"], extraction: null, has_number_ranges: false, tables: [], blocks, units, pairs: [], part_groups: partGroups,
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
    view.tables = [{ id: 7, table_index: 0, parent_table_id: null, part: "body", n_rows: 1, n_cols: 2, is_layout: false, is_band: false, anchor: null }];
    const model = buildPaperModel(view);
    expect(model.header).toHaveLength(1);
    expect(model.footer).toHaveLength(1);
    expect(model.body).toHaveLength(1);
    const table = model.body[0];
    expect(table.type === "table" && table.rows[0].map((cell) => cell.text)).toEqual(["b", "a"]);
    expect(table.type === "table" && table.unitId).toBe(20);
  });

  it("draws an unwrapped band table as one heading piece, not a table (F4)", () => {
    // 번호 칸 | 빈 칸 | 제목 칸 - 제목 줄 하나가 번호 칸 블록 전체와 제목 칸을 덮는다
    const cell = (id: number, col: number, text: string) => makeBlock(id, id, text, { kind: "table_cell", table_id: 7, row_index: 0, col_index: col });
    const blocks = [cell(1, 0, "7.4"), cell(2, 1, ""), cell(3, 2, "Filter change")];
    const band = makeUnit(30, [[1, 0, 3], [3, 0, 13]], "7.4\nFilter change", { kind: "heading", table_id: 7, row_index: 0 });
    const view = makeView(blocks, [band]);
    view.tables = [{ id: 7, table_index: 0, parent_table_id: null, part: "body", n_rows: 1, n_cols: 3, is_layout: true, is_band: false, anchor: null }];
    const model = buildPaperModel(view);
    expect(model.body.map((item) => (item.type === "block" ? item.block.id : "table"))).toEqual([1, 3]);
    const rows = buildRows(model.body, model.segments);
    expect(rows).toHaveLength(1);
    expect(rows[0].type === "piece" && rows[0].unitId).toBe(30);
    expect(rows[0].type === "piece" && rows[0].parts.map((part) => part.block.id)).toEqual([1, 3]);
    // 표로 되돌린(데이터 표) 띠 표는 다시 표로 그린다
    view.tables = [{ ...view.tables[0], is_layout: false }];
    view.units = [makeUnit(31, [], "", { kind: "table", table_id: 7, pos_seq: 1 })];
    expect(buildPaperModel(view).body.map((item) => item.type)).toEqual(["table"]);
  });
});

describe("isBandHeading", () => {
  it("is a heading unit that points at a source table", () => {
    expect(isBandHeading({ kind: "heading", table_id: 7 })).toBe(true);
    expect(isBandHeading({ kind: "heading", table_id: null })).toBe(false);
    expect(isBandHeading({ kind: "cell_sentence", table_id: 7 })).toBe(false);
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
    number: null,
    display_id: "OLD-1-001",
    kind: "sentence",
    spans: [[10, 0, 5]],
    text: "Hello",
    lang: "ko",
    table_id: null,
    row_index: null,
    group_unit_id: null,
    status: "unassigned",
    pair_id: null,
    pos_seq: 1,
    block_id: 10,
    is_edited: false, can_unmerge: false,
    split_suggestion_id: null, ref: null, caption_refs: [],
    ...over,
  };
}

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
    const unit = makeSplitUnit({ pair_id: 4, is_edited: true, split_suggestion_id: 2 });
    expect(getMarks(unit)).toEqual(["edited", "pair", "suggest"]);
  });

  it("leaves out what the box already says - confirmed and AI by the note line, a joined pair by the card", () => {
    expect(getMarks(makeSplitUnit({ status: "confirmed" }))).toEqual([]);
    expect(getMarks(makeSplitUnit({ status: "ai_suggested" }))).toEqual([]);
    expect(getMarks(makeSplitUnit({ pair_id: 4 }), true)).toEqual([]);
    expect(getMarks(makeSplitUnit({ pair_id: 4 }), false)).toEqual(["pair"]);
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

  it("will not merge a contents line with anything (server toc_line_locked)", () => {
    expect(getMergeBlocker(makeSplitUnit({ noise_kind: "toc" }), makeSplitUnit({ id: 2 }))).toBe("toc");
    expect(getMergeBlocker(makeSplitUnit(), makeSplitUnit({ id: 2, noise_kind: "toc" }))).toBe("toc");
  });
});

describe("hasTocLineIn", () => {
  it("finds a contents line over the block, so it is not carved", () => {
    const units = [makeSplitUnit({ spans: [[10, 0, 5]] }), makeSplitUnit({ id: 2, noise_kind: "toc", spans: [[11, 0, 9]] })];

    expect(hasTocLineIn(units, 11)).toBe(true);
    expect(hasTocLineIn(units, 10)).toBe(false);
  });
});

describe("resolvePickUnit", () => {
  it("picks the table for a bound cell sentence and itself otherwise", () => {
    const units = new Map([
      [1, makeSplitUnit({ id: 1, kind: "table" })],
      [2, makeSplitUnit({ id: 2, kind: "cell_sentence", group_unit_id: 1 })],
      [3, makeSplitUnit({ id: 3, kind: "sentence" })],
    ]);
    expect(resolvePickUnit(2, units)).toBe(1);
    expect(resolvePickUnit(3, units)).toBe(3);
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

describe("getBundleHeader", () => {
  const view = makeView(
    [
      makeBlock(1, 0, "열1", { kind: "table_cell", table_id: 7, row_index: 0, col_index: 0 }),
      makeBlock(2, 1, "열2", { kind: "table_cell", table_id: 7, row_index: 0, col_index: 1 }),
      makeBlock(3, 2, "a", { kind: "table_cell", table_id: 7, row_index: 1, col_index: 0 }),
      makeBlock(4, 3, "b", { kind: "table_cell", table_id: 7, row_index: 1, col_index: 1 }),
      makeBlock(5, 4, "그림 1 로터", { kind: "figure" }),
    ],
    [makeUnit(20, [], "", { kind: "table", table_id: 7, pos_seq: 0 }), makeUnit(21, [[5, 0, 7]], "그림 1 로터", { kind: "figure" })],
  );
  view.tables = [{ id: 7, table_index: 0, parent_table_id: null, part: "body", n_rows: 2, n_cols: 2, is_layout: false, is_band: false, anchor: null }];
  const model = buildPaperModel(view);
  const rows = buildRows(model.body, model.segments);
  const tableRow = rows.find((row) => row.type === "table")!;
  const figureRow = rows.find((row) => row.type === "figure")!;

  it("previews the first row of a table and the block text of a figure", () => {
    expect(getBundleHeader(tableRow, model)).toEqual({ kind: "table", unitId: 20, displayId: "D-20", preview: "열1 · 열2" });
    expect(getBundleHeader(figureRow, model)).toMatchObject({ kind: "figure", unitId: 21, displayId: "D-21", preview: "그림 1 로터" });
  });
});

describe("foldCaptionRows", () => {
  function pieceRow(unitId: number): PaperRow {
    return { type: "piece", key: `u${unitId}`, unitId, parts: [{ block: makeBlock(unitId, unitId, "캡션"), segments: [{ start: 0, end: 2, unitId }] }] };
  }
  function tableRow(unitId: number): PaperRow {
    const table = { id: 70, table_index: 0, parent_table_id: null, part: "body", n_rows: 0, n_cols: 0, is_layout: false, is_band: false, anchor: null };
    return { type: "table", key: "t70", item: { type: "table", table, rows: [], unitId } };
  }
  function units(spec: Record<number, Partial<ViewUnit>>): Map<number, ViewUnit> {
    return new Map(Object.entries(spec).map(([id, extra]) => [Number(id), makeUnit(Number(id), [], "", extra)]));
  }

  it("folds a caption piece before the table into the table row", () => {
    const rows = foldCaptionRows([pieceRow(5), tableRow(9)], units({ 5: { kind: "caption", group_unit_id: 9 }, 9: { kind: "table" } }));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: "table", captions: [expect.objectContaining({ unitId: 5 })] });
  });

  it("ties a figure row to its figure unit and folds the caption paragraph under it", () => {
    const view = makeView(
      [makeBlock(1, 0, "", { kind: "figure" }), makeBlock(2, 1, "그림 1 로터")],
      [makeUnit(20, [], "", { kind: "figure", block_id: 1, pos_seq: 0 }), makeUnit(21, [[2, 0, 7]], "그림 1 로터", { kind: "caption", group_unit_id: 20 })],
    );
    const model = buildPaperModel(view);
    const rows = foldCaptionRows(buildRows(model.body, model.segments), model.units);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: "figure", unitId: 20, captions: [expect.objectContaining({ unitId: 21 })] });
  });

  it("reads an old-extraction caption anchored on the figure block as the figure's caption", () => {
    const view = makeView(
      [makeBlock(1, 0, "그림 1 로터", { kind: "figure" })],
      [makeUnit(20, [], "", { kind: "figure", block_id: 1, pos_seq: 0 }), makeUnit(21, [[1, 0, 7]], "그림 1 로터", { kind: "caption", group_unit_id: 20 })],
    );
    const model = buildPaperModel(view);
    const [row] = foldCaptionRows(buildRows(model.body, model.segments), model.units);
    expect(row).toMatchObject({ type: "figure", unitId: 20 });
    const caption = row.type === "figure" ? row.captions?.[0] : undefined;
    expect(caption?.unitId).toBe(21);
    expect(caption?.parts[0]).toMatchObject({ block: { id: 1 }, segments: [{ start: 0, end: 7, unitId: 21 }] });
  });

  it("reads a caption lifted from the table's first row (a span on a table cell) as the table's caption (F7 ③)", () => {
    const table = { id: 70, table_index: 0, parent_table_id: null, part: "body", n_rows: 2, n_cols: 1, is_layout: false, is_band: false, anchor: null };
    const cell = makeBlock(3, 0, "표 2. 경보 목록", { kind: "table_cell", table_id: 70, row_index: 0 });
    const row: PaperRow = { type: "table", key: "t70", item: { type: "table", table, rows: [[cell]], unitId: 9 } };
    const [folded] = foldCaptionRows([row], units({ 9: { kind: "table" }, 6: { kind: "caption", group_unit_id: 9, spans: [[3, 0, 9]] } }));
    expect(folded).toMatchObject({ type: "table", captions: [{ unitId: 6, parts: [{ block: { id: 3 }, segments: [{ start: 0, end: 9, unitId: 6 }] }] }] });
  });

  it("leaves a caption whose bundle is not on the list as its own piece and gives a captionless bundle an empty list", () => {
    const rows = foldCaptionRows([pieceRow(5), tableRow(9)], units({ 5: { kind: "caption", group_unit_id: 8 }, 9: { kind: "table" } }));
    expect(rows.map((row) => row.type)).toEqual(["piece", "table"]);
    expect(rows[1]).toMatchObject({ captions: [] });
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
      [makeUnit(10, [[1, 0, 4]], "One."), makeUnit(11, [[1, 5, 9]], "Two."), makeUnit(12, [[2, 0, 2]], "셋.", { lang: "ko" })],
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

  it("has no control between two members of the same pair, but keeps one between different pairs", () => {
    const { model, rows } = build(
      [makeBlock(1, 0, "가. Alpha. 나.")],
      [makeUnit(10, [[1, 0, 3]], "가.", { lang: "ko", pair_id: 5 }), makeUnit(11, [[1, 3, 10]], " Alpha.", { pair_id: 5 }), makeUnit(12, [[1, 10, 13]], " 나.", { lang: "ko", pair_id: 6 })],
    );
    expect(getGapMerge(rows[0], rows[1], model.units)).toBeNull();
    expect(getGapMerge(rows[1], rows[2], model.units)).toEqual({ firstId: 11, secondId: 12, blocker: null });
  });

  it("has no merge across part groups", () => {
    const blocks = [makeBlock(1, 0, "Head A", { part: "header", part_group: "header:1" }), makeBlock(2, 1, "Head B", { part: "header", part_group: "header:2" })];
    const units = [makeUnit(10, [[1, 0, 6]], "Head A"), makeUnit(11, [[2, 0, 6]], "Head B")];
    const model = buildPaperModel(makeView(blocks, units));
    const rows = buildRows(model.header, model.segments);
    expect(getGapMerge(rows[0], rows[1], model.units)).toBeNull();
  });
});

describe("listPartSheets (sheets of one tab on the Assign paper)", () => {
  const blocks = [
    makeBlock(1, 0, "Head A", { part: "header", part_group: "h1" }),
    makeBlock(2, 1, "Head A", { part: "header", part_group: "h2" }),
    makeBlock(3, 2, "Body."),
    makeBlock(4, 3, "Note", { part: "footnote", part_group: "footnote" }),
  ];
  const units = [makeUnit(10, [[1, 0, 6]], "Head A"), makeUnit(11, [[2, 0, 6]], "Head A"), makeUnit(12, [[3, 0, 5]], "Body."), makeUnit(13, [[4, 0, 4]], "Note")];
  const groups: ViewPartGroup[] = [
    { key: "h1", part: "header", refs: [{ section: 2, type: "default" }, { section: 1, type: "default" }], block_count: 1, same_as: null },
    { key: "h2", part: "header", refs: [{ section: 3, type: "first" }], block_count: 1, same_as: "h1" },
    { key: "body", part: "body", refs: [], block_count: 1, same_as: null },
    { key: "footnote", part: "footnote", refs: [], block_count: 1, same_as: null },
  ];
  const view = makeView(blocks, units, groups);
  const model = buildPaperModel(view);

  it("keeps a repeated header as its own sheet, with where each one is used", () => {
    const sheets = listPartSheets(view, model, "header");
    expect(sheets.map((sheet) => sheet.key)).toEqual(["h1", "h2"]);
    expect(sheets[0].refs.map((ref) => ref.section)).toEqual([1, 2]);
    expect(sheets[1].refs).toEqual([{ section: 3, type: "first" }]);
    expect(sheets.every((sheet) => sheet.items.length === 1)).toBe(true);
  });

  it("gives the footer tab its footnotes and the body one sheet", () => {
    expect(listPartSheets(view, model, "footer").map((sheet) => sheet.part)).toEqual(["footnote"]);
    expect(listPartSheets(view, model, "body")).toHaveLength(1);
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

describe("figures tab (mockup 2 D3)", () => {
  // 문단 · 그림(캡션 문단 딸림) · 문단 · 캡션을 같이 쓰는 그림 둘 · 데이터 표 칸 안 그림 · 머리말 그림
  const blocks = [
    makeBlock(1, 0, "Before."),
    makeBlock(2, 1, "", { kind: "figure" }),
    makeBlock(3, 2, "Figure 1 Rotor"),
    makeBlock(4, 3, "Middle."),
    makeBlock(5, 4, "", { kind: "figure" }),
    makeBlock(6, 5, "", { kind: "figure" }),
    makeBlock(7, 6, "cell", { kind: "table_cell", table_id: 9, row_index: 0, col_index: 0 }),
    makeBlock(8, 7, "", { kind: "figure", table_id: 9, row_index: 0, col_index: 0 }),
    makeBlock(10, 9, "", { kind: "figure", part: "header" }),
  ];
  const units = [
    makeUnit(10, [[1, 0, 7]], "Before."),
    makeUnit(20, [], "", { kind: "figure", block_id: 2, pos_seq: 1 }),
    makeUnit(21, [[3, 0, 14]], "Figure 1 Rotor", { kind: "caption", group_unit_id: 20 }),
    makeUnit(11, [[4, 0, 7]], "Middle."),
    makeUnit(30, [], "", { kind: "figure", block_id: 5, pos_seq: 4 }),
    makeUnit(31, [], "", { kind: "figure", block_id: 6, pos_seq: 5, caption_figure_id: 30 }),
    makeUnit(40, [], "", { kind: "table", table_id: 9, block_id: 7, pos_seq: 6 }),
    makeUnit(41, [[7, 0, 4]], "cell", { kind: "cell_sentence", table_id: 9, group_unit_id: 40 }),
    makeUnit(50, [], "", { kind: "figure", block_id: 8, pos_seq: 7 }),
    makeUnit(60, [], "", { kind: "figure", block_id: 10, pos_seq: 9 }),
  ];
  const view = makeView(blocks, units);
  view.tables = [{ id: 9, table_index: 0, parent_table_id: null, part: "body", n_rows: 1, n_cols: 1, is_layout: false, is_band: false, anchor: null }];
  const model = buildPaperModel(view);

  it("makes one card per figure group - captions ride along, a shared caption joins its figures, an in-cell figure is its own card", () => {
    expect(model.figures.map((group) => [group.figureIds, group.captionIds])).toEqual([
      [[20], [21]],
      [[30, 31], []],
      [[50], []],
    ]);
    expect(listFigureTabUnitIds(view)).toEqual(new Set([20, 21, 30, 31, 50]));
    // 머리말 그림은 머리말에 남는다
    expect(model.figureGroupOf.has(60)).toBe(false);
  });

  it("drops figure rows and their caption pieces from the body with no placeholder, and keeps only figure cards on the tab", () => {
    const rows = foldCaptionRows(buildRows(model.body, model.segments), model.units);
    const body = pickFigureRows(rows, model.figureGroupOf, "hide");
    expect(body.map((row) => (row.type === "table" ? `t${row.item.unitId}` : `${row.type}${row.unitId}`))).toEqual(["piece10", "piece11", "t40"]);
    const tab = pickFigureRows(foldCaptionRows(buildRows(model.figureItems, model.segments), model.units), model.figureGroupOf, "only");
    expect(tab.map((row) => (row.type === "figure" ? row.unitId : null))).toEqual([20, 30, 31, 50]);
    const first = tab[0];
    expect(first.type === "figure" && first.captions?.map((piece) => piece.unitId)).toEqual([21]);
  });

  it("adds a Figures tab after the others whose J/K order is card order, and the body tab skips figures", () => {
    const tabs = buildPaperTabs(view, model);
    expect(tabs.tabs.map((tab) => tab.key)).toEqual(["body", "header", "figures"]);
    expect(tabs.tabs[0].unitIds).toEqual([10, 11, 40, 41]);
    expect(tabs.tabs[2].unitIds).toEqual([20, 21, 30, 31, 50]);
    expect(tabs.tabOf.get(50)).toBe("figures");
    expect(tabs.tabOf.get(60)).toBe("header");
  });

  it("has no Figures tab when the document has no body figure", () => {
    const plain = makeView([makeBlock(1, 0, "Only text.")], [makeUnit(10, [[1, 0, 10]], "Only text.")]);
    const plainModel = buildPaperModel(plain);
    expect(plainModel.figures).toEqual([]);
    expect(buildPaperTabs(plain, plainModel).tabs.map((tab) => tab.key)).toEqual(["body"]);
  });
});
