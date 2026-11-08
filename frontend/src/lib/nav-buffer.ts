// 앱 안 이동 버퍼 - 사람이 고른 이동은 0.6초 뒤에 일어나고, 그 사이 같은 곳을 다시 고르면(또는 Esc) 취소된다.
// 링크 클릭은 NavHost가 창 캡처 단계에서 가로채 여기로 보낸다. 저장 안 한 변경이 있는 화면은 registerLeaveGuard로 이동을 넘겨받는다.
"use client";

import { useSyncExternalStore } from "react";

/** 버퍼 길이(ms). 사용자 요청 0.5~0.7초의 가운데 - 바꾸면 진행 막대 CSS(.nav-progress)의 전환 시간도 같이 본다 */
export const NAV_BUFFER_MS = 600;
// 이동을 보낸 뒤 경로가 끝내 안 바뀌면(같은 주소 등) 진행 표시를 거두는 상한(ms)
const LOADING_GIVE_UP_MS = 6000;
// 도착 뒤 막대가 100%로 차고 사라지는 시간(ms)
const DONE_LINGER_MS = 320;

export type NavPhase = "idle" | "buffer" | "loading" | "done";

export interface NavState {
  phase: NavPhase;
  /** 버퍼 중이거나 불러오는 중인 목적지(경로+쿼리) */
  href: string | null;
}

interface LeaveGuard {
  onLeave: (href: string) => void;
}

const IDLE: NavState = { phase: "idle", href: null };
let state: NavState = IDLE;
let timer: number | null = null;
let push: ((href: string) => void) | null = null;
let prefetch: ((href: string) => void) | null = null;
const listeners = new Set<() => void>();
const guards: LeaveGuard[] = [];

function setState(next: NavState): void {
  state = next;
  for (const listener of listeners) listener();
}

function clearTimer(): void {
  if (timer !== null) window.clearTimeout(timer);
  timer = null;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getNavState(): NavState {
  return state;
}

export function useNavState(): NavState {
  return useSyncExternalStore(subscribe, getNavState, () => IDLE);
}

/** NavHost가 라우터를 꽂는다. 라우터가 없으면(로그인 전) 이동은 일어나지 않는다 */
export function bindNavRouter(nextPush: (href: string) => void, nextPrefetch: (href: string) => void): () => void {
  push = nextPush;
  prefetch = nextPrefetch;
  return () => {
    push = null;
    prefetch = null;
    clearTimer();
    state = IDLE;
  };
}

function startLoading(href: string): void {
  clearTimer();
  setState({ phase: "loading", href });
  push?.(href);
  timer = window.setTimeout(() => {
    timer = null;
    if (state.phase === "loading") setState(IDLE);
  }, LOADING_GIVE_UP_MS);
}

/** 버퍼 중인 이동을 거둔다. 이미 보낸 이동(loading)은 되돌리지 못한다 */
export function cancelNav(): void {
  if (state.phase !== "buffer") return;
  clearTimer();
  setState(IDLE);
}

/**
 * 사람이 고른 앱 안 이동. immediate는 확인 창처럼 이미 한 번 확인받은 이동이라 버퍼와 가드를 건너뛴다.
 * 버퍼 중인 같은 목적지를 다시 고르면 취소, 다른 목적지면 그쪽으로 다시 건다.
 */
export function navigate(href: string, { immediate = false }: { immediate?: boolean } = {}): void {
  if (state.phase === "buffer" && state.href === href && !immediate) {
    cancelNav();
    return;
  }
  const guard = guards.at(-1);
  if (guard && !immediate) {
    cancelNav();
    guard.onLeave(href);
    return;
  }
  prefetch?.(href);
  if (immediate) {
    startLoading(href);
    return;
  }
  clearTimer();
  setState({ phase: "buffer", href });
  timer = window.setTimeout(() => startLoading(href), NAV_BUFFER_MS);
}

/** 경로가 바뀌었다 - 막대를 채우고 거둔다 */
export function completeNav(): void {
  if (state.phase === "idle" || state.phase === "done") return;
  clearTimer();
  setState({ phase: "done", href: null });
  timer = window.setTimeout(() => {
    timer = null;
    setState(IDLE);
  }, DONE_LINGER_MS);
}

/** 가드가 걸려 있으면 링크 클릭은 가드 쪽 리스너(useLeaveGuard)가 받는다 - NavHost는 손대지 않는다 */
export function hasLeaveGuard(): boolean {
  return guards.length > 0;
}

/** 저장 안 한 변경이 있는 동안 앱 안 이동을 화면이 넘겨받는다. 가장 나중에 건 가드가 받는다 */
export function registerLeaveGuard(guard: LeaveGuard): () => void {
  guards.push(guard);
  return () => {
    const index = guards.indexOf(guard);
    if (index >= 0) guards.splice(index, 1);
  };
}
