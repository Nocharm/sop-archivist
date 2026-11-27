// 연습 화면 가짜 서버의 상태와 연산(설계 2026-11-26-practice-page §6.2 · §6.3) - 순수: React · fetch 없음, 시험의 몸통.
// 받은 요청을 검사하지 않고 그대로 반영한다(D5 - 서버 업무 규칙의 사본을 만들지 않는다). 막는 판단은 화면의 순수 모델이 이미 한다.
// 응답 꼴은 api-sop.ts 타입으로 묶어 백엔드가 꼴을 바꾸면 tsc가 알린다. 원문 편집은 D6의 일곱 종류만, 그 밖은 PracticeUnsupportedError.

import type {
  Bundle,
  CoverStatus,
  Decision,
  DecisionStepResult,
  DetachReport,
  DocumentView,
  EditOp,
  EditResult,
  Group,
  GroupSaveInput,
  GroupTarget,
  GroupUnit,
  NewCandidate,
  PairResult,
  RecentRemark,
  SopDocument,
  ToBe,
  UndoMeta,
  UnitRow,
  ViewNumber,
  ViewPair,
  ViewTable,
  ViewUnit,
  WrittenSentence,
} from "../api-sop";

/** 표 하나의 한 모습 - 표 줄과 그 표의 Unit들 · 그 Unit끼리의 짝(D7: 백엔드가 벗기기 전 · 뒤를 찍어 둔다, 벗기면 칸 Unit이 새 짝으로 맺어진다) */
export interface PracticeTableLook {
  table: ViewTable;
  units: ViewUnit[];
  pairs: ViewPair[];
}

/**
 * 연습 자료(설계 §4.1-7) - backend/scripts/dump_practice_fixture.py가 실제 백엔드 응답을 뽑아 practice-fixture.json에 쓴다.
 * JSON 객체 키는 글자라 id로 찾는 칸은 Record<string, …>이다.
 */
export interface PracticeFixture {
  _generated: string;
  bundle: Bundle;
  documents: SopDocument[];
  /** 문서 id → GET …/documents/{d}/view */
  views: Record<string, DocumentView>;
  /** GET …/units?limit=1000의 items(Old 문서 Unit 전부) */
  units: UnitRow[];
  tobe: ToBe;
  written: WrittenSentence[];
  /** 새 문장 id → GET …/groups/by-target/{t}가 실은 새 문장 */
  targets: Record<string, GroupTarget>;
  /** Old Unit id → GET …/units/{u}/new-candidates */
  candidates: Record<string, NewCandidate[]>;
  /** 표 id → 처음 모습 · 실제 서버로 벗긴 모습 */
  tableVariants: Record<string, { wrapped: PracticeTableLook; unwrapped: PracticeTableLook }>;
}

/** 연습에서 안 되는 요청 - 가짜 서버가 422 practice_unsupported로 바꾼다. what은 무엇이 안 됐는지(로그 · 시험용) */
export class PracticeUnsupportedError extends Error {
  constructor(readonly what: string) {
    super(`not available in practice: ${what}`);
    this.name = "PracticeUnsupportedError";
  }
}

/** 연습에서 판단 · 짝을 만든 사람(자료의 합성 구성원과 같은 값) */
export const PRACTICE_LOGIN = "practice";
/** 새 Unit · 짝 id의 시작 - 자료의 id(백엔드가 준 작은 수)와 문서 id(900001~)에 겹치지 않는다 */
export const PRACTICE_FIRST_NEW_ID = 950001;
/** 최근 사유 목록 상한 - 서버와 같다 */
const RECENT_REMARK_LIMIT = 10;

type TableLookName = "wrapped" | "unwrapped";

/** 되돌리기 사진에 드는 판 - 판단 · 원문 · 새 문장 · 짝(D8) */
interface PracticeBoard {
  views: Record<number, DocumentView>;
  decisions: Record<number, Decision>;
  targets: Record<number, GroupTarget>;
  /** merge가 만든 Unit → 합치기 전 Unit들(unmerge가 옛 id 그대로 되살린다) */
  merged: Record<number, ViewUnit[]>;
  tableLooks: Record<number, TableLookName>;
}

interface UndoEntry {
  board: PracticeBoard;
  op: string;
  meta: UndoMeta;
}

export interface PracticeState {
  fixture: PracticeFixture;
  board: PracticeBoard;
  /** 문서 revision - 되돌려도 줄지 않는다(화면의 doc-revision이 늘기만 하는 값으로 안다) */
  docRevision: Record<number, number>;
  remarks: RecentRemark[];
  nextId: number;
  undo: UndoEntry[];
  redo: UndoEntry[];
  /** 바로 앞 쓰기의 step_key - 같은 손짓의 이어진 요청은 되돌리기 한 칸 */
  lastStepKey: string | null;
}

const BLANK_DECISION: Decision = {
  disposition: "unassigned",
  move_target_code: "",
  reason: "",
  status: "unassigned",
  hold_reason: "",
  confirmed_by: null,
  confirmed_at: null,
  revision: 0,
};

const EMPTY_NUMBER: ViewNumber = { value: null, read: null, source: null, is_set: false, content_start: 0, from_text: false, note: null };

const HANGUL = /[가-힣]/;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function readNow(): string {
  return new Date().toISOString();
}

export function createPracticeState(fixture: PracticeFixture): PracticeState {
  const views: Record<number, DocumentView> = {};
  const docRevision: Record<number, number> = {};
  for (const [docId, view] of Object.entries(fixture.views)) {
    views[Number(docId)] = clone(view);
    docRevision[Number(docId)] = view.document.revision;
  }
  const decisions: Record<number, Decision> = {};
  for (const row of fixture.units) decisions[row.unit_id] = clone(row.decision);
  const targets: Record<number, GroupTarget> = {};
  for (const target of Object.values(fixture.targets)) targets[target.id] = clone(target);
  return {
    fixture,
    board: { views, decisions, targets, merged: {}, tableLooks: {} },
    docRevision,
    remarks: [],
    nextId: PRACTICE_FIRST_NEW_ID,
    undo: [],
    redo: [],
    lastStepKey: null,
  };
}

// ── 읽기 ──

function isOldView(view: DocumentView): boolean {
  return view.document.side === "old";
}

function listOldViews(state: PracticeState): DocumentView[] {
  return Object.values(state.board.views).filter(isOldView).sort((a, b) => a.document.id - b.document.id);
}

function getDecision(state: PracticeState, unitId: number): Decision {
  return state.board.decisions[unitId] ?? BLANK_DECISION;
}

/** Old Unit의 상태 - 칸 문장은 표 Unit의 판단을 따른다(백엔드 status.get_cover_status) */
function readCoverStatus(state: PracticeState, unit: ViewUnit): CoverStatus {
  return getDecision(state, unit.group_unit_id ?? unit.id).status;
}

function findView(state: PracticeState, docId: number): DocumentView {
  const view = state.board.views[docId];
  if (!view) throw new PracticeUnsupportedError(`document ${docId}`);
  return view;
}

function findUnitIndex(view: DocumentView, unitId: number): number {
  const index = view.units.findIndex((unit) => unit.id === unitId);
  if (index < 0) throw new PracticeUnsupportedError(`unit ${unitId}`);
  return index;
}

export function hasDocument(state: PracticeState, docId: number): boolean {
  return docId in state.board.views;
}

export function readDocuments(state: PracticeState): SopDocument[] {
  return state.fixture.documents.map((doc) => ({ ...clone(doc), revision: state.docRevision[doc.id] ?? doc.revision }));
}

export function readView(state: PracticeState, docId: number): DocumentView {
  const view = clone(findView(state, docId));
  view.document.revision = state.docRevision[docId] ?? view.document.revision;
  if (isOldView(view)) {
    for (const unit of view.units) unit.status = readCoverStatus(state, unit);
  }
  view.edits = { can_undo: state.undo.length > 0, can_redo: state.redo.length > 0 };
  return view;
}

function listLinkedTargets(state: PracticeState, unitId: number): GroupTarget[] {
  return Object.values(state.board.targets)
    .filter((target) => target.source_unit_ids.includes(unitId))
    .sort((a, b) => a.id - b.id);
}

function buildUnitRow(state: PracticeState, docId: number, unit: ViewUnit): UnitRow {
  const linked = listLinkedTargets(state, unit.id);
  const linkedIds = new Set(linked.map((target) => target.id));
  // 써 넣은 캡션 - 출처 새 문장 아래 칸 밖 문장(백엔드 find_captioned_units와 같은 꼴)
  const hasCaption = Object.values(state.board.targets).some(
    (target) => target.parent_target_id !== null && linkedIds.has(target.parent_target_id) && target.kind === "sentence" && target.cell_row === null && target.cell_col === null,
  );
  return {
    unit_id: unit.id,
    document_id: docId,
    display_id: unit.display_id,
    kind: unit.kind,
    lang: unit.lang,
    text: unit.text,
    content_start: unit.number?.content_start ?? 0,
    table_id: unit.table_id,
    row_index: unit.row_index,
    group_unit_id: unit.group_unit_id,
    status: readCoverStatus(state, unit),
    decision: clone(getDecision(state, unit.id)),
    target_ids: linked.map((target) => target.id),
    target_doc_ids: [...new Set(linked.map((target) => target.target_doc_id))].sort((a, b) => a - b),
    pair_id: unit.pair_id,
    has_caption_target: hasCaption,
    caption_figure_id: unit.caption_figure_id ?? null,
  };
}

/** GET …/units - Old 문서 Unit 전부, 문서 · 자리 순(백엔드 list_units의 정렬 키) */
export function listUnitRows(state: PracticeState, documentId?: number): UnitRow[] {
  const rows: { row: UnitRow; key: [number, number, number, number] }[] = [];
  for (const view of listOldViews(state)) {
    if (documentId !== undefined && view.document.id !== documentId) continue;
    for (const unit of view.units) {
      rows.push({ row: buildUnitRow(state, view.document.id, unit), key: [view.document.id, unit.pos_seq, unit.spans[0]?.[1] ?? 0, unit.id] });
    }
  }
  rows.sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1] || a.key[2] - b.key[2] || a.key[3] - b.key[3]);
  return rows.map((item) => item.row);
}

/** GET …/written-sentences - 자료의 목록에 새 문장의 출처 · 상태 · revision을 덮어 쓴다 */
export function listWritten(state: PracticeState): WrittenSentence[] {
  return state.fixture.written.map((sentence) => {
    const target = state.board.targets[sentence.target_id];
    if (!target) return clone(sentence);
    return { ...clone(sentence), source_unit_ids: [...target.source_unit_ids], status: target.status, revision: target.revision };
  });
}

export function listCandidates(state: PracticeState, unitId: number): NewCandidate[] {
  return clone(state.fixture.candidates[String(unitId)] ?? []);
}

export function listRemarks(state: PracticeState, limit: number): RecentRemark[] {
  return state.remarks.slice(0, limit).map((remark) => ({ ...remark }));
}

function addRemark(state: PracticeState, text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  state.remarks = [{ text: trimmed, used_at: readNow() }, ...state.remarks.filter((remark) => remark.text !== trimmed)].slice(0, RECENT_REMARK_LIMIT);
}

function mapOldUnits(state: PracticeState): Map<number, { unit: ViewUnit; docId: number; order: number }> {
  const found = new Map<number, { unit: ViewUnit; docId: number; order: number }>();
  let order = 0;
  for (const view of listOldViews(state)) {
    for (const unit of view.units) found.set(unit.id, { unit, docId: view.document.id, order: order++ });
  }
  return found;
}

/** 시작 Unit · 새 문장에서 출처 연결 · 칸 묶음 · 표 새 문장을 따라간 연결 요소(백엔드 groups.collect_component와 같은 걷기, 짝은 넣지 않는다) */
function collectComponent(state: PracticeState, unitIds: number[], targetIds: number[]): { units: Set<number>; targets: Set<number> } {
  const oldUnits = mapOldUnits(state);
  const allTargets = Object.values(state.board.targets);
  const units = new Set<number>();
  const targets = new Set<number>();
  const unitQueue = unitIds.filter((id) => oldUnits.has(id));
  const targetQueue = targetIds.filter((id) => id in state.board.targets);
  while (unitQueue.length > 0 || targetQueue.length > 0) {
    const unitId = unitQueue.pop();
    if (unitId !== undefined) {
      if (units.has(unitId)) continue;
      units.add(unitId);
      const unit = oldUnits.get(unitId)?.unit;
      if (unit?.group_unit_id != null) unitQueue.push(unit.group_unit_id);
      for (const other of oldUnits.values()) if (other.unit.group_unit_id === unitId) unitQueue.push(other.unit.id);
      for (const target of allTargets) if (target.source_unit_ids.includes(unitId)) targetQueue.push(target.id);
      continue;
    }
    const targetId = targetQueue.pop();
    if (targetId === undefined || targets.has(targetId)) continue;
    targets.add(targetId);
    const target = state.board.targets[targetId];
    unitQueue.push(...target.source_unit_ids.filter((id) => oldUnits.has(id)));
    if (target.parent_target_id !== null) targetQueue.push(target.parent_target_id);
    for (const child of allTargets) if (child.parent_target_id === targetId) targetQueue.push(child.id);
  }
  return { units, targets };
}

/** 묶음 ID - 출처 연결의 요소 중 Unit ≥2 또는 새 문장 ≥2(나눔 · 합침 · 중복)에만, 가장 앞 Unit의 표시 ID(백엔드 build_group_ids를 줄인 것) */
function buildGroupIds(state: PracticeState, units: Set<number>, targets: Set<number>): Map<string, string> {
  const oldUnits = mapOldUnits(state);
  const parents = new Map<string, string>();
  const findRoot = (node: string): string => {
    let root = node;
    while (parents.get(root) !== root) root = parents.get(root) ?? root;
    return root;
  };
  for (const targetId of targets) {
    const target = state.board.targets[targetId];
    if (target.kind === "slot_heading") continue;
    for (const unitId of target.source_unit_ids) {
      if (!units.has(unitId)) continue;
      const t = `t${targetId}`;
      const u = `u${unitId}`;
      if (!parents.has(t)) parents.set(t, t);
      if (!parents.has(u)) parents.set(u, u);
      parents.set(findRoot(t), findRoot(u));
    }
  }
  const members = new Map<string, string[]>();
  for (const node of parents.keys()) members.set(findRoot(node), [...(members.get(findRoot(node)) ?? []), node]);
  const ids = new Map<string, string>();
  for (const nodes of members.values()) {
    const unitNodes = nodes.filter((node) => node.startsWith("u")).map((node) => Number(node.slice(1)));
    if (unitNodes.length < 2 && nodes.length - unitNodes.length < 2) continue;
    const first = unitNodes.sort((a, b) => (oldUnits.get(a)?.order ?? 0) - (oldUnits.get(b)?.order ?? 0))[0];
    const groupId = `G-${oldUnits.get(first)?.unit.display_id ?? first}`;
    for (const node of nodes) ids.set(node, groupId);
  }
  return ids;
}

/** GET …/groups/by-unit · by-target와 저장 응답 - 시작점들의 연결 요소 */
export function readGroup(state: PracticeState, unitIds: number[], targetIds: number[]): Group {
  const component = collectComponent(state, unitIds, targetIds);
  const oldUnits = mapOldUnits(state);
  const groupIds = buildGroupIds(state, component.units, component.targets);
  const units: GroupUnit[] = [...component.units]
    .map((id) => oldUnits.get(id))
    .filter((found) => found !== undefined)
    .sort((a, b) => a.order - b.order)
    .map(({ unit, docId }) => ({
      unit_id: unit.id,
      display_id: unit.display_id,
      document_id: docId,
      kind: unit.kind,
      lang: unit.lang,
      text: unit.text,
      group_id: groupIds.get(`u${unit.id}`) ?? null,
      decision: clone(getDecision(state, unit.id)),
      cell_unit_ids: [...oldUnits.values()].filter((other) => other.unit.group_unit_id === unit.id).sort((a, b) => a.order - b.order).map((other) => other.unit.id),
    }));
  const targets: GroupTarget[] = [...component.targets]
    .sort((a, b) => a - b)
    .map((id) => {
      const target = state.board.targets[id];
      return { ...clone(target), source_unit_ids: target.source_unit_ids.filter((unitId) => component.units.has(unitId)), group_id: groupIds.get(`t${id}`) ?? null };
    });
  return { units, targets };
}

// ── 쓰기 ──

/** 되돌리기 한 칸을 쌓는다 - undo 메타가 실린 쓰기만(백엔드도 메타가 없으면 단계를 남기지 않는다), 같은 step_key의 이어진 요청은 한 칸 */
function recordStep(state: PracticeState, undo: UndoMeta | undefined, op: string, before?: PracticeBoard): void {
  if (!undo) return;
  const stepKey = undo.step_key ?? null;
  if (stepKey !== null && stepKey === state.lastStepKey && state.undo.length > 0) return;
  state.undo.push({ board: before ?? clone(state.board), op: undo.op ?? op, meta: { ...undo } });
  state.redo = [];
  state.lastStepKey = stepKey;
}

function bumpDocRevision(state: PracticeState, docId: number): number {
  const next = (state.docRevision[docId] ?? 0) + 1;
  state.docRevision[docId] = next;
  return next;
}

function setDecision(state: PracticeState, unitId: number, next: Omit<Decision, "revision">): Decision {
  const decision = { ...next, revision: getDecision(state, unitId).revision + 1 };
  state.board.decisions[unitId] = decision;
  return decision;
}

/** 그 Unit을 모든 새 문장의 출처에서 뺀다 - 출처가 비면 새 문장은 미배정(이미 쓴 문서의 문장은 지우지 않는다) */
function detachSources(state: PracticeState, unitIds: number[]): void {
  const gone = new Set(unitIds);
  for (const target of Object.values(state.board.targets)) {
    if (!target.source_unit_ids.some((id) => gone.has(id))) continue;
    target.source_unit_ids = target.source_unit_ids.filter((id) => !gone.has(id));
    if (target.source_unit_ids.length === 0) target.status = "unassigned";
    target.revision += 1;
  }
}

function resetDecision(state: PracticeState, unitId: number): Decision {
  detachSources(state, [unitId]);
  return setDecision(state, unitId, BLANK_DECISION);
}

/** 편집으로 물러난 Unit - 출처에서 빼고 판단도 미배정으로(되살려도 이어진 New 없이 확정으로 남지 않게). 묶음의 나머지 보류는 따라 하지 않는다 */
function retireUnits(state: PracticeState, unitIds: number[]): void {
  for (const unitId of unitIds) resetDecision(state, unitId);
}

/** 짝을 지우고 구성원의 pair_id를 비운다 - 지운 짝 id */
function dissolvePairs(state: PracticeState, view: DocumentView, unitIds: number[]): number[] {
  const pairIds = new Set(view.units.filter((unit) => unitIds.includes(unit.id) && unit.pair_id !== null).map((unit) => unit.pair_id as number));
  if (pairIds.size === 0) return [];
  view.pairs = view.pairs.filter((pair) => !pairIds.has(pair.id));
  for (const unit of view.units) if (unit.pair_id !== null && pairIds.has(unit.pair_id)) unit.pair_id = null;
  return [...pairIds];
}

function findUnitView(state: PracticeState, unitId: number): DocumentView | null {
  return Object.values(state.board.views).find((view) => view.units.some((unit) => unit.id === unitId)) ?? null;
}

export type GroupSaveBody = GroupSaveInput & { undo?: UndoMeta };

/** POST …/groups/save - 판단 · 새 문장의 출처를 받은 그대로(§6.3). 새 id 없는 새 문장 만들기는 숨긴 기능이라 안 됨 */
export function saveGroup(state: PracticeState, body: GroupSaveBody): Group {
  if (body.targets.some((target) => target.id === undefined || !(target.id in state.board.targets))) {
    throw new PracticeUnsupportedError("groups/save:new-target");
  }
  recordStep(state, body.undo, body.action);
  const status: CoverStatus = body.action === "confirm" ? "confirmed" : "on_hold";
  const now = readNow();
  for (const unit of body.units) {
    setDecision(state, unit.unit_id, {
      disposition: unit.disposition,
      move_target_code: unit.move_target_code,
      reason: unit.reason,
      status,
      hold_reason: body.action === "hold" ? body.hold_reason : "",
      confirmed_by: PRACTICE_LOGIN,
      confirmed_at: now,
    });
  }
  for (const input of body.targets) {
    const target = state.board.targets[input.id as number];
    target.source_unit_ids = [...input.source_unit_ids];
    target.status = input.source_unit_ids.length > 0 ? status : "unassigned";
    if (input.remark !== undefined) target.remark = input.remark;
    target.revision += 1;
  }
  for (const targetId of body.removed_target_ids) {
    const target = state.board.targets[targetId];
    if (!target) continue;
    target.source_unit_ids = [];
    target.status = "unassigned";
    target.revision += 1;
  }
  const dissolved: number[] = [];
  for (const unitId of body.release_unit_ids ?? []) {
    const view = findUnitView(state, unitId);
    if (view) dissolved.push(...dissolvePairs(state, view, [unitId]));
  }
  if (body.action === "hold") addRemark(state, body.hold_reason);
  const group = readGroup(
    state,
    [...body.units.map((unit) => unit.unit_id), ...(body.release_unit_ids ?? [])],
    [...body.targets.map((target) => target.id as number), ...body.removed_target_ids],
  );
  return { ...group, pairs_dissolved: dissolved };
}

export interface BulkDecideBody {
  action: "delete" | "move_external" | "clear";
  reason: string;
  move_target_code: string;
  units: Array<{ unit_id: number; revision: number }>;
  undo?: UndoMeta;
}

/** POST …/decisions/bulk - delete · clear만(다른 문서로 이동은 화면에서 뺀 기능) */
export function bulkDecide(state: PracticeState, body: BulkDecideBody): Array<{ unit_id: number; decision: Decision }> {
  if (body.action === "move_external") throw new PracticeUnsupportedError("decisions/bulk:move_external");
  recordStep(state, body.undo, body.action);
  const now = readNow();
  return body.units.map(({ unit_id }) => ({
    unit_id,
    decision:
      body.action === "clear"
        ? resetDecision(state, unit_id)
        : setDecision(state, unit_id, { ...BLANK_DECISION, disposition: "delete", status: "confirmed", reason: body.reason, confirmed_by: PRACTICE_LOGIN, confirmed_at: now }),
  }));
}

/** POST …/decisions/clear - 배정을 처음 값으로, 그 Unit을 출처에서 뺀다 */
export function clearDecision(state: PracticeState, body: { unit_id: number; revision: number; undo?: UndoMeta }): DetachReport {
  recordStep(state, body.undo, "clear");
  resetDecision(state, body.unit_id);
  return { reset_unit_ids: [body.unit_id], deleted_target_ids: [], held_unit_ids: [], held_target_ids: [] };
}

// ── 원문 편집(D6) ──

function readBlockTexts(view: DocumentView): Map<number, string> {
  return new Map(view.blocks.map((block) => [block.id, block.text]));
}

/** Unit 글 = 범위 글을 띄어쓰기 하나로 이은 것, 범위 안 줄바꿈도 띄어쓰기(백엔드 segment.build_unit_text) */
function buildSpanText(spans: ViewUnit["spans"], blocks: Map<number, string>): string {
  return spans.map(([blockId, start, end]) => (blocks.get(blockId) ?? "").slice(start, end).replace(/[\r\n]/g, " ")).join(" ");
}

function detectLang(text: string): "ko" | "en" {
  return HANGUL.test(text) ? "ko" : "en";
}

/** 그 문서의 다음 표시 번호 - 표시 ID "<문서 번호>-<순번 세 자리>"의 순번 다음. 되살릴 옛 Unit · 표의 다른 모습 · 같은 편집에서 먼저 지은 Unit도 센다 */
function buildDisplayId(state: PracticeState, view: DocumentView, pending: ViewUnit[]): string {
  const looks = Object.values(state.fixture.tableVariants).flatMap((look) => [...look.wrapped.units, ...look.unwrapped.units]);
  const units = [...view.units, ...Object.values(state.board.merged).flat(), ...looks, ...pending];
  const sample = view.units[0]?.display_id ?? `D${view.document.id}-000`;
  const prefix = sample.slice(0, sample.lastIndexOf("-"));
  const numbers = units.filter((unit) => unit.display_id.startsWith(`${prefix}-`)).map((unit) => Number(unit.display_id.slice(prefix.length + 1)) || 0);
  return `${prefix}-${String(Math.max(0, ...numbers) + 1).padStart(3, "0")}`;
}

function takeId(state: PracticeState): number {
  return state.nextId++;
}

function buildEditedUnit(
  state: PracticeState,
  view: DocumentView,
  like: ViewUnit,
  patch: Pick<ViewUnit, "spans" | "text" | "number"> & Partial<ViewUnit>,
  pending: ViewUnit[] = [],
): ViewUnit {
  return {
    ...clone(like),
    id: takeId(state),
    display_id: buildDisplayId(state, view, pending),
    lang: detectLang(patch.text),
    status: null,
    pair_id: null,
    is_edited: true,
    can_unmerge: false,
    merge_pieces: [],
    split_suggestion_id: null,
    ref: null,
    caption_refs: [],
    ...patch,
  };
}

/** 글 자리 at → (범위 번호, 블록 안 자리). 범위 사이 이음 글자거나 글 밖이면 null(백엔드 spans.locate_text_offset) */
function locateTextOffset(spans: ViewUnit["spans"], at: number): [number, number] | null {
  let offset = 0;
  for (const [index, [, start, end]] of spans.entries()) {
    if (offset <= at && at < offset + end - start) return [index, start + at - offset];
    offset += end - start + 1;
  }
  return null;
}

function splitUnit(state: PracticeState, view: DocumentView, unitId: number, at: number): EditResult {
  const index = findUnitIndex(view, unitId);
  const unit = view.units[index];
  const located = at > 0 && at < unit.text.length ? locateTextOffset(unit.spans, at) : null;
  if (!located) throw new PracticeUnsupportedError(`edits:split@${at}`);
  const [spanIndex, cut] = located;
  const [blockId, start, end] = unit.spans[spanIndex];
  const leftSpans = [...unit.spans.slice(0, spanIndex), ...(cut > start ? [[blockId, start, cut] as ViewUnit["spans"][number]] : [])];
  const rightSpans = [[blockId, cut, end] as ViewUnit["spans"][number], ...unit.spans.slice(spanIndex + 1)];
  const blocks = readBlockTexts(view);
  dissolvePairs(state, view, [unitId]);
  // 문단 번호는 앞 조각에 남는다 - 뒤 조각은 번호 없음(번호 칸이 없는 종류는 그대로 null)
  const left = buildEditedUnit(state, view, unit, { spans: leftSpans, text: buildSpanText(leftSpans, blocks), number: unit.number });
  const right = buildEditedUnit(state, view, unit, { spans: rightSpans, text: buildSpanText(rightSpans, blocks), number: unit.number ? { ...EMPTY_NUMBER } : null }, [left]);
  view.units.splice(index, 1, left, right);
  retireUnits(state, [unitId]);
  return { document_revision: 0, created_unit_ids: [left.id, right.id], retired_unit_ids: [unitId] };
}

function mergeUnits(state: PracticeState, view: DocumentView, unitIds: number[]): EditResult {
  const indexes = unitIds.map((id) => findUnitIndex(view, id)).sort((a, b) => a - b);
  const pieces = indexes.map((index) => view.units[index]);
  dissolvePairs(state, view, unitIds);
  const first = pieces[0];
  const spans = pieces.flatMap((unit) => unit.spans);
  const text = pieces.map((unit) => unit.text).join(" ");
  const merged = buildEditedUnit(state, view, first, { spans, text, number: first.number, can_unmerge: true, merge_pieces: pieces.map((unit) => unit.text) });
  state.board.merged[merged.id] = pieces.map((unit) => ({ ...clone(unit), pair_id: null, status: null }));
  view.units = view.units.filter((unit) => !unitIds.includes(unit.id));
  view.units.splice(indexes[0], 0, merged);
  retireUnits(state, unitIds);
  return { document_revision: 0, created_unit_ids: [merged.id], retired_unit_ids: pieces.map((unit) => unit.id) };
}

function unmergeUnit(state: PracticeState, view: DocumentView, unitId: number): EditResult {
  const pieces = state.board.merged[unitId];
  if (!pieces) throw new PracticeUnsupportedError("edits:unmerge");
  const index = findUnitIndex(view, unitId);
  view.units.splice(index, 1, ...clone(pieces));
  delete state.board.merged[unitId];
  retireUnits(state, [unitId]);
  return { document_revision: 0, created_unit_ids: pieces.map((unit) => unit.id), retired_unit_ids: [unitId] };
}

/** 표 벗기기 · 다시 표로 - 백엔드가 찍은 두 모습 사이를 바꾼다(D7, 서버 규칙을 흉내 내지 않는다) */
function setLayoutTable(state: PracticeState, view: DocumentView, tableId: number, isLayout: boolean): EditResult {
  const looks = state.fixture.tableVariants[String(tableId)];
  if (!looks) throw new PracticeUnsupportedError(`edits:set_layout_table#${tableId}`);
  const now = state.board.tableLooks[tableId] ?? "wrapped";
  const want: TableLookName = isLayout ? "unwrapped" : "wrapped";
  if (now === want) return { document_revision: 0, created_unit_ids: [], retired_unit_ids: [] };
  const lookIds = new Set(looks[now].units.map((unit) => unit.id));
  const isCurrent = (unit: ViewUnit) => unit.table_id === tableId || lookIds.has(unit.id);
  const at = view.units.findIndex(isCurrent);
  const retired = view.units.filter(isCurrent).map((unit) => unit.id);
  const incoming = clone(looks[want].units);
  view.units = view.units.filter((unit) => !isCurrent(unit));
  view.units.splice(at < 0 ? view.units.length : at, 0, ...incoming);
  view.tables = view.tables.map((table) => (table.id === tableId ? clone(looks[want].table) : table));
  // 그 표의 짝만 바꾼다 - 문서의 다른 짝은 그대로
  const lookPairIds = new Set(looks[now].pairs.map((pair) => pair.id));
  view.pairs = [...view.pairs.filter((pair) => !lookPairIds.has(pair.id)), ...clone(looks[want].pairs)];
  state.board.tableLooks[tableId] = want;
  const incomingIds = new Set(incoming.map((unit) => unit.id));
  const gone = retired.filter((id) => !incomingIds.has(id));
  retireUnits(state, gone);
  return { document_revision: 0, created_unit_ids: incoming.map((unit) => unit.id).filter((id) => !retired.includes(id)), retired_unit_ids: gone };
}

/** 묶음(표)이면 구성원까지 */
function withMembers(view: DocumentView, unitIds: number[]): Set<number> {
  const ids = new Set(unitIds);
  for (const unit of view.units) if (unit.group_unit_id !== null && ids.has(unit.group_unit_id)) ids.add(unit.id);
  return ids;
}

export interface EditBody {
  revision: number;
  confirm?: boolean;
  op: EditOp;
  undo?: UndoMeta;
}

/** POST …/documents/{d}/edits - D6의 일곱 종류만 */
export function applyEdit(state: PracticeState, docId: number, body: EditBody): EditResult {
  const view = findView(state, docId);
  const { op } = body;
  const supported = ["split", "merge", "unmerge", "set_language", "set_layout_table", "set_noise_reason", "clear_noise"];
  if (!supported.includes(op.type)) throw new PracticeUnsupportedError(`edits:${op.type}`);
  // 사진은 지금 찍고 쌓기는 편집이 된 뒤에 - 거절(422)로 끝나는 편집이 되돌리기 칸을 만들지 않게. 각 편집은 검사를 마친 뒤에만 판을 바꾼다
  const before = body.undo ? clone(state.board) : undefined;
  let result: EditResult = { document_revision: 0, created_unit_ids: [], retired_unit_ids: [] };
  if (op.type === "split") result = splitUnit(state, view, op.unit_id, op.at);
  else if (op.type === "merge") result = mergeUnits(state, view, op.unit_ids);
  else if (op.type === "unmerge") result = unmergeUnit(state, view, op.unit_id);
  else if (op.type === "set_layout_table") result = setLayoutTable(state, view, op.table_id, op.is_layout);
  else if (op.type === "set_language") {
    for (const unit of view.units) if (op.unit_ids.includes(unit.id)) unit.lang = op.lang;
  } else if (op.type === "set_noise_reason") {
    const ids = withMembers(view, op.unit_ids);
    for (const unit of view.units) if (ids.has(unit.id)) unit.noise_reason = op.reason;
    addRemark(state, op.reason);
  } else if (op.type === "clear_noise") {
    const ids = withMembers(view, op.unit_ids);
    for (const unit of view.units) {
      if (!ids.has(unit.id)) continue;
      unit.noise_kind = null;
      unit.noise_reason = "";
    }
  }
  recordStep(state, body.undo, op.type, before);
  return { ...result, document_revision: bumpDocRevision(state, docId), detach: null, shape: null };
}

// ── 짝 ──

export function createPair(state: PracticeState, docId: number, body: { revision: number; unit_ids: number[]; undo?: UndoMeta }): PairResult {
  const view = findView(state, docId);
  for (const id of body.unit_ids) findUnitIndex(view, id);
  recordStep(state, body.undo, "pair");
  dissolvePairs(state, view, body.unit_ids);
  const pair: ViewPair = { id: takeId(state), status: "confirmed", source: "human", unit_ids: [...body.unit_ids] };
  view.pairs.push(pair);
  for (const unit of view.units) if (body.unit_ids.includes(unit.id)) unit.pair_id = pair.id;
  return { document_revision: bumpDocRevision(state, docId), pair: clone(pair) };
}

function findPair(view: DocumentView, pairId: number): ViewPair {
  const pair = view.pairs.find((item) => item.id === pairId);
  if (!pair) throw new PracticeUnsupportedError(`pair ${pairId}`);
  return pair;
}

export function deletePair(state: PracticeState, docId: number, pairId: number, undo?: UndoMeta): PairResult {
  const view = findView(state, docId);
  const pair = findPair(view, pairId);
  recordStep(state, undo, "unpair");
  dissolvePairs(state, view, pair.unit_ids);
  return { document_revision: bumpDocRevision(state, docId), pair: null };
}

export function confirmPair(state: PracticeState, docId: number, pairId: number, undo?: UndoMeta): PairResult {
  const view = findView(state, docId);
  const pair = findPair(view, pairId);
  recordStep(state, undo, "pair");
  pair.status = "confirmed";
  return { document_revision: bumpDocRevision(state, docId), pair: clone(pair) };
}

// ── 되돌리기 · 다시 하기(D8) ──

function listChangedUnits(before: PracticeBoard, after: PracticeBoard): number[] {
  const changed = new Set<number>();
  const unitsOf = (board: PracticeBoard) => new Map(Object.values(board.views).flatMap((view) => view.units.map((unit) => [unit.id, JSON.stringify(unit)] as const)));
  const a = unitsOf(before);
  const b = unitsOf(after);
  for (const id of new Set([...a.keys(), ...b.keys()])) if (a.get(id) !== b.get(id)) changed.add(id);
  for (const id of new Set([...Object.keys(before.decisions), ...Object.keys(after.decisions)].map(Number))) {
    if (JSON.stringify(before.decisions[id]) !== JSON.stringify(after.decisions[id])) changed.add(id);
  }
  return [...changed].sort((x, y) => x - y);
}

/** POST …/decisions/undo · redo - 사진을 꺼내 되쓰고 반대쪽에 지금 판을 넣는다. 스택이 비면 null(서버의 nothing_to_undo · nothing_to_redo) */
export function stepDecision(state: PracticeState, direction: "undo" | "redo"): DecisionStepResult | null {
  const from = direction === "undo" ? state.undo : state.redo;
  const to = direction === "undo" ? state.redo : state.undo;
  const entry = from.pop();
  if (!entry) return null;
  to.push({ board: clone(state.board), op: entry.op, meta: entry.meta });
  const before = state.board;
  state.board = entry.board;
  state.lastStepKey = null;
  // revision은 늘기만 한다 - 화면이 든 값보다 작아지면 다음 쓰기가 낡은 값을 들고 간다
  for (const docId of Object.keys(state.board.views)) bumpDocRevision(state, Number(docId));
  return {
    op: entry.op,
    unit_ids: listChangedUnits(before, state.board),
    focus_unit_id: entry.meta.focus_unit_id ?? null,
    focus_target_id: entry.meta.focus_target_id ?? null,
    scope_label: entry.meta.scope_label ?? null,
    can_undo: state.undo.length > 0,
    can_redo: state.redo.length > 0,
    restored_decisions: true,
  };
}
