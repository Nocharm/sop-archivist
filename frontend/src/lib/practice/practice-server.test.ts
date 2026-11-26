// 가짜 서버(설계 §6.4-3) - api-sop.ts의 실제 함수로 과제 순서를 연습 Bundle에 부르고 fetch가 한 번도 불리지 않는다.
// 모르는 경로 · 편집 종류는 실제와 같은 ApiError 422 practice_unsupported, 과제 판정이 읽는 기록이 남는다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../api";
import {
  clearDecisions,
  createPair,
  editUnits,
  getAiStatus,
  getBundle,
  getDocumentView,
  getGroupByTarget,
  getGroupByUnit,
  getTableCounterpart,
  getToBe,
  getUnitRef,
  listAllUnits,
  listDocuments,
  listIdenticalCandidates,
  listNewCandidates,
  listOpenTranslations,
  listRecentRemarks,
  listSuggestions,
  listWrittenSentences,
  resetAssignments,
  saveGroup,
  undoDecision,
  type GroupSaveInput,
  type SaveOp,
} from "../api-sop";
import { PRACTICE_BUNDLE_ID, PRACTICE_PATH } from "../practice-route";

import { PRACTICE_ROUTE_COUNT, notePracticeAct, readPracticeSnapshot, resetPracticeServer, subscribePractice, type PracticeLogEntry } from "./practice-server";
import { TEST_OLD_DOC, TEST_TABLE, TEST_TARGETS, TEST_UNITS as U, buildPracticeTestFixture } from "./practice-test-fixture";

const B = PRACTICE_BUNDLE_ID;
const SESSION = "practice-test";

let fetchSpy: ReturnType<typeof vi.fn<typeof fetch>>;

beforeEach(() => {
  resetPracticeServer(buildPracticeTestFixture());
  fetchSpy = vi.fn<typeof fetch>(async () => new Response("{}"));
  vi.stubGlobal("fetch", fetchSpy);
  window.history.pushState({}, "", PRACTICE_PATH);
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.pushState({}, "", "/");
});

function buildSave(unitIds: number[], action: "confirm" | "hold", targetId: number | null): GroupSaveInput {
  return {
    action,
    hold_reason: action === "hold" ? "Ask the owner" : "",
    units: unitIds.map((unit_id) => ({ unit_id, revision: 1, disposition: action === "hold" ? "unassigned" : "assigned", move_target_code: "", reason: "" })),
    targets: targetId === null ? [] : [{ key: `t${targetId}`, id: targetId, revision: 1, source_unit_ids: unitIds }],
    removed_target_ids: [],
  };
}

function listWrites(): Exclude<PracticeLogEntry, { act: unknown }>[] {
  return readPracticeSnapshot().log.filter((entry): entry is Exclude<PracticeLogEntry, { act: unknown }> => "route" in entry);
}

async function catchApiError(promise: Promise<unknown>): Promise<ApiError> {
  const err = await promise.catch((e: unknown) => e);
  if (!(err instanceof ApiError)) throw new Error(`expected ApiError, got ${String(err)}`);
  return err;
}

describe("practice requests never reach the real server", () => {
  it("answers every read Assign makes on the practice bundle", async () => {
    expect(PRACTICE_ROUTE_COUNT).toBe(25);
    expect((await getBundle(B)).my_role).toBe("author");
    expect((await listDocuments(B)).map((doc) => doc.id)).toEqual([TEST_OLD_DOC, 900002]);
    expect((await getDocumentView(B, TEST_OLD_DOC)).units.length).toBe(12);
    expect((await listAllUnits(B, TEST_OLD_DOC)).length).toBe(12);
    expect((await getToBe(B)).docs).toHaveLength(1);
    expect((await listWrittenSentences(B)).map((item) => item.target_id)).toEqual([TEST_TARGETS.aPrime, TEST_TARGETS.bPrime]);
    expect((await getGroupByTarget(B, TEST_TARGETS.aPrime)).targets).toHaveLength(1);
    expect((await getGroupByUnit(B, U.cellKey)).units.map((unit) => unit.unit_id)).toEqual([U.table, U.cellKey, U.cellMeaning]);
    expect(await listNewCandidates(B, U.pairBKo)).toHaveLength(1);
    expect((await getAiStatus(B)).ai_enabled).toBe(false);
    expect(await listSuggestions(B, "classify")).toEqual([]);
    expect(await listIdenticalCandidates(B)).toEqual([]);
    expect(await listOpenTranslations(B)).toEqual([]);
    expect((await getTableCounterpart(B, TEST_OLD_DOC, TEST_TABLE)).source_table_id).toBeNull();
    expect((await getUnitRef(B, TEST_OLD_DOC, U.title)).state).toBeNull();
    expect(await listRecentRemarks()).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("follows the task order with real API functions and calls fetch zero times", async () => {
    const undo = (op?: SaveOp, step_key?: string) => ({ session: SESSION, ...(op ? { op } : {}), ...(step_key ? { step_key } : {}) });
    const view = () => getDocumentView(B, TEST_OLD_DOC);
    await listAllUnits(B);
    await saveGroup(B, buildSave([U.pairAKo, U.pairAEn], "confirm", TEST_TARGETS.aPrime), undo("link"));
    await saveGroup(B, buildSave([U.pairBKo, U.pairBEn], "confirm", TEST_TARGETS.bPrime), undo("confirm"));
    await saveGroup(B, buildSave([U.twoSentences], "hold", null), undo("hold"));
    expect(await clearDecisions(B, [{ unit_id: U.pairBKo, revision: 2 }, { unit_id: U.pairBEn, revision: 2 }], undo())).toEqual([U.pairBKo, U.pairBEn]);
    const merged = await editUnits(B, TEST_OLD_DOC, 3, { type: "merge", unit_ids: [U.brokenHead, U.brokenTail] }, false, undo());
    const split = await editUnits(B, TEST_OLD_DOC, 3, { type: "split", unit_id: merged.created_unit_ids[0], at: "끊긴 문장의 앞 조각은".length + 1 }, false, undo());
    expect(split.created_unit_ids).toHaveLength(2);
    // ⇧P 두 번: 짝 카드 → 한 문장(merge), 한 문장 → 짝(unmerge → set_language → pairs)
    const sentence = await editUnits(B, TEST_OLD_DOC, 3, { type: "merge", unit_ids: [U.pairAKo, U.pairAEn] }, false, undo(undefined, "p1"));
    await editUnits(B, TEST_OLD_DOC, 3, { type: "unmerge", unit_id: sentence.created_unit_ids[0] }, false, undo(undefined, "p2"));
    await editUnits(B, TEST_OLD_DOC, 3, { type: "set_language", unit_ids: [U.pairAEn], lang: "en" }, false, undo(undefined, "p2"));
    const { pair } = await createPair(B, TEST_OLD_DOC, 3, [U.pairAKo, U.pairAEn], undo(undefined, "p2"));
    expect((await view()).units.find((unit) => unit.id === U.pairAEn)?.pair_id).toBe(pair?.id);
    await editUnits(B, TEST_OLD_DOC, 3, { type: "set_layout_table", table_id: TEST_TABLE, is_layout: true }, true, undo());
    await editUnits(B, TEST_OLD_DOC, 3, { type: "set_noise_reason", unit_ids: [U.toc], reason: "Old contents page" }, false, undo());
    expect((await listRecentRemarks()).map((remark) => remark.text)).toEqual(["Old contents page", "Ask the owner"]);
    const step = await undoDecision(B, SESSION);
    expect(step.unit_ids).toContain(U.toc);
    expect((await view()).units.find((unit) => unit.id === U.toc)?.noise_reason).toBe("");
    expect(fetchSpy).not.toHaveBeenCalled();

    expect(listWrites().map(({ route, editType, undoOp, action }) => [route, editType ?? action ?? null, undoOp ?? null])).toEqual([
      ["groups/save", "confirm", "link"],
      ["groups/save", "confirm", "confirm"],
      ["groups/save", "hold", "hold"],
      ["decisions/clear", null, null],
      ["decisions/clear", null, null],
      ["edits", "merge", null],
      ["edits", "split", null],
      ["edits", "merge", null],
      ["edits", "unmerge", null],
      ["edits", "set_language", null],
      ["pairs", null, null],
      ["edits", "set_layout_table:unwrap", null],
      ["edits", "set_noise_reason", null],
      ["decisions/undo", null, "set_noise_reason"],
    ]);
  });

  it("keeps the log after an undo and tells subscribers about every write and act", async () => {
    const heard = vi.fn();
    const stop = subscribePractice(heard);
    await saveGroup(B, buildSave([U.pairBKo], "confirm", TEST_TARGETS.bPrime), { session: SESSION, op: "confirm" });
    const before = readPracticeSnapshot();
    await undoDecision(B, SESSION);
    notePracticeAct({ key: "move_next" });
    notePracticeAct({ click: "keyboard-map" });
    stop();
    const after = readPracticeSnapshot();
    expect(after.log.slice(0, before.log.length)).toEqual(before.log);
    expect(after.log.slice(-2)).toEqual([{ act: { key: "move_next" } }, { act: { click: "keyboard-map" } }]);
    expect(after.version).toBe(before.version + 3);
    expect(heard).toHaveBeenCalledTimes(4);
    expect(readPracticeSnapshot()).toBe(after);
  });
});

describe("what practice does not do is visible", () => {
  it("rejects unknown routes and edit kinds with practice_unsupported", async () => {
    const reset = await catchApiError(resetAssignments(B, { revision: 1 }));
    expect([reset.status, reset.rule?.code]).toEqual([422, "practice_unsupported"]);
    const edit = await catchApiError(editUnits(B, TEST_OLD_DOC, 3, { type: "split_sentences", unit_id: U.twoSentences }));
    expect([edit.status, edit.rule?.code, edit.rule?.what]).toEqual([422, "practice_unsupported", "edits:split_sentences"]);
    // /practice에서 실제 Bundle을 부르면 흉내 내지 않는다
    const real = await catchApiError(getBundle(5));
    expect(real.rule?.code).toBe("practice_unsupported");
    expect(listWrites()).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("answers an empty undo stack the way the backend does", async () => {
    const err = await catchApiError(undoDecision(B, SESSION));
    expect([err.status, err.rule?.code]).toEqual([409, "nothing_to_undo"]);
  });
});
