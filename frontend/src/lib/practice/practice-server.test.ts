// 가짜 서버(설계 §6.4-3) - api-sop.ts의 실제 함수로 과제 순서를 연습 Bundle에 부르고 fetch가 한 번도 불리지 않는다.
// 모르는 경로 · 편집 종류는 실제와 같은 ApiError 422 practice_unsupported, 과제 판정이 읽는 기록이 남는다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../api";
import { buildRecommendations, mergeGroups } from "../assign-model";
import { buildGroupSave } from "../classify-model";
import { pickSaveOp } from "../decision-step-model";
import { buildLinkSave } from "../link-save-model";
import { planPrimary } from "../primary-model";
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
  type UnitRow,
} from "../api-sop";
import { PRACTICE_BUNDLE_ID, PRACTICE_PATH } from "../practice-route";

import { PRACTICE_ROUTE_COUNT, handlePracticeRequest, notePracticeAct, readPracticeSnapshot, resetPracticeServer, subscribePractice, type PracticeLogEntry } from "./practice-server";
import { listAchieved } from "./practice-tasks";
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

  // 이 시나리오의 fetch 0회가 연습 Assign이 -1 밖의 Bundle id를 부르지 않는다는 근거이기도 하다(실제 id면 실제 서버로 간다)
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

// D22 - 잇기와 카드 확정은 둘 다 groups/save다. Assign의 실제 명령 모델로 지은 본문을 보내 기록이 어떻게 갈리는지 고정한다.
// 되돌리기 메타는 use-assign-page.tsx의 sendLink · sendSave가 짓는 꼴 그대로(그 두 줄은 practice-tasks.test.ts가 소스로 붙든다)
describe("link and card confirm land as different tasks (D22)", () => {
  const toSource = (unit: UnitRow) => ({ id: unit.unit_id, kind: unit.kind, lang: unit.lang, text: unit.text, content_start: unit.content_start, revision: unit.decision.revision });

  it("pins the bodies Assign's command models build", async () => {
    const units = await listAllUnits(B, TEST_OLD_DOC);
    const rowOf = (ids: number[]) => units.filter((unit) => ids.includes(unit.unit_id));
    // 잇기: Old 짝 A를 고르고 New A′를 골라 단추 줄의 잇기 - link-save-model buildLinkSave, 메타는 sendLink(op link + 이은 문장)
    const rowA = [U.pairAKo, U.pairAEn];
    const link = buildLinkSave({ row: { unitIds: rowA }, units: rowOf(rowA), groups: [await getGroupByUnit(B, U.pairAKo), await getGroupByTarget(B, TEST_TARGETS.aPrime)], result: [TEST_TARGETS.aPrime], reason: "" });
    if (link.kind !== "save") throw new Error("link should save");
    await saveGroup(B, link.body, { session: SESSION, op: "link", focus_unit_id: rowA[0], focus_target_id: TEST_TARGETS.aPrime });
    // 카드 확정: Old 짝 B 하나를 고른 채 Enter - primary-model planPrimary의 첫 카드, 메타는 sendSave(pickSaveOp + 고른 Unit만)
    const rowB = [U.pairBKo, U.pairBEn];
    const recommendations = buildRecommendations({ aiLinks: [], aiPlaces: [], identical: [], similar: await listNewCandidates(B, U.pairBKo) });
    const plan = planPrimary({ canEdit: true, hasRow: true, destination: null, recommendations, blockKey: null, orderPreviewTableId: null });
    if (plan.kind !== "confirm") throw new Error(`card confirm planned ${plan.kind}`);
    const group = mergeGroups([await getGroupByUnit(B, U.pairBKo), await getGroupByTarget(B, TEST_TARGETS.bPrime)]);
    const body = buildGroupSave({ destination: plan.destination, texts: {}, reason: "" }, { units: rowOf(rowB).map(toSource), group, tables: new Map() }, "confirm");
    const op = pickSaveOp({ action: "confirm", destinationKind: plan.destination.kind, savedLinkIds: [], nextLinkIds: plan.destination.kind === "link" ? plan.destination.targetIds : [] });
    await saveGroup(B, body, { session: SESSION, op, focus_unit_id: rowB[0] });

    // 카드도 New 문장으로 가는 확정이라 op는 "link"다(설계가 처음 짐작한 "confirm"이 아니다) - 가르는 것은 이은 문장을 싣느냐다
    expect(listWrites().map(({ action, undoOp, focusTargetId }) => [action, undoOp, focusTargetId ?? null])).toEqual([
      ["confirm", "link", TEST_TARGETS.aPrime],
      ["confirm", "link", null],
    ]);
    const log = readPracticeSnapshot().log;
    expect([...listAchieved(log.slice(0, 1))]).toEqual(["link"]);
    expect([...listAchieved(log.slice(1))]).toEqual(["confirm"]);
  });

  it("marks the Shift+P join of a pair so it is not the Merge task", async () => {
    await editUnits(B, TEST_OLD_DOC, 3, { type: "merge", unit_ids: [U.pairAKo, U.pairAEn] }, false, { session: SESSION });
    await editUnits(B, TEST_OLD_DOC, 4, { type: "merge", unit_ids: [U.brokenHead, U.brokenTail] }, false, { session: SESSION });
    expect(listWrites().map((entry) => entry.isPairJoin ?? false)).toEqual([true, false]);
    expect([...listAchieved(readPracticeSnapshot().log)]).toEqual(["merge"]);
  });
});

describe("what practice does not do is visible", () => {
  it("rejects unknown routes and edit kinds with practice_unsupported", async () => {
    const reset = await catchApiError(resetAssignments(B, { revision: 1 }));
    expect([reset.status, reset.rule?.code]).toEqual([422, "practice_unsupported"]);
    const edit = await catchApiError(editUnits(B, TEST_OLD_DOC, 3, { type: "split_sentences", unit_id: U.twoSentences }));
    expect([edit.status, edit.rule?.code, edit.rule?.what]).toEqual([422, "practice_unsupported", "edits:split_sentences"]);
    // 실제 Bundle은 api.ts가 실제 서버로 보낸다 - 가짜 서버에 잘못 와도 실제 자료를 흉내 내지 않는다
    const real = await handlePracticeRequest("GET", "/bundles/5");
    expect(real.status).toBe(422);
    expect(listWrites()).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("answers an empty undo stack the way the backend does", async () => {
    const err = await catchApiError(undoDecision(B, SESSION));
    expect([err.status, err.rule?.code]).toEqual([409, "nothing_to_undo"]);
  });
});
