// 연습 상태(설계 §6.2 · §6.3) - 처음 상태에서 지은 응답이 자료와 같고, 쓰기 표의 줄마다 반영 · 응답 꼴, 되돌리기 사진(D8).
// 자료는 손으로 줄인 시험 자료(practice-test-fixture.ts) - 진짜 자료가 합쳐지면 처음 응답 시험은 그것으로도 돈다.
import { describe, expect, it } from "vitest";

import type { GroupSaveInput } from "../api-sop";

import {
  PracticeUnsupportedError,
  applyEdit,
  bulkDecide,
  clearDecision,
  confirmPair,
  createPair,
  createPracticeState,
  deletePair,
  listCandidates,
  listRemarks,
  listUnitRows,
  listWritten,
  readGroup,
  readView,
  saveGroup,
  stepDecision,
  type PracticeState,
} from "./practice-state";
import { TEST_NEW_DOC, TEST_OLD_DOC, TEST_TABLE, TEST_TARGETS, TEST_UNITS as U, buildPracticeTestFixture } from "./practice-test-fixture";

const SESSION = "s1";

function setUp(): PracticeState {
  return createPracticeState(buildPracticeTestFixture());
}

function buildLink(unitIds: number[], targetId: number, action: "confirm" | "hold", op: "link" | "confirm" | "hold", stepKey?: string): GroupSaveInput & { undo: { session: string; op: typeof op; step_key?: string } } {
  return {
    action,
    hold_reason: action === "hold" ? "Waiting for the owner" : "",
    units: unitIds.map((unit_id) => ({ unit_id, revision: 1, disposition: action === "hold" ? "unassigned" : "assigned", move_target_code: "", reason: "" })),
    targets: action === "hold" ? [] : [{ key: `t${targetId}`, id: targetId, revision: 1, source_unit_ids: unitIds }],
    removed_target_ids: [],
    undo: { session: SESSION, op, ...(stepKey ? { step_key: stepKey } : {}) },
  };
}

function findRow(state: PracticeState, unitId: number) {
  const row = listUnitRows(state).find((item) => item.unit_id === unitId);
  if (!row) throw new Error(`no row ${unitId}`);
  return row;
}

function listViewIds(state: PracticeState, docId = TEST_OLD_DOC): number[] {
  return readView(state, docId).units.map((unit) => unit.id);
}

describe("first responses equal the fixture", () => {
  it("builds units, written sentences and views exactly as the backend returned them", () => {
    const fixture = buildPracticeTestFixture();
    const state = createPracticeState(fixture);
    expect(listUnitRows(state)).toEqual(fixture.units);
    expect(listUnitRows(state, TEST_OLD_DOC)).toEqual(fixture.units);
    expect(listWritten(state)).toEqual(fixture.written);
    for (const [docId, view] of Object.entries(fixture.views)) expect(readView(state, Number(docId))).toEqual(view);
    expect(listCandidates(state, U.pairBKo).map((card) => card.target_id)).toEqual([TEST_TARGETS.bPrime]);
    expect(listCandidates(state, 999)).toEqual([]);
  });
});

describe("groups/save", () => {
  it("links Old units to a written sentence and confirms them", () => {
    const state = setUp();
    const group = saveGroup(state, buildLink([U.pairAKo, U.pairAEn], TEST_TARGETS.aPrime, "confirm", "link"));
    expect(group.units.map((unit) => unit.unit_id)).toEqual([U.pairAKo, U.pairAEn]);
    expect(group.targets.map((target) => [target.id, target.source_unit_ids, target.status])).toEqual([[TEST_TARGETS.aPrime, [U.pairAKo, U.pairAEn], "confirmed"]]);
    expect(group.units[0].group_id).toBe("G-SOP-OLD-001-003");
    expect(group.pairs_dissolved).toEqual([]);
    const row = findRow(state, U.pairAKo);
    expect([row.status, row.decision.disposition, row.decision.revision, row.target_ids, row.target_doc_ids]).toEqual(["confirmed", "assigned", 2, [TEST_TARGETS.aPrime], [401]]);
    expect(listWritten(state).find((item) => item.target_id === TEST_TARGETS.aPrime)?.source_unit_ids).toEqual([U.pairAKo, U.pairAEn]);
    expect(readGroup(state, [], [TEST_TARGETS.aPrime]).units.map((unit) => unit.unit_id)).toEqual([U.pairAKo, U.pairAEn]);
  });

  it("holds with a reason and remembers the reason", () => {
    const state = setUp();
    saveGroup(state, buildLink([U.twoSentences], 0, "hold", "hold"));
    expect(findRow(state, U.twoSentences).status).toBe("on_hold");
    expect(findRow(state, U.twoSentences).decision.hold_reason).toBe("Waiting for the owner");
    expect(listRemarks(state, 10).map((remark) => remark.text)).toEqual(["Waiting for the owner"]);
  });

  it("releases a pair member and empties removed targets", () => {
    const state = setUp();
    saveGroup(state, buildLink([U.pairBKo], TEST_TARGETS.bPrime, "confirm", "confirm"));
    const group = saveGroup(state, { ...buildLink([U.pairAKo], TEST_TARGETS.aPrime, "confirm", "link"), removed_target_ids: [TEST_TARGETS.bPrime], release_unit_ids: [U.pairAEn] });
    expect(group.pairs_dissolved).toEqual([701]);
    expect(findRow(state, U.pairAEn).pair_id).toBeNull();
    expect(listWritten(state).find((item) => item.target_id === TEST_TARGETS.bPrime)).toMatchObject({ source_unit_ids: [], status: "unassigned" });
  });

  it("refuses to create a new sentence (hidden feature)", () => {
    const state = setUp();
    const body = buildLink([U.pairAKo], TEST_TARGETS.aPrime, "confirm", "link");
    expect(() => saveGroup(state, { ...body, targets: [{ key: "new", source_unit_ids: [U.pairAKo] }] })).toThrow(PracticeUnsupportedError);
  });
});

describe("decisions/bulk and decisions/clear", () => {
  it("deletes, then clears back to unassigned and detaches the sources", () => {
    const state = setUp();
    const deleted = bulkDecide(state, { action: "delete", reason: "Duplicate", move_target_code: "", units: [{ unit_id: U.title, revision: 1 }] });
    expect(deleted[0].decision).toMatchObject({ disposition: "delete", status: "confirmed", reason: "Duplicate" });
    saveGroup(state, buildLink([U.pairBKo], TEST_TARGETS.bPrime, "confirm", "confirm"));
    const cleared = bulkDecide(state, { action: "clear", reason: "", move_target_code: "", units: [{ unit_id: U.title, revision: 2 }] });
    expect(cleared[0].decision).toMatchObject({ disposition: "unassigned", status: "unassigned", revision: 3 });
    expect(clearDecision(state, { unit_id: U.pairBKo, revision: 2 })).toEqual({ reset_unit_ids: [U.pairBKo], deleted_target_ids: [], held_unit_ids: [], held_target_ids: [] });
    expect(findRow(state, U.pairBKo)).toMatchObject({ status: "unassigned", target_ids: [] });
    expect(() => bulkDecide(state, { action: "move_external", reason: "", move_target_code: "X", units: [] })).toThrow(PracticeUnsupportedError);
  });
});

describe("edits", () => {
  it("splits a two-sentence box into two new units", () => {
    const state = setUp();
    const at = "정할 수 없는 Unit은 보류합니다. ".length;
    const result = applyEdit(state, TEST_OLD_DOC, { revision: 3, op: { type: "split", unit_id: U.twoSentences, at } });
    expect(result.document_revision).toBe(4);
    expect(result.retired_unit_ids).toEqual([U.twoSentences]);
    const [left, right] = result.created_unit_ids.map((id) => readView(state, TEST_OLD_DOC).units.find((unit) => unit.id === id));
    expect([left?.text, right?.text]).toEqual(["정할 수 없는 Unit은 보류합니다. ", "보류한 Unit은 On hold에 모입니다."]);
    expect([right?.lang, right?.is_edited, right?.number?.value, right?.status]).toEqual(["ko", true, null, "unassigned"]);
    expect([left?.display_id, right?.display_id]).toEqual(["SOP-OLD-001-015", "SOP-OLD-001-016"]);
    expect(listUnitRows(state).some((row) => row.unit_id === U.twoSentences)).toBe(false);
    expect(readView(state, TEST_OLD_DOC).document.revision).toBe(4);
  });

  it("merges two pieces and unmerge brings back the old ids", () => {
    const state = setUp();
    const merged = applyEdit(state, TEST_OLD_DOC, { revision: 3, op: { type: "merge", unit_ids: [U.brokenTail, U.brokenHead] } });
    const unit = readView(state, TEST_OLD_DOC).units.find((item) => item.id === merged.created_unit_ids[0]);
    expect(unit).toMatchObject({ text: "끊긴 문장의 앞 조각은 다음 문단에서 이어집니다.", can_unmerge: true, merge_pieces: ["끊긴 문장의 앞 조각은", "다음 문단에서 이어집니다."], lang: "ko" });
    expect(merged.retired_unit_ids).toEqual([U.brokenHead, U.brokenTail]);
    const back = applyEdit(state, TEST_OLD_DOC, { revision: 4, op: { type: "unmerge", unit_id: merged.created_unit_ids[0] } });
    expect(back.created_unit_ids).toEqual([U.brokenHead, U.brokenTail]);
    expect(listViewIds(state)).toEqual(buildPracticeTestFixture().views[TEST_OLD_DOC].units.map((item) => item.id));
  });

  it("walks the shift+P path: merge a pair, unmerge, set language, pair again", () => {
    const state = setUp();
    const merged = applyEdit(state, TEST_OLD_DOC, { revision: 3, op: { type: "merge", unit_ids: [U.pairAKo, U.pairAEn] } });
    expect(readView(state, TEST_OLD_DOC).pairs.map((pair) => pair.id)).toEqual([702]);
    applyEdit(state, TEST_OLD_DOC, { revision: 4, op: { type: "unmerge", unit_id: merged.created_unit_ids[0] } });
    expect(readView(state, TEST_OLD_DOC).units.find((unit) => unit.id === U.pairAKo)?.pair_id).toBeNull();
    applyEdit(state, TEST_OLD_DOC, { revision: 5, op: { type: "set_language", unit_ids: [U.pairAEn], lang: "en" } });
    const { pair } = createPair(state, TEST_OLD_DOC, { revision: 6, unit_ids: [U.pairAKo, U.pairAEn] });
    expect(pair).toMatchObject({ status: "confirmed", source: "human", unit_ids: [U.pairAKo, U.pairAEn] });
    expect(findRow(state, U.pairAEn).pair_id).toBe(pair?.id);
    expect(confirmPair(state, TEST_OLD_DOC, 702).pair?.status).toBe("confirmed");
    expect(deletePair(state, TEST_OLD_DOC, 702)).toEqual({ document_revision: 9, pair: null });
    expect(findRow(state, U.pairBKo).pair_id).toBeNull();
  });

  it("set_layout_table switches between the two looks the backend took", () => {
    const state = setUp();
    const wrappedIds = listViewIds(state);
    const off = applyEdit(state, TEST_OLD_DOC, { revision: 3, op: { type: "set_layout_table", table_id: TEST_TABLE, is_layout: true } });
    expect(off.retired_unit_ids).toEqual([U.table, U.cellKey, U.cellMeaning]);
    expect(off.created_unit_ids).toEqual([U.unwrappedKey, U.unwrappedMeaning]);
    expect(readView(state, TEST_OLD_DOC).tables[0].is_layout).toBe(true);
    expect(listViewIds(state).slice(-2)).toEqual([U.unwrappedKey, U.unwrappedMeaning]);
    expect(findRow(state, U.unwrappedKey).status).toBe("unassigned");
    const again = applyEdit(state, TEST_OLD_DOC, { revision: 4, op: { type: "set_layout_table", table_id: TEST_TABLE, is_layout: true } });
    expect([again.created_unit_ids, again.retired_unit_ids]).toEqual([[], []]);
    applyEdit(state, TEST_OLD_DOC, { revision: 5, op: { type: "set_layout_table", table_id: TEST_TABLE, is_layout: false } });
    expect(listViewIds(state)).toEqual(wrappedIds);
    expect(readView(state, TEST_OLD_DOC).tables[0].is_layout).toBe(false);
  });

  it("writes a reason on the auto-deleted contents block and clears it", () => {
    const state = setUp();
    applyEdit(state, TEST_OLD_DOC, { revision: 3, op: { type: "set_noise_reason", unit_ids: [U.toc], reason: "Old contents page" } });
    expect(readView(state, TEST_OLD_DOC).units.find((unit) => unit.id === U.toc)).toMatchObject({ noise_kind: "toc", noise_reason: "Old contents page" });
    expect(listRemarks(state, 10)[0].text).toBe("Old contents page");
    applyEdit(state, TEST_OLD_DOC, { revision: 4, op: { type: "clear_noise", unit_ids: [U.toc] } });
    expect(readView(state, TEST_OLD_DOC).units.find((unit) => unit.id === U.toc)).toMatchObject({ noise_kind: null, noise_reason: "" });
  });

  it("refuses every other edit kind and unknown documents", () => {
    const state = setUp();
    expect(() => applyEdit(state, TEST_OLD_DOC, { revision: 3, op: { type: "split_sentences", unit_id: U.twoSentences } })).toThrow(/edits:split_sentences/);
    expect(() => applyEdit(state, 12345, { revision: 3, op: { type: "clear_noise", unit_ids: [] } })).toThrow(PracticeUnsupportedError);
  });
});

describe("undo and redo (whole-board snapshots)", () => {
  it("restores the board, keeps revisions growing and replays on redo", () => {
    const state = setUp();
    saveGroup(state, buildLink([U.pairBKo, U.pairBEn], TEST_TARGETS.bPrime, "confirm", "confirm"));
    expect(readView(state, TEST_OLD_DOC).edits.can_undo).toBe(true);
    const undone = stepDecision(state, "undo");
    expect(undone).toMatchObject({ op: "confirm", unit_ids: [U.pairBKo, U.pairBEn], can_undo: false, can_redo: true, restored_decisions: true });
    expect(findRow(state, U.pairBKo).status).toBe("unassigned");
    expect(listWritten(state).find((item) => item.target_id === TEST_TARGETS.bPrime)?.source_unit_ids).toEqual([]);
    expect(readView(state, TEST_NEW_DOC).document.revision).toBe(4);
    stepDecision(state, "redo");
    expect(findRow(state, U.pairBKo).status).toBe("confirmed");
    expect(stepDecision(state, "redo")).toBeNull();
  });

  it("folds requests that share a step_key into one step", () => {
    const state = setUp();
    saveGroup(state, buildLink([U.pairAKo], TEST_TARGETS.aPrime, "confirm", "link", "k1"));
    saveGroup(state, buildLink([U.pairBKo], TEST_TARGETS.bPrime, "confirm", "link", "k1"));
    expect(state.undo).toHaveLength(1);
    stepDecision(state, "undo");
    expect([findRow(state, U.pairAKo).status, findRow(state, U.pairBKo).status]).toEqual(["unassigned", "unassigned"]);
    expect(stepDecision(state, "undo")).toBeNull();
  });

  it("undoes an edit back to the old unit ids", () => {
    const state = setUp();
    applyEdit(state, TEST_OLD_DOC, { revision: 3, op: { type: "split", unit_id: U.twoSentences, at: 5 }, undo: { session: SESSION } });
    stepDecision(state, "undo");
    expect(listViewIds(state)).toContain(U.twoSentences);
    expect(readView(state, TEST_OLD_DOC).document.revision).toBe(5);
  });

  it("does not record writes without undo meta", () => {
    const state = setUp();
    applyEdit(state, TEST_OLD_DOC, { revision: 3, op: { type: "set_language", unit_ids: [U.title], lang: "en" } });
    expect(stepDecision(state, "undo")).toBeNull();
  });
});
