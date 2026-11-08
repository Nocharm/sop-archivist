// AI 작업 지켜보기 - 대기·실행 중인 작업이 있는 동안만 상태를 다시 묻고, 작업이 끝나면 화면에 알려 제안을 다시 불러오게 한다.
import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AiJobCounts, AiStatus } from "./api-sop";

const getAiStatus = vi.fn<(id: number) => Promise<AiStatus>>();
vi.mock("./api-sop", () => ({ getAiStatus: (id: number) => getAiStatus(id) }));

const { AI_POLL_MS, useAiJobs } = await import("./use-ai-jobs");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeStatus(counts: Partial<AiJobCounts>): AiStatus {
  return { ai_enabled: true, embed_enabled: false, jobs: { queued: 0, running: 0, done: 0, failed: 0, stale: 0, cancelled: 0, ...counts } };
}

const box: { watch: () => void; status: AiStatus | null } = { watch: () => undefined, status: null };

function Harness({ onFinished }: { onFinished: () => void }) {
  const { status, watch } = useAiJobs(1, onFinished);
  useEffect(() => {
    box.watch = watch;
    box.status = status;
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
});
