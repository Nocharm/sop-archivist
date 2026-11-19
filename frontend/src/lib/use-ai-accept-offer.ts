// AI 추천 일괄 수락의 묶음 맥락 - 상단 바 AI 알약은 어느 묶음·Old 문서인지 모르므로, 연 Assign 화면이 여기에 묶음·종류별 건수·창 열기를 올려 둔다.
// 알약 메뉴가 이것을 읽어 "AI 추천 받기"를 보이고, 누르면 Assign의 확인 창이 열린다(설계 2026-11-19-ai-suggest-only §5 3-1).
"use client";

import { useEffect, useSyncExternalStore } from "react";

import type { AcceptKind } from "./api-sop";

export interface AiAcceptOffer {
  bundleId: number;
  /** 지금 연 Old 문서의 살아 있는 제안 수 - 0이어도 Bundle 전체는 확인 창에서 고른다 */
  counts: Record<AcceptKind, number>;
}

interface Registered {
  offer: AiAcceptOffer;
  open: (kind: AcceptKind) => void;
}

let current: Registered | null = null;
const listeners = new Set<() => void>();

function emit(next: Registered | null): void {
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 상단 바가 읽는다 - 일괄 수락을 열 수 있는 Assign 화면이 없으면 null */
export function useAiAcceptOffer(): Registered | null {
  return useSyncExternalStore(subscribe, () => current, () => null);
}

/**
 * Assign 화면이 올린다 - offer가 null이면(편집할 수 없음 등) 내리고, 화면을 떠나면 내린다. 건수가 바뀔 때만 다시 알린다.
 * open은 다른 컴포넌트(상단 바)의 클릭에서 불리므로 렌더마다 바뀌지 않는 함수(state setter)를 넘긴다.
 */
export function useRegisterAiAcceptOffer(offer: AiAcceptOffer | null, open: (kind: AcceptKind) => void): void {
  const key = offer === null ? "" : `${offer.bundleId}:${offer.counts.classify}:${offer.counts.match}`;
  useEffect(() => {
    if (key === "") return;
    const [bundleId, classify, match] = key.split(":").map(Number);
    const registered: Registered = { offer: { bundleId, counts: { classify, match } }, open };
    emit(registered);
    return () => {
      if (current === registered) emit(null);
    };
  }, [key, open]);
}
