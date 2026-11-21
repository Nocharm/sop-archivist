// To-Be 초안 - 번호 바꾸기·지우기·종류 바꾸기가 딸린 N/A·단계를 함께 맞추고, 저장 요청의 순서가 보이는 순서인지 본다.
import { describe, expect, it } from "vitest";

import type { ToBe } from "./api-sop";
import { createDraft, orderDocs } from "./tobe-draft";

const BASE: ToBe = {
  revision: 4,
  docs: [
    { id: 2, code: "WI-01", title: "Op", doc_type: "wi", parent_code: "SOP-1", entrance: "assign", is_equipment_sop: false, order_index: 0, document_id: null, ref_parent_codes: [] },
    { id: 1, code: "SOP-1", title: "Main", doc_type: "sop", parent_code: null, entrance: "assign", is_equipment_sop: true, order_index: 1, document_id: null, ref_parent_codes: [] },
  ],
  na_slots: [{ code: "SOP-1", slot_key: "scope", reason: "n/a" }],
  wi_steps: [
    { code: "WI-01", step_no: 3, title: "B" },
    { code: "WI-01", step_no: 1, title: "A" },
  ],
  outline_items: [],
  outline_suggestions: {},
};

describe("the New list as the screen shows it", () => {
  it("shows each SOP followed by its WIs", () => {
    expect(orderDocs(createDraft(BASE).docs).map(({ doc, depth }) => `${doc.code}:${depth}`)).toEqual(["SOP-1:0", "WI-01:1"]);
  });

  it("keys every row, its N/A sections and its steps by the row id", () => {
    const list = createDraft(BASE);
    expect(list.docs.map((doc) => [doc.key, doc.parent_key])).toEqual([["id-2", "id-1"], ["id-1", null]]);
    expect(list.na_slots).toEqual([{ doc_key: "id-1", slot_key: "scope", reason: "n/a" }]);
    expect(list.wi_steps.map((step) => [step.doc_key, step.step_no])).toEqual([["id-2", 3], ["id-2", 1]]);
  });

  it("puts a WI whose parent is missing at the end, on its own", () => {
    const orphan = { ...BASE, docs: [{ ...BASE.docs[0], parent_code: "SOP-GONE" }, BASE.docs[1]] };
    expect(orderDocs(createDraft(orphan).docs).map(({ doc, depth }) => `${doc.code}:${depth}`)).toEqual(["SOP-1:0", "WI-01:0"]);
  });
});

describe("WIs found by reference", () => {
  const sop = (id: number, code: string, order: number) => ({ ...BASE.docs[1], id, code, order_index: order });
  const wi = (id: number, code: string, refs: string[], parent: string | null = null) => ({ ...BASE.docs[0], id, code, parent_code: parent, ref_parent_codes: refs });
  const show = (docs: ToBe["docs"]) => orderDocs(createDraft({ ...BASE, docs }).docs).map(({ doc, depth, ref }) => `${doc.code}:${depth}:${ref ?? "-"}`);

  it("shows a WI under every SOP that references it - the first by code is the full row, the rest are echoes", () => {
    // 목록 순서와 번호 순서가 다르다 - 온전한 줄은 번호 순 첫 SOP(서버가 그 순서로 준다) 아래
    const docs = [sop(1, "SOP-B", 0), sop(2, "SOP-A", 1), wi(3, "WI-09", ["SOP-A", "SOP-B"])];
    expect(show(docs)).toEqual(["SOP-B:0:-", "WI-09:1:echo", "SOP-A:0:-", "WI-09:1:main"]);
  });

  it("lists direct children before reference children and keeps a WI with neither at the end", () => {
    const docs = [sop(1, "SOP-A", 0), wi(2, "WI-REF", ["SOP-A"]), wi(3, "WI-DIRECT", [], "SOP-A"), wi(4, "WI-LOOSE", [])];
    expect(show(docs)).toEqual(["SOP-A:0:-", "WI-DIRECT:1:-", "WI-REF:1:main", "WI-LOOSE:0:-"]);
  });

  it("ignores references to an SOP that is not in the list", () => {
    expect(show([sop(1, "SOP-A", 0), wi(2, "WI-09", ["SOP-GONE"])])).toEqual(["SOP-A:0:-", "WI-09:0:-"]);
  });
});
