// 편집이 다듬는 문서 한 벌 - Old와 New를 따로 고르므로(assign-focus-model) 편집마다 어느 문서를 고치는지 인자로 받는다.
import type { DocumentView, ViewUnit } from "./api-sop";
import type { PaperModel, PaperTabs } from "./paper-model";

export type PickSide = "old" | "new";

/** 용지에 그려진 문서 하나 */
export interface DocShape {
  side: PickSide;
  view: DocumentView;
  model: PaperModel;
  tabs: PaperTabs;
}

/** 그 문서의 것 - 짝 고르기 · 캡션 고르기는 시작한 문서에서 찾는다(다른 쪽을 눌러도 사라지지 않게) */
export function findShapeOfDoc(shapes: readonly DocShape[], docId: number): DocShape | null {
  return shapes.find((shape) => shape.view.document.id === docId) ?? null;
}

/** 그 Unit과 그것이 든 문서 */
export function findShapeUnit(shapes: readonly DocShape[], unitId: number): { shape: DocShape; unit: ViewUnit } | null {
  for (const shape of shapes) {
    const unit = shape.model.units.get(unitId);
    if (unit) return { shape, unit };
  }
  return null;
}
