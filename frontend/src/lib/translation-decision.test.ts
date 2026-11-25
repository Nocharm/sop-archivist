// 남은 AI 번역 줄의 확정 · 지우기 - 문장 번역은 그것만 저장하고, 칸 번역은 표 묶음을 지금 그대로 함께 되보낸다.
import { describe, expect, it } from "vitest";

import type { Decision, Group, GroupTarget, GroupUnit } from "./api-sop";
import { buildTranslationDecision, listOpenTranslations } from "./translation-decision";

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

const translation = (id: number, unitId: number, extra: Partial<GroupTarget> = {}) =>
  makeTarget(id, { origin: "translation", lang: "en", confirmed_text: "", ai_text: "Text", change_type: "translated", status: "ai_suggested", translation_source_unit_id: unitId, ...extra });

describe("buildTranslationDecision for a sentence", () => {
  const group: Group = { units: [makeUnit(1)], targets: [makeTarget(10, { source_unit_ids: [1] })], translations: [translation(11, 1)] };

  it("sends only the translation, so the row keeps who confirmed it and when", () => {
    expect(buildTranslationDecision(group, [1], "confirm")).toMatchObject({ action: "confirm", units: [], removed_target_ids: [], targets: [{ id: 11, revision: 2, source_unit_ids: [] }] });
    expect(buildTranslationDecision(group, [1], "remove")).toMatchObject({ action: "confirm", units: [], removed_target_ids: [11], targets: [] });
  });

  it("settles a translation that went on hold, and leaves confirmed ones and other rows' alone", () => {
    const mixed: Group = { ...group, translations: [translation(11, 1, { status: "on_hold" }), translation(12, 1, { status: "confirmed" }), translation(13, 2)] };
    expect(listOpenTranslations(mixed, [1]).map((item) => item.id)).toEqual([11]);
    expect(buildTranslationDecision(mixed, [1], "remove")?.removed_target_ids).toEqual([11]);
  });

  it("has nothing to do without a leftover translation", () => {
    const groupWithoutTranslation: Group = { units: group.units, targets: group.targets };
    expect(buildTranslationDecision(groupWithoutTranslation, [1], "remove")).toBeNull();
    expect(buildTranslationDecision(null, [1], "confirm")).toBeNull();
  });
});

describe("buildTranslationDecision for a table cell", () => {
  // 표 9 · 칸 새 문장 10(확정, 출처 1)과 그 번역 11 - 칸 번역은 표 묶음 안이라 묶음 전체를 지금 그대로 되보낸다
  const group: Group = {
    units: [makeUnit(100, { kind: "table", cell_unit_ids: [1] })],
    targets: [
      makeTarget(9, { kind: "table", lang: "neutral", source_unit_ids: [100], grid: { rows: 1, cols: 1 } }),
      makeTarget(10, { parent_target_id: 9, cell_row: 1, cell_col: 1, source_unit_ids: [1] }),
      translation(11, 1, { parent_target_id: 9, cell_row: 1, cell_col: 1 }),
    ],
  };
  const units = [{ unit_id: 100, revision: 4, disposition: "assigned", move_target_code: "", reason: "사유" }];

  it("echoes the whole table and confirms the translation", () => {
    expect(buildTranslationDecision(group, [100], "confirm")).toMatchObject({ action: "confirm", units, removed_target_ids: [], targets: [{ id: 9 }, { id: 10, parent_key: "t9" }, { id: 11 }] });
  });

  it("echoes the rest and removes the translation", () => {
    expect(buildTranslationDecision(group, [100], "remove")).toMatchObject({ action: "confirm", units, removed_target_ids: [11], targets: [{ id: 9 }, { id: 10 }] });
  });
});
