// Old 조각 오른쪽 칸의 연결 배지 - "→ 문서 코드". 이어진 New 문장이 오른쪽 칸 화면 밖이면 ↑/↓, 다른 New 문서면 문서 아이콘이 붙는다.
// 방향은 오른쪽 칸 스크롤마다 바뀌므로 React 상태가 아니라 LinkLines가 data-dir 속성으로 단다(Old 조각이 수천 개여도 다시 그리지 않는다).
"use client";

import { ArrowUp, ArrowDown, FileText } from "lucide-react";

import type { WrittenSentence } from "@/lib/api-sop";
import { useI18n } from "@/lib/i18n";

interface LinkBadgeProps {
  unitId: number;
  /** 이 조각이 출처로 붙은 New 문장들(저장된 것) */
  targets: WrittenSentence[];
  /** 지금 열린 New 문서 - 그 문서의 문장을 먼저 가리킨다 */
  currentDocId: number | null;
  onJump: (unitId: number, targetId: number) => void;
}

/** 배지가 가리키는 문장 - 지금 열린 문서의 첫 문장, 없으면 첫 문장 */
export function pickBadgeTarget(targets: WrittenSentence[], currentDocId: number | null): WrittenSentence | null {
  return targets.find((item) => item.target_doc_id === currentDocId) ?? targets[0] ?? null;
}

export function LinkBadge({ unitId, targets, currentDocId, onJump }: LinkBadgeProps) {
  const { t } = useI18n();
  const target = pickBadgeTarget(targets, currentDocId);
  if (!target) return null;
  return (
    <button
      type="button"
      className="lbadge"
      aria-label={t("assign.jumpBadge", { id: target.doc_code })}
      data-link-badge={unitId}
      data-targets={targets.map((item) => `${item.target_doc_id}:${item.target_id}`).join(",")}
      data-testid={`assign-link-badge-${unitId}`}
      onClick={(event) => {
        event.stopPropagation();
        onJump(unitId, target.target_id);
      }}
    >
      <span aria-hidden>→</span>
      <span className="lbadge-code">{target.doc_code}</span>
      <ArrowUp size={11} strokeWidth={2} className="lbadge-dir" data-d="above" aria-hidden />
      <ArrowDown size={11} strokeWidth={2} className="lbadge-dir" data-d="below" aria-hidden />
      <FileText size={11} strokeWidth={2} className="lbadge-dir" data-d="otherDoc" aria-hidden />
    </button>
  );
}
