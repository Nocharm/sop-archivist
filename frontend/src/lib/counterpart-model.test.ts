import { describe, expect, it } from "vitest";

import type { ViewBlock, ViewTable } from "./api-sop";
import { buildUnwrapOp, listCounterpartChoices, readFirstCellText, readOtherHalf } from "./counterpart-model";

function makeTable(id: number, tableIndex: number, rows: number, extra: Partial<ViewTable> = {}): ViewTable {
  return { id, table_index: tableIndex, parent_table_id: null, part: "body", n_rows: rows, n_cols: 2, is_layout: false, ...extra };
}

function makeCell(id: number, seq: number, tableId: number, text: string): ViewBlock {
  return { id, seq, part: "body", kind: "table_cell", text, table_id: tableId } as ViewBlock;
}

describe("대응 표 함께 벗기기(F8a)", () => {
  const korean = makeTable(1, 0, 3, { lang: "ko", counterparts: [3, 5, 4] });
  const tables = [korean, makeTable(3, 2, 3, { lang: "en" }), makeTable(4, 3, 4, { lang: "en" }), makeTable(5, 4, 2, { lang: "en", n_cols: 2 })];
  const blocks = [makeCell(10, 0, 3, "  "), makeCell(11, 1, 3, "Step\nTask"), makeCell(12, 2, 5, "Drain")];

  it("서버가 정한 차례대로 고를 것을 만들고 행 수가 다른 표를 표시한다", () => {
    expect(listCounterpartChoices(korean, tables, blocks)).toEqual([
      { tableId: 3, number: 3, rows: 3, cols: 2, firstText: "Step Task", rowsDiffer: false },
      { tableId: 5, number: 5, rows: 2, cols: 2, firstText: "Drain", rowsDiffer: true },
      { tableId: 4, number: 4, rows: 4, cols: 2, firstText: "", rowsDiffer: true },
    ]);
  });

  it("후보가 없거나 화면이 낡아 이미 벗긴 표는 고를 것에서 빠진다", () => {
    expect(listCounterpartChoices(makeTable(2, 1, 2), tables, blocks)).toEqual([]);
    const unwrapped = tables.map((table) => (table.id === 3 ? { ...table, is_layout: true } : table));
    expect(listCounterpartChoices(korean, unwrapped, blocks).map((choice) => choice.tableId)).toEqual([5, 4]);
  });

  it("첫 칸 글은 빈 칸을 건너뛴 첫 글 있는 칸이다", () => {
    expect(readFirstCellText(blocks, 3)).toBe("Step Task");
    expect(readFirstCellText(blocks, 9)).toBe("");
  });

  it("함께 벗기면 한 편집에 대응 표를 싣고, 이 표만이면 싣지 않는다", () => {
    expect(buildUnwrapOp(1, 3)).toEqual({ type: "set_layout_table", table_id: 1, is_layout: true, counterpart_table_id: 3 });
    expect(buildUnwrapOp(1, null)).toEqual({ type: "set_layout_table", table_id: 1, is_layout: true });
  });

  it("창 제목의 절반은 벗기는 표의 반대 언어다", () => {
    expect([readOtherHalf(korean), readOtherHalf(tables[1]), readOtherHalf(makeTable(9, 0, 1))]).toEqual(["en", "ko", null]);
  });
});
