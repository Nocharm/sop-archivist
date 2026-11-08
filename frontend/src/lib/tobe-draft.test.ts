// To-Be 초안 - 번호 바꾸기·지우기·종류 바꾸기가 딸린 N/A·단계를 함께 맞추고, 저장 요청의 순서가 보이는 순서인지 본다.
import { describe, expect, it } from "vitest";

import type { ToBe } from "./api-sop";
import { buildToBeInput, changeDocType, createDraft, isDraftDirty, orderDocs, removeDoc, renameDoc } from "./tobe-draft";

const BASE: ToBe = {
  revision: 4,
  docs: [
    { id: 2, code: "WI-01", title: "Op", doc_type: "wi", parent_code: "SOP-1", entrance: "assign", is_equipment_sop: false, order_index: 0, document_id: null },
    { id: 1, code: "SOP-1", title: "Main", doc_type: "sop", parent_code: null, entrance: "assign", is_equipment_sop: true, order_index: 1, document_id: null },
  ],
  na_slots: [{ code: "SOP-1", slot_key: "scope", reason: "n/a" }],
  wi_steps: [
    { code: "WI-01", step_no: 3, title: "B" },
    { code: "WI-01", step_no: 1, title: "A" },
  ],
};

describe("tobe draft", () => {
  it("shows each SOP followed by its WIs", () => {
    expect(orderDocs(createDraft(BASE).docs).map(({ doc, depth }) => `${doc.code}:${depth}`)).toEqual(["SOP-1:0", "WI-01:1"]);
  });

  it("renames references with the code", () => {
    const next = renameDoc(createDraft(BASE), "id-1", "SOP-2");
    expect(next.docs.find((doc) => doc.key === "id-2")?.parent_code).toBe("SOP-2");
    expect(next.na_slots[0].code).toBe("SOP-2");
  });

  it("drops a removed doc's slots and orphans its WIs", () => {
    const next = removeDoc(createDraft(BASE), "id-1");
    expect(next.na_slots).toHaveLength(0);
    expect(next.docs[0].parent_code).toBeNull();
  });

  it("clears what the new type cannot have", () => {
    const next = changeDocType(createDraft(BASE), "id-1", "wi");
    expect(next.na_slots).toHaveLength(0);
    expect(next.docs.find((doc) => doc.key === "id-1")?.is_equipment_sop).toBe(false);
  });

  it("orders the request as shown and renumbers steps", () => {
    const input = buildToBeInput(createDraft(BASE), 4);
    expect(input.docs.map((doc) => [doc.code, doc.order_index])).toEqual([["SOP-1", 0], ["WI-01", 1]]);
    expect(input.wi_steps).toEqual([
      { code: "WI-01", step_no: 1, title: "A" },
      { code: "WI-01", step_no: 2, title: "B" },
    ]);
  });

  it("is clean right after loading", () => {
    expect(isDraftDirty(createDraft(BASE), BASE)).toBe(false);
    expect(isDraftDirty(renameDoc(createDraft(BASE), "id-2", "WI-09"), BASE)).toBe(true);
  });
});
