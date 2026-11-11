// 떠 있는 층(메뉴·툴팁)의 위치 계산과 Esc 순서. 위치는 잰 뒤에 정하고, 경계에서 뒤집고 화면 안으로 맞춘다(디자인 문서 11절).

const EDGE = 8; // 화면 가장자리와 띄울 최소 간격(px)
const GAP = 4; // 트리거와 층 사이(px)

export interface FloatingPos {
  top: number;
  left: number;
}

/** 트리거 아래(공간이 모자라면 위)에 놓는다. align end는 오른쪽 끝을 맞춘다. */
export function placeBelow(anchor: DOMRect, floating: { width: number; height: number }, align: "start" | "end" | "center"): FloatingPos {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = align === "end" ? anchor.right - floating.width : align === "center" ? anchor.left + (anchor.width - floating.width) / 2 : anchor.left;
  left = Math.min(Math.max(left, EDGE), vw - floating.width - EDGE);
  let top = anchor.bottom + GAP;
  if (top + floating.height > vh - EDGE && anchor.top - GAP - floating.height >= EDGE) {
    top = anchor.top - GAP - floating.height;
  }
  return { top, left };
}

/** 트리거 위(공간이 모자라면 아래)에 놓는다 - 아래에 다른 창이 뜨는 자리의 툴팁용 */
export function placeAbove(anchor: DOMRect, floating: { width: number; height: number }, align: "start" | "end" | "center"): FloatingPos {
  const below = placeBelow(anchor, floating, align);
  const top = anchor.top - GAP - floating.height;
  return { top: top >= EDGE ? top : below.top, left: below.left };
}

/** 트리거 옆(오른쪽, 자리가 모자라면 왼쪽)에 놓는다 - 목록 항목의 설명이 다른 항목을 덮지 않게. 세로는 트리거 맞춤 */
export function placeBeside(anchor: DOMRect, floating: { width: number; height: number }): FloatingPos {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = anchor.right + GAP;
  if (left + floating.width > vw - EDGE && anchor.left - GAP - floating.width >= EDGE) left = anchor.left - GAP - floating.width;
  left = Math.min(Math.max(left, EDGE), vw - floating.width - EDGE);
  const top = Math.min(Math.max(anchor.top + (anchor.height - floating.height) / 2, EDGE), vh - floating.height - EDGE);
  return { top, left };
}

// Esc는 가장 위 층만 닫는다 - 열린 순서대로 쌓아 둔다
const escStack: symbol[] = [];

export function pushEscLayer(): symbol {
  const id = Symbol("layer");
  escStack.push(id);
  return id;
}

export function popEscLayer(id: symbol): void {
  const index = escStack.indexOf(id);
  if (index >= 0) escStack.splice(index, 1);
}

export function isTopEscLayer(id: symbol): boolean {
  return escStack[escStack.length - 1] === id;
}
