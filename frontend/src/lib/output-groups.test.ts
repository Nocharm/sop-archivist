// 결과물 의미 묶음 - A는 묶음 첫 줄에만 함께 쓰는 칸을 보이고, C는 의미가 바뀌는 줄에서 굵은 선을 시작한다.
import { describe, expect, it } from "vitest";

import type { OutputARow, OutputC, OutputCItem } from "./api-sop";
import { buildAScreenLines, buildCLines, listMeaningStarts } from "./output-groups";

function row(rowNo: number, isGroupStart: boolean, destKind: string, destDocCode: string): OutputARow {
  return {
    row_no: rowNo, is_group_start: isGroupStart, row_kind: "unit", old_doc_code: "OLD-1", old_doc_version: "1.0",
    location: { section: "5", place: "", page: null, page_basis: "" }, unit_id: 1, display_id: "OLD-1-1", source_text: "",
    dest_kind: destKind, dest_doc_code: destDocCode, dest_doc_title: "", dest_location: "", dest_number: "", dest_is_note: false,
    confirmed_text: "", ai_text: "", change_type: "as_is", remark: "", status: "confirmed", confirmed_by: null, confirmed_at: null,
    group_id: null, warnings: [],
  };
}

describe("buildAScreenLines", () => {
  it("shows shared cells on the first line of a group only", () => {
    expect(buildAScreenLines([row(1, true, "sop", "SOP-1"), row(1, false, "sop", "SOP-1")]).map((l) => [l.showShared, l.showDest])).toEqual([[true, true], [false, false]]);
  });

  it("shows the destination again when a duplicate line goes to another document", () => {
    expect(buildAScreenLines([row(1, true, "sop", "SOP-1"), row(1, false, "wi", "WI-1")])[1].showDest).toBe(true);
  });

  it("starts the shared cells again on the next group even with the same destination", () => {
    expect(buildAScreenLines([row(1, true, "sop", "SOP-1"), row(2, true, "sop", "SOP-1")]).map((l) => [l.showShared, l.showDest])).toEqual([[true, true], [true, true]]);
  });
});

describe("buildCLines", () => {
  function item(id: number): OutputCItem {
    return { target_id: id, kind: "sentence", lang: "ko", text: "", ai_text: "", change_type: null, status: "confirmed", source_note: "", origin: "units", meaning_key: null, number: null, indent_level: 0, number_style: "numbered", cell_row: null, cell_col: null, children: [] };
  }
  const section = (key: string, items: OutputCItem[], naReason: string | null = null) => ({ location_key: key, label: key, number: null, na_reason: naReason, heading_note: "", items });
  const doc = (id: number, sections: ReturnType<typeof section>[]) => ({ target_doc_id: id, code: `D${id}`, title: "", doc_type: "sop", parent_code: null, entrance: "assign", sections });

  it("lists documents, then sections, then lines, and keeps an empty or N/A section as one line", () => {
    const output: OutputC = { docs: [doc(1, [section("a", [item(11), item(12)]), section("b", [], "covered elsewhere")]), doc(2, [section("c", [])])], deleted: [], moved: [] };
    expect(buildCLines(output)).toEqual([
      { kind: "doc", docIndex: 0 },
      { kind: "section", docIndex: 0, sectionIndex: 0 },
      { kind: "item", docIndex: 0, sectionIndex: 0, itemIndex: 0, targetId: 11 },
      { kind: "item", docIndex: 0, sectionIndex: 0, itemIndex: 1, targetId: 12 },
      { kind: "section", docIndex: 0, sectionIndex: 1 },
      { kind: "doc", docIndex: 1 },
      { kind: "section", docIndex: 1, sectionIndex: 0 },
    ]);
  });
});

describe("listMeaningStarts", () => {
  it("starts a meaning border where the meaning key changes or is missing", () => {
    expect(listMeaningStarts([{ meaning_key: "old:3" }, { meaning_key: "old:3" }, { meaning_key: "old:-9" }, { meaning_key: null }])).toEqual([true, false, true, true]);
  });

  it("starts each line without a meaning key on its own", () => {
    expect(listMeaningStarts([{ meaning_key: null }, { meaning_key: null }])).toEqual([true, true]);
    expect(listMeaningStarts([])).toEqual([]);
  });
});
