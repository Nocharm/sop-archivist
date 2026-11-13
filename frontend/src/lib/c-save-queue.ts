// 결과물 화면에서 묶음 revision을 쓰는 저장 요청의 줄 - C의 순서·깊이·표시(문서마다)와 의미 확인 체크. revision이 묶음에 하나라 한 번에 하나만 보낸다.
// 같은 일이 기다리는 중이면 하나로 합친다 - 보낼 때 그 문서(체크)의 최신 상태를 실으므로 마지막 상태가 이긴다.
// 응답을 이 화면 것으로 셀지(isOwnSave)·409/422 뒤 멈춤(SaveHold)은 순수 규칙이고, 묶음마다 날아가는 저장(trackBundleSave)만 모듈 상태다.

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

/** 날아가는 것이 없을 때만 앞에서 하나를 꺼낸다 - canTake가 막는 일(잠시 멈춘 문서 저장)은 건너뛰고 자리를 지킨다 */
export function takeNextJob(queue: SaveQueue, canTake: (job: SaveJob) => boolean = () => true): { queue: SaveQueue; job: SaveJob } | null {
  if (queue.inFlight !== null) return null;
  const index = queue.pending.findIndex(canTake);
  if (index < 0) return null;
  const job = queue.pending[index];
  return { queue: { pending: queue.pending.filter((_, at) => at !== index), inFlight: job }, job };
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

/** C를 받는 형편 - fetch는 지금까지 받기 시작한 C의 수, busy는 받는 중이거나 C 탭이 아닌 동안(그때 보이는 결과물이 저장 전 것일 수 있다) */
export interface CViewMark {
  fetch: number;
  busy: boolean;
}

/**
 * 문서 저장 응답의 revision을 이 화면 것(own - 다시 받지 않음)으로 셀까. 보낼 때부터 응답까지 C를 받기 시작하거나 받는 중이거나
 * 다른 탭을 본 적이 없을 때만이다 - 그 사이에 받은 C는 이 저장 전에 읽혔을 수 있어, own으로 두면 낡은 C가 이기고 다음 누름이 저장된 바뀜을 되돌린다.
 * own이 아니면 revision이 화면 키를 바꿔 한 번 더 받는다(그 전에 받던 C는 버려진다).
 */
export function isOwnSave(sent: CViewMark, now: CViewMark): boolean {
  return !sent.busy && !now.busy && sent.fetch === now.fetch;
}

/**
 * 409·422 뒤 저장 줄 멈춤 - "bundle"은 묶음을 다시 읽을 때까지 모두, { docsFromFetch }는 그 뒤 받기 시작한 C(번호가 그 이상)가 올 때까지
 * 문서 저장만 멈춘다(의미 확인은 C와 무관해 새 revision으로 간다). 기다리는 문서 저장은 새로 받은 C 위에 다시 얹어 보낸다.
 */
export type SaveHold = "none" | "bundle" | { docsFromFetch: number };

export function canSendJob(hold: SaveHold, job: SaveJob): boolean {
  return hold === "none" || (hold !== "bundle" && job.kind === "checks");
}

/** 받은 C(그 받기 번호)로 문서 저장 멈춤을 푼다 - 다시 읽기 전에 받기 시작한 C로는 풀지 않는다 */
export function releaseHold(hold: SaveHold, fetch: number): SaveHold {
  return typeof hold === "object" && fetch >= hold.docsFromFetch ? "none" : hold;
}

/** 화면을 떠나면 사라질 일 - none은 없음, held는 멈춤에 걸려 다시 받은 C(다시 시도)를 기다리는 일이 있음, sending은 차례대로 나가는 중 */
export type PendingSave = "none" | "sending" | "held";

/** waiting = 날아가는 요청에 실리지 않은 바뀜이 남은 일(편집이 남은 문서, 아직 안 보낸 의미 확인) */
export function getPendingSave(hold: SaveHold, waiting: readonly SaveJob[]): PendingSave {
  if (waiting.length === 0) return "none";
  return waiting.some((job) => !canSendJob(hold, job)) ? "held" : "sending";
}

// 묶음마다 날아가는 저장 - 화면을 떠났다 금방 돌아와 새 화면 인스턴스가 생겨도 같은 묶음에 두 줄이 겹쳐 보내지 않게(모듈 상태, 화면과 무관)
const lanes = new Map<number, { owner: object; done: Promise<void> }>();

/** 보낸 저장을 그 묶음의 줄에 적는다 - 끝나면(실패해도) 스스로 지운다 */
export function trackBundleSave(bundleId: number, owner: object, request: Promise<unknown>): void {
  const done: Promise<void> = request.then(
    () => undefined,
    () => undefined,
  );
  lanes.set(bundleId, { owner, done });
  void done.then(() => {
    if (lanes.get(bundleId)?.done === done) lanes.delete(bundleId);
  });
}

/** 다른 화면 인스턴스(owner)의 저장이 그 묶음에서 날아가는 중이면 그 끝, 아니면 null */
export function findOtherSave(bundleId: number, owner: object): Promise<void> | null {
  const lane = lanes.get(bundleId);
  return lane && lane.owner !== owner ? lane.done : null;
}
