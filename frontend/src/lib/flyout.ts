// 하위 메뉴(플라이아웃)를 어느 쪽으로 펼칠지 - 화면 오른쪽 끝에서는 왼쪽으로 뒤집는다.

/** 오른쪽에 하위 메뉴 폭+간격이 들어가면 오른쪽, 아니면 왼쪽. 양쪽 다 모자라면 여유가 큰 쪽 */
export function pickFlyoutSide(anchor: DOMRect, flyoutWidth: number, viewportWidth: number, gap = 6): "right" | "left" {
  const rightRoom = viewportWidth - anchor.right;
  const leftRoom = anchor.left;
  const need = flyoutWidth + gap;
  if (rightRoom >= need) return "right";
  if (leftRoom >= need) return "left";
  return rightRoom >= leftRoom ? "right" : "left";
}
