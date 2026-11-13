// 결과물 화면에서 묶음 revision을 쓰는 저장 요청의 줄 - C의 순서·깊이·표시(문서마다)와 의미 확인 체크. revision이 묶음에 하나라 한 번에 하나만 보낸다.
// 같은 일이 기다리는 중이면 하나로 합친다 - 보낼 때 그 문서(체크)의 최신 상태를 실으므로 마지막 상태가 이긴다.

export type SaveJob = { kind: "doc"; docId: number } | { kind: "checks" };

export interface SaveQueue {
  pending: readonly SaveJob[];
  inFlight: SaveJob | null;
}

export const EMPTY_QUEUE: SaveQueue = { pending: [], inFlight: null };

function isSameJob(a: SaveJob, b: SaveJob): boolean {
  return a.kind === "doc" ? b.kind === "doc" && a.docId === b.docId : b.kind === a.kind;
}

/** 줄 끝에 더한다 - 같은 일이 이미 기다리면 그대로(날아가는 중인 것과는 합치지 않는다 - 그 뒤 바뀐 것은 응답 뒤에 한 번 더 보낸다) */
export function enqueueJob(queue: SaveQueue, job: SaveJob): SaveQueue {
  return queue.pending.some((item) => isSameJob(item, job)) ? queue : { ...queue, pending: [...queue.pending, job] };
}

/** 날아가는 것이 없을 때만 앞에서 하나를 꺼낸다 */
export function takeNextJob(queue: SaveQueue): { queue: SaveQueue; job: SaveJob } | null {
  if (queue.inFlight !== null || queue.pending.length === 0) return null;
  const [job, ...rest] = queue.pending;
  return { queue: { pending: rest, inFlight: job }, job };
}

export function finishJob(queue: SaveQueue): SaveQueue {
  return { ...queue, inFlight: null };
}

/**
 * 화면 자료(결과물·요약)가 기준으로 삼는 revision - 이 화면이 스스로 올린 revision(own)이면 한 칸씩 내려가 바깥에서 바뀐 마지막 revision.
 * 순서·깊이·표시·의미 확인은 요약 숫자를 바꾸지 않고 바뀐 문서는 응답으로 맞추므로, 스스로 올린 revision으로는 다시 받지 않는다.
 */
export function getDataRevision(revision: number, own: ReadonlySet<number>): number {
  let current = revision;
  while (own.has(current)) current -= 1;
  return current;
}
