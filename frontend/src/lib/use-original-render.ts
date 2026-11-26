// 원본 보기의 그리기 - 자리 조회 → 원본 파일 → 표지 심기 → 그리기 → 다듬기(링크 · EMF · 쪽 나누기)를 문서마다 한 번.
// host는 React가 자식을 두지 않는 빈 div다 - 그 그림자 뿌리 안에 그린다(그리개 CSS가 앱에 닿지 않게). 같은 문서는 다시 그리지 않는다 - <Activity>로 숨겼다 다시 보여도 그린 DOM을 그대로 쓴다.
// 상태 전이는 순수 함수 reduceOriginalRender(시험). 설계: docs/superpowers/specs/2026-11-27-original-view-design.md §5.2·§5.5
"use client";

import { useEffect, useEffectEvent, useReducer, useRef, type RefObject } from "react";

import { openOriginalRoot, paginateRendered, readPartsToMark, renderOriginal, replaceUnrenderable, stripUnsafeLinks } from "@/components/assign/original-render";
import { fetchOriginalPlaces } from "@/lib/api-sop";
import { downloadDocumentFile } from "@/lib/api-manage";
import { useI18n } from "@/lib/i18n";
import { plantPlaceMarks, type PlaceMark } from "@/lib/original-place-model";

export type OriginalRenderStatus = "loading" | "ready" | "pdf" | "none" | "error";

export interface OriginalRenderState {
  /** `${bundleId}:${docId}` - 다른 문서의 늦은 결과를 버리는 기준 */
  key: string;
  status: OriginalRenderStatus;
  marks: Map<number, PlaceMark[]>;
  pageCount: number;
  renderedDocId: number | null;
  attempt: number;
  error: unknown;
}

export type OriginalRenderAction =
  | { type: "start"; key: string }
  | { type: "unavailable"; key: string; format: "pdf" | "none" }
  | { type: "rendered"; key: string; docId: number; marks: Map<number, PlaceMark[]>; pageCount: number }
  | { type: "failed"; key: string; error: unknown }
  | { type: "retry"; key: string };

/** 그 문서의 상태 - 다른 문서의 것이면 처음(불러오는 중)부터 */
export function readRenderView(state: OriginalRenderState | null, key: string): OriginalRenderState {
  if (state !== null && state.key === key) return state;
  return { key, status: "loading", marks: new Map(), pageCount: 0, renderedDocId: null, attempt: 0, error: null };
}

export function reduceOriginalRender(state: OriginalRenderState, action: OriginalRenderAction): OriginalRenderState {
  if (action.type === "start") return readRenderView(state, action.key);
  if (state.key !== action.key) return state;
  switch (action.type) {
    case "unavailable":
      return { ...state, status: action.format };
    case "rendered":
      return { ...state, status: "ready", marks: action.marks, pageCount: action.pageCount, renderedDocId: action.docId, error: null };
    case "failed":
      return { ...state, status: "error", error: action.error };
    case "retry":
      return { ...state, status: "loading", attempt: state.attempt + 1, error: null };
  }
}

export function useOriginalRender(
  bundleId: number,
  docId: number,
): {
  state: OriginalRenderStatus;
  host: RefObject<HTMLDivElement | null>;
  marks: Map<number, PlaceMark[]>;
  pageCount: number;
  renderedDocId: number | null;
  error: unknown;
  retry: () => void;
} {
  const { t } = useI18n();
  const key = `${bundleId}:${docId}`;
  const [state, dispatch] = useReducer(reduceOriginalRender, key, (first) => readRenderView(null, first));
  // 문서가 바뀌면 그리는 중에 처음으로 되돌린다(이전 렌더 값으로 상태 맞추기)
  if (state.key !== key) dispatch({ type: "start", key });
  const view = readRenderView(state, key);
  const host = useRef<HTMLDivElement | null>(null);
  // 마지막으로 끝까지 그린(또는 못 보임을 확인한) 문서 · 시도 - Activity로 다시 보일 때 같은 것을 다시 그리지 않는다
  const doneRef = useRef("");
  const readEmfLabel = useEffectEvent(() => t("assign.original.emf"));

  useEffect(() => {
    const target = host.current;
    const runKey = `${key}#${view.attempt}`;
    if (target === null || doneRef.current === runKey) return;
    let cancelled = false;
    const { styles, body } = openOriginalRoot(target);
    const run = async () => {
      const places = await fetchOriginalPlaces(bundleId, docId);
      if (cancelled) return;
      if (places.file_format !== "docx") {
        doneRef.current = runKey;
        dispatch({ type: "unavailable", key, format: places.file_format });
        return;
      }
      const file = await downloadDocumentFile(bundleId, docId);
      const parts = await readPartsToMark(file, places.places);
      if (cancelled) return;
      const planted = plantPlaceMarks(parts, places.places);
      await renderOriginal(file, planted.parts, body, styles);
      if (cancelled) return;
      stripUnsafeLinks(body);
      replaceUnrenderable(body, readEmfLabel());
      const pageCount = paginateRendered(body);
      doneRef.current = runKey;
      dispatch({ type: "rendered", key, docId, marks: planted.marks, pageCount });
    };
    run().catch((error: unknown) => {
      if (!cancelled) dispatch({ type: "failed", key, error });
    });
    return () => {
      cancelled = true;
    };
  }, [bundleId, docId, key, view.attempt]);

  return {
    state: view.status,
    host,
    marks: view.marks,
    pageCount: view.pageCount,
    renderedDocId: view.renderedDocId,
    error: view.error,
    retry: () => dispatch({ type: "retry", key }),
  };
}
