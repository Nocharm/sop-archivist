// 캡션 규칙 - 캡션이 필요한 묶음을 처리와 입구 2에 따라 가르고, 캡션 출처·Confirm 막기·남은 수를 같은 기준으로 센다.
import { describe, expect, it } from "vitest";

import type { Group, GroupTarget, UnitRow, ViewUnit } from "./api-sop";
import { isBundleCaptionNeeded, isCaptionGate, isCaptionNeeded, listCaptionFields, listCaptionPendingRowKeys, listCaptionSources, makeIsLinkedToWritten, pickCaptionLang } from "./caption-model";
import type { ClassifyRow, Destination } from "./classify-model";

describe("isCaptionNeeded", () => {
  it("needs a caption for an undecided, held or assigned bundle without one", () => {
    expect(isCaptionNeeded({ hasCaption: false, disposition: "unassigned", isLinkedToWritten: false })).toBe(true);
    expect(isCaptionNeeded({ hasCaption: false, disposition: "assigned", isLinkedToWritten: false })).toBe(true);
    expect(isCaptionNeeded({ hasCaption: false, disposition: undefined, isLinkedToWritten: false })).toBe(true);
  });

  it("does not need one when the bundle has a caption, is deleted or moved, or is linked to a written New document", () => {
    expect(isCaptionNeeded({ hasCaption: true, disposition: "assigned", isLinkedToWritten: false })).toBe(false);
    expect(isCaptionNeeded({ hasCaption: false, disposition: "delete", isLinkedToWritten: false })).toBe(false);
    expect(isCaptionNeeded({ hasCaption: false, disposition: "move_external", isLinkedToWritten: false })).toBe(false);
    expect(isCaptionNeeded({ hasCaption: false, disposition: "assigned", isLinkedToWritten: true })).toBe(false);
  });
});

function makeUnit(id: number, extra: Partial<ViewUnit> = {}): ViewUnit {
  return {
    id, display_id: `D-${id}`, kind: "sentence", spans: [], text: "", lang: "ko", number: null, table_id: null, row_index: null, group_unit_id: null, status: "unassigned",
    pair_id: null, pos_seq: id, block_id: id, is_edited: false, can_unmerge: false, split_suggestion_id: null, ref: null, caption_refs: [], ...extra,
  };
}

function units(extra: Record<number, Partial<ViewUnit>>): Map<number, ViewUnit> {
  return new Map(Object.entries(extra).map(([id, value]) => [Number(id), makeUnit(Number(id), value)]));
}

function makeTarget(extra: Partial<GroupTarget>): GroupTarget {
  return {
    id: 1, target_doc_id: 6, slot_key: "scope", wi_step: null, wi_part: null, section_path: "", order_index: 0, lang: "ko", kind: "sentence",
    confirmed_text: "", ai_text: "", change_type: "as_is", origin: "units", new_unit_id: null, translation_source_unit_id: null, parent_target_id: null, cell_row: null, cell_col: null,
    grid: null, status: "confirmed", hold_reason: "", remark: "", warnings: [], source_unit_ids: [], group_id: null, revision: 1, indent_level: 0, ...extra,
  };
}

const figureRow: ClassifyRow = { key: "u9", documentId: 1, unitIds: [9], status: "unassigned", pairStatus: null, pairId: null };
const placeDest: Destination = { kind: "slot", docId: 6, slotKey: "scope" };
const deleteDest: Destination = { kind: "delete" };
const draftWith = (extra: { captionTexts: Record<string, string> }) => extra;

describe("isCaptionGate", () => {
  it("gates confirm for an assigned figure without any caption", () => {
    expect(isCaptionGate(figureRow, placeDest, units({ 9: { kind: "figure" } }), undefined)).toBe(true);
    expect(isCaptionGate(figureRow, deleteDest, units({ 9: { kind: "figure" } }), undefined)).toBe(false);
    expect(isCaptionGate(figureRow, placeDest, units({ 9: { kind: "figure" } }), draftWith({ captionTexts: { "w9:ko": "로터" } }))).toBe(false);
  });

  it("lets a figure with a bound caption unit or a saved written caption through, and ignores sentences and links", () => {
    expect(isCaptionGate(figureRow, placeDest, units({ 9: { kind: "figure" }, 10: { kind: "caption", group_unit_id: 9, text: "그림 1" } }), undefined)).toBe(false);
    const group: Group = { units: [], targets: [makeTarget({ id: 50, kind: "figure", source_unit_ids: [9] }), makeTarget({ id: 51, parent_target_id: 50, confirmed_text: "쓴 캡션" })] };
    expect(isCaptionGate(figureRow, placeDest, units({ 9: { kind: "figure" } }), undefined, group)).toBe(false);
    expect(isCaptionGate(figureRow, placeDest, units({ 9: { kind: "figure" } }), draftWith({ captionTexts: { "w9:ko": "   " } }))).toBe(true);
    expect(isCaptionGate(figureRow, placeDest, units({ 9: { kind: "sentence" } }), undefined)).toBe(false);
    expect(isCaptionGate(figureRow, { kind: "link", targetIds: [70] }, units({ 9: { kind: "figure" } }), undefined)).toBe(false);
  });

  it("gates a table dropped between two sentences the same as a clicked slot - the drop only adds a position", () => {
    const tableRow: ClassifyRow = { ...figureRow, key: "u8", unitIds: [8] };
    const dropped = { captionTexts: {}, position: { placeId: "slot:6:scope", after: 70 } };
    expect(isCaptionGate(tableRow, placeDest, units({ 8: { kind: "table" } }), dropped)).toBe(true);
    expect(isCaptionGate(tableRow, placeDest, units({ 8: { kind: "table" }, 12: { kind: "caption", group_unit_id: 8, text: "표 1" } }), dropped)).toBe(false);
    expect(isCaptionGate(tableRow, placeDest, units({ 8: { kind: "table" } }), { ...dropped, captionTexts: { "w8:ko": "운전 조건" } })).toBe(false);
  });
});

describe("listCaptionSources", () => {
  const view = [makeUnit(9, { kind: "table" }), makeUnit(10, { kind: "caption", group_unit_id: 9, lang: "ko", text: "표 1. 운전 조건" }), makeUnit(11, { kind: "caption", group_unit_id: 9, lang: "en", text: "Table 1. Run" })];

  it("reads bound caption units, with the text the person rewrote", () => {
    expect(listCaptionSources(view[0], view, draftWith({ captionTexts: { u11: "Table 1. Run conditions" } }))).toEqual([
      { key: "u10", unitId: 10, lang: "ko", text: "표 1. 운전 조건" },
      { key: "u11", unitId: 11, lang: "en", text: "Table 1. Run conditions" },
    ]);
  });

  it("takes a written caption without a source when the bundle has no caption unit", () => {
    const bare = [makeUnit(9, { kind: "figure" })];
    expect(listCaptionSources(bare[0], bare, draftWith({ captionTexts: { "w9:ko": " 로터 " } }))).toEqual([{ key: "w9:ko", unitId: null, lang: "ko", text: "로터" }]);
    expect(listCaptionSources(bare[0], bare, undefined)).toEqual([]);
  });
});

describe("listCaptionFields", () => {
  it("opens one Write a caption field in the language of the sentence before the bundle", () => {
    const view = [makeUnit(1, { lang: "en", text: "See below." }), makeUnit(2, { kind: "figure", lang: "neutral" })];
    expect(listCaptionFields(view[1], view, undefined)).toEqual([{ key: "w2:en", unitId: null, lang: "en", text: "" }]);
    expect(pickCaptionLang(makeUnit(2, { kind: "figure" }), [makeUnit(2, { kind: "figure" })])).toBe("ko");
  });

  it("keeps a field for each bound caption language, even while it is emptied", () => {
    const view = [makeUnit(9, { kind: "table" }), makeUnit(10, { kind: "caption", group_unit_id: 9, lang: "ko", text: "표 1" })];
    expect(listCaptionFields(view[0], view, draftWith({ captionTexts: { u10: "" } }))).toEqual([{ key: "u10", unitId: 10, lang: "ko", text: "" }]);
  });

  it("keeps two same-language caption units apart - each keeps its own edited text", () => {
    const view = [makeUnit(9, { kind: "table" }), makeUnit(10, { kind: "caption", group_unit_id: 9, lang: "ko", text: "표 1." }), makeUnit(11, { kind: "caption", group_unit_id: 9, lang: "ko", text: "운전 조건" })];
    expect(listCaptionSources(view[0], view, draftWith({ captionTexts: { u11: "운전 조건표" } })).map((source) => [source.key, source.text])).toEqual([["u10", "표 1."], ["u11", "운전 조건표"]]);
  });
});

describe("listCaptionPendingRowKeys", () => {
  const unitRow = (id: number, extra: Partial<UnitRow>): UnitRow => ({
    unit_id: id, document_id: 1, display_id: `D-${id}`, kind: "sentence", lang: "ko", text: "", content_start: 0, table_id: null, row_index: null, group_unit_id: null,
    status: "unassigned", target_ids: [], target_doc_ids: [], pair_id: null,
    decision: { disposition: "unassigned", move_target_code: "", reason: "", status: "unassigned", hold_reason: "", confirmed_by: null, confirmed_at: null, revision: 1 },
    ...extra,
  });
  const row = (id: number): ClassifyRow => ({ key: `u${id}`, documentId: 1, unitIds: [id], status: "unassigned", pairStatus: null, pairId: null });

  it("counts the bundles the head flags as Caption needed, in document order", () => {
    const deleted = { ...unitRow(4, {}).decision, disposition: "delete" as const };
    const map = new Map([
      [1, unitRow(1, { kind: "table" })],
      [2, unitRow(2, { kind: "figure" })],
      [3, unitRow(3, { kind: "caption", group_unit_id: 2 })],
      [4, unitRow(4, { kind: "figure", decision: deleted })],
      [5, unitRow(5, { kind: "table", has_caption_target: true })],
      [6, unitRow(6, { kind: "table_row" })],
      [7, unitRow(7, { kind: "sentence" })],
      [8, unitRow(8, { kind: "figure" })],
    ]);
    expect(listCaptionPendingRowKeys([1, 2, 4, 5, 6, 7, 8].map(row), map, (id) => id === 8)).toEqual(["u1", "u6"]);
  });

  it("uses one rule for the counter and the head row: the units of a written document opened alone and bundles linked to one are exempt", () => {
    const map = new Map([[1, unitRow(1, { kind: "table" })], [2, unitRow(2, { kind: "figure" })], [5, unitRow(5, { kind: "table", has_caption_target: true })]]);
    const isLinkedToWritten = makeIsLinkedToWritten(new Set([90]), new Set([2]));
    expect([1, 2, 5, 90].map(isLinkedToWritten)).toEqual([false, true, false, true]);
    // 위쪽 줄 수에 든 묶음과 머리 줄에 Caption needed를 띄우는 묶음이 같다
    const counted = listCaptionPendingRowKeys([1, 2, 5].map(row), map, isLinkedToWritten);
    const flagged = [1, 2, 5].filter((id) => isBundleCaptionNeeded(map.get(id), false, isLinkedToWritten(id))).map((id) => `u${id}`);
    expect(counted).toEqual(["u1"]);
    expect(flagged).toEqual(counted);
    // 혼자 연 New 문서의 단위는 목록(unitMap)에 없어도 캡션을 묻지 않는다
    expect(isBundleCaptionNeeded(undefined, false, isLinkedToWritten(90))).toBe(false);
    expect(isBundleCaptionNeeded(map.get(1), true, false)).toBe(false);
  });

  it("does not count a figure that shares the caption of its group's first figure (F7 ⑥)", () => {
    const map = new Map([
      [2, unitRow(2, { kind: "figure" })],
      [3, unitRow(3, { kind: "caption", group_unit_id: 2 })],
      [4, unitRow(4, { kind: "figure", caption_figure_id: 2 })],
      [5, unitRow(5, { kind: "figure", caption_figure_id: 9 })],
    ]);
    expect(listCaptionPendingRowKeys([2, 4, 5].map(row), map, () => false)).toEqual(["u5"]);
  });
});

describe("isCaptionGate - shared figure caption", () => {
  it("lets a figure through when the first figure of its group has a caption unit", () => {
    const row: ClassifyRow = { key: "u11", documentId: 1, unitIds: [11], status: "unassigned", pairStatus: null, pairId: null };
    expect(isCaptionGate(row, placeDest, units({ 9: { kind: "figure" }, 10: { kind: "caption", group_unit_id: 9 }, 11: { kind: "figure", caption_figure_id: 9 } }), undefined)).toBe(false);
    expect(isCaptionGate(row, placeDest, units({ 9: { kind: "figure" }, 11: { kind: "figure", caption_figure_id: 9 } }), undefined)).toBe(true);
  });
});
