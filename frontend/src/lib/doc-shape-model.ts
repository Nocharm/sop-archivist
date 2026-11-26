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

/** 누른 박스의 문서 - 편집은 늘 누른 쪽의 문서로 간다(한 단으로 연 New는 왼쪽 용지가 side "new"다, 쪼개기 먼저 §8 4-3) */
export function pickEditTarget(shapes: readonly DocShape[], pressed: { side: PickSide; unitId: number }): { docId: number; side: PickSide } | null {
  const shape = shapes.find((item) => item.side === pressed.side);
  return shape ? { docId: shape.view.document.id, side: shape.side } : null;
}

// 두 번 눌러 나눌 수 있는 줄 - 서버 split 편집이 받는 글 줄(묶음 · 그림 · 캡션은 아니다)
const SPLIT_KINDS: ReadonlySet<string> = new Set(["sentence", "heading", "cell_sentence"]);

/** 그 용지에서 그 자리에 나눌 선을 놓을 수 있나 - Old · New 모두 같은 용지라 표 칸도 그 자리에서. 저절로 삭제된 줄은 먼저 삭제 취소 */
export function canSplitInPlace(unit: ViewUnit, shape: DocShape): boolean {
  return shape.model.units.has(unit.id) && SPLIT_KINDS.has(unit.kind) && !unit.noise_kind;
}
