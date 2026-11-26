import { describe, expect, it } from "vitest";

import type { Group, GroupTarget, UnitRow } from "./api-sop";
import type { ClassifyRow } from "./classify-model";
import { buildLinkSave, type LinkRequest } from "./link-save-model";

const row = { key: "u3", unitIds: [3], documentId: 1, pairId: null, status: "confirmed" } as unknown as ClassifyRow;
const decision = (linked: boolean) => ({ disposition: linked ? "assigned" : "unassigned", move_target_code: "", reason: "", status: linked ? "confirmed" : "unassigned", hold_reason: "", confirmed_by: null, confirmed_at: null, revision: 2 }) as UnitRow["decision"];
const unit = (linked: boolean): UnitRow => ({ unit_id: 3, document_id: 1, display_id: "OLD-3", kind: "sentence", lang: "ko", text: "글", content_start: 0, table_id: null, row_index: null, group_unit_id: null, status: linked ? "confirmed" : "unassigned", decision: decision(linked), target_ids: [] }) as unknown as UnitRow;
const target = (id: number, docId: number, sources: number[]): GroupTarget => ({ id, target_doc_id: docId, lang: "ko", kind: "sentence", source_unit_ids: sources, revision: 1, status: "confirmed", parent_target_id: null, translation_source_unit_id: null, slot_key: null, wi_step: null, wi_part: null, section_path: "", order_index: 0, confirmed_text: "", ai_text: "", change_type: null, origin: "new_doc", new_unit_id: null }) as unknown as GroupTarget;

/** 71 · 72는 문서 7, 91은 문서 9 - linked는 지금 그 줄(Unit 3)에 이어진 문장 */
function request(result: number[], over: { linked?: number[]; reason?: string } = {}): LinkRequest {
  const linked = over.linked ?? [];
  const group: Group = { units: [{ unit_id: 3, display_id: "OLD-3", document_id: 1, kind: "sentence", lang: "ko", text: "글", group_id: null, decision: decision(linked.length > 0), cell_unit_ids: [] }], targets: [71, 72, 91].map((id) => target(id, id === 91 ? 9 : 7, linked.includes(id) ? [3] : [])) };
  return { row, units: [unit(linked.length > 0)], groups: [group], result, reason: over.reason ?? "" };
}
function saved(result: number[], over: { linked?: number[]; reason?: string } = {}) {
  const save = buildLinkSave(request(result, over));
  if (save.kind !== "save") throw new Error("expected a save");
  return save;
}

describe("buildLinkSave", () => {
  it("links one sentence and its pair partner", () => expect(saved([71, 72]).body.targets.filter((item) => item.source_unit_ids.includes(3)).map((item) => item.id)).toEqual([71, 72]));
  it("replaces the row's other links", () => {
    // 이 줄만 출처였던 문장은 이음이 풀려 미배정으로 돌아간다
    const { body } = saved([72], { linked: [71] });
    expect(body.removed_target_ids).toContain(71);
    expect(body.targets.find((item) => item.id === 72)?.source_unit_ids).toEqual([3]);
  });
  it("unlinking the last one clears the decision", () => expect(buildLinkSave(request([], { linked: [71] }))).toEqual({ kind: "clear", units: [{ unit_id: 3, revision: 2 }] }));
  it("carries the remark", () => expect(saved([71, 91], { reason: "두 문서" }).body.units[0].reason).toBe("두 문서"));
  it("clears nothing on a row with no decision", () => expect(buildLinkSave(request([]))).toEqual({ kind: "clear", units: [] }));
});
