// New 목록 칸 상태 모델 - 일곱 상태의 순서, N/A를 둘 수 있는 칸, 요약, 쓴 사유, 사유 편집기 하나.
import { describe, expect, it } from "vitest";

import type { SlotCount, TargetDoc, ToBe } from "./api-sop";
import { makeDeepOutline, makeOutline, makeTemplateOutline, TEMPLATE_KEYS } from "./outline-fixture";
import { buildSlotRows, canSubmitSlotEdit, canUndoRestore, countDeviations, formatSlotName, isNaEditDirty, listUsedReasons, openNaEdit, splitSlotColumns, summarizeSlots, type NaEdit } from "./slot-status-model";

function makeDoc(patch: Partial<TargetDoc> = {}): TargetDoc {
  return { id: 12, code: "SOP-CF", title: "", doc_type: "sop", parent_code: null, entrance: "assign", is_equipment_sop: true, order_index: 1, document_id: null, ref_parent_codes: [], ...patch };
}

function makeCount(slot_key: string, count: number, heading_count: number, target_doc_id = 12): SlotCount {
  return { target_doc_id, slot_key, count, heading_count };
}

const ASSOCIATED = "document_relationships.associated_documents";

const sop = makeDoc();
const tobe: ToBe = {
  revision: 1,
  docs: [sop],
  na_slots: [
    { code: "SOP-CF", slot_key: "attachments", reason: "r1" },
    { code: "SOP-CF", slot_key: ASSOCIATED, reason: "r2" },
    { code: "SOP-CF", slot_key: `${ASSOCIATED}.form`, reason: "own" },
  ],
  wi_steps: [],
  outline_items: makeTemplateOutline("SOP-CF"),
  outline_suggestions: {},
  slot_counts: [
    makeCount("purpose", 2, 0),
    makeCount("scope", 0, 1),
    makeCount("general_requirements.safety", 3, 0),
    makeCount("procedures.p1", 6, 0),
    makeCount("document_relationships.references", 1, 0),
    makeCount("purpose", 9, 9, 99),
    makeCount("procedures.nope", 4, 4),
  ],
};

describe("buildSlotRows", () => {
  it("reads the states in order, top state first", () => {
    expect(buildSlotRows(tobe, sop).map((row) => [row.number, row.state.kind])).toEqual([
      ["1", "filled"], ["2", "empty"], ["3", "empty"], ["4", "empty"], ["5", "sub"], ["", "filled"], ["", "empty"],
      ["6", "sub"], ["6.1", "filled"],
      ["7", "sub"], ["7.1", "na"], ["", "na"], ["", "covered"], ["", "covered"], ["", "covered"], ["7.2", "auto"], ["7.3", "filled"],
      ["8", "na"], ["9", "empty"], ["", "empty"],
    ]);
  });

  it("counts a parent by its sub-sections and keeps a sub-section's own N/A under an N/A parent", () => {
    const rows = new Map(buildSlotRows(tobe, sop).map((row) => [row.key, row]));
    expect(rows.get("general_requirements")?.state).toEqual({ kind: "sub", count: 3 });
    expect(rows.get(`${ASSOCIATED}.visual_aid`)?.state).toEqual({ kind: "covered", by: ASSOCIATED });
    expect(rows.get(`${ASSOCIATED}.form`)?.state).toEqual({ kind: "na", reason: "own" });
  });

  it("offers Mark N/A on empty sections only, and not where an Old heading is linked", () => {
    expect(buildSlotRows(tobe, sop).filter((row) => row.canMarkNa).map((row) => row.key)).toEqual(["definitions", "responsibilities", "general_requirements.work", "appendices", "appendices.a1"]);
    expect(buildSlotRows(tobe, sop).filter((row) => row.headingLinked).map((row) => row.key)).toEqual(["scope"]);
  });

  it("blocks a parent whose sub-section has only a linked heading", () => {
    const linked = { ...tobe, na_slots: [], slot_counts: [makeCount("procedures.p1", 0, 1)] };
    const rows = new Map(buildSlotRows(linked, sop).map((row) => [row.key, row]));
    expect(rows.get("procedures")).toMatchObject({ headingLinked: true, canMarkNa: false, state: { kind: "empty" } });
    expect(rows.get("procedures.p1")).toMatchObject({ headingLinked: true, canMarkNa: false, state: { kind: "empty" } });
  });

  it("reads an equipment SOP like any other SOP", () => {
    const plain = makeDoc({ is_equipment_sop: false });
    expect(buildSlotRows({ ...tobe, docs: [plain] }, plain)).toEqual(buildSlotRows(tobe, sop));
  });

  it("reads a written SOP without counts", () => {
    const written = makeDoc({ entrance: "match", document_id: 5 });
    const rows = buildSlotRows({ ...tobe, docs: [written], na_slots: [] }, written);
    expect(rows.some((row) => row.headingLinked || row.state.kind === "filled" || row.state.kind === "sub")).toBe(false);
    expect(summarizeSlots(rows)).toEqual({ filled: 0, empty: 17, na: 0, total: 17 });
  });

  it("treats a missing or unknown count as empty", () => {
    const noCounts = { ...tobe, slot_counts: undefined };
    const unknownOnly = { ...tobe, slot_counts: [makeCount("procedures.nope", 4, 4)] };
    for (const response of [noCounts, unknownOnly]) {
      const rows = buildSlotRows(response, sop);
      expect(rows).toHaveLength(20);
      expect(summarizeSlots(rows)).toEqual({ filled: 0, empty: 12, na: 6, total: 17 });
    }
  });
});

describe("sections that take no sentences", () => {
  const empty: ToBe = { ...tobe, na_slots: [], slot_counts: [] };
  const rowsOf = (response: ToBe) => new Map(buildSlotRows(response, sop).map((row) => [row.key, row]));

  it("marks group and auto-list items as not assignable", () => {
    expect(buildSlotRows(empty, sop).filter((row) => !row.isAssignable).map((row) => row.key)).toEqual(["document_relationships", ASSOCIATED, "document_relationships.work_instructions"]);
  });

  it("shows nothing on a group with no sentences below, and the roll-up when there are", () => {
    expect(rowsOf(empty).get("document_relationships")).toMatchObject({ state: { kind: "group" }, canMarkNa: true, headingLinked: false });
    expect(rowsOf(empty).get(ASSOCIATED)?.state).toEqual({ kind: "group" });

    // 두 수준 아래(7.1.x)의 문장도 7과 7.1에 모인다
    const filled = rowsOf({ ...empty, slot_counts: [makeCount(`${ASSOCIATED}.form`, 2, 0)] });
    expect(filled.get("document_relationships")).toMatchObject({ state: { kind: "sub", count: 2 }, canMarkNa: false });
    expect(filled.get(ASSOCIATED)?.state).toEqual({ kind: "sub", count: 2 });
  });

  it("blocks N/A on a group whose sub-section title has an Old heading linked", () => {
    const linked = rowsOf({ ...empty, slot_counts: [makeCount("document_relationships.references", 0, 1)] });
    expect(linked.get("document_relationships")).toMatchObject({ state: { kind: "group" }, headingLinked: true, canMarkNa: false });
    expect(linked.get(ASSOCIATED)).toMatchObject({ headingLinked: false, canMarkNa: true });
  });

  it("never offers Mark N/A on the auto list, and covers it under an N/A parent", () => {
    expect(rowsOf(empty).get("document_relationships.work_instructions")).toMatchObject({ state: { kind: "auto" }, canMarkNa: false, headingLinked: false });
    const covered = rowsOf({ ...empty, na_slots: [{ code: "SOP-CF", slot_key: "document_relationships", reason: "r" }] });
    expect(covered.get("document_relationships.work_instructions")?.state).toEqual({ kind: "covered", by: "document_relationships" });
  });
});

describe("summarizeSlots", () => {
  it("counts filled, empty and total over the sections that take sentences, and N/A over every row marked N/A", () => {
    // 7(묶음)은 하위에 문장이 있어도 채운 칸으로 세지 않고, 7.1(묶음)의 N/A는 N/A 수에 든다
    expect(summarizeSlots(buildSlotRows(tobe, sop))).toEqual({ filled: 6, empty: 6, na: 6, total: 17 });
  });

  it("counts neither an empty group nor the auto list as empty", () => {
    expect(summarizeSlots(buildSlotRows({ ...tobe, na_slots: [], slot_counts: [] }, sop))).toEqual({ filled: 0, empty: 17, na: 0, total: 17 });
  });
});

describe("formatSlotName", () => {
  it("joins the number and the name, and leaves no stray space when there is no number", () => {
    const names = Object.fromEntries(buildSlotRows(tobe, sop).map((row) => [row.key, formatSlotName(row)]));
    expect(names["document_relationships.references"]).toBe("7.3 References");
    expect(names["general_requirements.safety"]).toBe("Safety");
    expect(formatSlotName({ number: "", label: "Form" })).toBe("Form");
  });

  it("names an appendix by its label alone, which already carries the number", () => {
    // 서버는 부록에 number "1"을 주되 shows_number를 끈다 - 번호 칸은 비우고 이름은 "Appendix 1. …"이다("1 Appendix 1. …"이 아니다)
    const appendix = buildSlotRows(tobe, sop).find((row) => row.key === "appendices.a1");
    expect(appendix).toMatchObject({ number: "", label: "Appendix 1. Alarm list" });
    expect(appendix && formatSlotName(appendix)).toBe("Appendix 1. Alarm list");
    // 같은 번호라도 번호를 적는 항목이면 번호 칸에 적고 이름은 그 항목의 것만이다
    const shown = makeTemplateOutline("SOP-CF", { "appendices.a1": { shows_number: true } });
    expect(buildSlotRows({ ...tobe, outline_items: shown }, sop).find((row) => row.key === "appendices.a1")).toMatchObject({ number: "1", label: "Alarm list" });
  });
});

describe("rows from the document's outline", () => {
  it("takes the order, number, name and level from the outline items of that document", () => {
    const rows = buildSlotRows(tobe, sop);
    expect(rows.map((row) => row.key)).toEqual(TEMPLATE_KEYS);
    // 범주와 비어 있는 선택 항목은 번호가 없고, 부록은 번호를 이름에 싣는다(번호 칸은 비운다)
    expect(rows.map((row) => row.number)).toEqual(["1", "2", "3", "4", "5", "", "", "6", "6.1", "7", "7.1", "", "", "", "", "7.2", "7.3", "8", "9", ""]);
    expect(rows.map((row) => row.level)).toEqual([0, 0, 0, 0, 0, 1, 1, 0, 1, 0, 1, 2, 2, 2, 2, 1, 1, 0, 0, 1]);
    // 이름은 그 항목의 것만 - 조상 이름을 붙인 label("General Requirements › Safety")이 아니다
    expect(rows.slice(4, 7).map((row) => row.label)).toEqual(["General Requirements", "Safety", "Work"]);
  });

  it("numbers the optional items that the server numbered", () => {
    const outline = makeTemplateOutline("SOP-CF", { [`${ASSOCIATED}.visual_aid`]: { number: "7.1.1" } });
    const row = buildSlotRows({ ...tobe, outline_items: outline }, sop).find((item) => item.key === `${ASSOCIATED}.visual_aid`);
    expect(row).toMatchObject({ number: "7.1.1", level: 2 });
  });

  it("leaves out removed items and the items of another document", () => {
    const other = makeTemplateOutline("SOP-XX", { purpose: { title_en: "Other" } });
    const removed = makeTemplateOutline("SOP-CF", { "procedures.p1": { is_removed: true } });
    const rows = buildSlotRows({ ...tobe, outline_items: [...other, ...removed] }, sop);
    expect(rows).toHaveLength(19);
    expect(rows.some((row) => row.key === "procedures.p1" || row.label === "Other")).toBe(false);
  });

  it("keeps a removed standard item in its place with no number, marked as differing when it was required", () => {
    const outline = makeTemplateOutline("SOP-CF", {
      definitions: { is_removed: true, number: null, is_assignable: false, is_deviation: true, deviation_reason: "No terms" },
      purpose: { is_deviation: true, deviation_reason: "Renamed" },
    });
    const rows = buildSlotRows({ ...tobe, outline_items: outline }, sop);
    const removed = rows.find((row) => row.key === "definitions");
    expect(removed).toMatchObject({ number: "", state: { kind: "removed" }, canMarkNa: false, canRemove: false, isDeviation: true, deviationReason: "No terms" });
    expect(summarizeSlots(rows).total).toBe(summarizeSlots(buildSlotRows(tobe, sop)).total - 1);
    expect(countDeviations(rows)).toBe(2);
  });

  it("offers remove only where no sentence or section title sits, and adding only under a group", () => {
    const rows = buildSlotRows(tobe, sop);
    const byKey = new Map(rows.map((row) => [row.key, row]));
    // 문장 · 칸 제목이 있는 칸(자기나 하위)은 뺄 수 없다
    expect([byKey.get("purpose")?.canRemove, byKey.get("scope")?.canRemove, byKey.get("procedures")?.canRemove]).toEqual([false, false, false]);
    expect(byKey.get("definitions")?.canRemove).toBe(true);
    // 선언 항목은 선언 목록이 고친다
    expect(byKey.get("procedures.p1")?.origin).toBe("declared");
    expect([byKey.get("document_relationships")?.canAddChild, byKey.get("purpose")?.canAddChild]).toEqual([true, false]);
    // 이미 쓴 SOP는 골격을 고치지 않는다
    const written = buildSlotRows(tobe, makeDoc({ entrance: "match" }));
    expect(written.some((row) => row.canRemove || row.canAddChild)).toBe(false);
  });

  it("has no rows for a document without an outline", () => {
    expect(buildSlotRows({ ...tobe, outline_items: [] }, sop)).toEqual([]);
  });
});

describe("a three-level outline", () => {
  const deep: ToBe = { ...tobe, na_slots: [], slot_counts: [], outline_items: makeDeepOutline("SOP-CF") };
  const statesOf = (response: ToBe) => Object.fromEntries(buildSlotRows(response, sop).map((row) => [row.key, row.state]));

  it("reads level 2 and numbers it under its parent", () => {
    expect(buildSlotRows(deep, sop).map((row) => [row.key, row.number, row.level])).toEqual([["a", "1", 0], ["a.b", "1.1", 1], ["a.b.c", "1.1.1", 2], ["z", "2", 0]]);
  });

  it("covers every level under an N/A ancestor, naming the nearest N/A one", () => {
    const top = statesOf({ ...deep, na_slots: [{ code: "SOP-CF", slot_key: "a", reason: "r" }] });
    expect(top["a.b"]).toEqual({ kind: "covered", by: "a" });
    expect(top["a.b.c"]).toEqual({ kind: "covered", by: "a" });
    expect(top.z).toEqual({ kind: "empty" });

    const both = statesOf({ ...deep, na_slots: [{ code: "SOP-CF", slot_key: "a", reason: "r" }, { code: "SOP-CF", slot_key: "a.b", reason: "mid" }] });
    expect(both["a.b"]).toEqual({ kind: "na", reason: "mid" });
    expect(both["a.b.c"]).toEqual({ kind: "covered", by: "a.b" });

    const mid = statesOf({ ...deep, na_slots: [{ code: "SOP-CF", slot_key: "a.b", reason: "mid" }] });
    expect(mid.a).toEqual({ kind: "empty" });
    expect(mid["a.b.c"]).toEqual({ kind: "covered", by: "a.b" });
  });

  it("counts everything below a section, not only its direct sub-sections", () => {
    const filled = statesOf({ ...deep, slot_counts: [makeCount("a.b.c", 2, 0)] });
    expect(filled.a).toEqual({ kind: "sub", count: 2 });
    expect(filled["a.b"]).toEqual({ kind: "sub", count: 2 });
    expect(filled["a.b.c"]).toEqual({ kind: "filled", count: 2 });

    // 두 수준 아래의 칸 제목 연결도 맨 위 칸의 N/A를 막는다
    const linked = new Map(buildSlotRows({ ...deep, slot_counts: [makeCount("a.b.c", 0, 1)] }, sop).map((row) => [row.key, row]));
    expect(linked.get("a")).toMatchObject({ headingLinked: true, canMarkNa: false });
    expect(linked.get("z")).toMatchObject({ headingLinked: false, canMarkNa: true });
  });
});

describe("splitSlotColumns", () => {
  const keysOf = (response: ToBe) => splitSlotColumns(buildSlotRows(response, sop)).map((column) => column.map((row) => row.key));

  it("splits the template's nine chapters before Procedures, chapters 1-5 and 6-9", () => {
    const [left, right] = keysOf(tobe);
    expect(left.at(-1)).toBe("general_requirements.work");
    expect(right[0]).toBe("procedures");
    expect(right.at(-1)).toBe("appendices.a1");
    expect([...left, ...right]).toEqual(TEMPLATE_KEYS);
  });

  it("splits before the top-level section nearest the middle when there is no Procedures, keeping sub-sections with their parent", () => {
    // 줄 7개의 가운데(3.5)에 가까운 최상위 칸은 c(자리 4) - b의 하위 칸은 b와 같은 단에 남는다
    const outline = makeOutline("SOP-CF", [["a", "A"], ["b", "B"], ["b.x", "X"], ["b.y", "Y"], ["c", "C"], ["c.x", "X"], ["d", "D"]]);
    expect(keysOf({ ...tobe, outline_items: outline })).toEqual([["a", "b", "b.x", "b.y"], ["c", "c.x", "d"]]);
    // 같은 거리면 뒤쪽 - 왼쪽 단이 길다
    const five = makeOutline("SOP-CF", [["a", "A"], ["b", "B"], ["c", "C"], ["d", "D"], ["e", "E"]]);
    expect(keysOf({ ...tobe, outline_items: five })).toEqual([["a", "b", "c"], ["d", "e"]]);
  });

  it("never splits inside a section, however deep", () => {
    expect(keysOf({ ...tobe, outline_items: makeDeepOutline("SOP-CF") })).toEqual([["a", "a.b", "a.b.c"], ["z"]]);
    // 최상위 칸이 하나면 가를 곳이 없다 - 오른쪽 단이 빈다
    const single = makeOutline("SOP-CF", [["a", "A"], ["a.b", "B"], ["a.b.c", "C"]]);
    expect(keysOf({ ...tobe, outline_items: single })).toEqual([["a", "a.b", "a.b.c"], []]);
    expect(splitSlotColumns([])).toEqual([[], []]);
  });

  it("does not treat a sub-section named procedures as the split point", () => {
    const outline = makeOutline("SOP-CF", [["a", "A"], ["a.procedures", "P"], ["b", "B"], ["c", "C"]]);
    expect(keysOf({ ...tobe, outline_items: outline })).toEqual([["a", "a.procedures"], ["b", "c"]]);
  });
});

describe("listUsedReasons", () => {
  function withReasons(reasons: string[]): ToBe {
    return { ...tobe, na_slots: reasons.map((reason, index) => ({ code: "SOP-CF", slot_key: TEMPLATE_KEYS[index], reason })) };
  }

  it("lists the reasons used most, one per text", () => {
    const used = withReasons(["A", " A ", "B", "C", "C", "C", "D"]);
    expect(listUsedReasons(used)).toEqual(["C", "A", "B"]);
    expect(listUsedReasons(used, 1)).toEqual(["C"]);
    expect(listUsedReasons({ ...tobe, na_slots: [] })).toEqual([]);
  });
});

describe("the one N/A editor", () => {
  const target = { docKey: "SOP-CF", slotKey: "scope" as const, saved: "r1" };

  it("keeps one editor", () => {
    expect(openNaEdit(null, target)).toEqual({ ...target, text: "r1", refused: false });

    const typing: NaEdit = { docKey: "SOP-CF", slotKey: "purpose", text: "x", saved: "", refused: false };
    expect(openNaEdit(typing, target)).toEqual({ ...typing, refused: true });

    const blank: NaEdit = { ...typing, text: " " };
    expect(openNaEdit(blank, target)).toEqual({ ...target, text: "r1", refused: false });

    expect(openNaEdit({ ...typing, refused: true }, { docKey: "SOP-CF", slotKey: "purpose", saved: "" })).toEqual({ ...typing, refused: false });
    expect(isNaEditDirty({ ...typing, text: " r1 ", saved: "r1" })).toBe(false);
    expect(isNaEditDirty(null)).toBe(false);
  });
});

describe("outline editors", () => {
  const base = { docKey: "id-12", slotKey: "purpose", saved: "" };

  it("treats another kind of edit on the same section as another editor", () => {
    const na = openNaEdit(null, base);
    const rename = openNaEdit(na, { ...base, mode: "rename", savedTitle: "Purpose" });
    expect(rename).toMatchObject({ mode: "rename", title: "Purpose", savedTitle: "Purpose", text: "" });
    // 적던 이름이 있으면 다른 일로 옮기지 않는다
    const typed = { ...rename, title: "Aim" };
    expect(isNaEditDirty(typed)).toBe(true);
    expect(openNaEdit(typed, { ...base, mode: "remove" })).toMatchObject({ mode: "rename", refused: true });
  });

  it("needs a reason to remove or add, and only a title to rename", () => {
    const make = (patch: Partial<NaEdit>): NaEdit => ({ ...base, text: "", refused: false, ...patch });
    expect(canSubmitSlotEdit(make({ mode: "remove" }))).toBe(false);
    expect(canSubmitSlotEdit(make({ mode: "remove", text: "No terms" }))).toBe(true);
    expect(canSubmitSlotEdit(make({ mode: "rename", title: "Aim" }))).toBe(true);
    expect(canSubmitSlotEdit(make({ mode: "rename", title: " " }))).toBe(false);
    expect(canSubmitSlotEdit(make({ mode: "add", title: "Glossary" }))).toBe(false);
    expect(canSubmitSlotEdit(make({ mode: "add", title: "Glossary", text: "Long list" }))).toBe(true);
    expect(canSubmitSlotEdit(make({ text: "N/A reason" }))).toBe(true);
  });
});

describe("canUndoRestore", () => {
  const restored: ToBe = { revision: 1, docs: [makeDoc({ id: 1 })], na_slots: [{ code: "SOP-CF", slot_key: "document_relationships", reason: "r" }], wi_steps: [], outline_items: [], outline_suggestions: {} };
  it("undoes only while the row is still an SOP and the slot has no N/A saved", () => {
    expect(canUndoRestore(restored, 1, "scope")).toBe(true);
    // 상위 칸만 N/A인 하위 칸 - 그 칸 자체에는 저장된 N/A가 없다
    expect(canUndoRestore(restored, 1, "document_relationships.references")).toBe(true);
  });
  it("leaves it alone after the slot is N/A again, the row is gone or became a WI", () => {
    expect(canUndoRestore({ ...restored, na_slots: [...restored.na_slots, { code: "SOP-CF", slot_key: "scope", reason: "again" }] }, 1, "scope")).toBe(false);
    expect(canUndoRestore(restored, 2, "scope")).toBe(false);
    expect(canUndoRestore({ ...restored, docs: [makeDoc({ id: 1, doc_type: "wi", parent_code: "SOP-X" })] }, 1, "scope")).toBe(false);
  });
});
