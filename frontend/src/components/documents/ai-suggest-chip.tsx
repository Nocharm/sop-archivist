// 비어 있는 문서 칸의 AI 제안 칩 - 흐린 값과 AI 표, 누르면 사람이 그 값으로 저장한다(AI는 문서에 쓰지 않는다). 문서 목록과 업로드 결과 행이 같이 쓴다.
"use client";

import { useI18n } from "@/lib/i18n";

export function AiSuggestChip({ value, testId, onAccept }: { value: string; testId: string; onAccept: () => void }) {
  const { t } = useI18n();
  return (
    <button type="button" className="ai-suggest" data-testid={testId} aria-label={t("documents.acceptAi", { value })} onClick={onAccept}>
      <span className="truncate font-mono">{value}</span>
      <span className="src-badge ai">AI</span>
    </button>
  );
}
