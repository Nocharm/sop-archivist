// Assign 연결 배지 - 이어진 New 문장이 오른쪽 칸에서 어디에 있는지(보임·위·아래·다른 문서·없음). 좌표는 칸 몸통 안(스크롤을 더한 값).

export type LinkDirection = "visible" | "above" | "below" | "otherDoc" | "none";

export interface LinkAnchor {
  docId: number;
  top: number;
  bottom: number;
}

export interface LinkView {
  docId: number;
  scrollTop: number;
  height: number;
}

/** 테두리에 걸치면 보이는 것으로 본다 - 선이 닿는 줄을 화살표로 가리키지 않게 */
export function getLinkDirection(newAnchor: LinkAnchor | null, view: LinkView): LinkDirection {
  if (newAnchor === null) return "none";
  if (newAnchor.docId !== view.docId) return "otherDoc";
  if (newAnchor.bottom < view.scrollTop) return "above";
  if (newAnchor.top > view.scrollTop + view.height) return "below";
  return "visible";
}
