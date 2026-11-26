// 이어 불러오는 긴 목록 - 서버 커서로 한 묶음씩 받아 쌓는다. 끝 표지가 화면에 가까워지면 다음 묶음을 받고, 실패하면 오류를 알린 채 멈춘다(retry로 다시).
"use client";

import { useEffect, useEffectEvent, useState } from "react";

const PRELOAD_MARGIN = "600px 0px";

export interface CursorList<T> {
  items: readonly T[];
  hasMore: boolean;
  isLoading: boolean;
  error: unknown;
  /** 목록 끝에 두는 표지 - 보이면 다음 묶음을 받는다 */
  sentinelRef: (node: Element | null) => void;
  retry: () => void;
}

interface CursorState<T> {
  items: readonly T[];
  isDone: boolean;
  isLoading: boolean;
  error: unknown;
}

/** fetchPage(cursor) - cursor는 마지막으로 받은 항목(처음에는 null). pageSize보다 적게 오면 끝이다. */
export function useCursorList<T>(fetchPage: (last: T | null) => Promise<T[]>, pageSize: number): CursorList<T> {
  const [state, setState] = useState<CursorState<T>>({ items: [], isDone: false, isLoading: true, error: null });
  const [attempt, setAttempt] = useState(0);
  const [sentinel, setSentinel] = useState<Element | null>(null);
  // 쌓인 마지막 항목 다음 묶음 - 부른 순간의 목록을 읽는다
  const loadPage = useEffectEvent((isAlive: () => boolean) => {
    fetchPage(state.items[state.items.length - 1] ?? null).then(
      (page) => {
        if (isAlive()) setState((prev) => ({ items: [...prev.items, ...page], isDone: page.length < pageSize, isLoading: false, error: null }));
      },
      (error: unknown) => {
        if (isAlive()) setState((prev) => ({ ...prev, isLoading: false, error }));
      },
    );
  });

  // attempt 한 번 = 묶음 하나(처음 마운트, 끝 표지가 보일 때, 다시 시도)
  useEffect(() => {
    let alive = true;
    loadPage(() => alive);
    return () => {
      alive = false;
    };
  }, [attempt]);

  const requestNext = useEffectEvent(() => {
    if (state.isLoading || state.isDone || state.error !== null) return;
    setState((prev) => ({ ...prev, isLoading: true }));
    setAttempt((count) => count + 1);
  });

  useEffect(() => {
    if (!sentinel || state.isDone) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) requestNext();
      },
      { rootMargin: PRELOAD_MARGIN },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [sentinel, state.isDone, state.items.length]);

  return {
    items: state.items,
    hasMore: !state.isDone && state.error === null,
    isLoading: state.isLoading,
    error: state.error,
    sentinelRef: setSentinel,
    retry: () => {
      setState((prev) => ({ ...prev, isLoading: true, error: null }));
      setAttempt((count) => count + 1);
    },
  };
}
