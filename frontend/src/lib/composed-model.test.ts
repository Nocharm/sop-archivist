import { describe, expect, it } from "vitest";

import type { ComposedDoc, GroupTarget } from "@/lib/api-sop";
import { applySavedTargets, buildComposedRows, diffRows, getNewRowKey, removeClearedUnits } from "@/lib/composed-model";

function makeDoc(): ComposedDoc {
  return {
    target_doc_id: 7,
    code: "SOP-CF",
    title: "Synthetic",
    doc_type: "sop",
    entrance: "assign",
    sections: [
      { location_key: "purpose", label: "Purpose", number: "1", na_reason: null, items: [{ target_id: 1, kind: "sentence", lang: "ko", text: "목적", status: "confirmed", change_type: "as_is", number: "1.1", source_unit_ids: [10] }] },
      { location_key: "scope", label: "Scope", number: "2", na_reason: "Synthetic", items: [] },
      { location_key: "step:1:instruction", label: "Step 1 · Instruction", number: "1", na_reason: null, items: [] },
    ],
  };
}

function makeTarget(fields: Partial<GroupTarget>): GroupTarget {
  return {
    id: 50, target_doc_id: 7, slot_key: null, wi_step: null, wi_part: null, section_path: "", order_index: 0, lang: "en", kind: "sentence",
    confirmed_text: "", ai_text: "", change_type: "as_is", origin: "units", new_unit_id: null, translation_source_unit_id: null, parent_target_id: null,
    cell_row: null, cell_col: null, grid: null, status: "confirmed", hold_reason: "", remark: "", warnings: [], source_unit_ids: [20], group_id: null,
    revision: 1, indent_level: 0, ...fields,
  };
}

describe("buildComposedRows", () => {
  it("lists sentences in section order and one placeholder per empty section", () => {
    const rows = buildComposedRows(makeDoc());

    expect(rows.map(getNewRowKey)).toEqual(["t:1", "slot:scope", "slot:step:1:instruction"]);
    expect(rows[0]).toMatchObject({ section_path: "1. Purpose", doc_code: "SOP-CF", source_unit_ids: [10], lang: "ko" });
    expect(rows[1]).toMatchObject({ kind: "empty", section_path: "2. Scope", na: true });
  });
});

describe("applySavedTargets", () => {
  it("appends a saved top-level sentence to its slot, with source text when nothing was rewritten", () => {
    const next = applySavedTargets(makeDoc(), [makeTarget({ slot_key: "purpose" })], (ids) => `src ${ids.join(",")}`);

    expect(next.sections[0].items.map((item) => [item.target_id, item.text])).toEqual([[1, "목적"], [50, "src 20"]]);
  });

  it("maps WI steps to step keys, moves re-saved sentences and skips other documents and cells", () => {
    const targets = [
      makeTarget({ id: 1, wi_step: 1, wi_part: "instruction", confirmed_text: "Moved" }),
      makeTarget({ id: 60, target_doc_id: 8, slot_key: "purpose" }),
      makeTarget({ id: 61, slot_key: "purpose", parent_target_id: 1 }),
    ];

    const next = applySavedTargets(makeDoc(), targets, () => "");

    expect(next.sections[0].items).toEqual([]);
    expect(next.sections[2].items.map((item) => [item.target_id, item.text])).toEqual([[1, "Moved"]]);
  });
});

describe("removeClearedUnits", () => {
  it("drops sentences whose sources were all cleared", () => {
    expect(removeClearedUnits(makeDoc(), new Set([10])).sections[0].items).toEqual([]);
    expect(removeClearedUnits(makeDoc(), new Set([11])).sections[0].items).toHaveLength(1);
  });
});

describe("diffRows", () => {
  it("reports added keys and hangs leaving rows before the next surviving row", () => {
    const { added, leaving } = diffRows(["a", "b", "c", "d"], ["a", "x", "c"], (row) => row);

    expect([...added]).toEqual(["x"]);
    expect([...leaving.entries()]).toEqual([["c", ["b"]], ["", ["d"]]]);
  });
});
