// Old 조각 오른쪽 아래 모서리의 연결 배지. 오른쪽에 열린 New 문서와 이어지면 아이콘만(보이면 연결, 화면 밖이면 위·아래 갈매기), 다른 문서와만 이어지면 옅은 문서 번호 글자만.
// 방향은 오른쪽 칸 스크롤마다 바뀌므로 React 상태가 아니라 LinkLines가 data-dir 속성으로 단다(Old 조각이 수천 개여도 다시 그리지 않는다) - 세 모양을 다 두고 CSS가 하나만 보인다.
"use client";

import { ChevronDown, ChevronUp, Link2 } from "lucide-react";

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

/** 다른 문서 배지 글자 - 첫 문서 번호, 문서가 더 있으면 " +N" */
export function formatOtherDocs(targets: WrittenSentence[]): string {
  const codes = [...new Set(targets.map((item) => item.doc_code))];
  return codes.length > 1 ? `${codes[0]} +${codes.length - 1}` : (codes[0] ?? "");
}

export function LinkBadge({ unitId, targets, currentDocId, onJump }: LinkBadgeProps) {
  const { t } = useI18n();
  const target = pickBadgeTarget(targets, currentDocId);
  if (!target) return null;
  const isAi = target.status === "ai_suggested";
  const codes = [...new Set(targets.map((item) => item.doc_code))].join(", ");
  const label = t("assign.jumpBadge", { id: codes });
  return (
    <button
      type="button"
      className="lbadge"
      aria-label={label}
      data-tip={isAi ? `${label} · ${t("assign.linkBadge.ai")}` : label}
      data-tip-side="top"
      data-ai={isAi ? "" : undefined}
      data-link-badge={unitId}
      data-targets={targets.map((item) => `${item.target_doc_id}:${item.target_id}`).join(",")}
      data-testid={`assign-link-badge-${unitId}`}
      onClick={(event) => {
        event.stopPropagation();
        onJump(unitId, target.target_id);
      }}
    >
      <Link2 size={13} strokeWidth={2.25} className="lbadge-dir" data-d="visible" aria-hidden />
      <ChevronUp size={14} strokeWidth={2.5} className="lbadge-dir" data-d="above" aria-hidden />
      <ChevronDown size={14} strokeWidth={2.5} className="lbadge-dir" data-d="below" aria-hidden />
      <span className="lbadge-dir lbadge-code" data-d="otherDoc">
        {formatOtherDocs(targets)}
      </span>
    </button>
  );
}
