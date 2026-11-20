// 표·그림 참조 규칙 - 참조 라벨·대상 표시, 다시 이을 후보, 다시 매긴 번호 표시.
import { describe, expect, it } from "vitest";

import type { ViewCaptionRef, ViewUnit } from "./api-sop";
import { describeCaptionRef, formatRenumber, listRefCandidates } from "./caption-ref-model";

function makeUnit(id: number, extra: Partial<ViewUnit> = {}): ViewUnit {
  return {
    id, display_id: `D-${id}`, kind: "sentence", spans: [], text: "", lang: "ko", number: null, table_id: null, row_index: null, group_unit_id: null, status: "unassigned",
    pair_id: null, pos_seq: id, block_id: id, is_edited: false, can_unmerge: false, split_suggestion_id: null, ref: null, caption_refs: [], ...extra,
  };
}

function units(extra: Record<number, Partial<ViewUnit>>): Map<number, ViewUnit> {
  return new Map(Object.entries(extra).map(([id, value]) => [Number(id), makeUnit(Number(id), value)]));
}

function ref(extra: Partial<ViewCaptionRef>): ViewCaptionRef {
  return { id: 1, kind: "table", number: 3, target_unit_id: null, state: "linked", origin: "auto", ...extra };
}

describe("describeCaptionRef", () => {
  it("describes a numbered reference and a missing one", () => {
    expect(describeCaptionRef(ref({ kind: "table", number: 3, target_unit_id: 9 }), units({ 9: { display_id: "OLD-7-012" } }))).toEqual({ label: "표 3", targetDisplayId: "OLD-7-012", missing: false });
    expect(describeCaptionRef(ref({ kind: "table", number: 9, target_unit_id: null }), units({})).missing).toBe(true);
  });

  it("uses English labels for an English sentence", () => {
    const from = makeUnit(1, { lang: "en" });
    expect(describeCaptionRef(ref({ kind: "figure", number: 5 }), units({}), from).label).toBe("Figure 5");
    expect(describeCaptionRef(ref({ kind: "table", number: 4 }), units({}), from).label).toBe("Table 4");
    expect(describeCaptionRef(ref({ kind: "figure", number: 5 }), units({})).label).toBe("그림 5");
  });

  it("reads a place reference's direction from where the target sits", () => {
    const from = makeUnit(5, { pos_seq: 5 });
    const below = units({ 9: { kind: "table", pos_seq: 6 } });
    const above = units({ 2: { kind: "figure", pos_seq: 2 } });
    expect(describeCaptionRef(ref({ number: null, target_unit_id: 9 }), below, from).label).toBe("아래 표");
    expect(describeCaptionRef(ref({ kind: "figure", number: null, target_unit_id: 2 }), above, from).label).toBe("위 그림");
    expect(describeCaptionRef(ref({ number: null, target_unit_id: 9 }), below, makeUnit(5, { pos_seq: 5, lang: "en" })).label).toBe("the table below");
  });

  it("counts a target that is no longer in the document as missing", () => {
    expect(describeCaptionRef(ref({ target_unit_id: 9 }), units({}))).toEqual({ label: "표 3", targetDisplayId: null, missing: true });
  });
});

describe("listRefCandidates", () => {
  it("lists every table or every figure, in paper order", () => {
    const all = units({
      4: { kind: "table", table_id: 2, pos_seq: 3 },
      7: { kind: "table", table_id: 1, pos_seq: 1 },
      8: { kind: "figure", pos_seq: 8 },
      10: { kind: "sentence" },
    });
    expect(listRefCandidates("table", all).map((unit) => unit.id)).toEqual([7, 4]);
    expect(listRefCandidates("figure", all).map((unit) => unit.id)).toEqual([8]);
  });
});

describe("formatRenumber", () => {
  it("formats a renumber change", () => {
    expect(formatRenumber({ from_label: "표 1", to_label: "표 3" })).toBe("표 1 → 표 3");
    expect(formatRenumber({ from_label: "", to_label: "표 3" })).toBe("+ 표 3");
  });
});
