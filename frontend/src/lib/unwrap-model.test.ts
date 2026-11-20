// 벗긴 표 - 칸이 문단처럼 제자리에 펴지고(행 → 왼쪽부터), 줄이 어느 벗긴 표에 드는지, 묶음 머리 자리, 다듬기의 다시 표로 줄을 못 박는다.
import { describe, expect, it } from "vitest";

import type { DocumentView, ViewBlock, ViewTable, ViewUnit } from "./api-sop";
import { buildPaperModel, buildRows } from "./paper-model";
import { countDecidedLines, findUnwrapHeads, getRowUnwrapTable, getTableNumber, getUnitUnwrapTable, listUnwrapScopes, orderUnwrappedRows } from "./unwrap-model";

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
  return { id, table_index: tableIndex, parent_table_id: null, part: "body", n_rows: 2, n_cols: 2, is_layout: isLayout, is_band: false, anchor: null };
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

  it("counts the decided lines of an unwrapped table before asking the server", () => {
    const statuses = new Map<number, ViewUnit["status"]>([[21, "confirmed"], [23, "on_hold"], [30, "confirmed"]]);
    expect(countDecidedLines(view.units, 7, (id) => statuses.get(id))).toBe(2); // 표 밖 줄(30)은 세지 않는다
    expect(countDecidedLines(view.units, 7, () => undefined)).toBe(0);
  });
});

// 표 안 표(F2) - 벗긴 바깥 표 7의 둘째 칸 "가 문장.\n나 문장." 두 문단 사이에 안쪽 값 표 8, 둘째 행 첫 칸 앞에 안쪽 띠 표 9
const nestedIntro = makeBlock(1, 0, "앞 문단이다.");
const outerCells = [cell(2, 1, "점검 항목", 7, 0, 0), cell(3, 2, "가 문장.\n나 문장.", 7, 0, 1)];
const innerCells = [cell(4, 3, "공장", 8, 0, 0), cell(5, 4, "120 Pa", 8, 0, 1)];
const bandCells = [cell(8, 5, "7.1", 9, 0, 0), cell(9, 6, "일상 점검", 9, 0, 2)];
const lastCells = [cell(6, 7, "기준", 7, 1, 0), cell(7, 8, "다 문장.", 7, 1, 1)];

function makeNested(outerLayout: boolean, innerLayout: boolean, bandHeading: boolean, at = 6): DocumentView {
  const outer = makeTable(7, 0, outerLayout);
  const inner = { ...makeTable(8, 1, innerLayout), parent_table_id: 7, anchor: { block_id: 3, at } };
  const band = { ...makeTable(9, 2, bandHeading), parent_table_id: 7, is_band: true, anchor: { block_id: 6, at: 0 } };
  const group = (id: number | null) => (outerLayout ? {} : { group_unit_id: id });
  return {
    document: {} as DocumentView["document"], extraction: null, has_number_ranges: true, tables: [outer, inner, band],
    blocks: [nestedIntro, ...outerCells, ...innerCells, ...bandCells, ...lastCells],
    units: [
      makeUnit(10, [[1, 0, nestedIntro.text.length]], nestedIntro.text),
      ...(outerLayout ? [] : [makeUnit(70, [], "", { kind: "table", table_id: 7, pos_seq: 1, block_id: 2 })]),
      cellUnit(20, outerCells[0], group(70)),
      makeUnit(21, [[3, 0, 5]], "가 문장.", { kind: "cell_sentence", table_id: 7, row_index: 0, pos_seq: 2, ...group(70) }),
      makeUnit(22, [[3, 6, 11]], "나 문장.", { kind: "cell_sentence", table_id: 7, row_index: 0, pos_seq: 2, ...group(70) }),
      ...(innerLayout ? [] : [makeUnit(30, [], "", { kind: "table", table_id: 8, pos_seq: 3, block_id: 4 })]),
      ...innerCells.map((block, index) => cellUnit(31 + index, block, innerLayout ? {} : { group_unit_id: 30 })),
      ...(bandHeading
        ? [makeUnit(50, [[8, 0, 3], [9, 0, 5]], "7.1\n일상 점검", { kind: "heading", table_id: 9, pos_seq: 5 })]
        : [makeUnit(51, [], "", { kind: "table", table_id: 9, pos_seq: 5, block_id: 8 }), ...bandCells.map((block, index) => cellUnit(52 + index, block, { group_unit_id: 51 }))]),
      cellUnit(40, lastCells[0], group(70)),
      cellUnit(41, lastCells[1], group(70)),
    ],
    pairs: [], part_groups: [], edits: { can_undo: false, can_redo: false },
  };
}

const describeRows = (rows: ReturnType<typeof buildRows>) => rows.map((row) => (row.type === "piece" ? row.unitId : row.type === "table" ? `t${row.item.table.id}` : row.type));

describe("tables inside tables", () => {
  it("puts an inner table between the paragraphs of its cell once the outer table is unwrapped", () => {
    const nested = buildPaperModel(makeNested(true, false, true));
    const nestedRows = buildRows(nested.body, nested.segments);
    expect(describeRows(nestedRows)).toEqual([10, 20, 21, "t8", 22, 50, 40, 41]);
    // 칸 둘로 나뉜 조각은 저마다 그 범위의 글만
    expect(nested.body.filter((item) => item.type === "block" && item.block.id === 3).map((item) => item.type === "block" && item.range)).toEqual([[0, 6], [6, 11]]);
    // J/K도 용지 순서 - 안쪽 표가 칸의 뒤 문단보다 먼저
    expect(nested.order).toEqual([10, 20, 21, 30, 31, 32, 22, 50, 40, 41]);
  });

  it("keeps a data outer table whole with its inner tables after it", () => {
    const whole = buildPaperModel(makeNested(false, false, false));
    expect(describeRows(buildRows(whole.body, whole.segments))).toEqual([10, "t7", "t8", "t9"]);
  });

  it("does not move an inner table that sat after the whole cell", () => {
    const after = buildPaperModel(makeNested(true, false, true, 11));
    expect(describeRows(buildRows(after.body, after.segments))).toEqual([10, 20, 21, 22, "t8", 50, 40, 41]);
  });

  it("keeps the outer rail through an inner table and gives an unwrapped inner table its own head", () => {
    const outerOnly = buildPaperModel(makeNested(true, false, true));
    const outerRows = buildRows(outerOnly.body, outerOnly.segments);
    expect(outerRows.map((row) => getRowUnwrapTable(row, outerOnly.unwrapped, outerOnly.tables))).toEqual([null, 7, 7, 7, 7, null, 7, 7]);
    expect([...findUnwrapHeads(outerRows, outerOnly.unwrapped, outerOnly.tables).values()]).toEqual([7, 7]); // 띠 표 제목 줄 뒤에 다시 선다

    const both = buildPaperModel(makeNested(true, true, true));
    const bothRows = buildRows(both.body, both.segments);
    expect(describeRows(bothRows)).toEqual([10, 20, 21, 31, 32, 22, 50, 40, 41]);
    expect([...findUnwrapHeads(bothRows, both.unwrapped, both.tables)]).toEqual([[bothRows[1].key, 7], [bothRows[3].key, 8], [bothRows[5].key, 7], [bothRows[7].key, 7]]);
  });

  it("counts an assigned inner band heading before wrapping the outer table back, and moves the band with it", () => {
    const nested = buildPaperModel(makeNested(true, false, true));
    const statuses = new Map<number, ViewUnit["status"]>([[50, "confirmed"], [21, "confirmed"]]);
    expect(countDecidedLines(nested.units.values(), 7, (id) => statuses.get(id), nested.tables)).toBe(2);
    expect(countDecidedLines(nested.units.values(), 8, (id) => statuses.get(id), nested.tables)).toBe(0);
    expect(listUnwrapScopes(nested.tables, 7)).toEqual(["t7", "t9"]); // 누르지 않은 안쪽 값 표는 그대로 표
    expect(listUnwrapScopes(nested.tables, 8)).toEqual(["t8"]);
  });
});

// 덩이 안 줄 순서(시안 2 D2) - 덩이 = 칸 줄 + 아직 표인 안쪽 표 + 안쪽 띠 표 제목 줄. 용지 줄 · J/K가 같은 차례를 따른다
describe("line order inside an unwrapped block", () => {
  const withSeqs = (view: DocumentView, seqs: ReadonlyMap<number, number>): DocumentView => ({
    ...view, units: view.units.map((unit) => ({ ...unit, unwrap_seq: seqs.get(unit.id) ?? null })),
  });

  it("holds the band heading and the inner table in the outer block, not the outside lines", () => {
    const nested = buildPaperModel(makeNested(true, false, true));
    expect([...nested.unwrapLines]).toEqual([[20, 7], [21, 7], [22, 7], [30, 7], [50, 7], [40, 7], [41, 7]]);
  });

  it("keeps source order until reordered, then the paper rows and J/K follow the seqs", () => {
    const plain = buildPaperModel(makeNested(true, false, true));
    expect(describeRows(orderUnwrappedRows(buildRows(plain.body, plain.segments), plain))).toEqual([10, 20, 21, "t8", 22, 50, 40, 41]);

    const moved = buildPaperModel(withSeqs(makeNested(true, false, true), new Map([[40, 0], [20, 1], [21, 2], [30, 3], [22, 4], [50, 5], [41, 6]])));
    expect(describeRows(orderUnwrappedRows(buildRows(moved.body, moved.segments), moved))).toEqual([10, 40, 20, 21, "t8", 22, 50, 41]);
    // 안쪽 표의 칸 문장은 제 표 줄을 따라간다
    expect(moved.order).toEqual([10, 40, 20, 21, 30, 31, 32, 22, 50, 41]);
  });

  it("leaves the lines of an unwrapped inner table in their own block", () => {
    const both = buildPaperModel(withSeqs(makeNested(true, true, true), new Map([[22, 0], [20, 1], [21, 2], [50, 3], [40, 4], [41, 5], [32, 0]])));
    // 7의 덩이 줄만 7이 쓰던 자리에서 차례를 바꾼다 - 8의 줄(31 · 32)은 제자리
    expect(describeRows(orderUnwrappedRows(buildRows(both.body, both.segments), both))).toEqual([10, 22, 20, 31, 32, 21, 50, 40, 41]);
  });
});
