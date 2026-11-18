import { describe, expect, it } from "vitest";

import type { ComposedDoc, ComposedItem, ComposedSection } from "@/lib/api-sop";
import { makeSectionOutline } from "@/lib/outline-fixture";

import { applyJoinedSources, countJoinedLines, isJoinable, listJoinableIds, shouldAdvanceAfterSave } from "./join-sentence-model";

function makeItem(targetId: number, extra: Partial<ComposedItem> = {}): ComposedItem {
  return { target_id: targetId, kind: "sentence", lang: "ko", text: `t${targetId}`, status: "confirmed", change_type: "as_is", number: `6.1.${targetId}`, number_style: "numbered", indent_level: 0, meaning_key: null, source_unit_ids: [targetId * 10], ...extra };
}

function makeSection(key: string, items: ComposedItem[]): ComposedSection {
  return { ...makeSectionOutline(), location_key: key, label: key, number: "6.1", na_reason: null, heading_note: "", items };
}

function makeDoc(): ComposedDoc {
  return {
    target_doc_id: 7, code: "SOP-J", title: "Synthetic", doc_type: "sop", entrance: "assign",
    sections: [makeSection("procedures", [makeItem(1), makeItem(2, { status: "ai_suggested" }), makeItem(3, { kind: "table" }), makeItem(4, { lang: "en" })]), makeSection("scope", [])],
  };
}

const ROW = [{ id: 90, lang: "ko" }];

describe("isJoinable", () => {
  it("accepts a confirmed sentence with a source and a same-language row unit", () => {
    expect(isJoinable(makeItem(1), ROW)).toBe(true);
  });
  it("refuses lines that are not confirmed sentences", () => {
    expect(isJoinable(makeItem(2, { status: "ai_suggested" }), ROW)).toBe(false);
    expect(isJoinable(makeItem(2, { status: "on_hold" }), ROW)).toBe(false);
    expect(isJoinable(makeItem(3, { kind: "table" }), ROW)).toBe(false);
    expect(isJoinable(makeItem(3, { kind: "figure" }), ROW)).toBe(false);
  });
  it("refuses a sentence with no source to merge into", () => {
    expect(isJoinable(makeItem(1, { source_unit_ids: [] }), ROW)).toBe(false);
  });
  it("refuses a row with no unit in the sentence language", () => {
    expect(isJoinable(makeItem(4, { lang: "en" }), ROW)).toBe(false);
  });
  it("refuses when every row unit is already a source", () => {
    expect(isJoinable(makeItem(1, { source_unit_ids: [10, 90] }), ROW)).toBe(false);
    expect(isJoinable(makeItem(1, { source_unit_ids: [10, 90] }), [...ROW, { id: 91, lang: "ko" }])).toBe(true);
  });
});

describe("listJoinableIds", () => {
  it("lists only the confirmed sentences the picked row can join", () => {
    expect([...listJoinableIds(makeDoc(), ROW, true)]).toEqual([1]);
  });
  it("is empty without a picked row, without edit rights, or without a document", () => {
    expect(listJoinableIds(makeDoc(), [], true).size).toBe(0);
    expect(listJoinableIds(makeDoc(), ROW, false).size).toBe(0);
    expect(listJoinableIds(null, ROW, true).size).toBe(0);
  });
});

describe("countJoinedLines", () => {
  it("counts distinct Old lines among the sources and the picked row", () => {
    const rowKeyOf = (id: number) => ({ 10: "r1", 11: "r1", 20: "r2" })[id];
    expect(countJoinedLines([10], "r9", rowKeyOf)).toBe(2);
    expect(countJoinedLines([10, 11], "r9", rowKeyOf)).toBe(2);
    expect(countJoinedLines([10, 20], "r9", rowKeyOf)).toBe(3);
  });
  it("counts a unit with no known row as its own line", () => {
    expect(countJoinedLines([55], "r9", () => undefined)).toBe(2);
  });
});

describe("applyJoinedSources", () => {
  it("adds the sources and marks the sentence merged without touching the rest", () => {
    const doc = makeDoc();
    const next = applyJoinedSources(doc, 1, [90, 10]);
    const [first, second] = next.sections[0].items;
    expect(first).toMatchObject({ target_id: 1, change_type: "merged", source_unit_ids: [10, 90], number: "6.1.1", text: "t1" });
    expect(second).toBe(doc.sections[0].items[1]);
    expect(doc.sections[0].items[0].change_type).toBe("as_is");
  });
});

describe("shouldAdvanceAfterSave", () => {
  it("advances after an ordinary confirm", () => {
    expect(shouldAdvanceAfterSave({ action: "confirm", destinationKind: "slot", isSplit: false })).toBe(true);
    expect(shouldAdvanceAfterSave({ action: "confirm", destinationKind: "link", isSplit: false })).toBe(true);
  });
  it("stays on the line after joining a placed sentence so it can be rewritten", () => {
    expect(shouldAdvanceAfterSave({ action: "confirm", destinationKind: "join", isSplit: false })).toBe(false);
  });
  it("does not advance after a hold or a pair split", () => {
    expect(shouldAdvanceAfterSave({ action: "hold", destinationKind: null, isSplit: false })).toBe(false);
    expect(shouldAdvanceAfterSave({ action: "confirm", destinationKind: "slot", isSplit: true })).toBe(false);
  });
});
