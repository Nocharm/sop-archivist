// 누른 조각과 그것이 든 배정 박스 - 표 칸은 칸이 골라지고 줄은 표, 짝 카드는 누른 쪽과 짝 묶음(11-23 명세 C1)
import { describe, expect, it } from "vitest";

import type { ViewTable, ViewUnit } from "@/lib/api-sop";
import { resolvePickUnit } from "@/lib/paper-model";

import { buildPickScope, readRowKeyOf, resolveBoxUnit } from "./pick-scope-model";

function u(id: number, over: Partial<ViewUnit> = {}): ViewUnit {
  return {
    id, display_id: `D-${id}`, kind: "sentence", spans: [], text: `t${id}`, lang: "ko", number: null, table_id: null, row_index: null, group_unit_id: null,
    status: "unassigned", pair_id: null, pos_seq: id, block_id: id, is_edited: false, can_unmerge: false, split_suggestion_id: null, ref: null, caption_refs: [], ...over,
  };
}
const toMap = (list: ViewUnit[]) => new Map(list.map((unit) => [unit.id, unit]));

// 1 표(표 id 10, 둘째 표) · 2 그 표의 칸 문장 · 4 그 표의 캡션 · 5/6 이웃한 짝 · 7 그림 · 8 외톨이 줄 · 9 벗긴 표의 칸 줄
const unitList = [
  u(1, { kind: "table", table_id: 10 }),
  u(2, { kind: "cell_sentence", table_id: 10, group_unit_id: 1 }),
  u(4, { kind: "caption", group_unit_id: 1 }),
  u(5, { pair_id: 3 }),
  u(6, { lang: "en", pair_id: 3 }),
  u(7, { kind: "figure" }),
  u(8),
  u(9, { kind: "cell_sentence", table_id: 11 }),
];
const units = toMap(unitList);
const tables = new Map<number, ViewTable>([[10, { id: 10, table_index: 1, parent_table_id: null, part: "body", n_rows: 3, n_cols: 3, is_layout: false, is_band: false, anchor: null }]]);

describe("buildPickScope", () => {
  it("a table cell is the picked unit and its table is the box", () => expect(buildPickScope(2, [1], units, tables)).toEqual({ unitId: 2, boxId: 1, group: { kind: "table", unitIds: [1], table: 2 } }));

  it("a pair half keeps itself as the box and names the pair", () => expect(buildPickScope(5, [5, 6], units, tables)).toEqual({ unitId: 5, boxId: 5, group: { kind: "pair", unitIds: [5, 6], table: null } }));

  it("a whole table, a figure and a lone line have no group", () => {
    for (const id of [1, 7, 8]) expect(buildPickScope(id, [id], units, tables).group).toBeNull();
  });

  it("an unwrapped cell line is its own box", () => expect(buildPickScope(9, [9], units, tables)).toMatchObject({ boxId: 9, group: null }));
});

describe("readRowKeyOf", () => {
  it("finds the table row of a cell", () => {
    expect(readRowKeyOf(2, new Map([[1, "t1"]]), new Map([[2, 1]]))).toBe("t1");
    expect(readRowKeyOf(99, new Map(), new Map())).toBeNull();
  });
});

describe("resolvePickUnit and resolveBoxUnit", () => {
  it("picks the cell itself and lifts a caption", () => {
    expect(resolvePickUnit(2, units)).toBe(2);
    expect(resolvePickUnit(4, units)).toBe(1);
    expect(resolveBoxUnit(2, units)).toBe(1);
  });
});
