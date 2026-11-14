// Assign 모델 - 묶음 합치기, 함께 확정되는 것, 한/영 짝 자동, 추천 섞기, 출처 없는 New, 확대·폭 범위.
import { describe, expect, it } from "vitest";

import type { Decision, Group, GroupTarget, GroupUnit, NewCandidate, WrittenSentence } from "./api-sop";
import {
  addPartnerTargets,
  buildLinkPairs,
  buildRecommendations,
  canMakeOtherLanguage,
  clampSplit,
  clampZoom,
  findLinkPartners,
  isRecommendationPicked,
  listCoConfirmed,
  listLinkMenuItems,
  listSiblingPlaces,
  listUnlinkRemainder,
  listUnsourced,
  mergeGroups,
  pickDrawnLinks,
  pickNearby,
  stepZoom,
} from "./assign-model";
import type { DestinationOption } from "./classify-model";

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
    grid: null, status: "ai_suggested", hold_reason: "", remark: "", warnings: [], source_unit_ids: [], group_id: null, revision: 1, indent_level: 0, ...extra,
  };
}

function makeWritten(id: number, extra: Partial<WrittenSentence> = {}): WrittenSentence {
  return {
    target_id: id, target_doc_id: 9, doc_code: "WI-04", section_path: "1. 준비", order_index: id, lang: "ko", kind: "sentence", text: `문장 ${id}`,
    status: "unassigned", change_type: null, source_unit_ids: [], partner_target_id: null, remark: "", revision: 1, ...extra,
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

  it("always picks the New partner too, whatever languages the row has", () => {
    expect(addPartnerTargets([72], written)).toEqual([72, 82]);
    expect(addPartnerTargets([82], written)).toEqual([82, 72]);
  });

  it("adds nothing when the sentence has no partner or the partner is already picked", () => {
    expect(addPartnerTargets([73], written)).toEqual([73]);
    expect(addPartnerTargets([72, 82], written)).toEqual([72, 82]);
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

  it("shows a KO/EN New pair as one card with both sentences on a KO/EN pair row", () => {
    // 한/영 짝 줄의 KO 조각 후보 72, EN 조각 후보 82 - 둘은 New 짝이라 어느 쪽을 골라도 같은 곳이다
    const written = new Map([
      [72, makeWritten(72, { partner_target_id: 82 })],
      [82, makeWritten(82, { lang: "en", partner_target_id: 72 })],
      [73, makeWritten(73)],
    ]);
    const recs = buildRecommendations(
      { aiLinks: [], aiPlaces: [], identical: [], similar: [similar(72), similar(82), similar(73)] },
      (ids) => addPartnerTargets(ids, written),
    );
    expect(recs.map((rec) => rec.destination)).toEqual([
      { kind: "link", targetIds: [72, 82] },
      { kind: "link", targetIds: [73] },
    ]);
  });

  it("shows the pair as one card on a one-language row too - the partner is linked as a translation", () => {
    const written = new Map([
      [72, makeWritten(72, { partner_target_id: 82 })],
      [82, makeWritten(82, { lang: "en", partner_target_id: 72 })],
    ]);
    const recs = buildRecommendations({ aiLinks: [], aiPlaces: [], identical: [], similar: [similar(72)] }, (ids) => addPartnerTargets(ids, written));
    expect(recs.map((rec) => rec.destination)).toEqual([{ kind: "link", targetIds: [72, 82] }]);
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

describe("pickNearby", () => {
  const rows = [makeWritten(1), makeWritten(2), makeWritten(3, { kind: "table" }), makeWritten(4), makeWritten(5, { target_doc_id: 8 })];

  it("returns the sentences around the picked ones in the same document", () => {
    expect(pickNearby(rows, [2]).map((row) => row.target_id)).toEqual([1, 4]);
  });

  it("skips tables and other documents", () => {
    expect(pickNearby(rows, [4]).map((row) => row.target_id)).toEqual([2]);
  });
});

describe("listSiblingPlaces", () => {
  const option = (slotKey: string, docId = 6, disabled = false): DestinationOption => ({
    id: `slot:${docId}:${slotKey}`, destination: { kind: "slot", docId, slotKey }, docCode: "SOP-CF", label: slotKey, disabled, depth: 0,
  });
  const options = [option("purpose"), option("scope"), option("defs", 6, true), option("resp"), option("other", 7)];

  it("lists the other places of the same To-Be document, N/A included", () => {
    expect(listSiblingPlaces(options, { kind: "slot", docId: 6, slotKey: "scope" }).map((item) => item.label)).toEqual(["purpose", "defs", "resp"]);
  });

  it("has nothing for links and disposals", () => {
    expect(listSiblingPlaces(options, { kind: "delete" })).toEqual([]);
  });
});

describe("canMakeOtherLanguage", () => {
  const slot = { kind: "slot", docId: 6, slotKey: "scope" } as const;

  it("offers the missing language for a confirmed one-language row in a slot", () => {
    expect(canMakeOtherLanguage(["ko"], slot, true)).toBe("en");
    expect(canMakeOtherLanguage(["en"], slot, true)).toBe("ko");
  });

  it("offers nothing before confirming, for pairs, or for links", () => {
    expect(canMakeOtherLanguage(["ko"], slot, false)).toBeNull();
    expect(canMakeOtherLanguage(["ko", "en"], slot, true)).toBeNull();
    expect(canMakeOtherLanguage(["ko"], { kind: "link", targetIds: [1] }, true)).toBeNull();
    expect(canMakeOtherLanguage(["neutral"], slot, true)).toBeNull();
  });
});

describe("isRecommendationPicked", () => {
  // 한/영 짝: KO 71 ↔ EN 72
  const written = new Map([
    [71, makeWritten(71, { lang: "ko", partner_target_id: 72 })],
    [72, makeWritten(72, { lang: "en", partner_target_id: 71 })],
    [73, makeWritten(73, { lang: "ko" })],
  ]);

  it("is on for a KO/EN pair row after picking adds the partner sentence", () => {
    // pickDestination이 짝을 더한 초안
    const draft = { kind: "link" as const, targetIds: addPartnerTargets([71], written) };
    expect(draft.targetIds).toEqual([71, 72]);
    expect(isRecommendationPicked(draft, { kind: "link", targetIds: [71] }, written)).toBe(true);
  });

  it("is on for a sentence with no partner", () => {
    expect(isRecommendationPicked({ kind: "link", targetIds: [73] }, { kind: "link", targetIds: [73] }, written)).toBe(true);
  });

  it("is off for a draft that lacks the partner the pick would add", () => {
    expect(isRecommendationPicked({ kind: "link", targetIds: [71] }, { kind: "link", targetIds: [71] }, written)).toBe(false);
  });

  it("is off when the draft holds another sentence or an extra one", () => {
    expect(isRecommendationPicked({ kind: "link", targetIds: [73] }, { kind: "link", targetIds: [71] }, written)).toBe(false);
    expect(isRecommendationPicked({ kind: "link", targetIds: [71, 72, 73] }, { kind: "link", targetIds: [71] }, written)).toBe(false);
  });

  it("is off with no draft and compares places by id", () => {
    expect(isRecommendationPicked(null, { kind: "link", targetIds: [71] }, written)).toBe(false);
    expect(isRecommendationPicked({ kind: "slot", docId: 3, slotKey: "purpose" }, { kind: "slot", docId: 3, slotKey: "purpose" }, written)).toBe(true);
    expect(isRecommendationPicked({ kind: "delete" }, { kind: "slot", docId: 3, slotKey: "purpose" }, written)).toBe(false);
  });
});

describe("buildLinkPairs", () => {
  const rows = [makeWritten(71, { lang: "ko", source_unit_ids: [10] }), makeWritten(72, { lang: "en", source_unit_ids: [11, 99], status: "ai_suggested" }), makeWritten(73, { lang: "ko" })];

  it("keeps only sources in the open Old document and marks AI-suggested links", () => {
    expect(buildLinkPairs(rows, new Set([10, 11]), null)).toEqual([
      { unitId: 10, targetId: 71, draft: false, ai: false },
      { unitId: 11, targetId: 72, draft: false, ai: true },
    ]);
  });

  it("adds unsaved picks against same-language units only, once", () => {
    const pairs = buildLinkPairs(rows, new Set([10, 11, 12]), { units: [{ id: 10, lang: "ko" }, { id: 12, lang: "en" }], targetIds: [71, 73] });
    expect(pairs.filter((pair) => pair.draft)).toEqual([{ unitId: 10, targetId: 73, draft: true, ai: false }]);
  });

  it("draws a line to a New sentence the row has no language for, from every unit of the row", () => {
    // 영어 단위 하나, 한글 새 문장 하나 → 선 하나(번역으로 이어진다)
    expect(buildLinkPairs(rows, new Set([5]), { units: [{ id: 5, lang: "en" }], targetIds: [71] })).toEqual([{ unitId: 5, targetId: 71, draft: true, ai: false }]);
  });
});

describe("findLinkPartners and pickDrawnLinks", () => {
  const pairs = [
    { unitId: 10, targetId: 71, draft: false, ai: false },
    { unitId: 10, targetId: 72, draft: false, ai: false },
    { unitId: 11, targetId: 72, draft: false, ai: false },
  ];

  it("finds the other side", () => {
    expect(findLinkPartners(pairs, "old", 10)).toEqual([71, 72]);
    expect(findLinkPartners(pairs, "new", 72)).toEqual([10, 11]);
    expect(findLinkPartners(pairs, "new", 5)).toEqual([]);
  });

  it("draws all lines when few and marks focused ones strong", () => {
    const drawn = pickDrawnLinks(pairs, new Set([11]), new Set());
    expect(drawn.map((pair) => pair.strong)).toEqual([false, false, true]);
  });

  it("draws only focused lines when there are many", () => {
    expect(pickDrawnLinks(pairs, new Set(), new Set([71]), 2)).toEqual([{ unitId: 10, targetId: 71, draft: false, ai: false, strong: true }]);
    expect(pickDrawnLinks(pairs, new Set(), new Set(), 2)).toEqual([]);
  });
});

describe("listLinkMenuItems", () => {
  it("offers confirm after picking, unlink on a confirmed link, link otherwise", () => {
    expect(listLinkMenuItems({ picked: true, linked: true, confirmed: true, hasTarget: true, canEdit: true })).toEqual(["confirm", "cancel"]);
    expect(listLinkMenuItems({ picked: false, linked: true, confirmed: true, hasTarget: true, canEdit: true })).toEqual(["unlink", "close"]);
    expect(listLinkMenuItems({ picked: false, linked: true, confirmed: false, hasTarget: true, canEdit: true })).toEqual(["confirm", "unlink", "close"]);
    expect(listLinkMenuItems({ picked: false, linked: false, confirmed: false, hasTarget: true, canEdit: true })).toEqual(["link", "close"]);
  });

  it("shows nothing when the bundle cannot be edited", () => {
    expect(listLinkMenuItems({ picked: true, linked: false, confirmed: false, hasTarget: true, canEdit: false })).toEqual([]);
  });

  it("shows nothing when nothing is picked and no sentence is known (a recommendation menu after saving)", () => {
    expect(listLinkMenuItems({ picked: false, linked: false, confirmed: true, hasTarget: false, canEdit: true })).toEqual([]);
    // 고른 채로면 문장을 몰라도 확정할 수 있다(추천 카드에서 연 메뉴)
    expect(listLinkMenuItems({ picked: true, linked: false, confirmed: false, hasTarget: false, canEdit: true })).toEqual(["confirm", "cancel"]);
  });
});

describe("listUnlinkRemainder", () => {
  it("drops the sentence and its KO/EN partner", () => {
    const written = new Map([
      [71, makeWritten(71, { partner_target_id: 72 })],
      [72, makeWritten(72, { lang: "en", partner_target_id: 71 })],
      [73, makeWritten(73)],
    ]);
    expect(listUnlinkRemainder([71, 72, 73], 71, written)).toEqual([73]);
    expect(listUnlinkRemainder([73], 73, written)).toEqual([]);
  });
});
