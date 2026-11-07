// 분류 모델 - 줄=짝, 줄 상태는 덜 끝난 쪽, 저장 요청은 두 단위를 함께 담고 기존 새 문장을 고치며 N/A 칸은 고를 수 없다.
import { describe, expect, it } from "vitest";

import type { DocumentView, Group, ToBe, UnitRow, ViewUnit } from "./api-sop";
import { buildDestinationOptions, buildGroupSave, buildRows, findNextOpen, pickRowStatus, readDestination } from "./classify-model";

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
      { destination: { kind: "slot", docId: 6, slotKey: "purpose" }, texts: { 11: "A changed" }, changeTypes: {}, reason: "", moveCode: "" },
      { units, group, tables: new Map() },
      "confirm",
    );
    expect(body.units.map((unit) => [unit.unit_id, unit.disposition])).toEqual([[10, "assigned"], [11, "assigned"]]);
    expect(body.targets[0]).toMatchObject({ id: 90, revision: 4, slot_key: "purpose", change_type: "as_is", source_unit_ids: [10] });
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
