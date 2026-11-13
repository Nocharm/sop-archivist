// 묶음 revision을 쓰는 저장 요청의 줄 - 한 번에 하나만 날리고, 같은 일이 기다리면 하나로 합쳐 보낼 때의 최신 상태를 싣는다.
import { describe, expect, it } from "vitest";

import { EMPTY_QUEUE, enqueueJob, finishJob, getDataRevision, takeNextJob, type SaveQueue } from "./c-save-queue";

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
});
