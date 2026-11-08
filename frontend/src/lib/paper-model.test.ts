// 용지 모델 - 블록 조각이 글자를 빠짐없이 덮고, 단위·블록 위치 변환이 서버 규칙(이음 글자 한 칸)과 같은지 본다.
import { describe, expect, it } from "vitest";

import type { DocumentView, ViewBlock, ViewUnit } from "./api-sop";
import { buildPaperModel, canSplitAt, toBlockOffset, toUnitOffset } from "./paper-model";

function makeBlock(id: number, seq: number, text: string, extra: Partial<ViewBlock> = {}): ViewBlock {
  return {
    id, seq, text, part: "body", kind: "paragraph", page: 1, page_basis: "estimated", section_label: "", heading_level: null,
    table_id: null, row_index: null, col_index: null, grid_span: 1, row_span: 1, flags: [], has_image: false, ...extra,
  };
}

function makeUnit(id: number, spans: Array<[number, number, number]>, text: string, extra: Partial<ViewUnit> = {}): ViewUnit {
  return {
    id, display_id: `D-${id}`, kind: "sentence", spans, text, lang: "en", table_id: null, row_index: null, group_unit_id: null,
    boundary_confirmed: false, status: "unassigned", pair_id: null, pos_seq: spans[0]?.[0] ?? 0, block_id: spans[0]?.[0] ?? 0, ...extra,
  };
}

function makeView(blocks: ViewBlock[], units: ViewUnit[]): DocumentView {
  return {
    document: {} as DocumentView["document"], extraction: null, tables: [], blocks, units, pairs: [],
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
