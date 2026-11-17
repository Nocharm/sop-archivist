// New 목록 칸 상태 모델 - 여섯 상태의 순서, N/A를 둘 수 있는 칸, 요약, 쓴 사유, 사유 편집기 하나.
import { describe, expect, it } from "vitest";

import { SLOT_KEYS, type SlotCount, type TargetDoc, type ToBe } from "./api-sop";
import { SLOT_COLUMNS, SLOT_NUMBERS, buildSlotRows, canUndoRestore, hasSubSlots, isNaEditDirty, listUsedReasons, openNaEdit, summarizeSlots, type NaEdit } from "./slot-status-model";

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

describe("slot places", () => {
  it("numbers the sections from their fixed places", () => {
    expect(SLOT_KEYS.map((key) => SLOT_NUMBERS[key])).toEqual(["1", "2", "3", "4", "5", "5.1", "5.2", "6", "6.1", "6.2", "6.3", "6.4", "7", "7.1", "7.2"]);
    expect(SLOT_COLUMNS[0].at(-1)).toBe("general_requirements.operation");
    expect(SLOT_COLUMNS[1][0]).toBe("procedures");
  });

  it("knows which sections have sub sections, from the key list", () => {
    expect(SLOT_KEYS.filter(hasSubSlots)).toEqual(["general_requirements", "procedures", "document_relationships"]);
    // SOP 칸 키가 아닌 칸(WI 단계·입구 2 절 경로)은 아니다
    expect(["step:1:instruction", "unstepped:why", "path:procedures"].some(hasSubSlots)).toBe(false);
  });
});

describe("listUsedReasons", () => {
  function withReasons(reasons: string[]): ToBe {
    return { ...tobe, na_slots: reasons.map((reason, index) => ({ code: "SOP-CF", slot_key: SLOT_KEYS[index], reason })) };
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
  const restored: ToBe = { revision: 1, docs: [makeDoc({ id: 1 })], na_slots: [{ code: "SOP-CF", slot_key: "document_relationships", reason: "r" }], wi_steps: [] };
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
