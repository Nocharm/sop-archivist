// 선언 묶음 모델 - 선언을 받는 부모마다 묶음 하나, 번호 글, 뺄 수 없는 까닭, 권장 이름, 같은 제목 검사.
import { describe, expect, it } from "vitest";

import type { OutlineItem, SlotCount, TargetDoc, ToBe } from "./api-sop";
import { buildDeclareGroups, checkOutlineTitle } from "./outline-declare-model";
import { makeOutline, makeTemplateOutline } from "./outline-fixture";

function makeDoc(patch: Partial<TargetDoc> = {}): TargetDoc {
  return { id: 12, code: "SOP-CF", title: "", doc_type: "sop", parent_code: null, entrance: "assign", is_equipment_sop: true, order_index: 1, document_id: null, ref_parent_codes: [], ...patch };
}

function makeCount(slot_key: string, count: number, heading_count: number, target_doc_id = 12): SlotCount {
  return { target_doc_id, slot_key, count, heading_count };
}

/** 템플릿 골격에 둘째 절차를 더한 것 - 절차 둘 · 부록 하나 · 범주 둘 */
function makeItems(code = "SOP-CF"): OutlineItem[] {
  const items = makeTemplateOutline(code, { "appendices.a1": { title_ko: "경보 목록" } });
  const first = items.findIndex((item) => item.key === "procedures.p1");
  const second: OutlineItem = { ...items[first], key: "procedures.n2", number: "6.2", title_en: "Cleaning", label: "Procedures › Cleaning" };
  return [...items.slice(0, first + 1), second, ...items.slice(first + 1)];
}

const sop = makeDoc();
const tobe: ToBe = {
  revision: 1,
  docs: [sop],
  na_slots: [],
  wi_steps: [],
  outline_items: makeItems(),
  outline_suggestions: {
    procedures: ["Electronic Record Control", "Troubleshooting", "Maintenance"],
    general_requirements: ["Safety", "Environment", "Work", "Quality"],
  },
  slot_counts: [],
};

const findGroup = (source: ToBe, doc: TargetDoc, parentKey: string) => {
  const group = buildDeclareGroups(source, doc).find((item) => item.parentKey === parentKey);
  if (group === undefined) throw new Error(`no group ${parentKey}`);
  return group;
};

describe("buildDeclareGroups", () => {
  it("makes one group per declarable parent, in outline order", () => {
    const groups = buildDeclareGroups(tobe, sop);
    expect(groups.map((group) => [group.parentKey, group.kind, group.number, group.title])).toEqual([
      ["general_requirements", "category_table", "5", "General Requirements"],
      ["procedures", "named_children", "6", "Procedures"],
      ["appendices", "named_children", "9", "Appendices"],
    ]);
    expect(groups.map((group) => group.rows.map((row) => row.key))).toEqual([
      ["general_requirements.safety", "general_requirements.work"],
      ["procedures.p1", "procedures.n2"],
      ["appendices.a1"],
    ]);
  });

  it("writes the number of a procedure, the lead of an appendix and nothing for a category", () => {
    const groups = buildDeclareGroups(tobe, sop);
    expect(groups.map((group) => group.rows.map((row) => row.number))).toEqual([["", ""], ["6.1", "6.2"], ["Appendix 1."]]);
    expect(findGroup(tobe, sop, "appendices").rows[0]).toMatchObject({ title_en: "Alarm list", title_ko: "경보 목록" });
  });

  it("falls back to the bare number when the label does not end with the title", () => {
    const items = makeItems().map((item) => (item.key === "appendices.a1" ? { ...item, label: "Annex" } : item));
    expect(findGroup({ ...tobe, outline_items: items }, sop, "appendices").rows[0].number).toBe("1");
  });

  it("knows which rows can move up and down, by their place among siblings", () => {
    expect(findGroup(tobe, sop, "procedures").rows.map((row) => [row.position, row.canMoveUp, row.canMoveDown])).toEqual([
      [0, false, true],
      [1, true, false],
    ]);
    expect(findGroup(tobe, sop, "appendices").rows.map((row) => [row.canMoveUp, row.canMoveDown])).toEqual([[false, false]]);
  });

  it("counts lines and slot headings of this document, and blocks removing a row that holds any", () => {
    const counted: ToBe = {
      ...tobe,
      slot_counts: [makeCount("procedures.p1", 2, 1), makeCount("general_requirements.work", 0, 1), makeCount("procedures.n2", 9, 9, 99)],
    };
    expect(findGroup(counted, sop, "procedures").rows.map((row) => [row.lineCount, row.canRemove, row.removeBlock])).toEqual([
      [3, false, "hasLines"],
      [0, true, null],
    ]);
    expect(findGroup(counted, sop, "general_requirements").rows.map((row) => [row.lineCount, row.removeBlock])).toEqual([
      [0, null],
      [1, "hasLines"],
    ]);
  });

  it("adds the lines of sub-items to their parent row", () => {
    const outline = makeOutline("SOP-CF", [["a", "A"], ["a.b", "B"], ["a.b.c", "C"]], { "a.b": { origin: "declared" } });
    const deep: ToBe = { ...tobe, outline_items: outline, slot_counts: [makeCount("a.b.c", 4, 0)] };
    expect(findGroup(deep, sop, "a").rows[0]).toMatchObject({ key: "a.b", lineCount: 4, removeBlock: "hasLines" });
  });

  it("does not let a row that the document did not declare be renamed, moved or removed", () => {
    const items = makeItems().map((item): OutlineItem => (item.key === "procedures.p1" ? { ...item, origin: "standard" } : item));
    const rows = findGroup({ ...tobe, outline_items: items }, sop, "procedures").rows;
    expect(rows.map((row) => [row.canRename, row.canRemove, row.removeBlock])).toEqual([
      [false, false, "notDeclared"],
      [true, true, null],
    ]);
    // 선언한 줄은 표준 줄 위로 옮겨 갈 수 있다
    expect(rows.map((row) => [row.canMoveUp, row.canMoveDown])).toEqual([
      [false, false],
      [true, false],
    ]);
  });

  it("offers the suggested names that are not used yet, whatever their case", () => {
    expect(findGroup(tobe, sop, "general_requirements").suggestions).toEqual(["Environment", "Quality"]);
    const loud: ToBe = { ...tobe, outline_suggestions: { general_requirements: [" SAFETY ", "Environment", "environment", ""] } };
    expect(findGroup(loud, sop, "general_requirements").suggestions).toEqual(["Environment"]);
  });

  it("suggests procedures to an equipment SOP only, categories to any SOP", () => {
    expect(findGroup(tobe, sop, "procedures").suggestions).toEqual(["Electronic Record Control", "Troubleshooting", "Maintenance"]);
    const plain = makeDoc({ is_equipment_sop: false });
    expect(findGroup(tobe, plain, "procedures").suggestions).toEqual([]);
    expect(findGroup(tobe, plain, "general_requirements").suggestions).toEqual(["Environment", "Quality"]);
  });

  it("has no suggestions for a parent the standard gives none", () => {
    expect(findGroup(tobe, sop, "appendices").suggestions).toEqual([]);
    expect(findGroup({ ...tobe, outline_suggestions: {} }, sop, "procedures").suggestions).toEqual([]);
  });

  it("reads only this document's items and skips removed ones", () => {
    const removed = makeItems().map((item) => (item.key === "procedures.n2" || item.key === "appendices" ? { ...item, is_removed: true } : item));
    const groups = buildDeclareGroups({ ...tobe, outline_items: [...makeItems("SOP-B"), ...removed] }, sop);
    expect(groups.map((group) => group.parentKey)).toEqual(["general_requirements", "procedures"]);
    expect(groups[1].rows.map((row) => [row.key, row.canMoveDown])).toEqual([["procedures.p1", false]]);
  });

  it("has no groups when the standard has no declarable parents", () => {
    const flat = makeOutline("SOP-CF", [["purpose", "Purpose"], ["scope", "Scope"]]);
    expect(buildDeclareGroups({ ...tobe, outline_items: flat }, sop)).toEqual([]);
  });

  it("has no groups for a written SOP or a WI", () => {
    expect(buildDeclareGroups(tobe, makeDoc({ entrance: "match", document_id: 9 }))).toEqual([]);
    expect(buildDeclareGroups(tobe, makeDoc({ doc_type: "wi", parent_code: "SOP-A" }))).toEqual([]);
  });
});

describe("checkOutlineTitle", () => {
  const procedures = findGroup(tobe, sop, "procedures");

  it("refuses an empty title", () => {
    expect(checkOutlineTitle(procedures, "   ")).toBe("empty");
  });

  it("refuses a title the group already has, ignoring case and outer spaces", () => {
    expect(checkOutlineTitle(procedures, "  cleaning ")).toBe("duplicate");
    expect(checkOutlineTitle(procedures, "Calibration")).toBeNull();
  });

  it("lets a row keep its own title, but not take a sibling's", () => {
    expect(checkOutlineTitle(procedures, "CLEANING", "procedures.n2")).toBeNull();
    expect(checkOutlineTitle(procedures, "Procedure 1", "procedures.n2")).toBe("duplicate");
  });

  it("looks only inside the group", () => {
    expect(checkOutlineTitle(procedures, "Safety")).toBeNull();
  });
});
