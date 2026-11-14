import { describe, expect, it } from "vitest";

import type { ComposedDoc, ComposedItem, ComposedSection, GroupTarget, WrittenSentence } from "@/lib/api-sop";
import {
  applySavedTargets,
  buildComposedRows,
  diffRows,
  getComposedLeadWidths,
  getNewRowKey,
  isComposedRow,
  listHeadingNotes,
  readSectionNumber,
  removeClearedUnits,
} from "@/lib/composed-model";
import { getPillWidth } from "@/lib/strip-pill-model";

function makeDoc(sections?: ComposedSection[]): ComposedDoc {
  return {
    target_doc_id: 7,
    code: "SOP-CF",
    title: "Synthetic",
    doc_type: "sop",
    entrance: "assign",
    sections: sections ?? [
      { location_key: "purpose", label: "Purpose", number: "1", na_reason: null, heading_note: "", items: [{ target_id: 1, kind: "sentence", lang: "ko", text: "목적", status: "confirmed", change_type: "as_is", number: "1.1", source_unit_ids: [10] }] },
      { location_key: "scope", label: "Scope", number: "2", na_reason: "Synthetic", heading_note: "", items: [] },
      { location_key: "step:1:instruction", label: "Step 1 · Instruction", number: "1", na_reason: null, heading_note: "", items: [] },
    ],
  };
}

function makeSection(number: string, label: string, headingNote: string): ComposedSection {
  return { location_key: `slot:${number}`, label, number, na_reason: null, heading_note: headingNote, items: [] };
}

function makeItem(targetId: number, number: string | null, kind: ComposedItem["kind"] = "sentence"): ComposedItem {
  return { target_id: targetId, kind, lang: "en", text: `t${targetId}`, status: "confirmed", change_type: "as_is", number, source_unit_ids: [targetId] };
}

function makeSlot(locationKey: string, number: string | null, label: string, items: ComposedItem[]): ComposedSection {
  return { location_key: locationKey, label, number, na_reason: null, heading_note: "", items };
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

  it("carries each item's own output C number while the slot header keeps the slot number", () => {
    const doc = makeDoc([makeSlot("5.1", "5.1", "Procedure", [makeItem(1, "5.1.1"), makeItem(2, null), makeItem(3, "5.1.1.1"), makeItem(4, "5.1.2", "table")])]);

    const rows = buildComposedRows(doc);

    expect(rows.map((row) => (isComposedRow(row) ? [row.section_path, row.number] : null))).toEqual([
      ["5.1. Procedure", "5.1.1"],
      // 번호 생략·주석 줄은 번호가 없다
      ["5.1. Procedure", null],
      ["5.1. Procedure", "5.1.1.1"],
      ["5.1. Procedure", "5.1.2"],
    ]);
  });

  it("tells composed rows from already-written sentences", () => {
    const written: WrittenSentence = {
      target_id: 9, target_doc_id: 7, doc_code: "SOP-CF", section_path: "1. Purpose", order_index: 0, lang: "en", kind: "sentence",
      text: "x", status: "confirmed", change_type: "as_is", source_unit_ids: [], partner_target_id: null, remark: "", revision: 1,
    };

    expect(isComposedRow(written)).toBe(false);
    expect(buildComposedRows(makeDoc()).map(isComposedRow)).toEqual([true, false, false]);
  });
});

describe("readSectionNumber", () => {
  it("reads the leading section number of a slot header", () => {
    expect(readSectionNumber("5.2. Title")).toBe("5.2");
    expect(readSectionNumber("Step 1 · Instruction")).toBe("");
  });
});

describe("getComposedLeadWidths", () => {
  it("sizes each row by the depth of its own number", () => {
    const doc = makeDoc([makeSlot("5", "5", "Responsibilities", [makeItem(1, "5.1")]), makeSlot("5.1", "5.1", "Procedure", [makeItem(2, "5.1.1"), makeItem(3, "5.1.1.1")])]);

    const widths = getComposedLeadWidths(buildComposedRows(doc));

    expect([...widths.entries()]).toEqual([["1", getPillWidth(2)], ["2", getPillWidth(3)], ["3", getPillWidth(4)]]);
  });

  it("widens a depth so its longest number is not clipped, for every row of that depth", () => {
    const doc = makeDoc([makeSlot("step:12:instruction", "12", "Step 12 · Instruction", [makeItem(1, "12.1"), makeItem(2, "12.13")])]);

    const widths = getComposedLeadWidths(buildComposedRows(doc));

    // "12.13" 다섯 자 = 33px + 칸 안 여백 6 - 깊이 2 기본 폭 36보다 넓다
    expect(widths.get("1")).toBe(39);
    expect(widths.get("2")).toBe(39);
  });

  it("gives an unnumbered row the previous row's width, or the slot's first depth when it opens the slot", () => {
    const doc = makeDoc([
      makeSlot("5", "5", "Responsibilities", [makeItem(1, "5.1"), makeItem(2, "5.1.1")]),
      makeSlot("5.1", "5.1", "Procedure", [makeItem(3, null), makeItem(4, "5.1.1"), makeItem(5, "5.1.1.1"), makeItem(6, null)]),
      makeSlot("path:Misc", null, "Misc", [makeItem(7, null)]),
    ]);

    const widths = getComposedLeadWidths(buildComposedRows(doc));

    expect(widths.get("3")).toBe(getPillWidth(3));
    expect(widths.get("6")).toBe(getPillWidth(4));
    expect(widths.get("7")).toBe(getPillWidth(1));
  });
});

describe("applySavedTargets", () => {
  it("appends a saved top-level sentence to its slot, with source text when nothing was rewritten", () => {
    const next = applySavedTargets(makeDoc(), [makeTarget({ slot_key: "purpose" })], (ids) => `src ${ids.join(",")}`);

    expect(next.sections[0].items.map((item) => [item.target_id, item.text])).toEqual([[1, "목적"], [50, "src 20"]]);
  });

  it("leaves the number of a just-saved sentence empty until the reload, keeping the server numbers of the others", () => {
    const next = applySavedTargets(makeDoc(), [makeTarget({ slot_key: "purpose" })], () => "");

    expect(buildComposedRows(next).filter(isComposedRow).map((row) => [row.target_id, row.number])).toEqual([[1, "1.1"], [50, null]]);
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

  it("does not put a saved slot heading into the section items", () => {
    const doc = makeDoc();

    const next = applySavedTargets(doc, [makeTarget({ kind: "slot_heading", slot_key: "purpose", change_type: "heading" })], () => "");

    expect(next.sections.flatMap((section) => section.items)).toEqual(doc.sections.flatMap((section) => section.items));
  });
});

describe("listHeadingNotes", () => {
  it("lists heading notes by the section path the rows use", () => {
    const doc = makeDoc([makeSection("6.1", "Procedure", "← OLD-1 §5"), makeSection("6.2", "Records", "")]);

    expect(listHeadingNotes(doc)).toEqual(new Map([["6.1. Procedure", "← OLD-1 §5"]]));
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
