// 상단 바 AI 작업 표시의 규칙 - 요청 집계·진행 수·끝난 요청 골라내기(알림)·경과 시간·"오래 걸림"·묶음별 묶기. 화면 없이 시험한다.

import type { AiJobCounts, AiJobKind, RecentAiJobs, RecentAiRequest } from "./api-sop";
import type { StageKey } from "./stages";

/** 무엇인가 대기·실행 중일 때 다시 묻는 간격(ms) - 짧으면 서버에 자주 묻고, 길면 끝난 작업이 늦게 보인다 */
export const AI_ACTIVE_POLL_MS = 3000;
/** 아무것도 돌지 않을 때 다시 묻는 간격(ms) - 다른 사람·자동(업로드 뒤 문서 정보) 작업을 이 안에 알아챈다 */
export const AI_IDLE_POLL_MS = 30000;
/** 실패 뒤 다시 묻는 간격의 상한(ms) - 3초에서 두 배씩 늘려 여기서 멈춘다 */
export const AI_RETRY_MAX_MS = 30000;
/** 작업 하나가 이보다 오래 running이면 "오래 걸림"을 보인다(ms). AI 호출 타임아웃(60초)의 세 배 - 그 안에 끝나지 않으면 멈췄을 가능성이 크다 */
export const AI_SLOW_MS = 3 * 60_000;

/** 종류가 결과를 보이는 화면 - 목록의 "열기"가 데려간다 */
const KIND_STAGE: Record<AiJobKind, StageKey> = {
  classify: "assign",
  translate: "assign",
  match_plan: "assign",
  match: "assign",
  pair: "split",
  split: "split",
  doc_meta: "documents",
};

export function getKindStage(kind: AiJobKind): StageKey {
  return KIND_STAGE[kind] ?? "overview";
}

export function isRequestActive(request: RecentAiRequest): boolean {
  return request.finished_at === null;
}

/** 진행 "n / N" - 성공한 작업 수와 전체. 짝 맞추기는 도중에 전체가 는다 */
export function getRequestProgress(request: RecentAiRequest): { done: number; total: number } {
  // 성공한 것만 센다 - 실패·버려짐·취소가 같이 있는데 "n / n"으로 읽히지 않게
  return { done: request.jobs.done, total: request.total };
}

export type RequestOutcome = "running" | "queued" | "failed" | "stale" | "cancelled" | "done";

/** 요청 한 줄의 상태 - 도는 중이면 running·queued, 끝났으면 실패 > 버려짐 > 취소 > 완료 순으로 가장 알릴 만한 것 */
export function getRequestOutcome(request: RecentAiRequest): RequestOutcome {
  const { jobs } = request;
  if (isRequestActive(request)) return jobs.running > 0 ? "running" : "queued";
  if (jobs.failed > 0) return "failed";
  if (jobs.stale > 0) return "stale";
  if (jobs.cancelled > 0) return "cancelled";
  return "done";
}

export type IndicatorState = "hidden" | "idle" | "active" | "failed" | "error";

export interface AiJobsSummary {
  state: IndicatorState;
  /** 대기·실행 중인 요청 수 */
  active: number;
  /** 실패가 있는데 아직 목록을 열어 보지 않은 요청 수 */
  failedUnseen: number;
}

/**
 * 상단 바 표시 하나로 접는다 - 도는 것이 있으면 active, 아니면 보지 않은 실패가 있으면 failed, 상태를 못 받으면 error,
 * 하루 안에 작업이 있었으면 idle, 아무것도 없으면 숨긴다. 도는 중에도 실패 수는 따로 센다(배지).
 */
export function summarizeAiJobs(data: RecentAiJobs | null, error: unknown, seen: ReadonlySet<string>): AiJobsSummary {
  const requests = data?.requests ?? [];
  const active = requests.filter(isRequestActive).length;
  const failedUnseen = requests.filter((request) => !isRequestActive(request) && request.jobs.failed > 0 && !seen.has(request.request_id)).length;
  let state: IndicatorState;
  if (active > 0) state = "active";
  else if (failedUnseen > 0) state = "failed";
  else if (error !== null && error !== undefined) state = "error";
  else if (requests.length > 0) state = "idle";
  else state = "hidden";
  return { state, active, failedUnseen };
}

export function getNextPollMs(data: RecentAiJobs | null): number {
  return (data?.requests ?? []).some(isRequestActive) ? AI_ACTIVE_POLL_MS : AI_IDLE_POLL_MS;
}

export function getRetryMs(failures: number): number {
  return Math.min(AI_ACTIVE_POLL_MS * 2 ** Math.max(failures - 1, 0), AI_RETRY_MAX_MS);
}

/** 앞 답의 서버 시각보다 이만큼 먼저 생긴 요청도 "그 뒤에 생긴 것"으로 본다(ms) - 작업을 쌓은 시각과 커밋 사이에 앞 답이 지나가면 그 답에 없다 */
export const AI_NEW_REQUEST_SLACK_MS = 10_000;

/**
 * 알릴 요청 - 내가 한 요청 중 이번에 끝난 것. 앞 답에서 돌고 있었거나, 앞 답 무렵 뒤에 생겨 두 번 묻는 사이에 끝난 것.
 * 앞 답이 없으면(첫 답·사용자 전환 뒤) 아무것도 알리지 않는다 - 지난 일을 쏟아내지 않게.
 */
export function findFinishedRequests(previous: RecentAiJobs | null, next: RecentAiJobs): RecentAiRequest[] {
  if (previous === null) return [];
  const before = new Map(previous.requests.map((request) => [request.request_id, request]));
  const since = Date.parse(previous.server_time) - AI_NEW_REQUEST_SLACK_MS;
  return next.requests.filter((request) => {
    if (!request.requested_by_me || isRequestActive(request)) return false;
    const earlier = before.get(request.request_id);
    if (earlier) return isRequestActive(earlier);
    return Date.parse(request.created_at) >= since;
  });
}

/** 서버 시계로 본 지금(ms) - 받은 때 서버 시각에 그 뒤 흐른 시간을 더한다. 클라이언트 시계가 틀려도 경과가 맞다 */
export function getServerNow(serverTime: string, receivedAt: number, clientNow: number): number {
  return Date.parse(serverTime) + (clientNow - receivedAt);
}

/** 경과 ms → "m:ss" 또는 "h:mm:ss" */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}

/** 도는 요청이 지금 상태에 머문 시간 - 실행 중이면 첫 시작부터, 대기 중이면 쌓인 때부터 */
export function getRequestElapsedMs(request: RecentAiRequest, serverNow: number): number {
  const from = request.jobs.running > 0 && request.started_at ? request.started_at : request.created_at;
  return serverNow - Date.parse(from);
}

/**
 * 지금 실행 중인 작업 하나라도 AI_SLOW_MS보다 오래 running이면 오래 걸림. 서버가 요청마다 실행 중 작업의 가장 이른 시작을 준다
 * (작업 목록은 100건만 오고, 워커는 가장 오래된 작업부터 꺼내 큰 요청에서는 도는 작업이 목록 밖이다)
 */
export function isRequestSlow(request: RecentAiRequest, serverNow: number): boolean {
  if (request.jobs.running === 0 || request.running_started_at === null) return false;
  return serverNow - Date.parse(request.running_started_at) > AI_SLOW_MS;
}

/** 요청이 문서 하나에 걸려 있으면 그 문서 이름(제목, 없으면 파일 이름) - 여러 문서거나 문서가 없으면 "" */
export function getRequestDocument(request: RecentAiRequest): string {
  return request.document_id === null ? "" : request.document_title || request.document_file_name;
}

export interface BundleGroup {
  bundleId: number;
  bundleCode: string;
  bundleTitle: string;
  requests: RecentAiRequest[];
}

/** 도는 요청을 먼저 - 같은 쪽 안에서는 서버가 준 순서(최신 순)를 지킨다 */
export function sortActiveFirst(requests: readonly RecentAiRequest[]): RecentAiRequest[] {
  return [...requests.filter(isRequestActive), ...requests.filter((request) => !isRequestActive(request))];
}

/** 묶음별로 모은다 - 도는 요청이 있는 묶음이 먼저이고, 묶음 안에서도 도는 요청이 먼저다. 나머지는 최신 순 */
export function groupRequestsByBundle(requests: readonly RecentAiRequest[]): BundleGroup[] {
  const groups = new Map<number, BundleGroup>();
  for (const request of sortActiveFirst(requests)) {
    let group = groups.get(request.bundle_id);
    if (!group) {
      group = { bundleId: request.bundle_id, bundleCode: request.bundle_code, bundleTitle: request.bundle_title, requests: [] };
      groups.set(request.bundle_id, group);
    }
    group.requests.push(request);
  }
  return [...groups.values()];
}

/** 한 묶음의 작업 상태 지문 - 바뀔 때만 화면이 묶음 AI 상태(/ai/status)를 다시 읽는다 */
export function getBundleSignature(data: RecentAiJobs | null, bundleId: number): string {
  const sum: AiJobCounts = { queued: 0, running: 0, done: 0, failed: 0, stale: 0, cancelled: 0 };
  for (const request of data?.requests ?? []) {
    if (request.bundle_id !== bundleId) continue;
    for (const key of Object.keys(sum) as (keyof AiJobCounts)[]) sum[key] += request.jobs[key];
  }
  return `${sum.queued}:${sum.running}:${sum.done}:${sum.failed}:${sum.stale}:${sum.cancelled}`;
}

/** 문서 정보(doc_meta)를 AI가 아직 읽는 문서 - 요청 목록(도는 요청은 상한에 걸리지 않는다)에서 고른다. 업로드마다 문서 하나에 요청 하나다 */
export function listReadingDocuments(data: RecentAiJobs | null, bundleId: number): Set<number> {
  const ids = new Set<number>();
  for (const request of data?.requests ?? []) {
    if (request.bundle_id === bundleId && request.kinds.includes("doc_meta") && request.document_id !== null && isRequestActive(request)) ids.add(request.document_id);
  }
  return ids;
}

/** 탭이 가려진 동안 끝난 요청을 모아 둔다 - 같은 요청은 한 번(나중 상태가 이긴다) */
export function mergeToastQueue(queue: readonly RecentAiRequest[], finished: readonly RecentAiRequest[]): RecentAiRequest[] {
  const byId = new Map(queue.map((request) => [request.request_id, request]));
  for (const request of finished) byId.set(request.request_id, request);
  return [...byId.values()];
}

export interface RequestToast {
  tone: "ok" | "error" | "info";
  /** i18n 키 - aiJobs.toast.<outcome> */
  key: string;
  /** 그 결과의 작업 수(실패·버려짐·취소) */
  n: number;
  /** 실패 코드(가장 많은 것), 실패가 아니면 "" */
  reason: string;
}

/** 끝난 요청 알림 한 줄 - 실패는 오류, 버려짐·취소는 설명(info), 다 끝났으면 완료 */
export function getRequestToast(request: RecentAiRequest): RequestToast {
  const outcome = getRequestOutcome(request);
  if (outcome === "failed") return { tone: "error", key: "aiJobs.toast.failed", n: request.jobs.failed, reason: getTopError(request) };
  if (outcome === "stale") return { tone: "info", key: "aiJobs.toast.stale", n: request.jobs.stale, reason: "" };
  if (outcome === "cancelled") return { tone: "info", key: "aiJobs.toast.cancelled", n: request.jobs.cancelled, reason: "" };
  return { tone: "ok", key: "aiJobs.toast.done", n: request.jobs.done, reason: "" };
}

/** 가장 많은 실패 코드 - 알림 한 줄에 이유 하나만 싣는다 */
export function getTopError(request: RecentAiRequest): string {
  let top = "";
  let count = 0;
  for (const [code, n] of Object.entries(request.error_counts)) {
    if (n > count) {
      top = code;
      count = n;
    }
  }
  return top;
}
