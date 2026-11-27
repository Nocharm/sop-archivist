// New 목록에서 WI 줄을 SOP 줄에 끌어 상위 SOP를 바꾸는 순수 모델 - 놓을 자리 판정, 끌 수 있는 줄, 끌려가는 표, 알림 Undo의 판정.
// 설계: 2026-11-17-documents-screen §7 (docs/architecture/decisions.md)
import type { ToBe } from "./api-sop";
import type { DragCard } from "./box-drag";
import type { DraftDoc } from "./tobe-draft";
import { truncateMiddle } from "./truncate-middle";

type DropDoc = Pick<DraftDoc, "key" | "code" | "doc_type" | "parent_key">;

export type ParentRefusal = "wiTarget" | "sameParent";
export type ParentDrop =
  | { kind: "move"; parentKey: string; parentCode: string }
  | { kind: "refused"; reason: ParentRefusal }
  | { kind: "none" }; // 자기 줄 · 줄이 아닌 곳

export const PARENT_REFUSAL_KEYS: Readonly<Record<ParentRefusal, string>> = {
  wiTarget: "tobe.drag.wiTarget",
  sameParent: "tobe.drag.sameParent",
};

/** 끄는 WI를 포인터 아래 줄에 놓으면 - 먼저 걸리는 것: 줄 없음·자기 줄 → none, WI 줄 → wiTarget, 지금 부모 → sameParent, 그 밖의 SOP → move */
export function resolveParentDrop(source: DropDoc, target: DropDoc | null): ParentDrop {
  if (target === null || target.key === source.key) return { kind: "none" };
  if (target.doc_type === "wi") return { kind: "refused", reason: "wiTarget" };
  if (target.key === source.parent_key) return { kind: "refused", reason: "sameParent" };
  return { kind: "move", parentKey: target.key, parentCode: target.code };
}

/** 이 WI 줄을 끌 수 있는가 - 고칠 수 있고, 줄 쓰기가 돌지 않고, 지금 부모가 아닌 SOP가 하나라도 있다 */
export function canDragParent(doc: DropDoc, state: { canEdit: boolean; saving: boolean; sopKeys: readonly string[] }): boolean {
  if (!state.canEdit || state.saving || doc.doc_type !== "wi") return false;
  return state.sopKeys.some((key) => key !== doc.parent_key);
}

/** 끌려가는 표 - ID 자리에 번호(가운데 말줄임), 글 자리에 제목, 개수 없음 */
export function buildParentCard(doc: Pick<DraftDoc, "code" | "title">, noTitle: string): DragCard {
  return { id: truncateMiddle(doc.code, 14, 8), text: doc.title || noTitle, count: null };
}

/** 알림의 Undo - 그 줄이 아직 WI이고 부모가 놓았던 SOP(movedTo) 그대로일 때만. 남이 그사이 바꾼 것을 덮지 않는다 */
export function canUndoParentMove(tobe: ToBe, docId: number, movedTo: string): boolean {
  const doc = tobe.docs.find((item) => item.id === docId);
  return doc !== undefined && doc.doc_type === "wi" && doc.parent_code === movedTo;
}
