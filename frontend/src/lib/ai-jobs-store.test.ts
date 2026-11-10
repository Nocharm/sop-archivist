// 공용 AI 작업 폴러 - 도는 동안 3초·조용하면 30초, 실패하면 늘려 가며 다시(멈추지 않음), 401·403은 poke까지 쉼, 비우면 늦은 답을 버린다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RecentAiJobs } from "./api-sop";

const getRecentAiJobs = vi.fn<() => Promise<RecentAiJobs>>();
vi.mock("./api-sop", () => ({ getRecentAiJobs: () => getRecentAiJobs() }));

const { AI_ACTIVE_POLL_MS, AI_IDLE_POLL_MS } = await import("./ai-jobs-model");
type Store = typeof import("./ai-jobs-store");

function makeData(isActive: boolean): RecentAiJobs {
  const jobs = { queued: isActive ? 1 : 0, running: 0, done: isActive ? 0 : 1, failed: 0, stale: 0, cancelled: 0 };
  return {
    server_time: "2026-11-10T10:00:00+09:00",
    jobs: [],
    jobs_total: 0,
    requests: [{ request_id: "r", bundle_id: 1, bundle_code: "BND-0001", bundle_title: "B", kind: "classify", kinds: ["classify"], requested_by_me: true, total: 1, jobs, error_counts: {}, created_at: "2026-11-10T10:00:00+09:00", started_at: null, finished_at: isActive ? null : "2026-11-10T10:00:05+09:00" }],
    requests_total: 1,
  };
}

let store: Store;
// 모듈을 다시 읽으면 ApiError도 새 클래스다 - 저장소와 같은 것을 써야 instanceof가 맞는다
let ApiError: typeof import("./api").ApiError;
let stop: () => void = () => undefined;

async function tick(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  getRecentAiJobs.mockReset();
  store = await import("./ai-jobs-store");
  ({ ApiError } = await import("./api"));
});

afterEach(() => {
  stop();
  vi.useRealTimers();
});

describe("ai-jobs-store", () => {
  it("asks every 3 seconds while something runs and every 30 seconds when idle", async () => {
    getRecentAiJobs.mockResolvedValueOnce(makeData(true)).mockResolvedValue(makeData(false));
    stop = store.startAiJobsPolling();
    await tick(0);
    expect(getRecentAiJobs).toHaveBeenCalledTimes(1);
    await tick(AI_ACTIVE_POLL_MS);
    expect(getRecentAiJobs).toHaveBeenCalledTimes(2);
    await tick(AI_ACTIVE_POLL_MS * 3);
    expect(getRecentAiJobs).toHaveBeenCalledTimes(2);
    await tick(AI_IDLE_POLL_MS);
    expect(getRecentAiJobs).toHaveBeenCalledTimes(3);
  });

  it("keeps asking with longer gaps after failures", async () => {
    getRecentAiJobs.mockResolvedValueOnce(makeData(true)).mockRejectedValueOnce(new Error("network")).mockRejectedValueOnce(new ApiError(500, "boom")).mockResolvedValue(makeData(false));
    stop = store.startAiJobsPolling();
    await tick(AI_ACTIVE_POLL_MS);
    expect(getRecentAiJobs).toHaveBeenCalledTimes(2);
    // 첫 실패 뒤 3초, 두 번째 실패 뒤 6초
    await tick(AI_ACTIVE_POLL_MS);
    expect(getRecentAiJobs).toHaveBeenCalledTimes(3);
    await tick(AI_ACTIVE_POLL_MS);
    expect(getRecentAiJobs).toHaveBeenCalledTimes(3);
    await tick(AI_ACTIVE_POLL_MS);
    expect(getRecentAiJobs).toHaveBeenCalledTimes(4);
  });

  it("keeps the previous list while an ask fails and clears the error once it answers", async () => {
    getRecentAiJobs.mockResolvedValueOnce(makeData(true)).mockRejectedValueOnce(new ApiError(404, "gone")).mockResolvedValue(makeData(false));
    stop = store.startAiJobsPolling();
    await tick(AI_ACTIVE_POLL_MS);
    expect(store.readAiJobsSnapshot().error).toBeInstanceOf(ApiError);
    expect(store.readAiJobsSnapshot().data?.requests[0].finished_at).toBeNull();
    // 4xx(401·403 밖)도 멈추지 않고 다시 묻는다
    await tick(AI_ACTIVE_POLL_MS);
    expect(store.readAiJobsSnapshot().error).toBeNull();
    expect(store.readAiJobsSnapshot().data?.requests[0].finished_at).not.toBeNull();
  });

  it("rests after a refusal until something pokes it", async () => {
    getRecentAiJobs.mockRejectedValueOnce(new ApiError(403, "inactive")).mockResolvedValue(makeData(false));
    stop = store.startAiJobsPolling();
    await tick(AI_IDLE_POLL_MS * 3);
    expect(getRecentAiJobs).toHaveBeenCalledTimes(1);
    store.pokeAiJobs();
    await tick(0);
    expect(getRecentAiJobs).toHaveBeenCalledTimes(2);
  });

  it("asks right away when poked and once more if poked during an ask", async () => {
    let resolveFirst: (value: RecentAiJobs) => void = () => undefined;
    getRecentAiJobs.mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve))).mockResolvedValue(makeData(false));
    stop = store.startAiJobsPolling();
    store.pokeAiJobs();
    expect(getRecentAiJobs).toHaveBeenCalledTimes(1);
    resolveFirst(makeData(false));
    await tick(0);
    expect(getRecentAiJobs).toHaveBeenCalledTimes(2);
  });

  it("drops an answer that arrives after the store was cleared", async () => {
    let resolveFirst: (value: RecentAiJobs) => void = () => undefined;
    getRecentAiJobs.mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve))).mockReturnValue(new Promise(() => undefined));
    stop = store.startAiJobsPolling();
    store.clearAiJobsStore();
    resolveFirst(makeData(true));
    await tick(0);
    expect(store.readAiJobsSnapshot().data).toBeNull();
  });

  it("stops asking when the last holder lets go", async () => {
    getRecentAiJobs.mockResolvedValue(makeData(true));
    const release = store.startAiJobsPolling();
    await tick(0);
    release();
    await tick(AI_IDLE_POLL_MS * 2);
    expect(getRecentAiJobs).toHaveBeenCalledTimes(1);
  });

  it("remembers failures that were seen", () => {
    store.markFailuresSeen(["a", "b"]);
    expect(JSON.parse(window.localStorage.getItem("sopa.aiJobs.seenFailed") ?? "[]")).toEqual(["a", "b"]);
  });
});

