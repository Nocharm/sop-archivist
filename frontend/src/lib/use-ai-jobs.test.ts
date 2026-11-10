// AI 작업 지켜보기 - 대기·실행 중인 작업이 있는 동안만 상태를 다시 묻고, 작업이 끝나면 화면에 알려 제안을 다시 불러오게 한다.
import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AiJobCounts, AiStatus } from "./api-sop";

const getAiStatus = vi.fn<(id: number) => Promise<AiStatus>>();
vi.mock("./api-sop", () => ({ getAiStatus: (id: number) => getAiStatus(id) }));

const { ApiError } = await import("./api");
const { AI_POLL_MS, AI_RETRY_MAX_MS, useAiJobs } = await import("./use-ai-jobs");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeStatus(counts: Partial<AiJobCounts>): AiStatus {
  return { ai_enabled: true, embed_enabled: false, jobs: { queued: 0, running: 0, done: 0, failed: 0, stale: 0, cancelled: 0, ...counts }, by_kind: {}, failed_errors: {}, adoption: {} };
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

beforeEach(() => {
  vi.useFakeTimers();
  getAiStatus.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useAiJobs", () => {
  it("asks once and stops when nothing is queued or running", async () => {
    getAiStatus.mockResolvedValue(makeStatus({ done: 2 }));
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(createElement(Harness, { onFinished: () => undefined })));
    await tick(AI_POLL_MS * 3);
    expect(getAiStatus).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });

  it("keeps asking while a job runs and reports when it finishes", async () => {
    const finished = vi.fn();
    getAiStatus.mockResolvedValueOnce(makeStatus({ done: 1 }));
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(createElement(Harness, { onFinished: finished })));

    // "AI에 묻기" 뒤 - 작업이 쌓였다
    getAiStatus.mockResolvedValueOnce(makeStatus({ queued: 1, done: 1 })).mockResolvedValueOnce(makeStatus({ running: 1, done: 1 })).mockResolvedValue(makeStatus({ done: 2 }));
    await act(async () => box.watch());
    expect(box.status?.jobs.queued).toBe(1);
    await tick(AI_POLL_MS);
    expect(finished).not.toHaveBeenCalled();
    await tick(AI_POLL_MS);
    expect(finished).toHaveBeenCalledTimes(1);
    expect(box.status?.jobs.done).toBe(2);

    const calls = getAiStatus.mock.calls.length;
    await tick(AI_POLL_MS * 3);
    expect(getAiStatus).toHaveBeenCalledTimes(calls);
    act(() => root.unmount());
  });

  it("keeps asking with longer gaps after a failure and clears the error once it answers", async () => {
    const finished = vi.fn();
    getAiStatus.mockResolvedValueOnce(makeStatus({ running: 1 })).mockRejectedValueOnce(new Error("network")).mockRejectedValueOnce(new Error("network")).mockResolvedValue(makeStatus({ done: 1 }));
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(createElement(Harness, { onFinished: finished })));

    await tick(AI_POLL_MS);
    expect(box.error).toBeInstanceOf(Error);
    expect(box.status?.jobs.running).toBe(1);
    // 첫 실패 뒤에는 평소 간격, 두 번째 실패 뒤에는 그 두 배를 기다린다
    await tick(AI_POLL_MS);
    expect(getAiStatus).toHaveBeenCalledTimes(3);
    await tick(AI_POLL_MS);
    expect(getAiStatus).toHaveBeenCalledTimes(3);
    await tick(AI_POLL_MS);
    expect(getAiStatus).toHaveBeenCalledTimes(4);
    expect(box.error).toBeNull();
    expect(finished).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });

  it("never waits longer than the cap between retries", async () => {
    getAiStatus.mockRejectedValue(new Error("network"));
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(createElement(Harness, { onFinished: () => undefined })));

    // 3s·6s·12s·24s 뒤로는 상한 간격으로 묻는다
    await tick(AI_POLL_MS * 15);
    const calls = getAiStatus.mock.calls.length;
    await tick(AI_RETRY_MAX_MS);
    expect(getAiStatus).toHaveBeenCalledTimes(calls + 1);
    act(() => root.unmount());
  });

  it("does not repeat a refusal that would answer the same again", async () => {
    getAiStatus.mockRejectedValue(new ApiError(403, "forbidden"));
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(createElement(Harness, { onFinished: () => undefined })));

    await tick(AI_RETRY_MAX_MS * 2);
    expect(getAiStatus).toHaveBeenCalledTimes(1);
    expect(box.error).toBeInstanceOf(ApiError);
    act(() => root.unmount());
  });
});
