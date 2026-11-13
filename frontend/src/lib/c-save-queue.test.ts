// 묶음 revision을 쓰는 저장 요청의 줄 - 한 번에 하나만 날리고, 같은 일이 기다리면 하나로 합쳐 보낼 때의 최신 상태를 싣는다.
import { describe, expect, it } from "vitest";

import {
  canSendJob,
  EMPTY_QUEUE,
  enqueueJob,
  findOtherSave,
  finishJob,
  getDataRevision,
  getPendingSave,
  isOwnSave,
  releaseHold,
  takeNextJob,
  trackBundleSave,
  type SaveQueue,
} from "./c-save-queue";

describe("save queue", () => {
  it("sends one job at a time and the next after the first finishes", () => {
    let queue: SaveQueue = enqueueJob(enqueueJob(EMPTY_QUEUE, { kind: "doc", docId: 1 }), { kind: "doc", docId: 2 });
    const first = takeNextJob(queue);
    expect(first?.job).toEqual({ kind: "doc", docId: 1 });
    queue = first!.queue;
    // 날아가는 것이 있으면 다음 것을 꺼내지 않는다
    expect(takeNextJob(queue)).toBeNull();
    queue = finishJob(queue);
    expect(takeNextJob(queue)?.job).toEqual({ kind: "doc", docId: 2 });
  });

  it("sends a document queued many times once, with its latest state", () => {
    let queue = EMPTY_QUEUE;
    for (let n = 0; n < 5; n += 1) queue = enqueueJob(queue, { kind: "doc", docId: 1 });
    expect(queue.pending).toEqual([{ kind: "doc", docId: 1 }]);
    // 날아가는 동안 또 누르면 응답 뒤에 한 번 더 보낸다
    const taken = takeNextJob(queue)!;
    queue = enqueueJob(enqueueJob(taken.queue, { kind: "doc", docId: 1 }), { kind: "doc", docId: 1 });
    expect(queue).toEqual({ pending: [{ kind: "doc", docId: 1 }], inFlight: { kind: "doc", docId: 1 } });
  });

  it("puts checks and documents on the same line", () => {
    let queue = enqueueJob(enqueueJob(enqueueJob(EMPTY_QUEUE, { kind: "doc", docId: 1 }), { kind: "checks" }), { kind: "checks" });
    expect(queue.pending).toEqual([{ kind: "doc", docId: 1 }, { kind: "checks" }]);
    queue = takeNextJob(queue)!.queue;
    expect(takeNextJob(queue)).toBeNull();
    expect(takeNextJob(finishJob(queue))?.job).toEqual({ kind: "checks" });
  });

  it("walks down own revisions to the last outside change", () => {
    expect(getDataRevision(12, new Set([11, 12]))).toBe(10);
    expect(getDataRevision(13, new Set([11, 12]))).toBe(13);
  });

  it("skips the jobs a hold keeps back and takes the first one it lets through", () => {
    const queue = enqueueJob(enqueueJob(EMPTY_QUEUE, { kind: "doc", docId: 1 }), { kind: "checks" });
    expect(takeNextJob(queue, (job) => job.kind === "checks")).toEqual({ queue: { pending: [{ kind: "doc", docId: 1 }], inFlight: { kind: "checks" } }, job: { kind: "checks" } });
    expect(takeNextJob(queue, () => false)).toBeNull();
  });
});

describe("own saves", () => {
  // 보낸 때의 C 표시(fetch = 몇 번째로 받기 시작한 C, busy = 받는 중이거나 C를 보지 않음)와 응답 때의 표시
  const idle = { fetch: 3, busy: false };

  it("counts a save as own when C was neither fetched nor left from send to response", () => {
    expect(isOwnSave(idle, idle)).toBe(true);
  });

  it("does not count a save answered while a C fetch that started before it is still in flight", () => {
    // 바깥 revision·라벨 언어로 C를 다시 받기 시작 → 누름(보냄) → 저장 응답이 먼저 온다. 그 C는 저장 전 것일 수 있다
    expect(isOwnSave({ fetch: 4, busy: true }, { fetch: 4, busy: true })).toBe(false);
  });

  it("does not count a save when a C fetch started or finished between send and response", () => {
    expect(isOwnSave(idle, { fetch: 4, busy: true })).toBe(false);
    expect(isOwnSave(idle, { fetch: 4, busy: false })).toBe(false);
    expect(isOwnSave({ fetch: 4, busy: true }, { fetch: 4, busy: false })).toBe(false);
  });
});

describe("hold after a stale rejection", () => {
  it("holds every job until the bundle is read again, then only documents until a C fetched after that arrives", () => {
    expect(canSendJob("none", { kind: "doc", docId: 1 })).toBe(true);
    expect(canSendJob("bundle", { kind: "checks" })).toBe(false);
    expect(canSendJob({ docsFromFetch: 5 }, { kind: "checks" })).toBe(true);
    expect(canSendJob({ docsFromFetch: 5 }, { kind: "doc", docId: 1 })).toBe(false);
  });

  it("releases the document hold only for a C whose fetch started after the reload", () => {
    expect(releaseHold({ docsFromFetch: 5 }, 4)).toEqual({ docsFromFetch: 5 });
    expect(releaseHold({ docsFromFetch: 5 }, 5)).toBe("none");
    expect(releaseHold("bundle", 9)).toBe("bundle");
    expect(releaseHold("none", 1)).toBe("none");
  });
});

describe("pending saves", () => {
  it("says nothing is lost on leaving when nothing waits to be sent", () => {
    expect(getPendingSave("none", [])).toBe("none");
    expect(getPendingSave({ docsFromFetch: 2 }, [])).toBe("none");
  });

  it("tells waiting work that still goes out from work a hold keeps back", () => {
    expect(getPendingSave("none", [{ kind: "doc", docId: 1 }, { kind: "checks" }])).toBe("sending");
    // 409·422 뒤 다시 받은 C를 기다리는 문서 저장 - C 받기가 실패하면 다시 시도해야 간다
    expect(getPendingSave({ docsFromFetch: 2 }, [{ kind: "checks" }])).toBe("sending");
    expect(getPendingSave({ docsFromFetch: 2 }, [{ kind: "checks" }, { kind: "doc", docId: 1 }])).toBe("held");
    expect(getPendingSave("bundle", [{ kind: "checks" }])).toBe("held");
  });
});

describe("bundle save lane", () => {
  it("lets another screen instance wait for a save still in flight on the same bundle", async () => {
    const left = {};
    const back = {};
    let finish!: () => void;
    const request = new Promise<void>((done) => (finish = done));
    trackBundleSave(77, left, request);
    // 같은 화면은 자기 줄이 이미 하나씩 보낸다 - 다른 화면(떠났다 돌아온 화면)만 기다린다
    expect(findOtherSave(77, left)).toBeNull();
    const wait = findOtherSave(77, back);
    expect(wait).not.toBeNull();
    expect(findOtherSave(78, back)).toBeNull();
    finish();
    await wait;
    expect(findOtherSave(77, back)).toBeNull();
  });

  it("clears the lane after a failed save too", async () => {
    const owner = {};
    const request = Promise.reject(new Error("synthetic"));
    trackBundleSave(79, owner, request);
    await request.catch(() => undefined);
    await new Promise((done) => setTimeout(done, 0));
    expect(findOtherSave(79, {})).toBeNull();
  });
});
