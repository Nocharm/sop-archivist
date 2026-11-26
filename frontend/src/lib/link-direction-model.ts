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

/** 다른 탭에 있어 그려지지 않은 New 문장의 쪽 - 이을 문장은 본문과 꼬리말(각주 · 미주) 탭에 있다. 탭이 없는 용지(엮은 문서)면 null */
export function readHiddenTabSide(tab: string | undefined): "above" | "below" | null {
  if (tab === undefined) return null;
  return tab === "footer" || tab === "figures" ? "above" : "below";
}

/** 덩어리(.strip-chunk)째로 가늠한 쪽 - 화면 밖 덩어리의 박스는 재지 않는다(재면 브라우저가 건너뛴 덩어리를 배치한다). 틀에 걸치거나 덩어리가 없으면 null(박스를 잰다) */
export function readFarSide(chunk: { top: number; bottom: number } | null, frame: { top: number; bottom: number }): "above" | "below" | null {
  if (chunk === null) return null;
  if (chunk.bottom < frame.top) return "above";
  return chunk.top > frame.bottom ? "below" : null;
}
