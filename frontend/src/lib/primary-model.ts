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
  /** 마지막으로 누른 것이 저절로 삭제된 줄이다(쪼개기 먼저 §7 R3) - 확정은 아무것도 하지 않는다 */
  isDeletedLine?: boolean;
  destination: Destination | null;
  /** Suggested의 카드 - Nearby는 대상이 아니다 */
  recommendations: readonly Recommendation[];
  /** 이 줄의 비슷한 문장이 아직 오지 않았다 - 카드가 없어도 "고를 것이 없다"가 아니다 */
  isSuggestedLoading?: boolean;
  /** 앞자리 추천(AI · 같은 글)이 처음 오는 중이다 - 지금 첫 카드가 곧 첫 카드가 아닐 수 있어 카드가 있어도 확정하지 않는다 */
  isFirstCardUnknown?: boolean;
  /** 확정을 막는 까닭(readConfirmBlockKey) - 카드로 확정할 때는 그 카드의 자리로 본 것 */
  blockKey: string | null;
  /** 고른 줄이 든 벗긴 표에 AI 순서 미리보기가 떠 있을 때만 그 표 */
  orderPreviewTableId: number | null;
}

export function planPrimary({ canEdit, hasRow, isDeletedLine = false, destination, recommendations, isSuggestedLoading = false, isFirstCardUnknown = false, blockKey, orderPreviewTableId }: PrimaryInput): PrimaryPlan {
  const blocked = (reasonKey: string): PrimaryPlan => ({ kind: "blocked", reasonKey });
  if (isDeletedLine) return blocked("assign.noise.nothing");
  if (!canEdit || !hasRow) return blocked("assign.primary.pickFirst");
  if (orderPreviewTableId !== null) return { kind: "apply_order", tableId: orderPreviewTableId };
  if (blockKey !== null) return blocked(blockKey);
  const readTone = (target: Destination) => (target.kind === "delete" ? "danger" : "normal");
  if (destination !== null) return { kind: "confirm", from: "draft", destination, cardIndex: null, isAiAsIs: false, tone: readTone(destination) };
  if (isFirstCardUnknown) return blocked("assign.primary.loading");
  const first = recommendations.at(0);
  if (first === undefined) return blocked(isSuggestedLoading ? "assign.primary.loading" : "assign.primary.pickFirst");
  return { kind: "confirm", from: "card", destination: first.destination, cardIndex: 0, isAiAsIs: first.source === "ai", tone: readTone(first.destination) };
}

export interface PrimaryLabel {
  labelKey: string;
  values: Record<string, string>;
  suffixKey: string | null;
  tone: "normal" | "danger";
}

/** 확정 단추의 이름과 색 - label은 갈 곳의 짧은 이름(자리 이름을 모르면 빈 글) */
export function describePrimary(plan: PrimaryPlan, label: string): PrimaryLabel {
  const plain = (labelKey: string): PrimaryLabel => ({ labelKey, values: {}, suffixKey: null, tone: "normal" });
  if (plan.kind === "apply_order") return plain("assign.primary.applyOrder");
  if (plan.kind === "blocked") return plain("classify.confirm");
  const suffixKey = plan.isAiAsIs ? "assign.primary.aiAsIs" : null;
  if (plan.destination.kind === "delete") return { labelKey: "assign.primary.delete", values: {}, suffixKey, tone: plan.tone };
  if (label === "") return { labelKey: "classify.confirm", values: {}, suffixKey, tone: plan.tone };
  return { labelKey: "assign.primary.confirmTo", values: { place: label }, suffixKey, tone: plan.tone };
}
