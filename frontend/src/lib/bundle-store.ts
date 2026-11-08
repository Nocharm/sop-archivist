// 지금 연 묶음 하나를 상단 막대와 화면이 함께 쓰는 캐시 - 화면에 들어올 때마다 다시 불러오고(동시에 들어오면 한 번), 저장 뒤 새 값을 넣으면 제목·상태가 같이 바뀐다. 나중에 시작한 요청·저장이 늘 이긴다.
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
// 묶음마다 마지막으로 시작한 요청(또는 넣은 저장 응답)의 번호 - 늦게 끝난 낡은 응답이 새 값을 덮지 않게 한다
const latest = new Map<number, number>();
let sequence = 0;
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

/**
 * 묶음을 새로 불러온다 - 바꾼 뒤(저장·409) 부르면 그 전에 시작한 요청을 재쓰지 않고 새 요청을 보낸다.
 * 다시 불러오는 동안 이전 값은 그대로 보인다.
 */
export function loadBundle(bundleId: number): Promise<void> {
  const mine = ++sequence;
  latest.set(bundleId, mine);
  const previous = entries.get(bundleId);
  if (previous && !previous.loading) setEntry(bundleId, { ...previous, loading: true });
  const isLatest = () => latest.get(bundleId) === mine;
  const request = getBundle(bundleId).then(
    (bundle) => {
      if (isLatest()) setEntry(bundleId, { bundle, error: null, loading: false });
    },
    (error: unknown) => {
      if (isLatest()) setEntry(bundleId, { bundle: entries.get(bundleId)?.bundle ?? null, error, loading: false });
    },
  );
  const tracked: Promise<void> = request.finally(() => {
    if (inflight.get(bundleId) === tracked) inflight.delete(bundleId);
  });
  inflight.set(bundleId, tracked);
  return tracked;
}

/** 화면에 들어올 때 - 상단 막대와 화면이 함께 들어오면 요청은 한 번이다 */
function refreshOnEntry(bundleId: number): void {
  if (!inflight.has(bundleId)) void loadBundle(bundleId);
}

/** 저장 응답(BundleOut)을 바로 넣는다 - 다시 부르지 않아도 화면이 따라오고, 그 전에 시작한 요청은 버린다. */
export function putBundle(bundle: Bundle): void {
  latest.set(bundle.id, ++sequence);
  setEntry(bundle.id, { bundle, error: null, loading: false });
}

export function useBundle(bundleId: number | null): Entry & { reload: () => void } {
  const entry = useSyncExternalStore(
    subscribe,
    () => (bundleId === null ? EMPTY : (entries.get(bundleId) ?? EMPTY)),
    () => EMPTY,
  );
  // 캐시가 있어도 들어올 때마다 다시 부른다 - 다른 사람이 돌려보내거나 고친 묶음이 세션 내내 낡지 않게(그동안 캐시 값이 보인다)
  useEffect(() => {
    if (bundleId !== null) refreshOnEntry(bundleId);
  }, [bundleId]);
  return { ...entry, reload: () => (bundleId === null ? undefined : void loadBundle(bundleId)) };
}
