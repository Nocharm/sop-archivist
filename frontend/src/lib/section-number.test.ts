// 결과물 C 섹션 번호 - 보이는 깊이는 서버 번호와 맞고, 들이기는 앞줄 깊이 + 1을 넘지 않으며, 한/영 짝 원문 줄의 상대를 찾는다.
import { describe, expect, it } from "vitest";

import type { OutputCItem, UnitRow } from "./api-sop";
import { canIndent, clampDepths, findPartnerTarget, getSectionDepths, isIndentable } from "./section-number";

function item(id: number, number: string | null, indent = 0): OutputCItem {
  return { target_id: id, kind: "sentence", lang: "ko", text: "", ai_text: "", change_type: null, status: "confirmed", source_note: "", number, indent_level: indent, cell_row: null, cell_col: null, children: [] };
}

function unit(id: number, pairId: number | null, targetIds: number[], lang: "ko" | "en" = "ko"): UnitRow {
  return {
    unit_id: id, document_id: 1, display_id: `OLD-${id}`, kind: "sentence", lang, text: "", table_id: null, row_index: null, group_unit_id: null,
    status: "confirmed", decision: {} as UnitRow["decision"], target_ids: targetIds, pair_id: pairId,
  };
}

describe("clampDepths", () => {
  it("keeps the first line at 0 and each line at most one deeper than the line before", () => {
    // 서버 number_lines와 같은 눌러 읽기 - [0, 4, 4]는 5.1, 5.1.1, 5.1.1.1
    expect(clampDepths([2, 4, 4, 0, 3])).toEqual([0, 1, 2, 0, 1]);
    expect(clampDepths([])).toEqual([]);
  });
});

describe("getSectionDepths", () => {
  it("reads the depth from the number under the section number", () => {
    const section = { number: "5.1", items: [item(1, "5.1.1"), item(2, "5.1.1.1", 4), item(3, "5.1.2")] };
    expect(getSectionDepths(section)).toEqual([0, 1, 0]);
  });

  it("clamps the stored depth where the section has no number", () => {
    expect(getSectionDepths({ number: null, items: [item(1, null, 1), item(2, null, 3)] })).toEqual([0, 1]);
  });
});

describe("canIndent", () => {
  const depths = [0, 1, 1, 0];

  it("lets a line go at most one deeper than the line before", () => {
    expect(canIndent(depths, 0, 1)).toBe(false);
    expect(canIndent(depths, 1, 1)).toBe(false);
    expect(canIndent(depths, 2, 1)).toBe(true);
    expect(canIndent(depths, 3, 1)).toBe(true);
  });

  it("outdents only above depth 0", () => {
    expect(canIndent(depths, 0, -1)).toBe(false);
    expect(canIndent(depths, 1, -1)).toBe(true);
    expect(canIndent(depths, 9, -1)).toBe(false);
  });
});

describe("isIndentable", () => {
  it("leaves written New documents and translation lines alone", () => {
    expect(isIndentable("assign", { change_type: "as_is" })).toBe(true);
    expect(isIndentable("match", { change_type: "as_is" })).toBe(false);
    expect(isIndentable("assign", { change_type: "translated" })).toBe(false);
  });
});

describe("findPartnerTarget", () => {
  const doc = new Set([10, 11, 12, 20]);

  it("finds the sentence the other unit of a KO/EN pair made in this document", () => {
    const units = [unit(1, 7, [10]), unit(2, 7, [11], "en")];
    expect(findPartnerTarget(10, units, doc)).toBe(11);
    expect(findPartnerTarget(11, units, doc)).toBe(10);
  });

  it("gives up when the partner is not one sentence in this document", () => {
    // 상대가 둘로 나뉘었거나(1:N), 짝이 없거나, 상대 문장이 다른 문서에 있다
    expect(findPartnerTarget(10, [unit(1, 7, [10]), unit(2, 7, [11, 12], "en")], doc)).toBeNull();
    expect(findPartnerTarget(10, [unit(1, null, [10])], doc)).toBeNull();
    expect(findPartnerTarget(10, [unit(1, 7, [10]), unit(2, 7, [99], "en")], doc)).toBeNull();
  });

  it("gives up for a merged line with several sources", () => {
    expect(findPartnerTarget(20, [unit(1, 7, [20]), unit(3, null, [20]), unit(2, 7, [11], "en")], doc)).toBeNull();
  });
});
