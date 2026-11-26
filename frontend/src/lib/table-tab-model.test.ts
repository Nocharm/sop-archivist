// 표 탭 · 본문 표 접기의 모델 - 본문의 바깥 표를 문서 차례로 모으고, 표 탭의 J/K 차례와 접힘을 정한다(11-23 명세 E2).
import { describe, expect, it } from "vitest";

import type { DocumentView, ViewBlock, ViewTable, ViewUnit } from "./api-sop";
import { buildPaperModel } from "./paper-model";
import { findUnitTable, listTableBlocks, listTableTabUnitIds, resolveFolded, toggleFold, toggleFoldAll } from "./table-tab-model";

function block(id: number, text: string, extra: Partial<ViewBlock> = {}): ViewBlock {
  return {
    id, seq: id, text, part: "body", kind: "paragraph", page: 1, page_basis: "estimated", section_label: "", heading_level: null,
    table_id: null, row_index: null, col_index: null, grid_span: 1, row_span: 1, flags: [], has_image: false, part_group: "body", ...extra,
  };
}
function cell(id: number, tableId: number, row: number, col: number, section: string, text = `c${id}`): ViewBlock {
  return block(id, text, { kind: "table_cell", table_id: tableId, row_index: row, col_index: col, section_label: section });
}
function unit(id: number, text: string, extra: Partial<ViewUnit> = {}): ViewUnit {
  return {
    id, display_id: `D-${id}`, kind: "sentence", spans: text === "" ? [] : [[id, 0, text.length]], text, lang: "en", number: null, table_id: null, row_index: null, group_unit_id: null,
    status: "unassigned", pair_id: null, pos_seq: id, block_id: id, is_edited: false, can_unmerge: false, split_suggestion_id: null, ref: null, caption_refs: [], ...extra,
  };
}
function table(id: number, index: number, rows: number, cols: number, extra: Partial<ViewTable> = {}): ViewTable {
  return { id, table_index: index, parent_table_id: null, part: "body", n_rows: rows, n_cols: cols, is_layout: false, is_band: false, anchor: null, ...extra };
}
function makeView(blocks: ViewBlock[], units: ViewUnit[], tables: ViewTable[]): DocumentView {
  return { document: {} as DocumentView["document"], extraction: null, has_number_ranges: false, tables, blocks, units, pairs: [], part_groups: [], edits: { can_undo: false, can_redo: false } };
}

// 본문 문장 · 캡션 "배양 조건" · 표 2(4×2, §5, 아직 표) · 본문 문장 · 표 5(3×3, §6, 벗김 - 줄 31 · 32 · 33)
const view = makeView(
  [
    block(10, "본문 문장", { section_label: "5" }),
    block(11, "배양 조건", { section_label: "5" }),
    cell(12, 2, 0, 0, "5"), cell(13, 2, 0, 1, "5"),
    block(14, "다음 문장", { section_label: "6" }),
    cell(15, 5, 0, 0, "6", "line one"), cell(16, 5, 1, 0, "6", "line two"), cell(17, 5, 2, 0, "6", "line three"),
  ],
  [
    unit(10, "본문 문장"),
    unit(11, "배양 조건", { kind: "caption", group_unit_id: 20 }),
    unit(20, "", { kind: "table", table_id: 2, block_id: 12, pos_seq: 12 }),
    unit(21, "c12", { kind: "cell_sentence", table_id: 2, group_unit_id: 20, spans: [[12, 0, 3]], block_id: 12, pos_seq: 12 }),
    unit(14, "다음 문장"),
    unit(31, "line one", { kind: "cell_sentence", table_id: 5, spans: [[15, 0, 8]], block_id: 15, pos_seq: 15 }),
    unit(32, "line two", { kind: "cell_sentence", table_id: 5, spans: [[16, 0, 8]], block_id: 16, pos_seq: 16 }),
    unit(33, "line three", { kind: "cell_sentence", table_id: 5, spans: [[17, 0, 10]], block_id: 17, pos_seq: 17 }),
  ],
  [table(2, 1, 4, 2), table(5, 4, 3, 3, { is_layout: true })],
);
const model = buildPaperModel(view);
const blocks = listTableBlocks(view, model);

// 바깥 표 1 안에 안쪽 표 3, 따로 선 띠 표 4(벗겨 제목 줄), 머리말 표 6
const nested = makeView(
  [
    cell(40, 1, 0, 0, "2"),
    cell(41, 3, 0, 0, "2"),
    cell(42, 4, 0, 0, "3", "4.1"), cell(43, 4, 0, 1, "3", "Title"),
    cell(44, 6, 0, 0, "", "head"),
  ].map((item) => (item.id === 44 ? { ...item, part: "header", part_group: "header" } : item)),
  [
    unit(50, "", { kind: "table", table_id: 1, block_id: 40, pos_seq: 40 }),
    unit(51, "", { kind: "table", table_id: 3, block_id: 41, pos_seq: 41 }),
    unit(52, "4.1 Title", { kind: "heading", table_id: 4, spans: [[42, 0, 3], [43, 0, 5]], block_id: 42, pos_seq: 42 }),
    unit(53, "", { kind: "table", table_id: 6, block_id: 44, pos_seq: 44 }),
  ],
  [table(1, 0, 1, 1), table(3, 1, 1, 1, { parent_table_id: 1 }), table(4, 2, 1, 2, { is_layout: true, is_band: true }), table(6, 3, 1, 1, { part: "header" })],
);
const nestedModel = buildPaperModel(nested);

describe("table tab model", () => {
  it("lists outer body tables in document order with their section", () => expect(listTableBlocks(view, model).map((b) => [b.tableId, b.section, b.rows, b.cols, b.isUnwrapped])).toEqual([[2, "5", 4, 2, false], [5, "6", 3, 3, true]]));

  it("reads the caption of a table that is still a table", () => expect(blocks.map((b) => b.caption)).toEqual(["배양 조건", ""]));

  it("leaves band tables and inner tables out", () => expect(listTableBlocks(nested, nestedModel).map((b) => b.tableId)).toEqual([1]));

  it("walks an unwrapped table line by line and a whole table as one", () => expect(listTableTabUnitIds(blocks)).toEqual([20, 31, 32, 33]));

  it("finds the table of a unit, a cell sentence through its table", () => {
    expect([21, 11, 32, 10].map((id) => findUnitTable(blocks, id, model.units))).toEqual([2, 2, 5, null]);
  });

  it("keeps the table of the picked unit open", () => expect(resolveFolded(new Set([2, 5]), blocks, new Set([32]))).toEqual(new Set([2])));

  it("toggles one table", () => {
    expect(toggleFold(new Set([2]), 5)).toEqual(new Set([2, 5]));
    expect(toggleFold(new Set([2, 5]), 2)).toEqual(new Set([5]));
  });

  it("folds all, then opens all", () => {
    expect(toggleFoldAll(new Set(), blocks)).toEqual(new Set([2, 5]));
    expect(toggleFoldAll(new Set([2]), blocks)).toEqual(new Set([2, 5]));
    expect(toggleFoldAll(new Set([2, 5]), blocks)).toEqual(new Set());
  });
});
