// New 목록 칸 상태 모델 - 여섯 상태의 순서, N/A를 둘 수 있는 칸, 요약, 쓴 사유, 사유 편집기 하나.
import { describe, expect, it } from "vitest";

import type { SlotCount, TargetDoc, ToBe } from "./api-sop";
import { LEGACY_KEYS, makeDeepOutline, makeLegacyOutline, makeOutline } from "./outline-fixture";
import { buildSlotRows, canUndoRestore, isNaEditDirty, listUsedReasons, openNaEdit, splitSlotColumns, summarizeSlots, type NaEdit } from "./slot-status-model";

function makeDoc(patch: Partial<TargetDoc> = {}): TargetDoc {
  return { id: 12, code: "SOP-CF", title: "", doc_type: "sop", parent_code: null, entrance: "assign", is_equipment_sop: true, order_index: 1, document_id: null, ...patch };
}

function makeCount(slot_key: string, count: number, heading_count: number, target_doc_id = 12): SlotCount {
  return { target_doc_id, slot_key, count, heading_count };
}

const sop = makeDoc();
const tobe: ToBe = {
  revision: 1,
  docs: [sop],
  na_slots: [
    { code: "SOP-CF", slot_key: "procedures.troubleshooting", reason: "r1" },
    { code: "SOP-CF", slot_key: "document_relationships", reason: "r2" },
    { code: "SOP-CF", slot_key: "document_relationships.appendices", reason: "own" },
  ],
  wi_steps: [],
  outline_items: makeLegacyOutline("SOP-CF"),
  slot_counts: [
    makeCount("purpose", 2, 0),
    makeCount("scope", 0, 1),
    makeCount("general_requirements.safety", 3, 0),
    makeCount("procedures.procedure", 6, 0),
    makeCount("purpose", 9, 9, 99),
    makeCount("procedures.nope", 4, 4),
  ],
};

describe("buildSlotRows", () => {
  it("reads the six states in order, top state first", () => {
    expect(buildSlotRows(tobe, sop).map((row) => [row.number, row.state.kind])).toEqual([
      ["1", "filled"], ["2", "empty"], ["3", "empty"], ["4", "empty"], ["5", "sub"], ["5.1", "filled"], ["5.2", "empty"],
      ["6", "sub"], ["6.1", "filled"], ["6.2", "decide"], ["6.3", "na"], ["6.4", "decide"], ["7", "na"], ["7.1", "covered"], ["7.2", "na"],
    ]);
  });

  it("counts a parent by its sub-sections and keeps a sub-section's own N/A under an N/A parent", () => {
    const rows = new Map(buildSlotRows(tobe, sop).map((row) => [row.key, row]));
    expect(rows.get("general_requirements")?.state).toEqual({ kind: "sub", count: 3 });
    expect(rows.get("document_relationships.attachments")?.state).toEqual({ kind: "covered", by: "document_relationships" });
    expect(rows.get("document_relationships.appendices")?.state).toEqual({ kind: "na", reason: "own" });
  });

  it("offers Mark N/A on empty and to-decide sections only, and not where an Old heading is linked", () => {
    expect(buildSlotRows(tobe, sop).filter((row) => row.canMarkNa).map((row) => row.number)).toEqual(["3", "4", "5.2", "6.2", "6.4"]);
    expect(buildSlotRows(tobe, sop).filter((row) => row.headingLinked).map((row) => row.number)).toEqual(["2"]);
  });

  it("blocks a parent whose sub-section has only a linked heading", () => {
    const linked = { ...tobe, na_slots: [], slot_counts: [makeCount("procedures.maintenance", 0, 1)] };
    const rows = new Map(buildSlotRows(linked, sop).map((row) => [row.key, row]));
    expect(rows.get("procedures")).toMatchObject({ headingLinked: true, canMarkNa: false, state: { kind: "empty" } });
    expect(rows.get("procedures.maintenance")).toMatchObject({ headingLinked: true, canMarkNa: false, state: { kind: "decide" } });
  });

  it("marks the three equipment sections to decide only on an equipment SOP", () => {
    const plain = makeDoc({ is_equipment_sop: false });
    const rows = new Map(buildSlotRows({ ...tobe, docs: [plain] }, plain).map((row) => [row.number, row.state.kind]));
    expect(rows.get("6.2")).toBe("empty");
    expect(rows.get("6.4")).toBe("empty");

    const parentNa = { ...tobe, na_slots: [{ code: "SOP-CF", slot_key: "procedures", reason: "none" }] };
    expect(buildSlotRows(parentNa, sop).filter((row) => ["6.2", "6.3", "6.4"].includes(row.number)).map((row) => row.state.kind)).toEqual(["covered", "covered", "covered"]);
  });

  it("reads a written SOP without counts", () => {
    const written = makeDoc({ entrance: "match", document_id: 5 });
    const rows = buildSlotRows({ ...tobe, docs: [written], na_slots: [] }, written);
    expect(rows.some((row) => row.headingLinked || row.state.kind === "filled" || row.state.kind === "sub")).toBe(false);
    expect(summarizeSlots(rows)).toEqual({ filled: 0, empty: 12, na: 0, decide: 3 });
  });

  it("treats a missing or unknown count as empty", () => {
    const noCounts = { ...tobe, slot_counts: undefined };
    const unknownOnly = { ...tobe, slot_counts: [makeCount("procedures.nope", 4, 4)] };
    for (const response of [noCounts, unknownOnly]) {
      const rows = buildSlotRows(response, sop);
      expect(rows).toHaveLength(15);
      expect(summarizeSlots(rows)).toEqual({ filled: 0, empty: 9, na: 4, decide: 2 });
    }
  });
});

describe("summarizeSlots", () => {
  it("sums to fifteen", () => {
    expect(summarizeSlots(buildSlotRows(tobe, sop))).toEqual({ filled: 5, empty: 4, na: 4, decide: 2 });
  });
});

describe("rows from the document's outline", () => {
  it("takes the order, number, name and level from the outline items of that document", () => {
    const rows = buildSlotRows(tobe, sop);
    expect(rows.map((row) => row.key)).toEqual(LEGACY_KEYS);
    expect(rows.map((row) => row.number)).toEqual(["1", "2", "3", "4", "5", "5.1", "5.2", "6", "6.1", "6.2", "6.3", "6.4", "7", "7.1", "7.2"]);
    expect(rows.map((row) => row.level)).toEqual([0, 0, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1]);
    // 이름은 그 항목의 것만 - 조상 이름을 붙인 label("General requirements › Safety")이 아니다
    expect(rows.filter((row) => row.number.startsWith("5")).map((row) => row.label)).toEqual(["General requirements", "Safety", "Operation"]);
  });

  it("leaves out removed items and the items of another document", () => {
    const other = makeLegacyOutline("SOP-XX", { purpose: { title_en: "Other" } });
    const removed = makeLegacyOutline("SOP-CF", { "procedures.maintenance": { is_removed: true } });
    const rows = buildSlotRows({ ...tobe, outline_items: [...other, ...removed] }, sop);
    expect(rows).toHaveLength(14);
    expect(rows.some((row) => row.key === "procedures.maintenance" || row.label === "Other")).toBe(false);
  });

  it("has no rows for a document without an outline", () => {
    expect(buildSlotRows({ ...tobe, outline_items: [] }, sop)).toEqual([]);
  });

  it("shows an item without a number as an empty number", () => {
    const rows = buildSlotRows({ ...tobe, outline_items: makeLegacyOutline("SOP-CF", { scope: { number: null } }) }, sop);
    expect(rows[1]).toMatchObject({ key: "scope", number: "" });
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

  it("splits the 15 sections before Procedures, between 5.2 and 6", () => {
    const [left, right] = keysOf(tobe);
    expect(left.at(-1)).toBe("general_requirements.operation");
    expect(right[0]).toBe("procedures");
    expect([...left, ...right]).toEqual(LEGACY_KEYS);
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
    return { ...tobe, na_slots: reasons.map((reason, index) => ({ code: "SOP-CF", slot_key: LEGACY_KEYS[index], reason })) };
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

describe("canUndoRestore", () => {
  const restored: ToBe = { revision: 1, docs: [makeDoc({ id: 1 })], na_slots: [{ code: "SOP-CF", slot_key: "document_relationships", reason: "r" }], wi_steps: [], outline_items: [] };
  it("undoes only while the row is still an SOP and the slot has no N/A saved", () => {
    expect(canUndoRestore(restored, 1, "scope")).toBe(true);
    // 상위 칸만 N/A인 하위 칸 - 그 칸 자체에는 저장된 N/A가 없다
    expect(canUndoRestore(restored, 1, "document_relationships.appendices")).toBe(true);
  });
  it("leaves it alone after the slot is N/A again, the row is gone or became a WI", () => {
    expect(canUndoRestore({ ...restored, na_slots: [...restored.na_slots, { code: "SOP-CF", slot_key: "scope", reason: "again" }] }, 1, "scope")).toBe(false);
    expect(canUndoRestore(restored, 2, "scope")).toBe(false);
    expect(canUndoRestore({ ...restored, docs: [makeDoc({ id: 1, doc_type: "wi", parent_code: "SOP-X" })] }, 1, "scope")).toBe(false);
  });
});
