// 긴 원문 용지의 카드 덩어리 - 몇 장씩 묶을지와 화면 가까운 덩어리 고르기. 설계: 2026-11-17-assign-long-doc(구현 끝나 지웠다, git 이력)

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
