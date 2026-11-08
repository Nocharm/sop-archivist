// 결과물 C 순서 바꾸기 - 한 판에서 옮긴 결과가 두 판을 합친 전체 순서로 바르게 나오는지 본다.
import { describe, expect, it } from "vitest";

import type { OutputC, OutputCItem } from "./api-sop";
import { buildTargetOrder, canMoveTarget } from "./target-order";

function item(id: number, lang: string): OutputCItem {
  return { target_id: id, kind: "sentence", lang, text: `t${id}`, ai_text: "", change_type: null, status: "confirmed", source_note: "", cell_row: null, cell_col: null, children: [] };
}

function output(lang: string, sections: Array<[string, number[]]>): OutputC {
  return {
    docs: [
      {
        target_doc_id: 7,
        code: "SOP-1",
        title: "T",
        doc_type: "sop",
        parent_code: null,
        entrance: "assign",
        sections: sections.map(([key, ids]) => ({ location_key: key, label: key, na_reason: null, items: ids.map((id) => item(id, lang)) })),
      },
    ],
    deleted: [],
    moved: [],
  };
}

describe("buildTargetOrder", () => {
  const ko = output("ko", [["purpose", [1, 2]], ["scope", [3, 4]]]);
  const en = output("en", [["purpose", [11, 12]], ["scope", [13]]]);

  it("moves one sentence down inside its section and keeps the other edition in place", () => {
    expect(buildTargetOrder(ko, en, 7, "scope", 3, 1)).toEqual([1, 2, 11, 12, 4, 3, 13]);
  });

  it("refuses a move past the section edge or into an unknown document", () => {
    expect(buildTargetOrder(ko, en, 7, "purpose", 1, -1)).toBeNull();
    expect(buildTargetOrder(ko, en, 9, "purpose", 2, -1)).toBeNull();
  });

  it("keeps sentences of sections that only the other edition has", () => {
    const enOnly = output("en", [["purpose", [11]], ["definitions", [15]]]);
    expect(buildTargetOrder(ko, enOnly, 7, "purpose", 2, -1)).toEqual([2, 1, 11, 3, 4, 15]);
  });

  it("tells whether a move is possible", () => {
    expect(canMoveTarget(ko.docs[0].sections[0].items, 1, -1)).toBe(false);
    expect(canMoveTarget(ko.docs[0].sections[0].items, 1, 1)).toBe(true);
  });
});
