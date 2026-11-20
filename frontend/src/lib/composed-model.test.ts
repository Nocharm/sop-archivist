import { describe, expect, it } from "vitest";

import type { BundleCell, BundleTable, ComposedDoc, ComposedItem, ComposedSection, GroupTarget, OutputCItem, WrittenSentence } from "@/lib/api-sop";
import {
  applySavedTargets,
  buildComposedRows,
  diffRows,
  applyCOrder,
  buildComposedStrips,
  buildPlaceUndo,
  isSameCOrder,
  toOutputCDoc,
  getNewRowKey,
  groupTableCells,
  isComposedRow,
  listHeadingNotes,
  listSectionMarks,
  readSectionNumber,
  removeClearedUnits,
  splitCTable,
} from "@/lib/composed-model";
import { previewEdit, type PlaceEdit } from "@/lib/c-edit-model";
import { makeSectionOutline } from "@/lib/outline-fixture";
import { getPillWidth } from "@/lib/strip-pill-model";

function makeDoc(sections?: ComposedSection[]): ComposedDoc {
  return {
    target_doc_id: 7,
    code: "SOP-CF",
    title: "Synthetic",
    doc_type: "sop",
    entrance: "assign",
    sections: sections ?? [
      { ...makeSectionOutline(), location_key: "purpose", label: "Purpose", number: "1", na_reason: null, heading_note: "", items: [{ target_id: 1, kind: "sentence", lang: "ko", text: "목적", status: "confirmed", change_type: "as_is", number: "1.1", number_style: "numbered", indent_level: 0, meaning_key: null, source_unit_ids: [10] }] },
      { ...makeSectionOutline(), location_key: "scope", label: "Scope", number: "2", na_reason: "Synthetic", heading_note: "", items: [] },
      { ...makeSectionOutline({ kind: null }), location_key: "step:1:instruction", label: "Step 1 · Instruction", number: "1", na_reason: null, heading_note: "", items: [] },
    ],
  };
}

function makeSection(number: string, label: string, headingNote: string): ComposedSection {
  return { ...makeSectionOutline(), location_key: `slot:${number}`, label, number, na_reason: null, heading_note: headingNote, items: [] };
}

function makeItem(targetId: number, number: string | null, kind: ComposedItem["kind"] = "sentence"): ComposedItem {
  return { target_id: targetId, kind, lang: "en", text: `t${targetId}`, status: "confirmed", change_type: "as_is", number, number_style: number === null ? "omitted" : "numbered", indent_level: 0, meaning_key: null, source_unit_ids: [targetId] };
}

function makeCell(targetId: number, row: number, col: number, text: string, lang: BundleCell["lang"] = "ko"): BundleCell {
  return { target_id: targetId, row, col, lang, text, status: "confirmed", source_unit_ids: [] };
}

function makeSlot(locationKey: string, number: string | null, label: string, items: ComposedItem[]): ComposedSection {
  return { ...makeSectionOutline(), location_key: locationKey, label, number, na_reason: null, heading_note: "", items };
}

/** 줄마다 번호 칸 폭(키 = target id 글자) - 지난 getComposedLeadWidths 시험의 모양 그대로 */
function readWidths(doc: ComposedDoc): Map<string, number> {
  return new Map([...buildComposedStrips(doc).lines].map(([id, line]) => [String(id), line.width]));
}

function makeTarget(fields: Partial<GroupTarget>): GroupTarget {
  return {
    id: 50, target_doc_id: 7, slot_key: null, wi_step: null, wi_part: null, section_path: "", order_index: 0, lang: "en", kind: "sentence",
    confirmed_text: "", ai_text: "", change_type: "as_is", origin: "units", new_unit_id: null, translation_source_unit_id: null, parent_target_id: null,
    cell_row: null, cell_col: null, grid: null, status: "confirmed", hold_reason: "", remark: "", warnings: [], source_unit_ids: [20], group_id: null,
    revision: 1, indent_level: 0, ...fields,
  };
}

describe("groupTableCells", () => {
  it("stacks a translated cell in the same position instead of shifting the columns", () => {
    const table: BundleTable = { rows: 2, cols: 2, cells: [makeCell(1, 0, 0, "항목"), makeCell(5, 0, 0, "Item", "en"), makeCell(2, 0, 1, "값"), makeCell(4, 1, 1, "x")] };

    const grid = groupTableCells(table);

    expect(grid.map((cols) => cols.map((cells) => cells.map((cell) => cell.target_id)))).toEqual([
      [[1, 5], [2]],
      // 빈 자리는 빈 칸으로 남아 열이 맞는다
      [[], [4]],
    ]);
  });
});

describe("splitCTable", () => {
  it("takes caption children out of the grid and stacks a translated cell in its own position", () => {
    const item = (target_id: number, cell_row: number | null, cell_col: number | null): OutputCItem => ({
      target_id, kind: "sentence", lang: "ko", text: String(target_id), ai_text: "", change_type: null, status: "confirmed", source_note: "", source_count: 1,
      origin: "units", meaning_key: null, number: null, indent_level: 0, number_style: "numbered", cell_row, cell_col, children: [],
    });

    const { captions, grid } = splitCTable([item(1, null, null), item(2, 0, 0), item(3, 0, 0), item(4, 1, 1)]);

    expect(captions.map((caption) => caption.target_id)).toEqual([1]);
    expect(grid.map((cols) => cols.map((cells) => cells.map((cell) => cell.item.target_id)))).toEqual([
      [[2, 3], []],
      [[], [4]],
    ]);
  });
});

describe("buildComposedRows", () => {
  it("lists sentences in section order and one placeholder per empty section", () => {
    const rows = buildComposedRows(makeDoc());

    expect(rows.map(getNewRowKey)).toEqual(["t:1", "slot:scope", "slot:step:1:instruction"]);
    expect(rows[0]).toMatchObject({ section_path: "1. Purpose", doc_code: "SOP-CF", source_unit_ids: [10], lang: "ko" });
    expect(rows[1]).toMatchObject({ kind: "empty", section_path: "2. Scope", na: true, fixed: null, autoItems: [] });
  });

  it("marks the sections that take no sentences: a group is a heading only, the auto list carries the SOP's work instructions", () => {
    const section = (location_key: string, number: string | null, label: string, outline: Parameters<typeof makeSectionOutline>[0] = {}): ComposedSection => ({ ...makeSectionOutline(outline), location_key, label, number, na_reason: null, heading_note: "", items: [] });
    const wis = [{ code: "WI-CF-01", title: "Rotor change" }];
    const rows = buildComposedRows(makeDoc([
      section("general_requirements.safety", null, "General Requirements › Safety", { level: 1 }),
      section("document_relationships", "7", "Document Relationships", { kind: "group", counts_lines: false }),
      section("document_relationships.work_instructions", "7.2", "Document Relationships › Work Instructions", { kind: "auto_list", counts_lines: false, level: 1, auto_items: wis }),
    ]));

    // 범주는 번호 없이 이름만이 칸 머리 글이다
    expect(rows.map((row) => [row.section_path, row.kind === "empty" ? row.fixed : "", row.kind === "empty" ? row.autoItems : []])).toEqual([
      ["General Requirements › Safety", null, []],
      ["7. Document Relationships", "group", []],
      ["7.2. Document Relationships › Work Instructions", "auto", wis],
    ]);
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

  it("carries a table's cells and a figure's image block onto the row", () => {
    const table: BundleTable = { rows: 1, cols: 2, cells: [makeCell(11, 0, 0, "a"), makeCell(12, 0, 1, "b")] };
    const figure = { document_id: 3, block_id: 30 };
    const doc = makeDoc([
      makeSlot("5.1", "5.1", "Procedure", [{ ...makeItem(1, "5.1.1", "table"), table }, { ...makeItem(2, "5.1.2", "figure"), figure, caption: "그림 2. 로터" }, makeItem(3, "5.1.3")]),
    ]);

    const rows = buildComposedRows(doc);

    // 캡션 글도 줄에 싣는다 - 없으면 null(New 칸이 쓰지 않은 문서에서 "Caption needed"를 보인다)
    expect(rows[0]).toMatchObject({ kind: "table", table, figure: null, caption: null });
    expect(rows[1]).toMatchObject({ kind: "figure", table: null, figure, caption: "그림 2. 로터" });
    expect(rows[2]).toMatchObject({ table: null, figure: null });
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

describe("buildComposedStrips", () => {
  it("sizes each row by the depth of its own number", () => {
    const doc = makeDoc([makeSlot("5", "5", "Responsibilities", [makeItem(1, "5.1")]), makeSlot("5.1", "5.1", "Procedure", [makeItem(2, "5.1.1"), makeItem(3, "5.1.1.1")])]);

    const widths = readWidths(doc);

    expect([...widths.entries()]).toEqual([["1", getPillWidth(2)], ["2", getPillWidth(3)], ["3", getPillWidth(4)]]);
  });

  it("widens a depth so its longest number is not clipped, for every row of that depth", () => {
    const doc = makeDoc([makeSlot("step:12:instruction", "12", "Step 12 · Instruction", [makeItem(1, "12.1"), makeItem(2, "12.13")])]);

    const widths = readWidths(doc);

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

    const widths = readWidths(doc);

    expect(widths.get("3")).toBe(getPillWidth(3));
    expect(widths.get("6")).toBe(getPillWidth(4));
    expect(widths.get("7")).toBe(getPillWidth(1));
  });

  it("heads an appendix with its label alone, and still sizes its lines under the appendix number", () => {
    // 부록은 이름에 번호가 들어 있어 머리에 번호를 따로 적지 않는다(shows_number false) - 줄 번호의 머리는 그대로 number "2"다
    const appendix: ComposedSection = { ...makeSlot("appendices.a2", "2", "Appendix 2. Alarm list", [makeItem(1, null), makeItem(2, "2.1")]), shows_number: false, heading_note: "← OLD-1 §9" };
    const doc = makeDoc([makeSlot("scope", "2", "Scope", [makeItem(3, null)]), appendix]);

    const rows = buildComposedRows(doc);

    expect(rows.map((row) => row.section_path)).toEqual(["2. Scope", "Appendix 2. Alarm list", "Appendix 2. Alarm list"]);
    expect(listHeadingNotes(doc).get("Appendix 2. Alarm list")).toBe("← OLD-1 §9");
    // 칸을 여는 번호 없는 줄은 그 칸 첫 깊이(2.1의 깊이)의 폭 - 머리 글에서 번호를 읽었다면 1단 폭이 된다
    expect(readWidths(doc).get("1")).toBe(getPillWidth(2));
    expect(readWidths(doc).get("2")).toBe(getPillWidth(2));
  });

  it("makes each slot head a heading box: the slot number in the number cell at that depth's width, the label in the box", () => {
    const appendix: ComposedSection = { ...makeSlot("appendices.a2", "2", "Appendix 2. Alarm list", []), shows_number: false };
    const doc = makeDoc([makeSlot("5.1", "5.1", "Procedure", [makeItem(1, "5.1.1")]), makeSlot("general_requirements.safety", null, "General Requirements › Safety", []), appendix]);

    const { heads } = buildComposedStrips(doc);

    expect(heads.get("5.1. Procedure")).toEqual({ sectionKey: "5.1", number: "5.1", label: "Procedure", width: getPillWidth(2), openWidth: getPillWidth(3) });
    // 번호 없는 범주는 빈 번호 칸, 부록은 이름에 번호가 있어 번호 칸을 비운다
    expect(heads.get("General Requirements › Safety")).toMatchObject({ number: null, width: getPillWidth(1), openWidth: getPillWidth(1) });
    expect(heads.get("Appendix 2. Alarm list")).toMatchObject({ number: null, label: "Appendix 2. Alarm list", width: getPillWidth(1), openWidth: getPillWidth(2) });
  });

  it("joins neighbouring sentences of one meaning into one pair card, but not across a table or another meaning", () => {
    const pair = (targetId: number, key: string | null, kind: ComposedItem["kind"] = "sentence"): ComposedItem => ({ ...makeItem(targetId, null, kind), meaning_key: key });
    const doc = makeDoc([makeSlot("5.1", "5.1", "Procedure", [pair(1, "m1"), pair(2, "m1"), pair(3, "m2"), pair(4, "m2", "table"), pair(5, "m2"), pair(6, null), pair(7, null)])]);

    const { lines } = buildComposedStrips(doc);

    expect([1, 2, 3, 4, 5, 6, 7].map((id) => lines.get(id)?.pairGroup)).toEqual([1, 1, null, null, null, null, null]);
  });

  it("shows a bullet line's symbol by its pressed depth and indents it one step past the nearest numbered line", () => {
    const bullet = (targetId: number, indent: number): ComposedItem => ({ ...makeItem(targetId, null), number_style: "bullet", indent_level: indent });
    const doc = makeDoc([makeSlot("5.1", "5.1", "Procedure", [makeItem(1, "5.1.1"), bullet(2, 0), bullet(3, 1), bullet(4, 2)])]);

    const { lines } = buildComposedStrips(doc);

    expect([2, 3, 4].map((id) => lines.get(id)?.mark)).toEqual(["•", "○", "▪"]);
    // 5.1.1은 깊이 3 - • 4, ○ 5, ▪ 6
    expect([2, 3, 4].map((id) => lines.get(id)?.width)).toEqual([getPillWidth(4), getPillWidth(5), getPillWidth(6)]);
    expect(lines.get(1)).toMatchObject({ mark: "5.1.1", style: "numbered", depth: 0, canNumber: true, canDepth: true });
  });

  it("locks the depth of an AI translation and the numbered style of a slot that does not count lines", () => {
    const doc = makeDoc([makeSlot("5.1", "5.1", "Procedure", [{ ...makeItem(1, null), change_type: "translated" }]), { ...makeSlot("7", "7", "Relationships", [makeItem(2, null)]), counts_lines: false }]);

    const { lines } = buildComposedStrips(doc);

    expect(lines.get(1)).toMatchObject({ canDepth: false, canNumber: true });
    expect(lines.get(2)).toMatchObject({ canDepth: true, canNumber: false });
  });
});

describe("toOutputCDoc · applyCOrder · isSameCOrder", () => {
  it("lays a C-shaped order, depth and style over the composed doc, keeping lines the shape does not know at the end of their slot", () => {
    const doc = makeDoc([makeSlot("5.1", "5.1", "Procedure", [makeItem(1, "5.1.1"), makeItem(2, "5.1.2"), makeItem(9, null)]), makeSlot("5.2", "5.2", "Records", [])]);
    const shape = toOutputCDoc(doc);
    // 2를 5.2로 옮기고 1을 글머리 기호로 - 9는 shape에 없는(그새 들어온) 줄
    shape.sections[0].items = [{ ...shape.sections[0].items[0], number: null, number_style: "bullet" }];
    shape.sections[1].items = [{ ...toOutputCDoc(doc).sections[0].items[1], number: "5.2.1" }];

    const next = applyCOrder(doc, shape);

    expect(next.sections.map((section) => section.items.map((item) => [item.target_id, item.number, item.number_style]))).toEqual([
      [[1, null, "bullet"], [9, null, "omitted"]],
      [[2, "5.2.1", "numbered"]],
    ]);
    expect(next.sections[1].items[0].source_unit_ids).toEqual([2]);
  });

  it("reads a translation as a translation origin and compares only the lines both docs share", () => {
    const doc = makeDoc([makeSlot("5.1", "5.1", "Procedure", [makeItem(1, "5.1.1"), { ...makeItem(2, "5.1.2"), change_type: "translated" }])]);
    const withNew = makeDoc([makeSlot("5.1", "5.1", "Procedure", [makeItem(1, "5.1.1"), makeItem(3, null), { ...makeItem(2, "5.1.2"), change_type: "translated" }])]);
    const swapped = makeDoc([makeSlot("5.1", "5.1", "Procedure", [{ ...makeItem(2, "5.1.2"), change_type: "translated" }, makeItem(1, "5.1.1")])]);

    expect(toOutputCDoc(doc).sections[0].items.map((item) => item.origin)).toEqual(["units", "translation"]);
    expect(isSameCOrder(toOutputCDoc(doc), toOutputCDoc(withNew))).toBe(true);
    expect(isSameCOrder(toOutputCDoc(doc), toOutputCDoc(swapped))).toBe(false);
  });
});

describe("buildPlaceUndo", () => {
  it("puts a line moved inside its slot back before its old next line at its old depth", () => {
    const before = toOutputCDoc(makeDoc([makeSlot("5.1", "5.1", "Procedure", [makeItem(1, "5.1.1"), makeItem(2, "5.1.2"), makeItem(3, "5.1.3")])]));
    const edit: PlaceEdit = { kind: "place", locationKey: "5.1", targetIds: [1], beforeId: null, depths: [1] };
    const after = previewEdit(before, edit)!;

    const undo = buildPlaceUndo(before, after, edit);

    expect(undo).toEqual([{ kind: "place", locationKey: "5.1", targetIds: [1], beforeId: 2, depths: [0] }]);
    expect(previewEdit(after, undo[0])!.sections[0].items.map((item) => [item.target_id, item.indent_level])).toEqual([[1, 0], [2, 0], [3, 0]]);
  });

  it("brings a line moved to another slot back to its slot, last when it was last, and restores the style the move changed", () => {
    const procedure = makeSlot("5.1", "5.1", "Procedure", [makeItem(1, "5.1.1"), { ...makeItem(2, null), number_style: "bullet" }]);
    const records = { ...makeSlot("5.2", "5.2", "Records", [makeItem(3, "5.2.1")]), default_style: "numbered" as const };
    const before = toOutputCDoc(makeDoc([procedure, records]));
    const edit: PlaceEdit = { kind: "place", locationKey: "5.1", toLocationKey: "5.2", targetIds: [2], beforeId: 3, depths: [0] };
    const after = previewEdit(before, edit)!;

    const undo = buildPlaceUndo(before, after, edit);

    expect(after.sections[1].items[0].number_style).toBe("numbered");
    expect(undo).toEqual([
      { kind: "place", locationKey: "5.2", toLocationKey: "5.1", targetIds: [2], beforeId: null, depths: [0] },
      { kind: "style", targetId: 2, style: "bullet" },
    ]);
    const restored = undo.reduce((doc, step) => previewEdit(doc, step)!, after);
    expect(restored.sections.map((section) => section.items.map((item) => [item.target_id, item.number_style]))).toEqual([[[1, "numbered"], [2, "bullet"]], [[3, "numbered"]]]);
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

describe("listSectionMarks", () => {
  it("lists only sections that differ from the standard or are empty but required, by the section path the rows use", () => {
    const doc = makeDoc([
      { ...makeSection("1", "Aim", ""), deviation_reason: "House style" },
      { ...makeSection("2", "Scope", ""), is_empty_required: true },
      makeSection("3", "Definitions", ""),
    ]);

    expect(listSectionMarks(doc)).toEqual(
      new Map([
        ["1. Aim", { deviationReason: "House style", isEmptyRequired: false }],
        ["2. Scope", { deviationReason: null, isEmptyRequired: true }],
      ]),
    );
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

describe("applySavedTargets at a drop place", () => {
  it("puts the saved sentences at the dropped place, in their saved order, instead of at the end", () => {
    const doc = makeDoc([makeSlot("purpose", "1", "Purpose", [makeItem(1, "1.1"), makeItem(2, "1.2")])]);
    const saved = [makeTarget({ id: 50, slot_key: "purpose", order_index: 3 }), makeTarget({ id: 51, slot_key: "purpose", order_index: 2 })];
    const ids = (at: { sectionKey: string; after: number | null }) => applySavedTargets(doc, saved, () => "", at).sections[0].items.map((item) => item.target_id);
    expect(ids({ sectionKey: "purpose", after: 1 })).toEqual([1, 51, 50, 2]);
    expect(ids({ sectionKey: "purpose", after: null })).toEqual([51, 50, 1, 2]);
    expect(ids({ sectionKey: "purpose", after: 99 })).toEqual([1, 2, 50, 51]);   // 자리의 문장이 없으면 지금처럼 끝에, 받은 순서로
  });
});
