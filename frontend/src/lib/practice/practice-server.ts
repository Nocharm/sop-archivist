// 연습 화면의 브라우저 안 가짜 서버(설계 2026-11-26-practice-page §6.1 · §5 표) - api.ts sendRequest가 동적 import로 부른다(D1).
// 과제에 쓰는 경로 25개만 답하고, 그 밖은 422 practice_unsupported로 눈에 보이게 거절한다(D5 - 조용히 비우지 않는다).
// 상태는 이 모듈 변수에만 산다 - 페이지를 새로 읽으면 처음, 앱 안에서 떠났다 돌아오면 이어진다(D11).
// Assign이 부르는 읽기 · 쓰기를 더하면 여기 경로 표(ROUTES)도 더한다 - 없으면 연습에서 "Not available in practice"가 뜬다.

import type { AiStatus, Bundle, TableCounterpart, UnitRefDetail } from "../api-sop";
import type { AssignKeyId } from "../assign-keymap";
import { PRACTICE_BUNDLE_ID } from "../practice-route";

import {
  PracticeUnsupportedError,
  applyEdit,
  bulkDecide,
  clearDecision,
  confirmPair,
  createPair,
  createPracticeState,
  deletePair,
  hasDocument,
  listCandidates,
  listRemarks,
  listUnitRows,
  listWritten,
  readDocuments,
  readGroup,
  readView,
  saveGroup,
  stepDecision,
  type BulkDecideBody,
  type EditBody,
  type GroupSaveBody,
  type PracticeFixture,
  type PracticeState,
} from "./practice-state";

/** 서버에 자취가 없는 손짓 - 연습 틀이 본 것을 적는다(D9) */
export type PracticeAct = { key: AssignKeyId } | { click: "keyboard-map" };

export type PracticeWriteRoute =
  | "groups/save"
  | "decisions/bulk"
  | "decisions/clear"
  | "decisions/undo"
  | "decisions/redo"
  | "edits"
  | "pairs"
  | "pairs/delete"
  | "pairs/confirm";

/** 한 일 기록 한 줄 - 과제 판정이 읽는다. append-only라 되돌려도 줄지 않는다(D9) */
export type PracticeLogEntry =
  | { route: PracticeWriteRoute; editType?: string; undoOp?: string; action?: string; unitIds: number[] }
  | { act: PracticeAct };

/** 과제 칸이 useSyncExternalStore로 읽는 값 - 쓰기 · 손짓마다 새 객체(판 번호가 오른다) */
export interface PracticeSnapshot {
  version: number;
  log: readonly PracticeLogEntry[];
}

interface PracticeRequest {
  match: RegExpExecArray;
  query: URLSearchParams;
  body: unknown;
  state: PracticeState;
}

interface Reply {
  status: number;
  body?: unknown;
  entry?: PracticeLogEntry;
}

type Handler = (request: PracticeRequest) => Reply;

interface Route {
  method: string;
  pattern: RegExp;
  handle: Handler;
}

const UNSUPPORTED_CODE = "practice_unsupported";
const BUNDLE = String.raw`/bundles/(-?\d+)`;

// 상태 · 자료 읽기
const ok = (body: unknown): Reply => ({ status: 200, body });
const readId = (match: RegExpExecArray, index: number) => Number(match[index]);

/** 연습 자료를 싣는다 - 시험은 resetPracticeServer로 자료를 넣는다 */
async function loadBundledFixture(): Promise<PracticeFixture> {
  const { default: fixture } = await import("./practice-fixture.json");
  // JSON 모듈은 글자 값을 string으로 넓혀 api-sop의 문자 합 타입과 맞지 않는다 - 꼴은 백엔드 신선도 시험(test_practice_fixture)이 지킨다
  return fixture as unknown as PracticeFixture;
}

const EMPTY_AI_STATUS: AiStatus = {
  ai_enabled: false,
  embed_enabled: false,
  jobs: { queued: 0, running: 0, done: 0, failed: 0, stale: 0, cancelled: 0 },
  by_kind: {},
  failed_errors: {},
  user_active: 0,
  adoption: {},
};

const ROUTES: Route[] = [
  { method: "GET", pattern: new RegExp(`^${BUNDLE}$`), handle: ({ state }) => ok(structuredClone(state.fixture.bundle) satisfies Bundle) },
  { method: "GET", pattern: new RegExp(`^${BUNDLE}/documents$`), handle: ({ state }) => ok(readDocuments(state)) },
  {
    method: "GET",
    pattern: new RegExp(String.raw`^${BUNDLE}/documents/(\d+)/view$`),
    handle: ({ state, match }) => {
      if (!hasDocument(state, readId(match, 2))) throw new PracticeUnsupportedError(`document ${match[2]}`);
      return ok(readView(state, readId(match, 2)));
    },
  },
  {
    method: "GET",
    pattern: new RegExp(`^${BUNDLE}/units$`),
    handle: ({ state, query }) => {
      const documentId = query.get("document_id");
      const rows = listUnitRows(state, documentId === null ? undefined : Number(documentId));
      const offset = Number(query.get("offset") ?? 0);
      return ok({ total: rows.length, items: rows.slice(offset, offset + Number(query.get("limit") ?? rows.length)) });
    },
  },
  { method: "GET", pattern: new RegExp(`^${BUNDLE}/tobe$`), handle: ({ state }) => ok(structuredClone(state.fixture.tobe)) },
  { method: "GET", pattern: new RegExp(`^${BUNDLE}/written-sentences$`), handle: ({ state }) => ok(listWritten(state)) },
  { method: "GET", pattern: new RegExp(String.raw`^${BUNDLE}/groups/by-unit/(\d+)$`), handle: ({ state, match }) => ok(readGroup(state, [readId(match, 2)], [])) },
  { method: "GET", pattern: new RegExp(String.raw`^${BUNDLE}/groups/by-target/(\d+)$`), handle: ({ state, match }) => ok(readGroup(state, [], [readId(match, 2)])) },
  { method: "GET", pattern: new RegExp(String.raw`^${BUNDLE}/units/(\d+)/new-candidates$`), handle: ({ state, match }) => ok(listCandidates(state, readId(match, 2))) },
  { method: "GET", pattern: /^\/sop\/remarks\/recent$/, handle: ({ state, query }) => ok(listRemarks(state, Number(query.get("limit") ?? 10))) },
  // 빈 답 - AI는 꺼짐, 같은 글자 일괄 · 번역 · 짝 표 · 참조 줄은 자료에 없다
  { method: "GET", pattern: new RegExp(`^${BUNDLE}/ai/status$`), handle: () => ok(EMPTY_AI_STATUS) },
  { method: "GET", pattern: new RegExp(`^${BUNDLE}/ai/suggestions$`), handle: () => ok({ total: 0, items: [] }) },
  { method: "GET", pattern: new RegExp(`^${BUNDLE}/match/identical-candidates$`), handle: () => ok([]) },
  { method: "GET", pattern: new RegExp(`^${BUNDLE}/translations/open$`), handle: () => ok([]) },
  {
    method: "GET",
    pattern: new RegExp(String.raw`^${BUNDLE}/documents/(\d+)/tables/(\d+)/counterpart$`),
    handle: () => ok({ table_no: 0, status: "none", source_table_id: null, decided: false, candidates: [] } satisfies TableCounterpart),
  },
  {
    method: "GET",
    pattern: new RegExp(String.raw`^${BUNDLE}/documents/(\d+)/units/(\d+)/ref$`),
    handle: () => ok({ state: null, number: "", equis: null, suggested_text: null } satisfies UnitRefDetail),
  },
  // 쓰기 - 받은 것을 그대로 반영한다(§6.3)
  {
    method: "POST",
    pattern: new RegExp(`^${BUNDLE}/groups/save$`),
    handle: ({ state, body }) => {
      const input = body as GroupSaveBody;
      return {
        status: 200,
        body: saveGroup(state, input),
        entry: { route: "groups/save", action: input.action, undoOp: input.undo?.op, unitIds: input.units.map((unit) => unit.unit_id) },
      };
    },
  },
  {
    method: "POST",
    pattern: new RegExp(`^${BUNDLE}/decisions/bulk$`),
    handle: ({ state, body }) => {
      const input = body as BulkDecideBody;
      return {
        status: 200,
        body: bulkDecide(state, input),
        entry: { route: "decisions/bulk", action: input.action, undoOp: input.undo?.op, unitIds: input.units.map((unit) => unit.unit_id) },
      };
    },
  },
  {
    method: "POST",
    pattern: new RegExp(`^${BUNDLE}/decisions/clear$`),
    handle: ({ state, body }) => {
      const input = body as Parameters<typeof clearDecision>[1];
      return { status: 200, body: clearDecision(state, input), entry: { route: "decisions/clear", undoOp: input.undo?.op, unitIds: [input.unit_id] } };
    },
  },
  { method: "POST", pattern: new RegExp(`^${BUNDLE}/decisions/undo$`), handle: ({ state }) => replyStep(state, "undo") },
  { method: "POST", pattern: new RegExp(`^${BUNDLE}/decisions/redo$`), handle: ({ state }) => replyStep(state, "redo") },
  {
    method: "POST",
    pattern: new RegExp(String.raw`^${BUNDLE}/documents/(\d+)/edits$`),
    handle: ({ state, match, body }) => {
      const input = body as EditBody;
      const result = applyEdit(state, readId(match, 2), input);
      const op = input.op;
      const unitIds = "unit_ids" in op ? op.unit_ids : "unit_id" in op ? [op.unit_id] : result.retired_unit_ids;
      const editType = op.type === "set_layout_table" && op.is_layout ? "set_layout_table:unwrap" : op.type;
      return { status: 200, body: result, entry: { route: "edits", editType, undoOp: input.undo?.op, unitIds } };
    },
  },
  {
    method: "POST",
    pattern: new RegExp(String.raw`^${BUNDLE}/documents/(\d+)/pairs$`),
    handle: ({ state, match, body }) => {
      const input = body as Parameters<typeof createPair>[2];
      return { status: 200, body: createPair(state, readId(match, 2), input), entry: { route: "pairs", undoOp: input.undo?.op, unitIds: input.unit_ids } };
    },
  },
  {
    method: "POST",
    pattern: new RegExp(String.raw`^${BUNDLE}/documents/(\d+)/pairs/(\d+)/confirm$`),
    handle: ({ state, match, body }) => {
      const { undo } = body as Pick<EditBody, "undo">;
      return { status: 200, body: confirmPair(state, readId(match, 2), readId(match, 3), undo), entry: { route: "pairs/confirm", undoOp: undo?.op, unitIds: [] } };
    },
  },
  {
    method: "DELETE",
    pattern: new RegExp(String.raw`^${BUNDLE}/documents/(\d+)/pairs/(\d+)$`),
    handle: ({ state, match, body }) => {
      const undo = (body as Pick<EditBody, "undo"> | undefined)?.undo;
      return { status: 200, body: deletePair(state, readId(match, 2), readId(match, 3), undo), entry: { route: "pairs/delete", undoOp: undo?.op, unitIds: [] } };
    },
  },
];

/** 가짜 서버가 흉내 내는 경로 수 - 시험이 설계 §5의 25와 맞춘다 */
export const PRACTICE_ROUTE_COUNT = ROUTES.length;

function replyStep(state: PracticeState, direction: "undo" | "redo"): Reply {
  const result = stepDecision(state, direction);
  // 스택이 비면 백엔드(decision_steps.undo_step)와 같은 거절
  if (!result) return { status: 409, body: { detail: { code: direction === "undo" ? "nothing_to_undo" : "nothing_to_redo" } } };
  return { status: 200, body: result, entry: { route: direction === "undo" ? "decisions/undo" : "decisions/redo", undoOp: result.op, unitIds: result.unit_ids } };
}

let fixtureLoader: () => Promise<PracticeFixture> = loadBundledFixture;
let statePromise: Promise<PracticeState> | null = null;
let snapshot: PracticeSnapshot = { version: 0, log: [] };
const listeners = new Set<() => void>();

function readState(): Promise<PracticeState> {
  // 첫 요청들이 함께 와도 상태는 하나 - 약속을 나눈다
  statePromise ??= fixtureLoader().then(createPracticeState);
  return statePromise;
}

function appendLog(entry: PracticeLogEntry): void {
  snapshot = { version: snapshot.version + 1, log: [...snapshot.log, entry] };
  for (const listener of listeners) listener();
}

function buildResponse(status: number, body: unknown): Response {
  if (status === 204) return new Response(null, { status });
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function buildUnsupported(what: string): Response {
  return buildResponse(422, { detail: { code: UNSUPPORTED_CODE, what } });
}

function parseBody(body: BodyInit | null | undefined): unknown {
  return typeof body === "string" ? JSON.parse(body) : undefined;
}

/** api.ts가 fetch 대신 부른다 - 실제 서버와 같은 꼴의 Response를 지어 그 뒤 오류 처리(ApiError · rule)가 같은 줄을 지난다 */
export async function handlePracticeRequest(method: string, path: string, body?: BodyInit | null): Promise<Response> {
  const url = new URL(path, "http://practice.invalid");
  const route = ROUTES.find((item) => item.method === method && item.pattern.test(url.pathname));
  const match = route?.pattern.exec(url.pathname);
  if (!route || !match) return buildUnsupported(`${method} ${url.pathname}`);
  // 연습 화면에서 연습 Bundle이 아닌 Bundle을 부르면 - 실제 자료를 흉내 내지 않는다
  if (url.pathname.startsWith("/bundles/") && Number(match[1]) !== PRACTICE_BUNDLE_ID) return buildUnsupported(`${method} ${url.pathname}`);
  const state = await readState();
  try {
    const reply = route.handle({ match, query: url.searchParams, body: parseBody(body), state });
    if (reply.entry) appendLog(reply.entry);
    return buildResponse(reply.status, reply.body);
  } catch (err) {
    if (err instanceof PracticeUnsupportedError) return buildUnsupported(err.what);
    // 가짜 서버의 버그 - 실제 서버의 500과 같은 길로 화면에 알린다
    console.error("practice server failed", { method, path: url.pathname, err });
    return buildResponse(500, { detail: "practice server error" });
  }
}

/** 연습 틀이 본 손짓을 기록에 더한다(D9 - 고르기 · 옮기기, 키보드 그림) */
export function notePracticeAct(act: PracticeAct): void {
  appendLog({ act });
}

export function subscribePractice(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function readPracticeSnapshot(): PracticeSnapshot {
  return snapshot;
}

/** 시험 전용 - 상태 · 기록을 비우고 자료를 넣는다(화면은 새로 읽기로 처음이 된다, D11) */
export function resetPracticeServer(fixture: PracticeFixture): void {
  fixtureLoader = () => Promise.resolve(fixture);
  statePromise = null;
  snapshot = { version: 0, log: [] };
}
