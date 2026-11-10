// 최근 AI 작업을 앱 전체가 함께 쓰는 저장소 - 상단 바가 한 번 켜 둔 폴러 하나가 /ai/jobs/recent를 묻고, 상단 바 표시·알림·화면의 useAiJobs가 같은 답을 읽는다.
// 무엇인가 돌면 3초, 조용하면 30초마다 묻는다. 실패하면 간격을 늘려 다시 묻고(멈추지 않는다), 401·403만 다음 요청(poke)이나 다시 켤 때까지 쉰다.
"use client";

import { useSyncExternalStore } from "react";

import { ApiError } from "./api";
import { getRecentAiJobs, type RecentAiJobs } from "./api-sop";
import { getNextPollMs, getRetryMs } from "./ai-jobs-model";

export interface AiJobsSnapshot {
  data: RecentAiJobs | null;
  /** 마지막 묻기의 실패, 성공하면 null */
  error: unknown;
  /** data를 받은 때의 클라이언트 시각(ms) - 서버 시각과 함께 경과를 잰다 */
  receivedAt: number;
}

// 실패를 이미 본(목록을 연) 요청 - 새로고침해도 배지가 되살아나지 않게 이 브라우저에 둔다
const SEEN_KEY = "sopa.aiJobs.seenFailed";
const SEEN_MAX = 200;

const EMPTY: AiJobsSnapshot = { data: null, error: null, receivedAt: 0 };
let snapshot: AiJobsSnapshot = EMPTY;
let seen: ReadonlySet<string> = new Set();
let seenLoaded = false;
const listeners = new Set<() => void>();

// 폴러 - 켜 둔 곳 수, 다음 묻기 타이머, 도는 요청, 실패 횟수, 세대(비운 뒤 늦게 온 답을 버린다)
let holders = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let inflight = false;
let again = false;
let failures = 0;
let generation = 0;

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function schedule(ms: number): void {
  clearTimeout(timer);
  if (holders > 0) timer = setTimeout(() => void poll(), ms);
}

// 다시 물어도 같은 답인 거절(로그인 만료·퇴직 계정) - 몰아 묻지 않고 다음 poke까지 쉰다
function isRefusal(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 401 || err.status === 403);
}

async function poll(): Promise<void> {
  if (inflight) {
    again = true;
    return;
  }
  inflight = true;
  clearTimeout(timer);
  const mine = generation;
  try {
    const data = await getRecentAiJobs();
    if (mine !== generation) return;
    failures = 0;
    snapshot = { data, error: null, receivedAt: Date.now() };
    emit();
    schedule(getNextPollMs(data));
  } catch (err) {
    if (mine !== generation) return;
    failures += 1;
    snapshot = { ...snapshot, error: err };
    emit();
    if (!isRefusal(err)) schedule(getRetryMs(failures));
  } finally {
    if (mine === generation) {
      inflight = false;
      if (again) {
        again = false;
        void poll();
      }
    }
  }
}

function handleVisible(): void {
  if (document.visibilityState === "visible") void poll();
}

/** 폴러를 켠다(상단 바가 로그인한 동안 한 번) - 돌려준 함수로 끈다 */
export function startAiJobsPolling(): () => void {
  holders += 1;
  if (holders === 1) {
    document.addEventListener("visibilitychange", handleVisible);
    void poll();
  }
  return () => {
    holders -= 1;
    if (holders > 0) return;
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", handleVisible);
  };
}

/** 지금 다시 묻는다 - AI 요청·취소·다시 시도 직후에 불러 새 작업이 바로 보이게 한다 */
export function pokeAiJobs(): void {
  if (holders > 0) void poll();
}

/** 로그아웃·사용자 전환 때 - 앞 사용자의 작업 목록(묶음 제목 포함)을 잊고, 도는 요청의 답도 버린다 */
export function clearAiJobsStore(): void {
  generation += 1;
  inflight = false;
  again = false;
  failures = 0;
  snapshot = EMPTY;
  emit();
  if (holders > 0) void poll();
}

/** 훅 밖에서 지금 값을 읽는다 */
export function readAiJobsSnapshot(): AiJobsSnapshot {
  return snapshot;
}

export function useAiJobsSnapshot(): AiJobsSnapshot {
  return useSyncExternalStore(subscribe, () => snapshot, () => EMPTY);
}

/** 고른 값만 지켜본다 - 문자열·숫자처럼 같으면 같은 값을 돌려주는 고르기여야 다시 그리지 않는다 */
export function useAiJobsSelect<T>(select: (snapshot: AiJobsSnapshot) => T, serverValue: T): T {
  return useSyncExternalStore(subscribe, () => select(snapshot), () => serverValue);
}

function loadSeen(): void {
  if (seenLoaded) return;
  seenLoaded = true;
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) seen = new Set(parsed.filter((item): item is string => typeof item === "string"));
  } catch {
    // 저장소를 못 읽으면(사생활 보호 창 등) 이번 창에서만 기억한다
  }
}

function getSeen(): ReadonlySet<string> {
  loadSeen();
  return seen;
}

const NO_SEEN: ReadonlySet<string> = new Set();

export function useSeenFailures(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, getSeen, () => NO_SEEN);
}

/** 목록을 열어 본 실패 요청 - 배지에서 뺀다. 오래된 것부터 버려 상한을 지킨다 */
export function markFailuresSeen(requestIds: readonly string[]): void {
  loadSeen();
  const fresh = requestIds.filter((id) => !seen.has(id));
  if (fresh.length === 0) return;
  seen = new Set([...seen, ...fresh].slice(-SEEN_MAX));
  try {
    window.localStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));
  } catch {
    // 저장 못 해도 이번 창에서는 본 것으로 둔다
  }
  emit();
}
