// 상단 바 AI 작업 규칙 - 표시 상태 접기, 끝난 요청 골라내기(알림), 진행 수, 경과·오래 걸림, 묶음별 묶기, 화면 지문.
import { describe, expect, it } from "vitest";

import type { AiJobCounts, RecentAiJob, RecentAiJobs, RecentAiRequest } from "./api-sop";
import {
  AI_ACTIVE_POLL_MS,
  AI_IDLE_POLL_MS,
  AI_RETRY_MAX_MS,
  AI_SLOW_MS,
  findFinishedRequests,
  formatElapsed,
  getBundleSignature,
  getKindStage,
  getNextPollMs,
  getRequestDocument,
  getRequestElapsedMs,
  getRequestOutcome,
  getRequestProgress,
  getRequestToast,
  getRetryMs,
  getServerNow,
  groupRequestsByBundle,
  isRequestSlow,
  listReadingDocuments,
  summarizeAiJobs,
} from "./ai-jobs-model";

const T0 = "2026-11-10T10:00:00+09:00";
const at = (seconds: number) => new Date(Date.parse(T0) + seconds * 1000).toISOString();

function makeRequest(id: string, counts: Partial<AiJobCounts>, extra: Partial<RecentAiRequest> = {}): RecentAiRequest {
  const jobs = { queued: 0, running: 0, done: 0, failed: 0, stale: 0, cancelled: 0, ...counts };
  const total = Object.values(jobs).reduce((a, b) => a + b, 0);
  const isActive = jobs.queued + jobs.running > 0;
  return {
    request_id: id,
    bundle_id: 1,
    bundle_code: "BND-0001",
    bundle_title: "Bundle one",
    kind: "classify",
    kinds: ["classify"],
    requested_by_me: true,
    total,
    jobs,
    error_counts: {},
    created_at: T0,
    started_at: jobs.running > 0 ? T0 : null,
    finished_at: isActive ? null : at(60),
    ...extra,
  };
}

function makeJob(id: number, requestId: string, extra: Partial<RecentAiJob> = {}): RecentAiJob {
  return {
    id,
    request_id: requestId,
    bundle_id: 1,
    bundle_code: "BND-0001",
    bundle_title: "Bundle one",
    kind: "classify",
    status: "done",
    error: "",
    document_id: null,
    document_title: "",
    document_file_name: "",
    unit_count: 1,
    target_count: 0,
    attempts: 1,
    requested_by_me: true,
    created_at: T0,
    started_at: T0,
    finished_at: at(10),
    ...extra,
  };
}

function makeData(requests: RecentAiRequest[], serverTime = T0, jobs: RecentAiJob[] = []): RecentAiJobs {
  return { server_time: serverTime, jobs, jobs_total: jobs.length, requests, requests_total: requests.length };
}

describe("summarizeAiJobs", () => {
  it("hides when nothing happened in the window and nothing failed to load", () => {
    expect(summarizeAiJobs(makeData([]), null, new Set())).toEqual({ state: "hidden", active: 0, failedUnseen: 0 });
    expect(summarizeAiJobs(null, null, new Set()).state).toBe("hidden");
  });

  it("shows active first and still counts unseen failures for the badge", () => {
    const data = makeData([makeRequest("a", { running: 1 }), makeRequest("b", { failed: 1 })]);
    expect(summarizeAiJobs(data, null, new Set())).toEqual({ state: "active", active: 1, failedUnseen: 1 });
  });

  it("drops failures already seen and falls back to idle", () => {
    const data = makeData([makeRequest("b", { failed: 1, done: 2 })]);
    expect(summarizeAiJobs(data, null, new Set()).state).toBe("failed");
    expect(summarizeAiJobs(data, null, new Set(["b"]))).toEqual({ state: "idle", active: 0, failedUnseen: 0 });
  });

  it("says the status is not updating when the last ask failed", () => {
    expect(summarizeAiJobs(makeData([]), new Error("network"), new Set()).state).toBe("error");
  });
});

describe("findFinishedRequests", () => {
  it("announces nothing on the first answer", () => {
    expect(findFinishedRequests(null, makeData([makeRequest("a", { done: 1 })]))).toEqual([]);
  });

  it("announces my request that was running before and is finished now", () => {
    const before = makeData([makeRequest("a", { running: 1 })]);
    const after = makeData([makeRequest("a", { done: 1 })], at(3));
    expect(findFinishedRequests(before, after).map((request) => request.request_id)).toEqual(["a"]);
  });

  it("announces a request made and finished between two answers, but not an old one that was never seen", () => {
    const before = makeData([], at(30));
    const fast = makeRequest("fast", { done: 1 }, { created_at: at(31) });
    const old = makeRequest("old", { done: 1 }, { created_at: at(0) });
    expect(findFinishedRequests(before, makeData([fast, old], at(33))).map((request) => request.request_id)).toEqual(["fast"]);
  });

  it("does not announce someone else's request, one still running, or one already finished", () => {
    const before = makeData([makeRequest("other", { running: 1 }, { requested_by_me: false }), makeRequest("busy", { queued: 2 }), makeRequest("old", { done: 1 })]);
    const after = makeData([makeRequest("other", { done: 1 }, { requested_by_me: false }), makeRequest("busy", { running: 1, done: 1 }), makeRequest("old", { done: 1 })], at(3));
    expect(findFinishedRequests(before, after)).toEqual([]);
  });
});

describe("request outcome and toast", () => {
  it("prefers failed over not applied over cancelled over done", () => {
    expect(getRequestOutcome(makeRequest("a", { running: 1, queued: 1 }))).toBe("running");
    expect(getRequestOutcome(makeRequest("a", { queued: 1, done: 1 }))).toBe("queued");
    expect(getRequestOutcome(makeRequest("a", { failed: 1, stale: 1, done: 3 }))).toBe("failed");
    expect(getRequestOutcome(makeRequest("a", { stale: 1, cancelled: 1 }))).toBe("stale");
    expect(getRequestOutcome(makeRequest("a", { cancelled: 2, done: 1 }))).toBe("cancelled");
    expect(getRequestOutcome(makeRequest("a", { done: 3 }))).toBe("done");
  });

  it("explains a failure with its most common code", () => {
    const request = makeRequest("a", { failed: 3, done: 1 }, { error_counts: { timeout: 1, connection: 2 } });
    expect(getRequestToast(request)).toEqual({ tone: "error", key: "aiJobs.toast.failed", n: 3, reason: "connection" });
  });

  it("gives not applied and cancelled an explanation, not an error", () => {
    expect(getRequestToast(makeRequest("a", { stale: 2 }))).toMatchObject({ tone: "info", key: "aiJobs.toast.stale", n: 2 });
    expect(getRequestToast(makeRequest("a", { cancelled: 1 }))).toMatchObject({ tone: "info", key: "aiJobs.toast.cancelled", n: 1 });
    expect(getRequestToast(makeRequest("a", { done: 4 }))).toMatchObject({ tone: "ok", key: "aiJobs.toast.done", n: 4 });
  });

  it("counts finished jobs out of a total that may grow", () => {
    expect(getRequestProgress(makeRequest("a", { queued: 2, running: 1, done: 3, failed: 1 }))).toEqual({ done: 4, total: 7 });
  });
});

describe("time", () => {
  it("measures now on the server clock even when the client clock is off", () => {
    // 클라이언트 시계가 한 시간 빠르다 - 받은 뒤 5초가 흘렀으면 서버로는 T0 + 5초
    const receivedAt = Date.parse(T0) + 3_600_000;
    expect(getServerNow(T0, receivedAt, receivedAt + 5000)).toBe(Date.parse(T0) + 5000);
  });

  it("formats elapsed time as m:ss or h:mm:ss", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(83_000)).toBe("1:23");
    expect(formatElapsed(3_723_000)).toBe("1:02:03");
    expect(formatElapsed(-500)).toBe("0:00");
  });

  it("counts a running request from its start and a queued one from its request", () => {
    const now = Date.parse(T0) + 90_000;
    expect(getRequestElapsedMs(makeRequest("a", { running: 1 }, { started_at: at(30) }), now)).toBe(60_000);
    expect(getRequestElapsedMs(makeRequest("a", { queued: 1 }), now)).toBe(90_000);
  });

  it("flags a request whose running job passed the threshold", () => {
    const request = makeRequest("a", { running: 1, done: 1 });
    const jobs = [makeJob(1, "a", { status: "running", started_at: T0, finished_at: null }), makeJob(2, "a")];
    expect(isRequestSlow(request, jobs, Date.parse(T0) + AI_SLOW_MS - 1000)).toBe(false);
    expect(isRequestSlow(request, jobs, Date.parse(T0) + AI_SLOW_MS + 1000)).toBe(true);
    // 대기만 오래인 요청은 앞 작업을 기다리는 것이라 오래 걸림이 아니다
    expect(isRequestSlow(makeRequest("b", { queued: 1 }), [makeJob(3, "b", { status: "queued", started_at: null })], Date.parse(T0) + AI_SLOW_MS * 2)).toBe(false);
  });
});

describe("polling intervals", () => {
  it("asks often while something runs and rarely when idle", () => {
    expect(getNextPollMs(makeData([makeRequest("a", { queued: 1 })]))).toBe(AI_ACTIVE_POLL_MS);
    expect(getNextPollMs(makeData([makeRequest("a", { done: 1 })]))).toBe(AI_IDLE_POLL_MS);
    expect(getNextPollMs(null)).toBe(AI_IDLE_POLL_MS);
  });

  it("doubles the gap after each failure up to the cap", () => {
    expect([1, 2, 3, 4, 5, 9].map(getRetryMs)).toEqual([3000, 6000, 12000, 24000, AI_RETRY_MAX_MS, AI_RETRY_MAX_MS]);
  });
});

describe("grouping and screens", () => {
  it("groups by bundle in order of the newest request", () => {
    const requests = [makeRequest("a", { done: 1 }, { bundle_id: 2, bundle_code: "BND-0002" }), makeRequest("b", { done: 1 }), makeRequest("c", { done: 1 }, { bundle_id: 2, bundle_code: "BND-0002" })];
    const groups = groupRequestsByBundle(requests);
    expect(groups.map((group) => [group.bundleCode, group.requests.map((request) => request.request_id)])).toEqual([
      ["BND-0002", ["a", "c"]],
      ["BND-0001", ["b"]],
    ]);
  });

  it("names the document only when the request is about one document", () => {
    const request = makeRequest("a", { done: 2 });
    expect(getRequestDocument(request, [makeJob(1, "a", { document_id: 5, document_title: "Cleaning SOP" }), makeJob(2, "a", { document_id: 5, document_title: "Cleaning SOP" })])).toBe("Cleaning SOP");
    expect(getRequestDocument(request, [makeJob(1, "a", { document_id: 5, document_title: "", document_file_name: "SYNTHETIC_a.docx" })])).toBe("SYNTHETIC_a.docx");
    expect(getRequestDocument(request, [makeJob(1, "a", { document_id: 5, document_title: "A" }), makeJob(2, "a", { document_id: 6, document_title: "B" })])).toBe("");
    expect(getRequestDocument(request, [makeJob(1, "a")])).toBe("");
  });

  it("opens the screen where each kind's result shows", () => {
    expect(getKindStage("classify")).toBe("assign");
    expect(getKindStage("match_plan")).toBe("assign");
    expect(getKindStage("split")).toBe("split");
    expect(getKindStage("pair")).toBe("split");
    expect(getKindStage("doc_meta")).toBe("documents");
  });

  it("changes a bundle's signature only when that bundle's jobs move", () => {
    const before = makeData([makeRequest("a", { running: 1 }), makeRequest("x", { running: 1 }, { bundle_id: 9 })]);
    const otherMoved = makeData([makeRequest("a", { running: 1 }), makeRequest("x", { done: 1 }, { bundle_id: 9 })]);
    const mineMoved = makeData([makeRequest("a", { done: 1 }), makeRequest("x", { done: 1 }, { bundle_id: 9 })]);
    expect(getBundleSignature(otherMoved, 1)).toBe(getBundleSignature(before, 1));
    expect(getBundleSignature(mineMoved, 1)).not.toBe(getBundleSignature(before, 1));
    expect(getBundleSignature(null, 1)).toBe(getBundleSignature(makeData([]), 1));
  });

  it("lists documents whose number and version AI is still reading", () => {
    const jobs = [
      makeJob(1, "a", { kind: "doc_meta", status: "running", document_id: 5 }),
      makeJob(2, "b", { kind: "doc_meta", status: "done", document_id: 6 }),
      makeJob(3, "c", { kind: "doc_meta", status: "queued", document_id: 7, bundle_id: 2 }),
      makeJob(4, "d", { kind: "split", status: "running", document_id: 8 }),
    ];
    expect([...listReadingDocuments(makeData([], T0, jobs), 1)]).toEqual([5]);
  });
});
