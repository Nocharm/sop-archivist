// 벗긴 표 - 칸이 문단처럼 제자리에 펴지고(행 → 왼쪽부터), 줄이 어느 벗긴 표에 드는지, 묶음 머리 자리, 다듬기의 다시 표로 줄을 못 박는다.
import { describe, expect, it } from "vitest";

import type { DocumentView, ViewBlock, ViewTable, ViewUnit } from "./api-sop";
import { buildPaperModel, buildRows } from "./paper-model";
import { findUnwrapHeads, getRowUnwrapTable, getTableNumber, getUnitUnwrapTable } from "./unwrap-model";

function makeBlock(id: number, seq: number, text: string, extra: Partial<ViewBlock> = {}): ViewBlock {
  return {
    id, seq, text, part: "body", kind: "paragraph", page: 1, page_basis: "estimated", section_label: "", heading_level: null,
    table_id: null, row_index: null, col_index: null, grid_span: 1, row_span: 1, flags: [], has_image: false, part_group: "body", ...extra,
  };
}

function makeUnit(id: number, spans: Array<[number, number, number]>, text: string, extra: Partial<ViewUnit> = {}): ViewUnit {
  return {
    id, display_id: `D-${id}`, kind: "sentence", spans, text, lang: "ko", number: null, table_id: null, row_index: null, group_unit_id: null,
    status: "unassigned", pair_id: null, pos_seq: spans[0]?.[0] ?? 0, block_id: spans[0]?.[0] ?? 0, is_edited: false, can_unmerge: false, split_suggestion_id: null, ref: null, caption_refs: [], ...extra,
  };
}

function makeTable(id: number, tableIndex: number, isLayout: boolean): ViewTable {
  return { id, table_index: tableIndex, parent_table_id: null, part: "body", n_rows: 2, n_cols: 2, is_layout: isLayout };
}

function cell(id: number, seq: number, text: string, tableId: number, row: number, col: number): ViewBlock {
  return makeBlock(id, seq, text, { kind: "table_cell", table_id: tableId, row_index: row, col_index: col });
}

function cellUnit(id: number, block: ViewBlock, extra: Partial<ViewUnit> = {}): ViewUnit {
  return makeUnit(id, [[block.id, 0, block.text.length]], block.text, { kind: "cell_sentence", table_id: block.table_id, row_index: block.row_index, pos_seq: block.seq, ...extra });
}

// 앞 문단 → 벗긴 표 7(2×2, 왼쪽 라벨) → 표 밖 문단 → 벗기지 않은 표 8
const intro = makeBlock(1, 0, "앞 문단이다.");
const unwrappedCells = [cell(2, 1, "준비", 7, 0, 0), cell(3, 2, "장갑을 낀다.", 7, 0, 1), cell(4, 3, "교체", 7, 1, 0), cell(5, 4, "필터를 뺀다.", 7, 1, 1)];
const outro = makeBlock(6, 5, "표 밖 문장이다.");
const dataCells = [cell(7, 6, "항목", 8, 0, 0), cell(8, 7, "값", 8, 0, 1)];
const view: DocumentView = {
  document: {} as DocumentView["document"], extraction: null, has_number_ranges: true, tables: [makeTable(7, 0, true), makeTable(8, 1, false)],
  blocks: [intro, ...unwrappedCells, outro, ...dataCells],
  units: [
    makeUnit(10, [[1, 0, intro.text.length]], intro.text),
    ...unwrappedCells.map((block, index) => cellUnit(20 + index, block)),
    makeUnit(30, [[6, 0, outro.text.length]], outro.text),
    makeUnit(40, [], "", { kind: "table", table_id: 8, pos_seq: 6 }),
    ...dataCells.map((block, index) => cellUnit(41 + index, block, { group_unit_id: 40 })),
  ],
  pairs: [], part_groups: [], edits: { can_undo: false, can_redo: false },
};
const model = buildPaperModel(view);
const rows = buildRows(model.body, model.segments);

describe("unwrapped tables on the paper", () => {
  it("lays the cells of an unwrapped table out as one sentence line per cell and keeps other tables whole", () => {
    expect(rows.map((row) => (row.type === "piece" ? row.unitId : row.type))).toEqual([10, 20, 21, 22, 23, 30, "table"]);
    expect([...model.unwrapped.keys()]).toEqual([7]);
  });

  it("tells which unwrapped table a line belongs to", () => {
    expect(rows.map((row) => getRowUnwrapTable(row, model.unwrapped))).toEqual([null, 7, 7, 7, 7, null, null]);
  });

  it("puts one group head on the first line of each run of the same table", () => {
    expect([...findUnwrapHeads(rows, model.unwrapped)]).toEqual([[rows[1].key, 7]]);
    // 덩이가 끊겼다 다시 이어지면 머리가 또 선다
    const broken = [rows[1], rows[0], rows[2]];
    expect([...findUnwrapHeads(broken, model.unwrapped).values()]).toEqual([7, 7]);
  });

  it("offers back to table only for a line of an unwrapped table", () => {
    const units = new Map(view.units.map((unit) => [unit.id, unit]));
    expect(getUnitUnwrapTable([units.get(21)!], model.unwrapped)).toBe(7);
    expect(getUnitUnwrapTable([units.get(10)!], model.unwrapped)).toBeNull();
    expect(getUnitUnwrapTable([units.get(41)!], model.unwrapped)).toBeNull(); // 표에 묶인 칸 문장
    expect(getTableNumber(view.tables[1])).toBe(2);
  });
});
