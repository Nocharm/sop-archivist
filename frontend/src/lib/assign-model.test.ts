// Assign 모델 - 묶음 합치기, 함께 확정되는 것, 한/영 짝 자동, 추천 섞기, 출처 없는 New, 확대·폭 범위.
import { describe, expect, it } from "vitest";

import type { Decision, Group, GroupTarget, GroupUnit, NewCandidate, WrittenSentence } from "./api-sop";
import { addPartnerTargets, buildRecommendations, clampSplit, clampZoom, listCoConfirmed, listUnsourced, mergeGroups, stepZoom } from "./assign-model";

function makeDecision(status: Decision["status"]): Decision {
  return { disposition: "assigned", move_target_code: "", reason: "", status, hold_reason: "", confirmed_by: null, confirmed_at: null, revision: 1 };
}

function makeUnit(id: number, status: Decision["status"]): GroupUnit {
  return { unit_id: id, display_id: `OLD-1-${id}`, document_id: 1, kind: "sentence", lang: "ko", text: `원문 ${id}`, group_id: null, decision: makeDecision(status), cell_unit_ids: [] };
}

function makeTarget(id: number, extra: Partial<GroupTarget> = {}): GroupTarget {
  return {
    id, target_doc_id: 9, slot_key: null, wi_step: null, wi_part: null, section_path: "", order_index: 0, lang: "ko", kind: "sentence",
    confirmed_text: `문장 ${id}`, ai_text: "", change_type: null, origin: "new_doc", new_unit_id: null, translation_source_unit_id: null, parent_target_id: null, cell_row: null, cell_col: null,
    grid: null, status: "ai_suggested", hold_reason: "", warnings: [], source_unit_ids: [], group_id: null, revision: 1, ...extra,
  };
}

function makeWritten(id: number, extra: Partial<WrittenSentence> = {}): WrittenSentence {
  return {
    target_id: id, target_doc_id: 9, doc_code: "WI-04", section_path: "1. 준비", order_index: id, lang: "ko", kind: "sentence", text: `문장 ${id}`,
    status: "unassigned", change_type: null, source_unit_ids: [], partner_target_id: null, revision: 1, ...extra,
  };
}

describe("mergeGroups", () => {
  it("joins groups without repeating units or targets", () => {
    const merged = mergeGroups([
      { units: [makeUnit(10, "unassigned")], targets: [makeTarget(71)] },
      { units: [makeUnit(10, "unassigned"), makeUnit(11, "confirmed")], targets: [makeTarget(71), makeTarget(72)] },
    ]);
    expect(merged.units.map((unit) => unit.unit_id)).toEqual([10, 11]);
    expect(merged.targets.map((target) => target.id)).toEqual([71, 72]);
  });
});

describe("listCoConfirmed", () => {
  it("lists the unconfirmed things outside the row that one confirm will settle", () => {
    const group: Group = {
      units: [makeUnit(10, "ai_suggested"), makeUnit(11, "ai_suggested"), makeUnit(12, "confirmed")],
      targets: [makeTarget(72), makeTarget(73), makeTarget(74, { status: "confirmed" })],
    };
    expect(listCoConfirmed(group, [10], [72])).toEqual([
      { kind: "unit", id: 11, label: "OLD-1-11" },
      { kind: "target", id: 73, label: "문장 73" },
    ]);
  });
});

describe("addPartnerTargets", () => {
  const written = new Map([
    [72, makeWritten(72, { partner_target_id: 82 })],
    [82, makeWritten(82, { lang: "en", partner_target_id: 72 })],
    [73, makeWritten(73)],
  ]);

  it("adds the other-language sentence when the row has that language", () => {
    expect(addPartnerTargets([72], ["ko", "en"], written)).toEqual([72, 82]);
  });

  it("adds nothing when the row has one language or the sentence has no partner", () => {
    expect(addPartnerTargets([72], ["ko"], written)).toEqual([72]);
    expect(addPartnerTargets([73], ["ko", "en"], written)).toEqual([73]);
    expect(addPartnerTargets([72, 82], ["ko", "en"], written)).toEqual([72, 82]);
  });
});

describe("buildRecommendations", () => {
  const similar = (id: number): NewCandidate => ({ target_id: id, target_doc_id: 9, doc_code: "WI-04", section_path: "", text: `문장 ${id}`, basis: "text" });

  it("puts AI links, AI places, identical and similar sentences in that order without repeats", () => {
    const recs = buildRecommendations({
      aiLinks: [{ targetIds: [72, 73], why: "나눔" }],
      aiPlaces: [{ destination: { kind: "slot", docId: 6, slotKey: "scope" }, why: "범위" }, { destination: { kind: "delete" }, why: "대응 없음" }],
      identical: [75],
      similar: [similar(75), similar(76)],
    });
    expect(recs.map((rec) => [rec.source, rec.destination])).toEqual([
      ["ai", { kind: "link", targetIds: [72, 73] }],
      ["ai", { kind: "slot", docId: 6, slotKey: "scope" }],
      ["ai", { kind: "delete" }],
      ["identical", { kind: "link", targetIds: [75] }],
      ["similar", { kind: "link", targetIds: [76] }],
    ]);
  });

  it("keeps at most five", () => {
    const recs = buildRecommendations({ aiLinks: [], aiPlaces: [], identical: [], similar: [1, 2, 3, 4, 5, 6, 7].map(similar) });
    expect(recs).toHaveLength(5);
  });
});

describe("listUnsourced", () => {
  it("keeps written sentences with no source that are not marked new", () => {
    const rows = [
      makeWritten(1),
      makeWritten(2, { source_unit_ids: [10] }),
      makeWritten(3, { change_type: "new" }),
      makeWritten(4, { kind: "table" }),
    ];
    expect(listUnsourced(rows).map((row) => row.target_id)).toEqual([1]);
  });
});

describe("zoom and split ranges", () => {
  it("clamps zoom to 70-160% in 10% steps", () => {
    expect(clampZoom(1.75)).toBe(1.6);
    expect(clampZoom(0.64)).toBe(0.7);
    expect(clampZoom(1.04)).toBe(1);
    expect(stepZoom(1, "+")).toBe(1.1);
    expect(stepZoom(1.6, "+")).toBe(1.6);
    expect(stepZoom(0.7, "-")).toBe(0.7);
    expect(stepZoom(1.3, "0")).toBe(1);
  });

  it("clamps the split to 30-70%", () => {
    expect(clampSplit(0.9)).toBe(0.7);
    expect(clampSplit(0.1)).toBe(0.3);
    expect(clampSplit(0.55)).toBe(0.55);
  });
});
