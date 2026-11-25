// Assign의 Old 문서 보기와 Unit 줄을 문서마다 쥔다 - 편집 뒤에는 고친 문서의 보기와 그 문서 줄만 다시 받아 바꿔 끼운다(설계 2026-11-20 D2).
// 한 번에 받은 보기와 줄은 한 번에 놓는다 - 새 보기에 옛 줄이 섞여 고른 줄이 잠깐 사라지는(결정 칸이 범례로 가는) 렌더가 없다.
"use client";

import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";

import { getDocumentView, listAllUnits, type Decision, type DocumentView, type UnitRow } from "./api-sop";

/** 다시 받을 것 - docs는 보기를 받을 문서(all이면 모두), units는 줄을 받을 문서(all이면 전체 목록 한 번, null이면 받지 않음) */
export interface DocReload {
  docs: readonly number[] | "all";
  units: readonly number[] | "all" | null;
}

/** 받아 둔 한 번 - apply로 놓는다. seq는 부른 차례라 늦게 닿은 옛 응답이 새것을 덮지 않는다 */
export interface DocBatch {
  seq: number;
  views: readonly DocumentView[];
  /** 문서마다 받은 줄 - 줄을 받은 문서는 줄이 없어도 빈 배열로 있다 */
  units: ReadonlyMap<number, readonly UnitRow[]>;
  /** 받는 중으로 센 문서(처음 불러오기는 세지 않는다) - 놓거나 실패하면 그만큼 뺀다 */
  asked: readonly number[];
}

export interface DocViewsState {
  views: ReadonlyMap<number, DocumentView>;
  units: ReadonlyMap<number, readonly UnitRow[]>;
  /** 문서마다 놓은 보기 · 줄의 차례 */
  viewSeq: ReadonlyMap<number, number>;
  unitSeq: ReadonlyMap<number, number>;
  /** 문서마다 받는 중인 보기 수 */
  asking: ReadonlyMap<number, number>;
  /** 놓은 횟수 - 바뀌면 고름에 알린다(한 렌더에 여러 번 놓여도 placedAt으로 빠짐없이) */
  placed: number;
  /** 문서마다 보기를 놓은 때(placed 값) */
  placedAt: ReadonlyMap<number, number>;
  error: unknown;
}

export const EMPTY_DOC_VIEWS: DocViewsState = { views: new Map(), units: new Map(), viewSeq: new Map(), unitSeq: new Map(), asking: new Map(), placed: 0, placedAt: new Map(), error: null };

/** 받는 중인 문서 수를 더하거나 뺀다 */
export function countAsking(state: DocViewsState, docIds: readonly number[], delta: 1 | -1): DocViewsState {
  if (docIds.length === 0) return state;
  const asking = new Map(state.asking);
  for (const id of docIds) {
    const next = (asking.get(id) ?? 0) + delta;
    if (next > 0) asking.set(id, next);
    else asking.delete(id);
  }
  return { ...state, asking };
}

/** 받은 한 번을 놓는다 - 문서마다 이미 놓은 것보다 늦게 부른 것만. 보기와 줄이 같은 렌더에 바뀌고, 바뀌지 않은 쪽의 Map은 그대로 둔다 */
export function mergeDocBatch(state: DocViewsState, batch: DocBatch): DocViewsState {
  const counted = countAsking(state, batch.asked, -1);
  const placedViews = batch.views.filter((view) => (counted.viewSeq.get(view.document.id) ?? -1) <= batch.seq);
  const placedUnits = [...batch.units].filter(([id]) => (counted.unitSeq.get(id) ?? -1) <= batch.seq);
  if (placedViews.length === 0 && placedUnits.length === 0) return counted.error === null ? counted : { ...counted, error: null };
  const views = placedViews.length === 0 ? counted.views : new Map([...counted.views, ...placedViews.map((view) => [view.document.id, view] as const)]);
  const viewSeq = placedViews.length === 0 ? counted.viewSeq : new Map([...counted.viewSeq, ...placedViews.map((view) => [view.document.id, batch.seq] as const)]);
  const units = placedUnits.length === 0 ? counted.units : new Map([...counted.units, ...placedUnits]);
  const unitSeq = placedUnits.length === 0 ? counted.unitSeq : new Map([...counted.unitSeq, ...placedUnits.map(([id]) => [id, batch.seq] as const)]);
  const placed = counted.placed + 1;
  const placedAt = placedViews.length === 0 ? counted.placedAt : new Map([...counted.placedAt, ...placedViews.map((view) => [view.document.id, placed] as const)]);
  return { views, units, viewSeq, unitSeq, asking: counted.asking, placed, placedAt, error: null };
}

/** since(placed 값) 뒤에 보기를 놓은 문서 */
export function listPlacedSince(state: DocViewsState, since: number): number[] {
  return [...state.placedAt].filter(([, at]) => at > since).map(([id]) => id);
}

/**
 * 저장 응답의 판단을 줄에 얹는다 - 큐가 빌 때 다시 받기 전에 화면이 먼저 안다(A1-R6). 얹은 문서는 seq로 그 전에 부른 받기를 막고,
 * 보기를 놓은 것이 아니라 고름에는 알리지 않는다(placed 그대로 - 따라가기는 새 보기를 기다린다)
 */
export function patchUnitDecisions(state: DocViewsState, seq: number, decisions: ReadonlyMap<number, Decision>): DocViewsState {
  const units = new Map(state.units);
  const unitSeq = new Map(state.unitSeq);
  let isChanged = false;
  for (const [docId, rows] of state.units) {
    if (!rows.some((row) => decisions.has(row.unit_id))) continue;
    isChanged = true;
    units.set(docId, rows.map((row) => { const decision = decisions.get(row.unit_id); return decision ? { ...row, decision, status: decision.status } : row; }));
    unitSeq.set(docId, seq);
  }
  return isChanged ? { ...state, units, unitSeq } : state;
}

/** 전체 줄 목록을 문서마다 나눈다 - 부른 문서는 줄이 없어도 빈 배열로 */
export function groupUnitsByDoc(rows: readonly UnitRow[], docIds: readonly number[]): Map<number, UnitRow[]> {
  const byDoc = new Map<number, UnitRow[]>(docIds.map((id) => [id, []]));
  for (const row of rows) {
    const list = byDoc.get(row.document_id);
    if (list) list.push(row);
    else byDoc.set(row.document_id, [row]);
  }
  return byDoc;
}

/** 놓은 보기를 문서 차례대로 - 하나라도 아직 없으면 null */
export function listDocViews(views: DocViewsState["views"], docIds: readonly number[] | null): DocumentView[] | null {
  if (docIds === null) return null;
  const list = docIds.map((id) => views.get(id));
  return list.every((view) => view !== undefined) ? (list as DocumentView[]) : null;
}

/** 놓은 줄 전부 - 서버 목록과 같은 문서 id 차례. 부른 문서 하나라도 아직 없으면 null */
export function listDocUnits(units: DocViewsState["units"], docIds: readonly number[] | null): UnitRow[] | null {
  if (docIds === null || docIds.some((id) => !units.has(id))) return null;
  return [...units.entries()].sort(([a], [b]) => a - b).flatMap(([, rows]) => rows);
}

function parseDocKey(docKey: string | null): number[] | null {
  return docKey === null ? null : docKey === "" ? [] : docKey.split(",").map(Number);
}

async function loadDocBatch(bundleId: number, seq: number, viewIds: readonly number[], units: readonly number[] | "all" | null, allIds: readonly number[], asked: readonly number[]): Promise<DocBatch> {
  const [views, unitMap] = await Promise.all([
    Promise.all(viewIds.map((id) => getDocumentView(bundleId, id))),
    units === null
      ? Promise.resolve(new Map<number, UnitRow[]>())
      : units === "all"
        ? listAllUnits(bundleId).then((rows) => groupUnitsByDoc(rows, allIds))
        : Promise.all(units.map((id) => listAllUnits(bundleId, id).then((rows) => [id, rows] as const))).then((entries) => new Map(entries)),
  ]);
  return { seq, views, units: unitMap, asked };
}

/**
 * docIds - 이 화면의 Old 문서(null이면 아직 문서 목록을 받지 않았다). 목록이 바뀌면 모두 다시 받는다.
 * 편집 뒤에는 fetch로 받아 apply로 놓거나(풀기 전환이 놓는 때를 정한다) reload로 받자마자 놓는다
 */
export function useDocViews(bundleId: number, docIds: readonly number[] | null) {
  const [state, setState] = useState<DocViewsState>(EMPTY_DOC_VIEWS);
  const [retryCount, setRetryCount] = useState(0);
  const seqRef = useRef(0);
  const docKey = docIds === null ? null : docIds.join(",");

  /** 보기 · 줄을 받는다(놓지는 않는다) - 실패하면 error에 남기고 다시 던진다 */
  async function fetchBatch(spec: DocReload): Promise<DocBatch> {
    const allIds = docIds ?? [];
    const viewIds = spec.docs === "all" ? allIds : spec.docs;
    seqRef.current += 1;
    const seq = seqRef.current;
    setState((prev) => countAsking(prev, viewIds, 1));
    try {
      return await loadDocBatch(bundleId, seq, viewIds, spec.units, allIds, viewIds);
    } catch (err) {
      setState((prev) => ({ ...countAsking(prev, viewIds, -1), error: err }));
      throw err;
    }
  }

  function apply(batch: DocBatch) {
    setState((prev) => mergeDocBatch(prev, batch));
  }

  /** 저장 응답의 판단을 줄에 얹는다 */
  function patchDecisions(decisions: ReadonlyMap<number, Decision>) {
    seqRef.current += 1;
    const seq = seqRef.current;
    setState((prev) => patchUnitDecisions(prev, seq, decisions));
  }

  /** 받았으나 놓지 않는다 - 받는 중으로 센 것만 뺀다 */
  function discard(batch: DocBatch) {
    setState((prev) => countAsking(prev, batch.asked, -1));
  }

  /** 받자마자 놓는다 - 받았으면 true(그 사이 쓸모없어졌으면 - shouldPlace 거짓 - 놓지 않는다). 실패는 error로 남는다(결정 칸의 다시 불러오기 단추가 보인다) */
  async function reload(spec: DocReload, shouldPlace: () => boolean = () => true): Promise<boolean> {
    let batch: DocBatch;
    try {
      batch = await fetchBatch(spec);
    } catch {
      return false;
    }
    if (shouldPlace()) apply(batch);
    else discard(batch);
    return true;
  }

  // 처음과 문서 목록이 바뀔 때 · 다시 시도 - 모두 받는다
  const loadAll = useEffectEvent((ids: readonly number[]) => {
    seqRef.current += 1;
    return loadDocBatch(bundleId, seqRef.current, ids, "all", ids, []);
  });
  useEffect(() => {
    if (docKey === null) return;
    let alive = true;
    loadAll(parseDocKey(docKey) ?? []).then(
      (batch) => {
        if (alive) setState((prev) => mergeDocBatch(prev, batch));
      },
      (error: unknown) => {
        if (alive) setState((prev) => ({ ...prev, error }));
      },
    );
    return () => {
      alive = false;
    };
  }, [docKey, retryCount]);

  const viewList = useMemo(() => listDocViews(state.views, parseDocKey(docKey)), [state.views, docKey]);
  const unitList = useMemo(() => listDocUnits(state.units, parseDocKey(docKey)), [state.units, docKey]);

  return {
    views: viewList,
    units: unitList,
    error: state.error,
    /** 놓은 횟수 - 바뀌면 고름에 알린다(처음 놓기 전에는 0) */
    placed: state.placed,
    /** since 뒤에 보기를 놓은 문서 - 비었으면 줄만 다시 받았다 */
    listPlacedSince: (since: number) => listPlacedSince(state, since),
    isReloading: (docId: number) => state.asking.has(docId),
    fetch: fetchBatch,
    apply,
    discard,
    patchDecisions,
    reload,
    retry: () => setRetryCount((count) => count + 1),
  };
}
