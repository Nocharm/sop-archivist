// 지금 연 묶음 하나를 상단 막대와 화면이 함께 쓰는 캐시 - 같은 묶음을 두 번 부르지 않고, 저장 뒤 새 값을 넣으면 제목·상태가 같이 바뀐다.
"use client";

import { useEffect, useSyncExternalStore } from "react";

import { getBundle, type Bundle } from "./api-sop";

interface Entry {
  bundle: Bundle | null;
  error: unknown;
  loading: boolean;
}

const EMPTY: Entry = { bundle: null, error: null, loading: true };
const entries = new Map<number, Entry>();
const inflight = new Map<number, Promise<void>>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setEntry(bundleId: number, next: Entry): void {
  entries.set(bundleId, next);
  emit();
}

/** 묶음을 (다시) 불러온다. 다시 불러오는 동안 이전 값은 그대로 보인다. */
export function loadBundle(bundleId: number): Promise<void> {
  const running = inflight.get(bundleId);
  if (running) return running;
  const previous = entries.get(bundleId);
  if (previous && !previous.loading) setEntry(bundleId, { ...previous, loading: true });
  const request = getBundle(bundleId).then(
    (bundle) => setEntry(bundleId, { bundle, error: null, loading: false }),
    (error: unknown) => setEntry(bundleId, { bundle: entries.get(bundleId)?.bundle ?? null, error, loading: false }),
  );
  const tracked = request.finally(() => inflight.delete(bundleId));
  inflight.set(bundleId, tracked);
  return tracked;
}

/** 저장 응답(BundleOut)을 바로 넣는다 - 다시 부르지 않아도 화면이 따라온다. */
export function putBundle(bundle: Bundle): void {
  setEntry(bundle.id, { bundle, error: null, loading: false });
}

export function useBundle(bundleId: number | null): Entry & { reload: () => void } {
  const entry = useSyncExternalStore(
    subscribe,
    () => (bundleId === null ? EMPTY : (entries.get(bundleId) ?? EMPTY)),
    () => EMPTY,
  );
  useEffect(() => {
    if (bundleId !== null && !entries.has(bundleId)) void loadBundle(bundleId);
  }, [bundleId]);
  return { ...entry, reload: () => (bundleId === null ? undefined : void loadBundle(bundleId)) };
}
