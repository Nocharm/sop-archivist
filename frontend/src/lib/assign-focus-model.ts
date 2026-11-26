// Assign 고름 · 처리 중 · 따라가기를 한 상태로 - 화면 훅(use-assign-focus)이 useReducer로 쥔다. 규칙은 설계
// 2026-11-20-assign-mockup1 D1(규칙 1-6, docs/architecture/decisions.md). 화면 · 요청 · 시간은 모른다.

import type { EditOp } from "./api-sop";
import { listWaitNumbers, type QueueState } from "./command-queue";

/** 고름 - Old 박스(Unit) 하나 · 목차 블록 · New 문서. 줄(row)은 고름에서 파생한다(rowOfUnit) */
export type Focus =
  | { kind: "none" }
  // docId - 다시 받은 보기가 그 문서 것일 때만 "사라졌는지"를 본다(문서마다 따로 받는 날을 위해)
  | { kind: "unit"; docId: number; unitId: number }
  | { kind: "toc"; docId: number; key: number; unitId: number | null }
  | { kind: "new"; docId: number; unitId: number | null; inPlace: boolean };

export const NO_FOCUS: Focus = { kind: "none" };

export type PendingKind =
  | "join" | "split" | "unmerge" | "unwrap" | "rewrap" | "pair" | "unpair" | "lang" | "heading" | "ref" | "caption" | "toc" | "figure" | "order" | "reorder" | "follow" | "save" | "undo" | "bulk";
export type PendingPlace = { at: "gap"; firstId: number; secondId: number } | { at: "box"; unitId: number } | { at: "table"; tableId: number } | { at: "none" };
export const NO_PLACE: PendingPlace = { at: "none" };

/** 보낸 일 하나 - isGlobal이면 묶음 전체가 바뀌는 일(초기화 · 일괄 수락 · 같은 글자 일괄 확정 · Undo/Redo) */
export interface Pending {
  id: string;
  kind: PendingKind;
  docId: number | null;
  unitIds: readonly number[];
  place: PendingPlace;
  isGlobal: boolean;
}

/** 처리 중인 일과 누른 때의 고름 - 응답 뒤 따라가기는 고름이 이것과 같고 그 사이 사람이 고르지 않았을 때만 건다 */
export interface PendingEntry extends Pending {
  from: Focus;
  /** 누른 뒤 사람이 골랐다(같은 것을 다시 골랐어도) - 응답의 박스를 따라가지 않는다 */
  isPickedOver: boolean;
}

/** 응답 뒤 고를 박스 - 그 문서 보기가 minRevision 이상으로 다시 오면 고른다. docId null은 응답이 문서를 알려 주지 않은 것(Undo) - 다음에 받은 보기 어디서든 찾는다 */
export interface Follow {
  pendingId: string;
  /** 건 일의 종류 - 판단 저장(save) 뒤 따라가기는 화면이 거르기 목록을 다시 잡지 않는다 */
  kind: PendingKind;
  docId: number | null;
  minRevision: number | null;
  pickUnitId: number;
  from: Focus;
}

export interface FocusState {
  focus: Focus;
  pending: readonly PendingEntry[];
  follows: readonly Follow[];
}

export const INITIAL_FOCUS_STATE: FocusState = { focus: NO_FOCUS, pending: [], follows: [] };

/** 다시 받은 문서 하나 - unitIds는 그 보기의 살아 있는 Unit 전부 */
export interface LoadedDoc {
  docId: number;
  revision: number;
  unitIds: ReadonlySet<number>;
}

export type FocusEvent =
  | { type: "pick"; focus: Focus }
  // 다시 시도가 멈춘 때의 고름을 되살린다 - 사람이 고른 것이 아니라, 그 고름에서 누른 일은 다시 따라갈 수 있다
  | { type: "restore"; focus: Focus }
  | { type: "start"; pending: Pending }
  | { type: "succeed"; pendingId: string; docId: number | null; revision: number | null; pickUnitId: number | null }
  | { type: "fail"; pendingId: string }
  // 줄에서 기다리던 묶음 전체 일을 이제 보낸다 - 그 사이 앞 편집이 건 따라가기를 버린다(은퇴할 Unit을 고르지 않게)
  | { type: "dropFollows" }
  // 한 번에 받은 문서들(지금은 Old 문서 전부 또는 한 단 New 문서 하나). liftUnit - 고를 수 있는 Unit으로 올린다(자기 · 묶음 · 없으면 null)
  | { type: "loaded"; docs: readonly LoadedDoc[]; liftUnit: (unitId: number) => number | null };

export function isSameFocus(a: Focus, b: Focus): boolean {
  if (a.kind === "none" || b.kind === "none") return a.kind === b.kind;
  if (a.kind === "unit") return b.kind === "unit" && a.docId === b.docId && a.unitId === b.unitId;
  if (a.kind === "toc") return b.kind === "toc" && a.docId === b.docId && a.key === b.key && a.unitId === b.unitId;
  return b.kind === "new" && a.docId === b.docId && a.unitId === b.unitId && a.inPlace === b.inPlace;
}

export function reduceFocus(state: FocusState, event: FocusEvent): FocusState {
  switch (event.type) {
    case "pick": {
      // 사람이 고르면 따라가기를 모두 버리고, 아직 응답이 없는 일도 따라가지 않게 적는다 - 같은 것을 다시 골랐어도 그 사람이 고른 것이다
      // (Del → Ctrl+Z 뒤 지금 고른 줄을 누르면 되돌리기의 늦은 따라가기가 그 고름을 덮었다, 3b "고름은 처리 중에도 그대로")
      if (isSameFocus(state.focus, event.focus) && state.follows.length === 0 && state.pending.every((entry) => entry.isPickedOver)) return state;
      const pending = state.pending.map((entry) => (entry.isPickedOver ? entry : { ...entry, isPickedOver: true }));
      return { focus: event.focus, pending, follows: [] };
    }
    case "restore": {
      // 그 고름에서 누른 일만 되살린다 - 다른 고름에서 누른 일과 따라가기는 그대로 두면 엉뚱한 박스로 간다
      const pending = state.pending.map((entry) => (entry.isPickedOver && isSameFocus(entry.from, event.focus) ? { ...entry, isPickedOver: false } : entry));
      return { focus: event.focus, pending, follows: state.follows.filter((follow) => isSameFocus(follow.from, event.focus)) };
    }
    case "start": {
      if (state.pending.some((entry) => entry.id === event.pending.id)) return state;
      // 고름은 그대로(규칙 2). 묶음 전체가 바뀌는 일은 앞 편집의 따라가기를 버린다 - 그 사이 은퇴할 Unit을 고르지 않게
      const pending = [...state.pending, { ...event.pending, from: state.focus, isPickedOver: false }];
      return { ...state, pending, follows: event.pending.isGlobal ? [] : state.follows };
    }
    case "succeed": {
      // 일은 걷지 않는다 - 응답 뒤 다시 받기를 걸 때까지(표 벗기기는 새 보기를 놓을 때까지) 처리 중으로 남고, 부른 쪽이 fail로 걷는다
      const entry = state.pending.find((item) => item.id === event.pendingId);
      // 따라갈 박스가 없거나 그 사이 사람이 골랐으면(같은 것이어도) 고름을 둔다(규칙 3)
      if (!entry || event.pickUnitId === null || entry.isPickedOver || !isSameFocus(entry.from, state.focus)) return state;
      const follow: Follow = { pendingId: entry.id, kind: entry.kind, docId: event.docId, minRevision: event.revision, pickUnitId: event.pickUnitId, from: entry.from };
      return { ...state, follows: [...state.follows, follow] };
    }
    case "fail": {
      // 그 일만 걷는다(실패 · 되묻기 · 성공 뒤 끝 모두) - 고름 · 따라가기는 그대로(규칙 4)
      const pending = state.pending.filter((item) => item.id !== event.pendingId);
      return pending.length === state.pending.length ? state : { ...state, pending };
    }
    case "dropFollows":
      return state.follows.length === 0 ? state : { ...state, follows: [] };
    case "loaded":
      return applyLoaded(state, event).state;
  }
}

/** 받은 보기로 따라가기와 사라진 고름을 맞춘다 - picked는 고른 따라가기(화면이 스크롤한다), consumed는 이번에 끝난 따라가기 전부 */
export function applyLoaded(state: FocusState, event: Extract<FocusEvent, { type: "loaded" }>): { state: FocusState; picked: Follow | null; consumed: readonly Follow[] } {
  let focus = state.focus;
  let picked: Follow | null = null;
  const consumed: Follow[] = [];
  const kept: Follow[] = [];
  for (const follow of state.follows) {
    if (!isFollowReady(follow, event.docs)) {
      kept.push(follow);
      continue;
    }
    consumed.push(follow);
    if (!isSameFocus(follow.from, focus)) continue;
    const unitId = event.liftUnit(follow.pickUnitId);
    const doc = unitId === null ? undefined : event.docs.find((item) => item.unitIds.has(unitId));
    if (unitId === null || !doc) continue;
    const next = buildFollowFocus(follow.from, doc.docId, unitId);
    if (next === null) continue;
    focus = next;
    picked = follow;
  }
  // 사라진 Unit은 고르지 않는다 - 그 고름에서 건 따라가기가 아직 기다리면 둔다(규칙 5)
  if (picked === null && !kept.some((follow) => isSameFocus(follow.from, focus))) focus = dropVanished(focus, event.docs);
  if (consumed.length === 0 && focus === state.focus) return { state, picked, consumed };
  return { state: { ...state, focus, follows: kept }, picked, consumed };
}

/** 그 따라가기가 이번에 받은 보기를 기다렸는가 - 문서를 모르면 받은 보기 무엇이든 */
function isFollowReady(follow: Follow, docs: readonly LoadedDoc[]): boolean {
  if (follow.docId === null) return docs.length > 0;
  const doc = docs.find((item) => item.docId === follow.docId);
  return doc !== undefined && (follow.minRevision === null || doc.revision >= follow.minRevision);
}

/** 따라가서 고를 것 - New 문서를 고른 채 건 따라가기는 그 문서 안에서만(다른 문서면 null), 그 밖은 Old 박스 */
function buildFollowFocus(from: Focus, docId: number, unitId: number): Focus | null {
  if (from.kind === "new") return from.docId === docId ? { ...from, unitId } : null;
  return { kind: "unit", docId, unitId };
}

/** 받은 문서에서 사라진 고름을 놓는다 - Old 박스 · 목차 블록은 고름 없음, 목차 줄 · New 문장은 그 블록 · 문서만 남긴다 */
function dropVanished(focus: Focus, docs: readonly LoadedDoc[]): Focus {
  if (focus.kind === "none") return focus;
  const doc = docs.find((item) => item.docId === focus.docId);
  if (!doc) return focus;
  if (focus.kind === "unit") return doc.unitIds.has(focus.unitId) ? focus : NO_FOCUS;
  if (focus.kind === "toc" && !doc.unitIds.has(focus.key)) return NO_FOCUS;
  return focus.unitId !== null && !doc.unitIds.has(focus.unitId) ? { ...focus, unitId: null } : focus;
}

/** New 문서 고름을 바꿀 때 고를 것 - 지금 고름과 같으면 null(이미 눌린 "한 단"을 다시 눌러도 New 편집의 따라가기를 버리지 않게), 놓으면 New 고름일 때만 NO_FOCUS */
export function buildSoloPick(focus: Focus, solo: { docId: number; unitId: number | null; inPlace: boolean } | null): Focus | null {
  if (solo === null) return focus.kind === "new" ? NO_FOCUS : null;
  const next: Focus = { kind: "new", docId: solo.docId, unitId: solo.unitId, inPlace: solo.inPlace };
  return isSameFocus(next, focus) ? null : next;
}

/** 처리 중인 일 목록만 */
type PendingList = { pending: readonly Pending[] };

/** 판단 저장 - 박스의 모양을 바꾸지 않아 잠그지 않는다(A1-R4). 같은 박스에 이어 누른 것은 큐가 앞 응답의 revision으로 보낸다 */
export function isDecisionKind(kind: PendingKind): boolean {
  return kind === "save" || kind === "bulk";
}

/** 처리 중인 일이 잡은 Unit인가 - 잠긴 박스는 고르기 · 끌기 · 틈 단추 · 우클릭 메뉴를 받지 않는다(규칙 6). 판단 저장 중인 박스는 잠기지 않는다 */
export function isUnitLocked(state: PendingList, unitId: number): boolean {
  return state.pending.some((entry) => !isDecisionKind(entry.kind) && entry.unitIds.includes(unitId));
}

/** 묶음 전체 일(초기화 · 일괄 수락 · 같은 글자 일괄 확정 · Undo/Redo)이 처리 중인가 - 그동안은 모든 일이 꺼진다 */
export function isGlobalPending(state: PendingList): boolean {
  return state.pending.some((entry) => entry.isGlobal);
}

/**
 * 처리 중인 일이 이 Unit을 은퇴시켰을 수 있나 - 그 Unit을 잡은 일, 묶음 전체 일, 그 문서에서 Unit을 모르고 보낸 일(글자 범위 · 참조).
 * 서버는 응답 전에 이미 바꿨을 수 있어, 이 동안 그 Unit으로 묶음 · 후보 · 참조를 물으면 404가 난다(규칙 5의 뜻). 판단 저장은 Unit을 바꾸지 않는다
 */
export function isUnitUnsettled(state: PendingList, docId: number, unitId: number): boolean {
  return state.pending.some((entry) => (entry.isGlobal || !isDecisionKind(entry.kind)) && (entry.isGlobal || entry.unitIds.includes(unitId) || (entry.docId === docId && entry.unitIds.length === 0)));
}

const NO_WAITS: ReadonlyMap<number, number> = new Map();

/** 기다리는 명령의 박스 → 칩 "대기 n"(A1-R5) - 기다리는 것이 없으면 늘 같은 빈 값(용지를 다시 그리지 않게) */
export function buildPaperWaits<T>(state: Pick<QueueState<T>, "waiting">): ReadonlyMap<number, number> {
  return state.waiting.length === 0 ? NO_WAITS : listWaitNumbers(state);
}

/** 처리 중 알약의 글 키 - 판단 저장은 결정 칸 단추가 이미 보이고, 묶음 전체 일은 그릴 자리가 없어 null(설계 D4 표) */
export function readPendingLabelKey(kind: PendingKind): string | null {
  switch (kind) {
    case "join":
      return "assign.working.join";
    case "split":
    case "unmerge":
      return "assign.working.split";
    case "unwrap":
      return "assign.working.unwrap";
    case "rewrap":
      return "assign.working.rewrap";
    case "pair":
      return "assign.working.pair";
    case "unpair":
      return "assign.working.unpair";
    case "lang":
      return "assign.working.lang";
    case "reorder":
      return "assign.working.reorder";
    case "follow":
      return "assign.working.follow";
    case "heading":
    case "ref":
    case "caption":
    case "toc":
    case "figure":
    case "order":
      return "assign.working.save";
    case "save":
    case "undo":
    case "bulk":
      return null;
  }
}

/** 원문 편집의 알약 자리 - 표 바꾸기 · 벗긴 표 줄 순서는 표 머리, 그 밖은 가리키는 첫 박스. 틈의 붙이기는 부르는 쪽이 틈을 준다(이웃끼리인지는 화면이 안다) */
export function readEditPlace(op: EditOp): PendingPlace {
  if (op.type === "set_layout_table" || op.type === "reorder_unwrapped" || op.type === "follow_table") return { at: "table", tableId: op.table_id };
  const [unitId] = listEditUnitIds(op);
  return unitId === undefined ? NO_PLACE : { at: "box", unitId };
}

/** 표 벗기기 · 다시 표로가 바꾸는 Unit - 그 표와 함께 바뀌는 바로 안쪽 띠 표의 Unit(표 · 칸 문장 · 제목 줄)과 그 묶음에 든 것(캡션) */
export function listTableUnitIds(
  units: readonly { id: number; table_id: number | null; group_unit_id: number | null }[],
  tables: readonly { id: number; parent_table_id: number | null; is_band: boolean }[],
  tableId: number,
): number[] {
  const tableIds = new Set([tableId, ...tables.filter((table) => table.parent_table_id === tableId && table.is_band).map((table) => table.id)]);
  const own = new Set(units.filter((unit) => unit.table_id !== null && tableIds.has(unit.table_id)).map((unit) => unit.id));
  return units.filter((unit) => own.has(unit.id) || (unit.group_unit_id !== null && own.has(unit.group_unit_id))).map((unit) => unit.id);
}

/** 원문 편집의 처리 중 종류 - 알약 글이 이것으로 갈린다 */
export function readEditKind(op: EditOp): PendingKind {
  switch (op.type) {
    case "merge":
      return "join";
    case "split":
    case "carve":
    case "move_boundary":
      return "split";
    case "unmerge":
      return "unmerge";
    case "set_layout_table":
      return op.is_layout ? "unwrap" : "rewrap";
    case "set_language":
    case "switch_language":
      return "lang";
    case "set_ref":
    case "clear_ref":
    case "set_number":
    case "set_indents":
      return "ref";
    case "set_heading":
      return "heading";
    case "attach_caption":
    case "detach_caption":
    case "set_first_row_caption":
      return "caption";
    case "group_figures":
    case "ungroup_figures":
      return "figure";
    case "clear_noise":
    case "set_noise_reason":
    case "start_body":
      return "toc";
    case "reorder_pair":
      return "order";
    case "reorder_unwrapped":
      return "reorder";
    case "follow_table":
      return "follow";
  }
}

/** 원문 편집이 가리키는 Unit - 잠금(스텝 4)이 쓴다. 글자 범위 · 표로 가리키는 편집은 비어 있다 */
export function listEditUnitIds(op: EditOp): number[] {
  switch (op.type) {
    case "merge":
    case "set_language":
    case "clear_noise":
    case "set_noise_reason":
    case "set_heading":
    case "group_figures":
    case "reorder_pair":
    case "reorder_unwrapped":
      return [...op.unit_ids];
    case "split":
    case "unmerge":
    case "switch_language":
    case "detach_caption":
    case "ungroup_figures":
    case "set_ref":
    case "clear_ref":
    case "set_number":
    case "start_body":
      return [op.unit_id];
    case "set_indents":
      return op.units.map((item) => item.unit_id);
    case "follow_table":
      return op.items.flatMap((item) => item.unit_ids);
    case "move_boundary":
      return [op.left_unit_id, op.right_unit_id];
    case "attach_caption":
      return [op.unit_id, op.bundle_unit_id];
    case "set_first_row_caption":
      return [op.table_unit_id];
    case "carve":
    case "set_layout_table":
      return [];
  }
}

/** 편집 뒤 다시 받기의 까닭(설계 D2) - isReleased는 판단을 풀며(confirm) 보낸 편집 */
export type ReloadCause =
  | { kind: "old_edit"; docId: number; isInPlace: boolean; isReleased: boolean }
  | { kind: "new_edit"; docId: number; isReleased: boolean }
  | { kind: "pair"; docId: number }
  | { kind: "caption_ref"; docId: number }
  | { kind: "split_suggestion"; docId: number; isApplied: boolean }
  // docId null - 되돌리기 응답은 문서를 알려 주지 않는다. 판단 저장 단계의 되돌리기는 이것이 아니라 전체 다시 받기다
  | { kind: "edit_undo"; docId: number | null };

/**
 * 무엇을 다시 받나 - docs · units · newDoc는 따라가기가 기다리는 것(보기와 그 문서 줄은 한 번에 받아 한 번에 놓는다),
 * 나머지는 뒤에서 받아 고름을 막지 않는다. 분류 · 묶기 · 무효 제안과 Remark 최근 목록은 편집이 바꾸지 않아 받지 않는다
 */
export interface ReloadPlan {
  /** 다시 받을 문서 보기 - all이면 Old 문서 모두 */
  docs: readonly number[] | "all";
  /** 그 문서들의 Unit 줄도(보기와 한 번에) */
  units: boolean;
  /** 한 단 New 문서 보기 */
  newDoc: number | null;
  /** New 문장 목록(엮은 문서도 같이) */
  written: boolean;
  tobe: boolean;
  identical: boolean;
  /** 이 문서의 AI 나누기 제안(AI 켬일 때만) */
  splitSuggestions: number | null;
  /** 분류 · 묶기 제안 목록 - Unit을 은퇴시키는 편집이 제안을 거두고 되돌리기는 되살리지 않아, 화면이 든 목록이 낡는다 */
  suggestions: boolean;
  bundle: boolean;
}

const NO_RELOAD: ReloadPlan = { docs: [], units: false, newDoc: null, written: false, tobe: false, identical: false, splitSuggestions: null, suggestions: false, bundle: false };

/** 편집 하나 뒤에 다시 받을 것 - 설계 D2의 표 "편집 | 기다림 | 뒤에서" 한 줄씩 */
export function planReload(cause: ReloadCause, ctx: { aiOn: boolean }): ReloadPlan {
  switch (cause.kind) {
    case "old_edit": {
      const own = { ...NO_RELOAD, docs: [cause.docId], units: true, suggestions: !cause.isInPlace, bundle: true };
      // 판단을 풀었으면 대상(Target)이 지워진다 - To-Be · New 문장(엮은 문서) · 같은 글자 후보까지
      if (cause.isReleased) return { ...own, tobe: true, written: true, identical: true, splitSuggestions: cause.isInPlace || !ctx.aiOn ? null : cause.docId };
      // 제자리 편집(언어 · 참조 · 번호)은 글도 Unit도 그대로다
      if (cause.isInPlace) return own;
      return { ...own, identical: true, splitSuggestions: ctx.aiOn ? cause.docId : null };
    }
    case "new_edit":
      // 이음을 풀었으면 이어져 있던 Old 줄이 보류가 된다 - 어느 Old 문서인지 응답이 말하지 않아 모두 다시 받는다
      if (cause.isReleased) return { ...NO_RELOAD, docs: "all", units: true, newDoc: cause.docId, written: true, tobe: true, identical: true, bundle: true };
      return { ...NO_RELOAD, newDoc: cause.docId, written: true, tobe: true };
    case "pair":
      // 짝은 엮은 New 문서의 짝 카드(같은 의미 키)도 바꾼다 - New 문장 목록과 함께 그 문서를 다시 받는다(스텝 8)
      return { ...NO_RELOAD, docs: [cause.docId], units: true, written: true, bundle: true };
    case "caption_ref":
      return { ...NO_RELOAD, docs: [cause.docId] };
    case "split_suggestion":
      // 제안 표시(split_suggestion_id)는 문서 보기에 실려 온다 - 버리기는 그 보기와 제안 목록만
      if (!cause.isApplied) return { ...NO_RELOAD, docs: [cause.docId], splitSuggestions: ctx.aiOn ? cause.docId : null };
      return planReload({ kind: "old_edit", docId: cause.docId, isInPlace: false, isReleased: false }, ctx);
    case "edit_undo":
      return { ...NO_RELOAD, docs: cause.docId === null ? "all" : [cause.docId], units: true, identical: true, suggestions: true, bundle: true };
  }
}
