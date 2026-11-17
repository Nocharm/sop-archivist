// WI 줄을 SOP 줄에 끌어 상위 SOP를 바꾸는 순수 모델 - 놓을 자리 판정, 끌 수 있는 줄, 끌려가는 표, 알림 Undo의 판정.
import { describe, expect, it } from "vitest";

import type { TargetDoc, ToBe } from "./api-sop";
import { PARENT_REFUSAL_KEYS, buildParentCard, canDragParent, canUndoParentMove, resolveParentDrop } from "./parent-drop-model";

const sopA = { key: "id-1", code: "SOP-CF", doc_type: "sop" as const, parent_key: null };
const sopB = { key: "id-2", code: "SOP-PH", doc_type: "sop" as const, parent_key: null };
const wi1 = { key: "id-3", code: "WI-01", doc_type: "wi" as const, parent_key: "id-1" };
const wi2 = { key: "id-4", code: "WI-02", doc_type: "wi" as const, parent_key: "id-1" };

describe("resolveParentDrop", () => {
  it("moves a WI under another SOP", () => expect(resolveParentDrop(wi1, sopB)).toEqual({ kind: "move", parentKey: "id-2", parentCode: "SOP-PH" }));
  it("refuses its own parent and any WI, with the reason", () => {
    expect(resolveParentDrop(wi1, sopA)).toEqual({ kind: "refused", reason: "sameParent" });
    expect(resolveParentDrop(wi1, wi2)).toEqual({ kind: "refused", reason: "wiTarget" });
    expect(PARENT_REFUSAL_KEYS).toEqual({ wiTarget: "tobe.drag.wiTarget", sameParent: "tobe.drag.sameParent" });
  });
  it("is silent on itself and off the rows", () => {
    expect(resolveParentDrop(wi1, wi1)).toEqual({ kind: "none" });
    expect(resolveParentDrop(wi1, null)).toEqual({ kind: "none" });
  });
  it("lets a WI without a parent land on any SOP", () => expect(resolveParentDrop({ ...wi1, parent_key: null }, sopA)).toEqual({ kind: "move", parentKey: "id-1", parentCode: "SOP-CF" }));
});

describe("canDragParent", () => {
  const on = { canEdit: true, saving: false, sopKeys: ["id-1", "id-2"] };
  it("needs an SOP other than the current parent", () => {
    expect(canDragParent(wi1, on)).toBe(true);
    expect(canDragParent(wi1, { ...on, sopKeys: ["id-1"] })).toBe(false);
    expect(canDragParent({ ...wi1, parent_key: null }, { ...on, sopKeys: ["id-1"] })).toBe(true);
  });
  it("is off for a reader, during a save and for an SOP row", () => {
    expect(canDragParent(wi1, { ...on, canEdit: false })).toBe(false);
    expect(canDragParent(wi1, { ...on, saving: true })).toBe(false);
    expect(canDragParent(sopA, on)).toBe(false);
  });
});

describe("buildParentCard", () => {
  it("shows the number, the title or the no-title text, and no count", () => {
    expect(buildParentCard({ code: "WI-01", title: "" }, "No title yet")).toEqual({ id: "WI-01", text: "No title yet", count: null });
    expect(buildParentCard({ code: "WI-01", title: "Clean the filler" }, "No title yet").text).toBe("Clean the filler");
  });
  it("cuts a long number in the middle", () => {
    const card = buildParentCard({ code: `WI-${"9".repeat(97)}`, title: "t" }, "No title yet");
    expect(Array.from(card.id)).toHaveLength(23);
    expect(card.id).toBe(`WI-${"9".repeat(11)}…${"9".repeat(8)}`);
  });
});

function makeDoc(patch: Partial<TargetDoc>): TargetDoc {
  return { id: 1, code: "SOP-CF", title: "", doc_type: "sop", parent_code: null, entrance: "assign", is_equipment_sop: false, order_index: 1, document_id: null, ...patch };
}

function makeToBe(docs: TargetDoc[]): ToBe {
  return { revision: 1, docs, na_slots: [], wi_steps: [] };
}

describe("canUndoParentMove", () => {
  const sops = [makeDoc({ id: 1, code: "SOP-CF" }), makeDoc({ id: 2, code: "SOP-PH", order_index: 2 })];
  it("undoes only while the WI still sits under the SOP it was dropped on", () => {
    expect(canUndoParentMove(makeToBe([...sops, makeDoc({ id: 3, code: "WI-01", doc_type: "wi", parent_code: "SOP-PH" })]), 3, "SOP-PH")).toBe(true);
  });
  it("leaves it alone after someone else moved it, removed it or made it an SOP", () => {
    expect(canUndoParentMove(makeToBe([...sops, makeDoc({ id: 3, code: "WI-01", doc_type: "wi", parent_code: "SOP-CF" })]), 3, "SOP-PH")).toBe(false);
    expect(canUndoParentMove(makeToBe(sops), 3, "SOP-PH")).toBe(false);
    expect(canUndoParentMove(makeToBe([...sops, makeDoc({ id: 3, code: "WI-01", doc_type: "sop", parent_code: null })]), 3, "SOP-PH")).toBe(false);
  });
});
