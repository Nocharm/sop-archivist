// AI 작업 지켜보기 - 묶음 상태는 들어올 때 한 번, 그다음엔 공용 목록에서 이 묶음 작업이 움직일 때만 다시 읽고, 끝난 작업이 늘면 화면에 알린다.
import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AiJobCounts, AiStatus, RecentAiJobs } from "./api-sop";

const getAiStatus = vi.fn<(id: number) => Promise<AiStatus>>();
const getRecentAiJobs = vi.fn<() => Promise<RecentAiJobs>>();
vi.mock("./api-sop", () => ({ getAiStatus: (id: number) => getAiStatus(id), getRecentAiJobs: () => getRecentAiJobs() }));

const { ApiError } = await import("./api");
const { AI_ACTIVE_POLL_MS, AI_IDLE_POLL_MS } = await import("./ai-jobs-model");
const { startAiJobsPolling } = await import("./ai-jobs-store");
const { useAiJobs } = await import("./use-ai-jobs");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ZERO: AiJobCounts = { queued: 0, running: 0, done: 0, failed: 0, stale: 0, cancelled: 0 };

function makeStatus(counts: Partial<AiJobCounts>): AiStatus {
  return { ai_enabled: true, embed_enabled: false, jobs: { ...ZERO, ...counts }, by_kind: {}, failed_errors: {}, adoption: {} };
}

/** 공용 목록 - 묶음마다 요청 하나 */
function makeRecent(byBundle: Record<number, Partial<AiJobCounts>>): RecentAiJobs {
  const requests = Object.entries(byBundle).map(([bundleId, counts]) => {
    const jobs = { ...ZERO, ...counts };
    return {
      request_id: `r${bundleId}`,
      bundle_id: Number(bundleId),
      bundle_code: `BND-${bundleId}`,
      bundle_title: "B",
      kind: "classify" as const,
      kinds: ["classify" as const],
      requested_by_me: true,
      total: Object.values(jobs).reduce((a, b) => a + b, 0),
      jobs,
      error_counts: {},
      created_at: "2026-11-10T10:00:00+09:00",
      started_at: null,
      running_started_at: null,
      finished_at: jobs.queued + jobs.running > 0 ? null : "2026-11-10T10:00:05+09:00",
      document_id: null,
      document_title: "",
      document_file_name: "",
    };
  });
  return { server_time: "2026-11-10T10:00:00+09:00", jobs: [], jobs_total: 0, requests, requests_total: requests.length };
}

const box: { watch: () => void; status: AiStatus | null; error: unknown } = { watch: () => undefined, status: null, error: null };

function Harness({ onFinished }: { onFinished: () => void }) {
  const { status, error, watch } = useAiJobs(1, onFinished);
  useEffect(() => {
    box.watch = watch;
    box.status = status;
    box.error = error;
  });
  return null;
}

async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

let stop: () => void = () => undefined;

beforeEach(() => {
  vi.useFakeTimers();
  getAiStatus.mockReset();
  getRecentAiJobs.mockReset();
});

afterEach(() => {
  stop();
  vi.useRealTimers();
});

async function mount(onFinished: () => void) {
  const root = createRoot(document.createElement("div"));
  await act(async () => {
    stop = startAiJobsPolling("qa.member");
    root.render(createElement(Harness, { onFinished }));
  });
  return root;
}

describe("useAiJobs", () => {
  it("reads the bundle status once and not again while its jobs stay still", async () => {
    getAiStatus.mockResolvedValue(makeStatus({ done: 2 }));
    getRecentAiJobs.mockResolvedValue(makeRecent({ 1: { done: 2 } }));
    const root = await mount(() => undefined);
    await tick(AI_IDLE_POLL_MS * 3);
    expect(getAiStatus).toHaveBeenCalledTimes(1);
    expect(box.status?.jobs.done).toBe(2);
    act(() => root.unmount());
  });

  it("reads again when its jobs move in the shared list and reports when one finishes", async () => {
    const finished = vi.fn();
    getAiStatus.mockResolvedValueOnce(makeStatus({ done: 1 }));
    getRecentAiJobs.mockResolvedValueOnce(makeRecent({ 1: { done: 1 } }));
    const root = await mount(finished);

    // "AI에 묻기" 뒤 - 상태를 바로 다시 읽고 공용 목록도 바로 묻는다
    getAiStatus.mockResolvedValueOnce(makeStatus({ queued: 1, done: 1 })).mockResolvedValueOnce(makeStatus({ running: 1, done: 1 })).mockResolvedValue(makeStatus({ done: 2 }));
    getRecentAiJobs.mockResolvedValueOnce(makeRecent({ 1: { queued: 1, done: 1 } })).mockResolvedValueOnce(makeRecent({ 1: { running: 1, done: 1 } })).mockResolvedValue(makeRecent({ 1: { done: 2 } }));
    await act(async () => box.watch());
    expect(getRecentAiJobs).toHaveBeenCalledTimes(2);
    expect(box.status?.jobs.queued).toBe(1);
    await tick(AI_ACTIVE_POLL_MS);
    expect(finished).not.toHaveBeenCalled();
    await tick(AI_ACTIVE_POLL_MS);
    expect(finished).toHaveBeenCalledTimes(1);
    expect(box.status?.jobs.done).toBe(2);

    const calls = getAiStatus.mock.calls.length;
    await tick(AI_IDLE_POLL_MS * 2);
    expect(getAiStatus).toHaveBeenCalledTimes(calls);
    act(() => root.unmount());
  });

  it("ignores jobs of other bundles", async () => {
    getAiStatus.mockResolvedValue(makeStatus({}));
    getRecentAiJobs.mockResolvedValueOnce(makeRecent({ 2: { running: 1 } })).mockResolvedValue(makeRecent({ 2: { done: 1 } }));
    const root = await mount(() => undefined);
    await tick(AI_ACTIVE_POLL_MS * 2);
    expect(getAiStatus).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });

  it("shows that the status is not updating while the shared list fails, and clears it once it answers", async () => {
    getAiStatus.mockResolvedValue(makeStatus({ running: 1 }));
    getRecentAiJobs.mockRejectedValueOnce(new Error("network")).mockResolvedValue(makeRecent({ 1: { running: 1 } }));
    const root = await mount(() => undefined);
    expect(box.error).toBeInstanceOf(Error);
    await tick(AI_ACTIVE_POLL_MS);
    expect(box.error).toBeNull();
    act(() => root.unmount());
  });

  it("does not keep asking for a status that is refused", async () => {
    getAiStatus.mockRejectedValue(new ApiError(404, "gone"));
    getRecentAiJobs.mockResolvedValue(makeRecent({ 2: { running: 1 } }));
    const root = await mount(() => undefined);
    await tick(AI_ACTIVE_POLL_MS * 4);
    expect(getAiStatus).toHaveBeenCalledTimes(1);
    expect(box.error).toBeInstanceOf(ApiError);
    act(() => root.unmount());
  });
});
