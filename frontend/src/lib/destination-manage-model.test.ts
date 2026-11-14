// 보낼 곳 추가·삭제 규칙 - 지울 수 없는 이유와 새 문서 입력 검사.
import { describe, expect, it } from "vitest";

import type { TargetDoc, ToBe } from "./api-sop";
import { checkNewDoc, findLastStep, getDocRemoveBlock, getStepRemoveBlock, listParentCodes } from "./destination-manage-model";

function makeDoc(id: number, code: string, patch: Partial<TargetDoc> = {}): TargetDoc {
  return { id, code, title: "", doc_type: "sop", parent_code: null, entrance: "assign", is_equipment_sop: false, order_index: id, document_id: null, ...patch };
}

const sop = makeDoc(1, "SOP-A");
const wi = makeDoc(2, "WI-A", { doc_type: "wi", parent_code: "SOP-A" });
const empty = makeDoc(3, "SOP-B");
const uploaded = makeDoc(4, "SOP-UP", { entrance: "match", document_id: 9 });

const tobe: ToBe = {
  revision: 3,
  docs: [sop, wi, empty, uploaded],
  na_slots: [],
  wi_steps: [
    { code: "WI-A", step_no: 1, title: "Prepare" },
    { code: "WI-A", step_no: 3, title: "" },
  ],
  sentence_counts: [{ target_doc_id: 2, wi_step: 1, count: 2 }],
};

describe("getDocRemoveBlock", () => {
  it("lets an empty document with nothing under it go", () => {
    expect(getDocRemoveBlock(tobe, empty)).toBeNull();
  });

  it("names why the others stay", () => {
    expect(getDocRemoveBlock(tobe, uploaded)).toBe("written");
    expect(getDocRemoveBlock(tobe, wi)).toBe("hasSentences");
    expect(getDocRemoveBlock(tobe, sop)).toBe("hasChildren");
  });

  it("treats a list without counts as having no sentences", () => {
    expect(getDocRemoveBlock({ ...tobe, sentence_counts: undefined }, wi)).toBeNull();
  });
});

describe("getStepRemoveBlock", () => {
  it("blocks only the step that holds sentences", () => {
    expect(getStepRemoveBlock(tobe, wi, 1)).toBe("hasSentences");
    expect(getStepRemoveBlock(tobe, wi, 3)).toBeNull();
  });
});

describe("checkNewDoc", () => {
  it("needs a number that is not in the list yet", () => {
    expect(checkNewDoc(tobe, { code: "  ", docType: "sop", parentCode: null })).toBe("codeRequired");
    expect(checkNewDoc(tobe, { code: " SOP-A ", docType: "sop", parentCode: null })).toBe("codeTaken");
    expect(checkNewDoc(tobe, { code: "SOP-C", docType: "sop", parentCode: null })).toBeNull();
  });

  it("needs a parent SOP for a WI", () => {
    expect(checkNewDoc(tobe, { code: "WI-B", docType: "wi", parentCode: null })).toBe("parentRequired");
    expect(checkNewDoc(tobe, { code: "WI-B", docType: "wi", parentCode: "WI-A" })).toBe("parentRequired");
    expect(checkNewDoc(tobe, { code: "WI-B", docType: "wi", parentCode: "SOP-B" })).toBeNull();
  });
});

describe("listParentCodes and findLastStep", () => {
  it("lists SOPs in list order, uploaded ones too", () => {
    expect(listParentCodes(tobe)).toEqual(["SOP-A", "SOP-B", "SOP-UP"]);
  });

  it("reads the highest step number of a WI", () => {
    expect(findLastStep(tobe, "WI-A")).toBe(3);
    expect(findLastStep(tobe, "SOP-A")).toBeNull();
  });
});
