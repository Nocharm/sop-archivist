// 화면 좌표의 글자 자리 - 브라우저마다 다른 두 API를 한 모양으로 읽는다. 나눌 선을 놓거나 끌 때 쓴다(Old 용지와 New 칸).

export interface CaretPoint {
  node: Node;
  /** 글자 노드면 그 안의 글자 위치, 요소면 자식 위치 */
  offset: number;
}

export function readCaretPoint(x: number, y: number): CaretPoint | null {
  if ("caretPositionFromPoint" in document) {
    const pos = document.caretPositionFromPoint(x, y);
    return pos ? { node: pos.offsetNode, offset: pos.offset } : null;
  }
  if ("caretRangeFromPoint" in document) {
    // Safari 등 구형 API
    const range = (document as Document & { caretRangeFromPoint: (x: number, y: number) => Range | null }).caretRangeFromPoint(x, y);
    return range ? { node: range.startContainer, offset: range.startOffset } : null;
  }
  return null;
}
