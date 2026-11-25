// 남은 AI 번역의 확정 · 지우기 - 문장 번역은 그것만 저장하고, 칸 번역은 표 묶음을 지금 그대로 함께 되보낸다.
import { describe, expect, it } from "vitest";

import type { Decision, Group, GroupTarget, GroupUnit, OpenTranslation } from "./api-sop";
import { buildTranslationDecision, isTranslationBlocked, listRowTranslations } from "./translation-decision";

const DECISION: Decision = { disposition: "assigned", move_target_code: "", reason: "사유", status: "confirmed", hold_reason: "", confirmed_by: "qa.member", confirmed_at: null, revision: 4 };

function makeUnit(unit_id: number, extra: Partial<GroupUnit> = {}): GroupUnit {
  return { unit_id, display_id: `OLD-1-${unit_id}`, document_id: 1, kind: "sentence", lang: "ko", text: "글", group_id: null, decision: DECISION, cell_unit_ids: [], ...extra };
}

function makeTarget(id: number, extra: Partial<GroupTarget> = {}): GroupTarget {
  return {
    id, target_doc_id: 6, slot_key: "purpose", wi_step: null, wi_part: null, section_path: "", order_index: 0, lang: "ko", kind: "sentence", confirmed_text: "글", ai_text: "",
    change_type: "as_is", origin: "units", new_unit_id: null, translation_source_unit_id: null, parent_target_id: null, cell_row: null, cell_col: null, grid: null,
    status: "confirmed", hold_reason: "", remark: "", warnings: [], source_unit_ids: [], group_id: null, revision: 2, indent_level: 0, ...extra,
  };
}

function makeOpen(id: number, extra: Partial<OpenTranslation> = {}): OpenTranslation {
  return {
    id, revision: 2, status: "ai_suggested", lang: "en", text: "Text", target_doc_code: "SOP-CF", parent_target_id: null, source_unit_id: 1, source_display_id: "OLD-1-1", source_text: "글",
    row_unit_id: 1, document_id: 1, can_confirm: true, ...extra,
  };
}

describe("listRowTranslations", () => {
  it("keeps the translations of the row, cells under their table, and none that lost their source", () => {
    const items = [makeOpen(11), makeOpen(12, { row_unit_id: 2 }), makeOpen(13, { source_unit_id: 5, row_unit_id: 100 }), makeOpen(14, { source_unit_id: null, row_unit_id: null })];
    expect(listRowTranslations(items, [1]).map((item) => item.id)).toEqual([11]);
    expect(listRowTranslations(items, [100]).map((item) => item.id)).toEqual([13]);
  });
});

describe("buildTranslationDecision for a sentence", () => {
  it("sends only the translation, so the row keeps who confirmed it and when", () => {
    expect(buildTranslationDecision([makeOpen(11)], null, "confirm")).toMatchObject({ action: "confirm", units: [], removed_target_ids: [], targets: [{ id: 11, revision: 2, source_unit_ids: [] }] });
    expect(buildTranslationDecision([makeOpen(11)], null, "remove")).toMatchObject({ action: "confirm", units: [], removed_target_ids: [11], removed_revisions: { 11: 2 }, targets: [] });
  });

  it("never confirms a translation without its source, only removes it", () => {
    const orphan = makeOpen(12, { status: "on_hold", source_unit_id: null, row_unit_id: null, can_confirm: false });
    expect(buildTranslationDecision([orphan], null, "confirm")).toBeNull();
    expect(buildTranslationDecision([makeOpen(11), orphan], null, "confirm")?.targets.map((target) => target.id)).toEqual([11]);
    expect(buildTranslationDecision([makeOpen(11), orphan], null, "remove")?.removed_target_ids).toEqual([11, 12]);
  });

  it("has nothing to do without a leftover translation", () => {
    expect(buildTranslationDecision([], null, "remove")).toBeNull();
  });
});

describe("buildTranslationDecision for a table cell", () => {
  // 표 9 · 칸 새 문장 10(확정, 출처 1)과 그 번역 11 - 칸 번역은 표 묶음 안이라 묶음 전체를 지금 그대로 되보낸다
  const cell = makeOpen(11, { parent_target_id: 9, row_unit_id: 100 });
  const group: Group = {
    units: [makeUnit(100, { kind: "table", cell_unit_ids: [1] })],
    targets: [
      makeTarget(9, { kind: "table", lang: "neutral", source_unit_ids: [100], grid: { rows: 1, cols: 1 } }),
      makeTarget(10, { parent_target_id: 9, cell_row: 1, cell_col: 1, source_unit_ids: [1] }),
      makeTarget(11, { origin: "translation", lang: "en", confirmed_text: "", ai_text: "Text", status: "ai_suggested", translation_source_unit_id: 1, parent_target_id: 9 }),
    ],
  };
  const units = [{ unit_id: 100, revision: 4, disposition: "assigned", move_target_code: "", reason: "사유" }];

  it("echoes the whole table and confirms the translation", () => {
    expect(buildTranslationDecision([cell], group, "confirm")).toMatchObject({ action: "confirm", units, removed_target_ids: [], targets: [{ id: 9 }, { id: 10, parent_key: "t9" }, { id: 11 }] });
  });

  it("echoes the rest and removes the translation", () => {
    expect(buildTranslationDecision([cell], group, "remove")).toMatchObject({ action: "confirm", units, removed_target_ids: [11], removed_revisions: { 11: 2 }, targets: [{ id: 9 }, { id: 10 }] });
  });

  it("refuses when the save would also confirm another cell or row that is still open", () => {
    const heldCell: Group = { ...group, targets: group.targets.map((target) => (target.id === 10 ? { ...target, status: "on_hold" as const } : target)) };
    const otherUnit: Group = { ...group, units: [...group.units, makeUnit(200, { decision: { ...DECISION, status: "unassigned", disposition: "unassigned" } })] };
    const otherTranslation: Group = { ...group, targets: [...group.targets, makeTarget(12, { origin: "translation", status: "ai_suggested", parent_target_id: 9 })] };
    for (const open of [heldCell, otherUnit, otherTranslation]) {
      expect(isTranslationBlocked([cell], open)).toBe(true);
      expect(buildTranslationDecision([cell], open, "confirm")).toBeNull();
      expect(buildTranslationDecision([cell], open, "remove")).toBeNull();
    }
    expect(isTranslationBlocked([cell], group)).toBe(false);
  });

  it("needs the table group, and the translation still in it", () => {
    expect(buildTranslationDecision([cell], null, "remove")).toBeNull();
    expect(buildTranslationDecision([cell], { ...group, targets: group.targets.filter((target) => target.id !== 11) }, "remove")).toBeNull();
  });

  it("never blocks a sentence translation, which is saved alone", () => {
    expect(isTranslationBlocked([makeOpen(11)], { units: [makeUnit(1, { decision: { ...DECISION, status: "on_hold" } })], targets: [] })).toBe(false);
  });
});
