// 여럿 고른 줄의 합치기 · 표 벗기기 계획(쪼개기 먼저 설계 §9) - 이웃 검사와 막는 까닭만 화면이, 합치기 · 짝 다시 맺기는 서버가
import { describe, expect, it } from "vitest";

import type { UnitRow, ViewTable, ViewUnit } from "@/lib/api-sop";

import { type MultiRow, listBulkActions, listNewRows, planBulkClear, planBulkLang, planMultiMerge, planMultiUnwrap, toggleChecked } from "./multi-pick-model";

function u(id: number, over: Partial<ViewUnit> = {}): ViewUnit {
  return {
    id, display_id: `D-${id}`, kind: "sentence", spans: [], text: `t${id}`, lang: "ko", number: null, table_id: null, row_index: null, group_unit_id: null,
    status: "unassigned", pair_id: null, pos_seq: id, block_id: id, is_edited: false, can_unmerge: false, split_suggestion_id: null, ref: null, caption_refs: [], ...over,
  };
}
/** 문서 docId의 줄 - 첫 Unit은 한글, 둘째는 영어이고 둘이면 짝이다 */
function rowOf(docId: number, ko: number, en?: number): MultiRow {
  const pairId = en === undefined ? null : ko * 100 + en;
  const units = [u(ko, { pair_id: pairId }), ...(en === undefined ? [] : [u(en, { lang: "en", pair_id: pairId })])];
  return { key: `row-${ko}`, docId, units };
}
const row = (ko: number, en?: number) => rowOf(1, ko, en);
const none = () => false;
const reason = (rows: MultiRow[], order: number[] = [1, 2, 3]) => {
  const plan = planMultiMerge(rows, order, none);
  return plan.ok ? null : plan.reasonKey;
};

function table(id: number): ViewTable {
  return { id, table_index: id, parent_table_id: null, part: "body", n_rows: 2, n_cols: 2, is_layout: false, is_band: false, anchor: null };
}
const tables = new Map<number, ViewTable>([[4, table(4)], [5, table(5)]]);
/** 표 단위 unitId의 줄 - 표 id는 unitId 10 → 4, 11 → 5 */
const tableRowOf = (docId: number, unitId = 10): MultiRow => ({ key: `row-${unitId}`, docId, units: [u(unitId, { kind: "table", table_id: unitId - 6 })] });
const tableRow = (unitId: number) => tableRowOf(1, unitId);

describe("planMultiMerge", () => {
  it("merges alternating pair rows", () => expect(planMultiMerge([row(1, 2), row(3, 4)], [1, 2, 3, 4], none)).toEqual({ ok: true, value: [1, 2, 3, 4] }));

  it("merges separate-language pair rows when each language is a run", () => expect(planMultiMerge([row(1, 5), row(2, 6)], [1, 2, 5, 6], none)).toEqual({ ok: true, value: [1, 2, 5, 6] }));

  it("merges a lone row with a pair row of the same language next to it", () => expect(planMultiMerge([row(1), row(2, 3)], [1, 2, 3], none)).toEqual({ ok: true, value: [1, 2, 3] }));

  it("refuses a gap, another document, one row and an unsaved row", () => {
    expect(reason([row(1), row(3)], [1, 2, 3])).toBe("assign.bulk.why.notAdjacent");
    expect(reason([row(1), rowOf(9, 2)])).toBe("assign.bulk.why.otherDoc");
    expect(reason([row(1)])).toBe("assign.bulk.why.two");
    expect(planMultiMerge([row(1), row(2)], [1, 2], () => true)).toMatchObject({ reasonKey: "assign.ctx.why.unsaved" });
  });

  it("refuses unpaired rows in two languages", () => {
    const koOnly = row(1);
    const enOnly: MultiRow = { key: "row-2", docId: 1, units: [u(2, { lang: "en" })] };
    expect(reason([koOnly, enOnly], [1, 2])).toBe("assign.bulk.why.mixed");
  });

  it("refuses what the server would refuse to merge", () => {
    expect(reason([row(1), tableRow(10)], [1, 10])).toBe("split.noMergeKind");
    const toc: MultiRow = { key: "row-2", docId: 1, units: [u(2, { noise_kind: "toc" })] };
    expect(reason([row(1), toc], [1, 2])).toBe("split.noMergeToc");
  });
});

describe("planMultiUnwrap", () => {
  it("unwraps only tables of one document", () => {
    expect(planMultiUnwrap([tableRow(10), tableRow(11)], tables)).toEqual({ ok: true, value: [4, 5] });
    expect(planMultiUnwrap([tableRow(10), row(1)], tables)).toBeNull();
    expect(planMultiUnwrap([tableRow(10), tableRowOf(9, 11)], tables)).toMatchObject({ reasonKey: "assign.bulk.why.otherDoc" });
  });
});

describe("listNewRows", () => {
  it("reads New rows with their pair", () => {
    const units = new Map([u(70, { pair_id: 3 }), u(71, { lang: "en", pair_id: 3 }), u(72)].map((unit) => [unit.id, unit]));
    expect(listNewRows([70], units, 7)[0].units.map((unit) => unit.id)).toEqual([70, 71]);
    expect(listNewRows([71, 70, 72], units, 7).map((item) => item.units.map((unit) => unit.id))).toEqual([[70, 71], [72]]);
    expect(listNewRows([70], units, 7)[0].docId).toBe(7);
  });
});

describe("toggleChecked", () => {
  it("the key adds only the picked row, the click adds the active row too", () => {
    expect([...toggleChecked(new Set(), "b", "a", "key")]).toEqual(["b"]);
    expect([...toggleChecked(new Set(), "b", "a", "click")]).toEqual(["b", "a"]);
    expect([...toggleChecked(new Set(["b"]), "b", null, "key")]).toEqual([]);
  });

  it("the click adds the active row only while nothing is picked yet", () => expect([...toggleChecked(new Set(["b"]), "c", "a", "click")]).toEqual(["b", "c"]));
});

function unitRow(id: number, over: Partial<UnitRow> = {}, disposition = "unassigned"): UnitRow {
  return { unit_id: id, status: "unassigned", decision: { disposition, revision: 3 }, ...over } as unknown as UnitRow;
}
const rowMap = new Map([[1, unitRow(1, { status: "confirmed" }, "assigned")], [2, unitRow(2)]]);
const lone = (id: number, over: Partial<ViewUnit> = {}): MultiRow => ({ key: `row-${id}`, docId: 1, units: [u(id, over)] });

describe("planBulkClear", () => {
  it("clears only decided rows", () => {
    expect(planBulkClear([lone(1), lone(2)], rowMap)).toEqual({ ok: true, value: [{ unit_id: 1, revision: 3 }] });
    expect(planBulkClear([lone(2)], rowMap)).toMatchObject({ ok: false, reasonKey: "assign.bulk.why.notAssigned" });
  });
});

describe("planBulkLang", () => {
  const pair = (ko: number, en: number) => rowOf(1, ko, en);
  it("skips same-language, paired, merged, decided and non-text rows", () => {
    const rows = [lone(1), lone(2, { lang: "en" }), pair(3, 4), lone(5, { can_unmerge: true }), tableRow(10), lone(6)];
    expect(planBulkLang(rows, "en", (unit) => unit.id === 6)).toEqual({ ok: true, value: { unitIds: [1], skipped: 5 } });
    expect(planBulkLang([pair(3, 4)], "en", none)).toMatchObject({ ok: false, reasonKey: "assign.bulk.why.noneToChange" });
  });

  it("skips reference and neutral lines, refuses another document", () => {
    expect(planBulkLang([lone(1), lone(2, { lang: "ref" }), lone(3, { lang: "neutral" })], "en", none)).toEqual({ ok: true, value: { unitIds: [1], skipped: 2 } });
    expect(planBulkLang([lone(1), { ...lone(2), docId: 9 }], "en", none)).toMatchObject({ reasonKey: "assign.bulk.why.otherDoc" });
  });
});

describe("listBulkActions", () => {
  it("offers a bar per side", () => {
    const rows = [row(1), row(2)];
    expect(listBulkActions("old", rows)).toEqual(["delete", "unassign", "lang_ko", "lang_en", "merge"]);
    expect(listBulkActions("new", rows)).toEqual(["merge", "lang_ko", "lang_en"]);
    expect(listBulkActions("old", [tableRow(10), tableRow(11)])).toContain("unwrap");
    expect(listBulkActions("new", [tableRow(10), tableRow(11)])).toEqual(["merge", "unwrap", "lang_ko", "lang_en"]);
  });
});
