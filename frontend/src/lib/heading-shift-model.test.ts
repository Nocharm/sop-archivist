import { describe, expect, it } from "vitest";

import type { ViewUnit } from "./api-sop";
import { buildHeadingShiftGroups, listHeadingBackUnits, readHeadingShiftHead } from "./heading-shift-model";

function makeUnit(id: number, posSeq: number, lang: "ko" | "en", over: Partial<ViewUnit> = {}): ViewUnit {
  return {
    id, number: null, display_id: `U${id}`, kind: "sentence", spans: [[posSeq, id, id + 1]], text: "text", lang,
    table_id: null, row_index: null, group_unit_id: null, status: null, pair_id: null, pos_seq: posSeq, block_id: posSeq,
    is_edited: false, can_unmerge: false, split_suggestion_id: null, ref: null, caption_refs: [], from_heading: true,
    ...over,
  };
}

// 합성 조항형 꼴(SYN-HEADING-1) - 진짜 제목 짝, 문장 둘인 영어 조항과 그 번역, 문장 하나인 조항과 번역, 짝 없는 한글 조항
const UNITS = [
  makeUnit(1, 1, "en", { kind: "heading", from_heading: false, pair_id: 100 }),
  makeUnit(2, 2, "ko", { kind: "heading", from_heading: false, pair_id: 100 }),
  makeUnit(3, 3, "en", { pair_id: 101 }), makeUnit(4, 3, "en", { pair_id: 102 }),
  makeUnit(5, 4, "ko", { pair_id: 101 }), makeUnit(6, 4, "ko", { pair_id: 102 }),
  makeUnit(7, 5, "en", { pair_id: 103 }), makeUnit(8, 6, "ko", { pair_id: 103 }),
  makeUnit(9, 7, "ko"), makeUnit(10, 7, "ko"),
];

describe("buildHeadingShiftGroups", () => {
  it("groups each clause with its translation and counts headings and lines", () => {
    // 용지 순서와 상관없이 받는다
    const groups = buildHeadingShiftGroups([...UNITS].reverse());

    expect(groups).toEqual([
      { firstUnitId: 3, unitIds: [3, 4, 5, 6], headingCount: 2, pairCount: 2, loneCount: 0 },
      { firstUnitId: 7, unitIds: [7, 8, 9, 10], headingCount: 3, pairCount: 1, loneCount: 2 },
    ]);
    expect(groups.map(readHeadingShiftHead)).toEqual([
      { key: "assign.headingShift.headPairs", values: { h: 2, n: 2 } },
      { key: "assign.headingShift.headLines", values: { h: 3, n: 3 } },
    ]);
  });

  it("breaks a group at any line that was not shifted", () => {
    const units = [makeUnit(1, 1, "en"), makeUnit(2, 2, "en", { from_heading: false }), makeUnit(3, 3, "ko")];

    expect(buildHeadingShiftGroups(units).map((group) => group.unitIds)).toEqual([[1], [3]]);
  });
});

describe("listHeadingBackUnits", () => {
  it("sends only the shifted sentences of the picked row", () => {
    expect(listHeadingBackUnits([UNITS[2], UNITS[4]])).toEqual([3, 5]);
    expect(listHeadingBackUnits([UNITS[0], UNITS[1]])).toEqual([]);
  });
});
