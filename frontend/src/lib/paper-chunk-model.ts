// 긴 원문 용지의 카드 덩어리 - 몇 장씩 묶을지와 화면 가까운 덩어리 고르기. 설계: 2026-11-17-assign-long-doc(구현 끝나 지웠다, git 이력)
import type { PaperPending } from "@/components/paper/paper";
import type { PendingPlace } from "@/lib/assign-focus-model";
import type { DeletedFold } from "@/lib/deleted-fold-model";
import type { FoldEntry } from "@/lib/paper-fold-model";
import type { ExpectedNumbers } from "@/lib/use-number-arrival";

// 긴 부분은 카드를 이만큼씩 덩어리로 묶는다 - 크면 덩어리가 화면 가까이 들 때 한 번에 그리는 양이, 작으면 스크롤마다 재는 덩어리 수가 는다.
// CSS .strip-chunk의 어림 높이(1840px = 40장 × 줄 어림 46px)가 이 값을 따른다
export const CHUNK_CARDS = 40;
// 카드가 이보다 적은 부분은 덩어리로 나누지 않는다 - 짧은 문서는 지금처럼 늘 전부 다시 그린다
export const CHUNK_MIN_CARDS = 120;

export interface CardSlice {
  /** 이 덩어리 첫 카드의 부분 안 자리 */
  start: number;
  count: number;
}

/** 카드 수로 덩어리 자르기 - CHUNK_MIN_CARDS보다 적으면 덩어리 하나(나누지 않음) */
export function sliceCards(cardCount: number): { isChunked: boolean; slices: CardSlice[] } {
  const isChunked = cardCount >= CHUNK_MIN_CARDS;
  const size = isChunked ? CHUNK_CARDS : Math.max(cardCount, 1);
  const slices: CardSlice[] = [];
  for (let start = 0; start < cardCount; start += size) slices.push({ start, count: Math.min(size, cardCount - start) });
  return { isChunked, slices };
}

/** 필터로 접힌 목록의 덩어리 자르기 - 펼친 묶음의 머리와 그 줄(엿보는 줄 포함)은 가르지 않고, 접혔을 때처럼 한 칸으로 센다(펼쳐도 뒤 덩어리의 경계가 밀리지 않는다 -
 *  밀리면 덩어리를 옮긴 줄이 다시 마운트된다). CHUNK_MIN_CARDS보다 적으면 덩어리 하나 */
export function sliceFoldEntries(entries: readonly FoldEntry[], size: number = CHUNK_CARDS): readonly CardSlice[] {
  if (entries.length === 0) return [];
  // 칸마다 첫 자리 - 펼친 묶음은 머리 자리 하나
  const cells: number[] = [];
  let run: Extract<FoldEntry, { kind: "runHead" }> | null = null;
  entries.forEach((entry, at) => {
    const isInRun = run !== null && ((entry.kind === "line" && entry.runKey === run.runKey) || (entry.kind === "peek" && run.memberKeys.includes(entry.key)));
    if (isInRun) return;
    run = entry.kind === "runHead" ? entry : null;
    cells.push(at);
  });
  const starts = cells.length < CHUNK_MIN_CARDS ? [0] : cells.filter((_, at) => at % size === 0);
  return starts.map((start, at) => ({ start, count: (starts[at + 1] ?? entries.length) - start }));
}

/** 보이는 칸 위아래로 한 화면씩 더 넓힌 범위에 걸치는 덩어리 번호 범위(문서 순서) - 하나도 없으면 -1 */
export function pickNearChunks(boxes: ReadonlyArray<{ top: number; bottom: number }>, view: { top: number; bottom: number }): { from: number; to: number } {
  const margin = view.bottom - view.top;
  let from = -1;
  let to = -1;
  boxes.forEach((box, index) => {
    if (box.bottom < view.top - margin || box.top > view.bottom + margin) return;
    if (from < 0) from = index;
    to = index;
  });
  return { from, to };
}

// 덩어리 다시 그리기의 판단 - 처리 중 · 삭제 접힘 · 저장 중인 번호는 글쇠마다 통째로 새 값이라, 덩어리마다 그 안의 것만 글로 읽어 견준다(그 안에 없으면 빈 글)

/** 이 덩어리의 처리 중 표시 - 잠금 · 쉬머 · 대기 차례 · 알약. tableIds는 이 덩어리에 표나 벗긴 표의 머리가 있는 표 */
export function readChunkPending(pending: PaperPending | undefined, unitIds: ReadonlySet<number>, tableIds: ReadonlySet<number> = new Set()): string {
  if (!pending) return "";
  const isHere = (place: PendingPlace): boolean => {
    if (place.at === "box") return unitIds.has(place.unitId);
    if (place.at === "gap") return unitIds.has(place.firstId) || unitIds.has(place.secondId);
    return place.at === "table" && tableIds.has(place.tableId);
  };
  const ids = [...unitIds];
  const parts = [
    ids.filter((id) => pending.lockedIds.has(id)),
    ids.filter((id) => pending.shimmerIds.has(id)),
    ids.flatMap((id) => (pending.waits.has(id) ? [[id, pending.waits.get(id)]] : [])),
    pending.pills.filter((pill) => isHere(pill.place)),
  ];
  return parts.some((part) => part.length > 0) ? JSON.stringify(parts) : "";
}

function readOwnEntries(map: ReadonlyMap<number, unknown> | undefined, unitIds: ReadonlySet<number>): string {
  if (!map || map.size === 0) return "";
  const own = [...unitIds].flatMap((id) => (map.has(id) ? [[id, map.get(id)]] : []));
  return own.length > 0 ? JSON.stringify(own) : "";
}

/** 이 덩어리의 삭제 접힘(풀린 것도 같은 꼴) */
export function readChunkDeleted(folds: ReadonlyMap<number, DeletedFold> | undefined, unitIds: ReadonlySet<number>): string {
  return readOwnEntries(folds, unitIds);
}

/** 이 덩어리의 저장을 기다리는 번호 */
export function readChunkNumbers(expected: ExpectedNumbers | undefined, unitIds: ReadonlySet<number>): string {
  return readOwnEntries(expected, unitIds);
}

/** 이 덩어리의 저절로 삭제된 블록 - 펼친 블록과 고른 블록 · 줄. 사유 · 줄은 용지 모델이 바뀌어 따로 견주지 않는다 */
export function readChunkNoise(open: ReadonlySet<number> | undefined, selected: { key: number; unitId: number | null } | null | undefined, unitIds: ReadonlySet<number>): string {
  const own = [...(open ?? [])].filter((key) => unitIds.has(key));
  const picked = selected && unitIds.has(selected.unitId ?? selected.key) ? selected : null;
  return own.length > 0 || picked !== null ? JSON.stringify([own, picked?.key, picked?.unitId]) : "";
}
