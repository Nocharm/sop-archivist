// 여럿 고른 줄의 표시 모델(11-25 명세 §9 [U 시안 1차]) - 이어진 카드 덩어리마다 테 하나와 "n줄 고름" 꼬리표
// 카드(짝 카드 한 장 · 외톨이 줄 하나) 순서에서 고른 카드가 이어진 덩어리를 찾는다. 사이에 안 고른 카드(접힌 삭제 줄 · 잡음 블록 포함)가 끼면 덩어리가 갈린다

export type CheckEdge = "only" | "top" | "middle" | "bottom";

/** 카드의 덩어리 안 자리 - count는 덩어리 첫 카드에만(그 덩어리의 줄 수, 짝 카드는 한 줄), 나머지는 null */
export interface CheckMark {
  edge: CheckEdge;
  count: number | null;
}

/** cards는 문서 순서 - key는 카드 첫 줄 key. rowKeyOf는 Unit → 판단 줄 키(짝 카드의 두 Unit은 한 줄) */
export function buildCheckMarks(
  cards: readonly { key: string; unitIds: readonly number[] }[],
  checkedUnitIds: ReadonlySet<number>,
  rowKeyOf: (unitId: number) => string,
): ReadonlyMap<string, CheckMark> {
  const marks = new Map<string, CheckMark>();
  let start = 0;
  while (start < cards.length) {
    if (!cards[start].unitIds.some((id) => checkedUnitIds.has(id))) {
      start += 1;
      continue;
    }
    let end = start;
    while (end + 1 < cards.length && cards[end + 1].unitIds.some((id) => checkedUnitIds.has(id))) end += 1;
    const rows = new Set(cards.slice(start, end + 1).flatMap((card) => card.unitIds.filter((id) => checkedUnitIds.has(id)).map(rowKeyOf)));
    for (let at = start; at <= end; at += 1) {
      const edge: CheckEdge = start === end ? "only" : at === start ? "top" : at === end ? "bottom" : "middle";
      marks.set(cards[at].key, { edge, count: at === start ? rows.size : null });
    }
    start = end + 1;
  }
  return marks;
}

/** 카드가 여러 줄(짝 카드)일 때 줄마다의 자리 - 카드의 윗 가장자리는 첫 줄만, 아랫 가장자리는 끝 줄만 맡는다 */
export function readRowEdge(edge: CheckEdge, index: number, size: number): CheckEdge {
  const isTop = index === 0 && (edge === "only" || edge === "top");
  const isBottom = index === size - 1 && (edge === "only" || edge === "bottom");
  return isTop && isBottom ? "only" : isTop ? "top" : isBottom ? "bottom" : "middle";
}

/** PaperChunk deps에 넣는 글 하나 - 이 덩어리의 카드 것만 읽어, 다른 덩어리의 고름이 바뀌어도 이 덩어리는 그대로 얼어 있다 */
export function readCheckKey(marks: ReadonlyMap<string, CheckMark>, cardKeys: readonly string[]): string {
  return cardKeys.flatMap((key) => {
    const mark = marks.get(key);
    return mark ? [`${key}:${mark.edge}:${mark.count ?? ""}`] : [];
  }).join("|");
}
