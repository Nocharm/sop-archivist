// 오른쪽 칸 확정 단추(= Enter)가 지금 할 일 - 단추의 이름 · 색 · 꺼짐과 글쇠가 같은 답을 읽는다(명세 2026-11-23-assign-feedback-2 B1-R2~R5).

import type { Recommendation } from "@/lib/assign-model";
import type { Destination } from "@/lib/classify-model";

export type PrimaryPlan =
  | { kind: "confirm"; from: "draft" | "card"; destination: Destination; cardIndex: number | null; isAiAsIs: boolean; tone: "normal" | "danger" }
  | { kind: "apply_order"; tableId: number }
  | { kind: "blocked"; reasonKey: string };

export interface PrimaryInput {
  canEdit: boolean;
  hasRow: boolean;
  destination: Destination | null;
  /** Suggested의 카드 - Nearby는 대상이 아니다 */
  recommendations: readonly Recommendation[];
  /** 확정을 막는 까닭(readConfirmBlockKey) - 카드로 확정할 때는 그 카드의 자리로 본 것 */
  blockKey: string | null;
  /** 고른 줄이 든 벗긴 표에 AI 순서 미리보기가 떠 있을 때만 그 표 */
  orderPreviewTableId: number | null;
}

export function planPrimary({ canEdit, hasRow, destination, recommendations, blockKey, orderPreviewTableId }: PrimaryInput): PrimaryPlan {
  const blocked = (reasonKey: string): PrimaryPlan => ({ kind: "blocked", reasonKey });
  if (!canEdit || !hasRow) return blocked("assign.primary.pickFirst");
  if (orderPreviewTableId !== null) return { kind: "apply_order", tableId: orderPreviewTableId };
  if (blockKey !== null) return blocked(blockKey);
  const readTone = (target: Destination) => (target.kind === "delete" ? "danger" : "normal");
  if (destination !== null) return { kind: "confirm", from: "draft", destination, cardIndex: null, isAiAsIs: false, tone: readTone(destination) };
  const first = recommendations.at(0);
  if (first === undefined) return blocked("assign.primary.pickFirst");
  return { kind: "confirm", from: "card", destination: first.destination, cardIndex: 0, isAiAsIs: first.source === "ai", tone: readTone(first.destination) };
}
