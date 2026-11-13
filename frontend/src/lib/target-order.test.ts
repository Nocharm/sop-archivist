// 결과물 C 순서 바꾸기 - 한 벌의 C에서 옮긴 결과가 그 새 문서 전체 순서로 바르게 나오는지 본다.
import { describe, expect, it } from "vitest";

import type { OutputC, OutputCItem } from "./api-sop";
import { buildPatchItems, buildTargetOrder, canMoveTarget } from "./target-order";

function item(id: number, lang: string): OutputCItem {
  return { target_id: id, kind: "sentence", lang, text: `t${id}`, ai_text: "", change_type: null, status: "confirmed", source_note: "", origin: "units", meaning_key: null, number: null, indent_level: 0, number_style: "numbered", cell_row: null, cell_col: null, children: [] };
}

function output(sections: Array<[string, Array<[number, string]>]>): OutputC {
  return {
    docs: [
      {
        target_doc_id: 7,
        code: "SOP-1",
        title: "T",
        doc_type: "sop",
        parent_code: null,
        entrance: "assign",
        sections: sections.map(([key, ids]) => ({ location_key: key, label: key, number: null, na_reason: null, heading_note: "", items: ids.map(([id, lang]) => item(id, lang)) })),
      },
    ],
    deleted: [],
    moved: [],
  };
}

describe("buildTargetOrder", () => {
  // 한 칸에 두 언어가 C 순서대로 한 목록이다
  const c = output([["purpose", [[11, "en"], [1, "ko"], [12, "en"], [2, "ko"]]], ["scope", [[13, "en"], [3, "ko"], [4, "ko"]]]]);

  it("moves one sentence down inside its section across languages", () => {
    expect(buildTargetOrder(c, 7, "scope", 13, 1)).toEqual([11, 1, 12, 2, 3, 13, 4]);
  });

  it("refuses a move past the section edge or into an unknown document", () => {
    expect(buildTargetOrder(c, 7, "purpose", 11, -1)).toBeNull();
    expect(buildTargetOrder(c, 7, "scope", 4, 1)).toBeNull();
    expect(buildTargetOrder(c, 9, "purpose", 1, -1)).toBeNull();
  });

  it("tells whether a move is possible", () => {
    expect(canMoveTarget(c.docs[0].sections[0].items, 11, -1)).toBe(false);
    expect(canMoveTarget(c.docs[0].sections[0].items, 11, 1)).toBe(true);
  });
});

describe("buildPatchItems", () => {
  const c = output([["purpose", [[11, "en"], [1, "ko"]]], ["scope", [[3, "ko"]]]]);

  it("sends the whole document in its current order with a depth only on the changed line", () => {
    expect(buildPatchItems(c, 7, new Map([[1, { indent_level: 1 }]]))).toEqual([{ target_id: 11 }, { target_id: 1, indent_level: 1 }, { target_id: 3 }]);
  });

  it("puts a number style on the one changed line only", () => {
    expect(buildPatchItems(c, 7, new Map([[3, { number_style: "note" as const }]]))).toEqual([{ target_id: 11 }, { target_id: 1 }, { target_id: 3, number_style: "note" }]);
  });

  it("returns null for an unknown document", () => {
    expect(buildPatchItems(c, 9, new Map())).toBeNull();
  });
});
