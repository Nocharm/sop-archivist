// 분류 모델 - 줄=짝, 줄 상태는 덜 끝난 쪽, 저장 요청은 두 단위를 함께 담고 기존 새 문장을 고치며 N/A 칸은 고를 수 없다.
import { describe, expect, it } from "vitest";

import type { Decision, DocumentView, Group, GroupTarget, ToBe, UnitRow, ViewUnit } from "./api-sop";
import {
  buildDestinationOptions,
  buildGroupSave,
  buildRows,
  buildSentenceSlots,
  findNextOpen,
  findSystemHold,
  pickRowStatus,
  readDestination,
  readHumanReason,
} from "./classify-model";

function makeViewUnit(id: number, lang: "ko" | "en", pos: number): ViewUnit {
  return {
    id, display_id: `D-${id}`, kind: "sentence", spans: [[pos, 0, 3]], text: `t${id}`, lang, table_id: null, row_index: null,
    group_unit_id: null, boundary_confirmed: false, status: "unassigned", pair_id: null, pos_seq: pos, block_id: pos,
  };
}

function makeUnitRow(id: number, status: UnitRow["status"]): UnitRow {
  return {
    unit_id: id, document_id: 1, display_id: `D-${id}`, kind: "sentence", lang: "ko", text: `t${id}`, table_id: null, row_index: null,
    group_unit_id: null, status, target_ids: [],
    decision: { disposition: "unassigned", move_target_code: "", reason: "", status, hold_reason: "", confirmed_by: null, confirmed_at: null, revision: 1 },
  };
}

const VIEW = {
  document: { id: 1 },
  extraction: null,
  tables: [],
  blocks: [],
  units: [makeViewUnit(10, "ko", 0), makeViewUnit(11, "en", 1), makeViewUnit(12, "en", 2)],
  pairs: [{ id: 5, status: "suggested", source: "code", unit_ids: [10, 11] }],
  edits: { can_undo: false, can_redo: false },
} as unknown as DocumentView;

describe("rows", () => {
  it("makes one row per pair and one per lone unit", () => {
    const unitRows = new Map([[10, makeUnitRow(10, "confirmed")], [11, makeUnitRow(11, "unassigned")], [12, makeUnitRow(12, "on_hold")]]);
    const rows = buildRows([VIEW], unitRows);
    expect(rows.map((row) => row.unitIds)).toEqual([[10, 11], [12]]);
    expect(rows[0].status).toBe("unassigned");
    expect(rows[0].pairStatus).toBe("suggested");
  });

  it("follows the less finished side", () => {
    expect(pickRowStatus(["confirmed", "on_hold"])).toBe("on_hold");
    expect(pickRowStatus(["confirmed", "confirmed"])).toBe("confirmed");
  });

  it("moves on to the next open row, wrapping around", () => {
    const rows = new Map([
      ["a", { key: "a", documentId: 1, unitIds: [1], status: "unassigned" as const, pairStatus: null }],
      ["b", { key: "b", documentId: 1, unitIds: [2], status: "confirmed" as const, pairStatus: null }],
      ["c", { key: "c", documentId: 1, unitIds: [3], status: "confirmed" as const, pairStatus: null }],
    ]);
    expect(findNextOpen(["a", "b", "c"], rows, "b")).toBe("a");
  });
});

const TOBE: ToBe = {
  revision: 1,
  docs: [
    { id: 6, code: "SOP-CF", title: "", doc_type: "sop", parent_code: null, entrance: "assign", is_equipment_sop: false, order_index: 0, document_id: null },
    { id: 7, code: "WI-01", title: "", doc_type: "wi", parent_code: "SOP-CF", entrance: "assign", is_equipment_sop: false, order_index: 1, document_id: null },
    { id: 8, code: "WI-04", title: "", doc_type: "wi", parent_code: "SOP-CF", entrance: "match", is_equipment_sop: false, order_index: 2, document_id: 3 },
  ],
  na_slots: [{ code: "SOP-CF", slot_key: "procedures", reason: "x" }],
  wi_steps: [{ code: "WI-01", step_no: 1, title: "Load" }],
};

describe("destinations", () => {
  it("lists SOP slots, WI step parts, and greys out N/A including children", () => {
    const options = buildDestinationOptions(TOBE, {});
    expect(options.find((option) => option.id === "slot:6:procedures.maintenance")?.disabled).toBe(true);
    expect(options.find((option) => option.id === "slot:6:purpose")?.disabled).toBe(false);
    expect(options.filter((option) => option.docCode === "WI-01").map((option) => option.id)).toEqual(["step:7:1:instruction", "step:7:1:why"]);
    expect(options.some((option) => option.docCode === "WI-04")).toBe(false);
  });
});

describe("save request", () => {
  const units = [
    { id: 10, kind: "sentence", lang: "ko" as const, text: "가", revision: 2 },
    { id: 11, kind: "sentence", lang: "en" as const, text: "A", revision: 3 },
  ];
  const group: Group = {
    units: [],
    targets: [
      {
        id: 90, target_doc_id: 6, slot_key: "scope", wi_step: null, wi_part: null, section_path: "", order_index: 0, lang: "ko", kind: "sentence",
        confirmed_text: "가", ai_text: "", change_type: "as_is", origin: "units", new_unit_id: null, parent_target_id: null, cell_row: null, cell_col: null,
        grid: null, status: "confirmed", hold_reason: "", warnings: [], source_unit_ids: [10], group_id: null, revision: 4,
      },
    ],
  };

  it("saves both units of a pair, updates the existing sentence and marks edits", () => {
    const body = buildGroupSave(
      { destination: { kind: "slot", docId: 6, slotKey: "purpose" }, texts: { u11: "A changed" }, changeTypes: {}, reason: "", moveCode: "" },
      { units, group, tables: new Map() },
      "confirm",
    );
    expect(body.units.map((unit) => [unit.unit_id, unit.disposition])).toEqual([[10, "assigned"], [11, "assigned"]]);
    expect(body.targets[0]).toMatchObject({ id: 90, revision: 4, slot_key: "purpose", source_unit_ids: [10] });
    // 손대지 않은 기존 새 문장은 글을 보내지 않는다 - 서버가 지금 글을 둔다
    expect(body.targets[0]).not.toHaveProperty("text");
    expect(body.targets[1]).toMatchObject({ text: "A changed", change_type: "rewritten", lang: "en" });
    expect(body.removed_target_ids).toEqual([]);
  });

  it("deleting drops the new sentences and carries the reason", () => {
    const body = buildGroupSave({ destination: { kind: "delete" }, texts: {}, changeTypes: {}, reason: " header ", moveCode: "" }, { units, group, tables: new Map() }, "confirm");
    expect(body.targets).toEqual([]);
    expect(body.removed_target_ids).toEqual([90]);
    expect(body.units[0]).toMatchObject({ disposition: "delete", reason: "header" });
  });

  it("reads the current destination back", () => {
    expect(readDestination(group, [10, 11])).toEqual({ kind: "slot", docId: 6, slotKey: "scope" });
  });
});

// --- v0.4.0 검토: 저장이 AI 제안·기존 새 문장을 망가뜨리지 않는다 ---

function makeTarget(extra: Partial<GroupTarget>): GroupTarget {
  return {
    id: 1, target_doc_id: 6, slot_key: "scope", wi_step: null, wi_part: null, section_path: "", order_index: 0, lang: "ko", kind: "sentence",
    confirmed_text: "", ai_text: "", change_type: "as_is", origin: "units", new_unit_id: null, parent_target_id: null, cell_row: null, cell_col: null,
    grid: null, status: "ai_suggested", hold_reason: "", warnings: [], source_unit_ids: [10], group_id: null, revision: 1, ...extra,
  };
}

const SCOPE = { kind: "slot", docId: 6, slotKey: "scope" } as const;
const ONE_UNIT = [{ id: 10, kind: "sentence", lang: "ko" as const, text: "원문", revision: 1 }];

function makeDraft(extra: Partial<Parameters<typeof buildGroupSave>[0]> = {}): Parameters<typeof buildGroupSave>[0] {
  return { destination: SCOPE, texts: {}, changeTypes: {}, reason: "", moveCode: "", ...extra };
}

describe("save keeps AI suggestions as they are", () => {
  it("accepts an untouched AI rewrite by sending no text and no change type", () => {
    const group: Group = { units: [], targets: [makeTarget({ id: 90, ai_text: "말투만 바꾼 원문", change_type: "tone" })] };
    const body = buildGroupSave(makeDraft(), { units: ONE_UNIT, group, tables: new Map() }, "confirm");
    expect(body.targets).toHaveLength(1);
    expect(body.targets[0]).toMatchObject({ id: 90, source_unit_ids: [10] });
    expect(body.targets[0]).not.toHaveProperty("text");
    expect(body.targets[0]).not.toHaveProperty("change_type");
  });

  it("keeps a human change type when the sentence is saved again untouched", () => {
    const group: Group = { units: [], targets: [makeTarget({ id: 90, confirmed_text: "말투만", change_type: "tone", status: "confirmed" })] };
    const body = buildGroupSave(makeDraft(), { units: ONE_UNIT, group, tables: new Map() }, "confirm");
    expect(body.targets[0]).toMatchObject({ id: 90, change_type: "tone" });
    expect(body.targets[0]).not.toHaveProperty("text");
  });

  it("keeps the existing change type when the text is edited and no type was picked", () => {
    const group: Group = { units: [], targets: [makeTarget({ id: 90, confirmed_text: "말투만", change_type: "tone", status: "confirmed" })] };
    const body = buildGroupSave(makeDraft({ texts: { t90: "말투만 다시" } }), { units: ONE_UNIT, group, tables: new Map() }, "confirm");
    expect(body.targets[0]).toMatchObject({ id: 90, text: "말투만 다시", change_type: "tone" });
  });

  it("keeps every sentence of an AI split", () => {
    const group: Group = {
      units: [],
      targets: [makeTarget({ id: 90, ai_text: "앞 문장", change_type: null }), makeTarget({ id: 91, ai_text: "뒤 문장", change_type: null, order_index: 1 })],
    };
    expect(buildSentenceSlots(group, ONE_UNIT).map((slot) => [slot.key, slot.text])).toEqual([["t90", "앞 문장"], ["t91", "뒤 문장"]]);
    const body = buildGroupSave(makeDraft(), { units: ONE_UNIT, group, tables: new Map() }, "confirm");
    expect(body.targets.map((target) => target.id)).toEqual([90, 91]);
    expect(body.removed_target_ids).toEqual([]);
  });

  it("sends an AI merge once, not once per source unit", () => {
    const units = [
      { id: 10, kind: "sentence", lang: "ko" as const, text: "가", revision: 1 },
      { id: 12, kind: "sentence", lang: "ko" as const, text: "나", revision: 1 },
      { id: 11, kind: "sentence", lang: "en" as const, text: "A", revision: 1 },
    ];
    const group: Group = { units: [], targets: [makeTarget({ id: 90, ai_text: "가 나", source_unit_ids: [10, 12] })] };
    const body = buildGroupSave(makeDraft(), { units, group, tables: new Map() }, "confirm");
    expect(body.targets.filter((target) => target.id === 90)).toHaveLength(1);
    expect(body.targets.find((target) => target.id === 90)?.source_unit_ids).toEqual([10, 12]);
    expect(body.targets.find((target) => target.id === undefined)).toMatchObject({ lang: "en", source_unit_ids: [11], text: "A", change_type: "as_is" });
  });

  it("keeps translations that ride along in the group", () => {
    const group: Group = {
      units: [],
      targets: [makeTarget({ id: 90, confirmed_text: "원문", status: "confirmed" }), makeTarget({ id: 95, origin: "translation", lang: "en", source_unit_ids: [], confirmed_text: "Source" })],
    };
    const body = buildGroupSave(makeDraft({ destination: { kind: "slot", docId: 6, slotKey: "purpose" } }), { units: ONE_UNIT, group, tables: new Map() }, "confirm");
    expect(body.removed_target_ids).toEqual([]);
    expect(body.targets.find((target) => target.id === 95)).toEqual({ key: "t95", id: 95, revision: 1, kind: "sentence", source_unit_ids: [] });
  });

  it("keeps a cell translation under a table that is saved again", () => {
    const units = [{ id: 30, kind: "table", lang: "neutral" as const, text: "", revision: 1 }];
    const tables = new Map([[30, { rows: 1, cols: 1, cells: [{ id: 31, lang: "ko" as const, text: "칸", row: 0, col: 0 }] }]]);
    const group: Group = {
      units: [],
      targets: [
        makeTarget({ id: 80, kind: "table", lang: "neutral", source_unit_ids: [30], grid: { rows: 1, cols: 1 } }),
        makeTarget({ id: 81, parent_target_id: 80, source_unit_ids: [31], cell_row: 0, cell_col: 0 }),
        makeTarget({ id: 82, parent_target_id: 80, origin: "translation", lang: "en", source_unit_ids: [], cell_row: 0, cell_col: 0 }),
      ],
    };
    const body = buildGroupSave(makeDraft(), { units, group, tables }, "confirm");
    expect(body.removed_target_ids).toEqual([]);
    expect(body.targets.map((target) => target.id)).toEqual([80, 81, 82]);
  });

  it("treats an emptied sentence as the source text", () => {
    const body = buildGroupSave(makeDraft({ texts: { u10: "  " } }), { units: ONE_UNIT, group: null, tables: new Map() }, "confirm");
    expect(body.targets[0]).toMatchObject({ text: "원문", change_type: "as_is" });
  });
});

describe("table rows and step-less WIs", () => {
  it("saves a row unit from 'split into rows' as a one-row table with row-relative cells", () => {
    const units = [{ id: 30, kind: "table_row", lang: "neutral" as const, text: "", revision: 1 }];
    const tables = new Map([[30, { rows: 1, cols: 2, cells: [{ id: 31, lang: "ko" as const, text: "칸", row: 0, col: 1 }] }]]);
    const body = buildGroupSave(makeDraft(), { units, group: null, tables }, "confirm");
    expect(body.targets[0]).toMatchObject({ key: "u30", kind: "table", lang: "neutral", grid: { rows: 1, cols: 2 }, source_unit_ids: [30] });
    expect(body.targets[1]).toMatchObject({ kind: "sentence", parent_key: "u30", cell_row: 0, cell_col: 1, source_unit_ids: [31] });
  });

  it("offers Instruction and Why without a step for a WI with no steps, and reads it back", () => {
    const tobe: ToBe = { ...TOBE, wi_steps: [] };
    const ids = buildDestinationOptions(tobe, {}).filter((option) => option.docCode === "WI-01").map((option) => option.id);
    expect(ids).toEqual(["step:7:none:instruction", "step:7:none:why"]);
    const group: Group = { units: [], targets: [makeTarget({ id: 90, target_doc_id: 7, slot_key: null, wi_step: null, wi_part: "why" })] };
    const destination = readDestination(group, [10]);
    expect(destination).toEqual({ kind: "step", docId: 7, step: null, part: "why" });
    const body = buildGroupSave(makeDraft({ destination }), { units: ONE_UNIT, group, tables: new Map() }, "confirm");
    expect(body.targets[0]).toMatchObject({ target_doc_id: 7, slot_key: null, wi_step: null, wi_part: "why" });
  });
});

describe("hold without a destination", () => {
  it("holds the units as unassigned with no new sentences", () => {
    const group: Group = { units: [], targets: [makeTarget({ id: 90 })] };
    const body = buildGroupSave(makeDraft({ destination: null }), { units: ONE_UNIT, group, tables: new Map() }, "hold", "모름");
    expect(body).toMatchObject({ action: "hold", hold_reason: "모름", targets: [], removed_target_ids: [90] });
    expect(body.units[0]).toMatchObject({ disposition: "unassigned", reason: "" });
  });

  it("still needs a destination to confirm", () => {
    expect(() => buildGroupSave(makeDraft({ destination: null }), { units: ONE_UNIT, group: null, tables: new Map() }, "confirm")).toThrow();
  });
});

describe("system hold codes", () => {
  const base: Decision = { disposition: "assigned", move_target_code: "", reason: "", status: "on_hold", hold_reason: "", confirmed_by: null, confirmed_at: null, revision: 1 };

  it("never treats a system code as the human reason", () => {
    expect(readHumanReason({ ...base, hold_reason: "system:related_unit_changed" })).toBe("");
    expect(readHumanReason({ ...base, reason: "system:ai_invalid_response" })).toBe("");
    expect(readHumanReason({ ...base, hold_reason: "다음 주 확인" })).toBe("다음 주 확인");
    expect(readHumanReason({ ...base, reason: "머리말", hold_reason: "x" })).toBe("머리말");
  });

  it("finds the system code to show as a label", () => {
    expect(findSystemHold({ ...base, hold_reason: "system:related_unit_changed" })).toBe("related_unit_changed");
    expect(findSystemHold({ ...base, hold_reason: "다음 주 확인" })).toBeNull();
  });
});
