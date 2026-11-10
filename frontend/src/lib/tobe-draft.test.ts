// To-Be 초안 - 번호 바꾸기·지우기·종류 바꾸기가 딸린 N/A·단계를 함께 맞추고, 저장 요청의 순서가 보이는 순서인지 본다.
import { describe, expect, it } from "vitest";

import type { ToBe } from "./api-sop";
import { addStep, buildToBeInput, changeDocType, createDraft, isDraftDirty, isSameToBe, findDraftProblem, orderDocs, removeDoc, removeStep, renameDoc, setNaSlot } from "./tobe-draft";

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
    const input = buildToBeInput(renameDoc(createDraft(BASE), "id-1", "SOP-2"), 4);
    expect(input.docs.find((doc) => doc.code === "WI-01")?.parent_code).toBe("SOP-2");
    expect(input.na_slots).toEqual([{ code: "SOP-2", slot_key: "scope", reason: "n/a" }]);
  });

  it("drops a removed doc's slots and orphans its WIs", () => {
    const input = buildToBeInput(removeDoc(createDraft(BASE), "id-1"), 4);
    expect(input.na_slots).toHaveLength(0);
    expect(input.docs[0].parent_code).toBeNull();
  });

  it("clears what the new type cannot have", () => {
    const next = changeDocType(createDraft(BASE), "id-1", "wi");
    expect(next.na_slots).toHaveLength(0);
    expect(next.docs.find((doc) => doc.key === "id-1")?.is_equipment_sop).toBe(false);
  });

  it("orphans the WIs under a SOP that becomes a WI", () => {
    const input = buildToBeInput(changeDocType(createDraft(BASE), "id-1", "wi"), 4);
    expect(input.docs.find((doc) => doc.code === "WI-01")?.parent_code).toBeNull();
  });

  // 코드는 키 입력마다 바뀐다 - 하위 항목을 코드로 묶으면 지나가는 같은 코드가 남의 것을 빼앗는다
  describe("references stay with their row while codes are typed", () => {
    const TWO_SOPS: ToBe = {
      ...BASE,
      docs: [...BASE.docs, { id: 3, code: "SOP-12", title: "Other", doc_type: "sop", parent_code: null, entrance: "assign", is_equipment_sop: false, order_index: 2, document_id: null }],
      na_slots: [...BASE.na_slots, { code: "SOP-12", slot_key: "purpose", reason: "b" }],
    };

    it("does not take another SOP's WIs and N/A when passing through its code", () => {
      // SOP-12 -> SOP-1 -> SOP-13 (지우고 다시 친다)
      const draft = renameDoc(renameDoc(createDraft(TWO_SOPS), "id-3", "SOP-1"), "id-3", "SOP-13");
      const input = buildToBeInput(draft, 4);
      expect(input.docs.find((doc) => doc.code === "WI-01")?.parent_code).toBe("SOP-1");
      expect(input.na_slots).toEqual([
        { code: "SOP-1", slot_key: "scope", reason: "n/a" },
        { code: "SOP-13", slot_key: "purpose", reason: "b" },
      ]);
    });

    it("lists each WI once while two SOPs share a code", () => {
      const draft = renameDoc(createDraft(TWO_SOPS), "id-3", "SOP-1");
      expect(orderDocs(draft.docs).map(({ doc }) => doc.key)).toEqual(["id-1", "id-2", "id-3"]);
    });

    it("removes only the row's own steps when another row has the same code", () => {
      const draft = createDraft(BASE);
      const withTwin = { ...draft, docs: [...draft.docs, { ...draft.docs[0], key: "new-a" }] };
      const next = removeDoc(withTwin, "new-a");
      expect(buildToBeInput(next, 4).wi_steps).toHaveLength(2);
    });

    it("keeps two new empty-code rows apart", () => {
      let draft = createDraft(BASE);
      const blank = { code: "", title: "", doc_type: "sop" as const, parent_key: null, is_equipment_sop: false, entrance: "assign" as const };
      draft = { ...draft, docs: [...draft.docs, { ...blank, key: "new-a" }, { ...draft.docs[0], ...blank, key: "new-b" }] };
      draft = setNaSlot(draft, "new-a", "purpose", true);
      draft = renameDoc(draft, "new-b", "SOP-9");
      expect(buildToBeInput(draft, 4).na_slots.filter((slot) => slot.slot_key === "purpose")).toEqual([{ code: "", slot_key: "purpose", reason: "" }]);
    });
  });

  // 서버는 (code, step_no)로 단계를 알아보고 분류한 문장은 wi_step 번호를 가리킨다 - 번호를 다시 매기면 문장이 다른 단계로 옮겨간다
  it("orders the request as shown and keeps step numbers, gaps included", () => {
    const input = buildToBeInput(createDraft(BASE), 4);
    expect(input.docs.map((doc) => [doc.code, doc.order_index])).toEqual([["SOP-1", 0], ["WI-01", 1]]);
    expect(input.wi_steps).toEqual([
      { code: "WI-01", step_no: 1, title: "A" },
      { code: "WI-01", step_no: 3, title: "B" },
    ]);
  });

  it("keeps the later steps' numbers when an earlier step is removed", () => {
    const draft = createDraft(BASE);
    const next = removeStep(draft, "id-2", 1);
    expect(buildToBeInput(next, 4).wi_steps).toEqual([{ code: "WI-01", step_no: 3, title: "B" }]);
  });

  it("gives a new step the next number after the largest", () => {
    const next = addStep(removeStep(createDraft(BASE), "id-2", 3), "id-2");
    expect(buildToBeInput(next, 4).wi_steps.map((step) => step.step_no)).toEqual([1, 2]);
    expect(buildToBeInput(addStep(createDraft(BASE), "id-2"), 4).wi_steps.map((step) => step.step_no)).toEqual([1, 3, 4]);
  });

  it("is clean right after loading", () => {
    expect(isDraftDirty(createDraft(BASE), BASE)).toBe(false);
    expect(isDraftDirty(renameDoc(createDraft(BASE), "id-2", "WI-09"), BASE)).toBe(true);
  });
});

describe("isSameToBe", () => {
  it("ignores a revision that moved for another reason", () => {
    expect(isSameToBe({ ...BASE, revision: 9 }, BASE)).toBe(true);
  });

  it("sees a renamed document or a changed step as different", () => {
    expect(isSameToBe({ ...BASE, docs: BASE.docs.map((doc) => (doc.id === 2 ? { ...doc, title: "Changed" } : doc)) }, BASE)).toBe(false);
    expect(isSameToBe({ ...BASE, wi_steps: BASE.wi_steps.slice(0, 1) }, BASE)).toBe(false);
  });
});

describe("problems the server would refuse without saying which row", () => {
  it("names the row with no number, by its position", () => {
    const draft = createDraft(BASE);
    const withBlank = { ...draft, docs: [...draft.docs, { ...draft.docs[1], key: "new-a", code: "  " }] };
    expect(findDraftProblem(withBlank)).toEqual({ kind: "empty_code", row: 3, code: "" });
  });

  it("names the SOP whose N/A section has no reason", () => {
    const draft = setNaSlot(createDraft(BASE), "id-1", "purpose", true);
    expect(findDraftProblem(draft)).toEqual({ kind: "empty_na_reason", row: 1, code: "SOP-1" });
  });

  it("finds nothing in a clean list", () => {
    expect(findDraftProblem(createDraft(BASE))).toBeNull();
  });
});
