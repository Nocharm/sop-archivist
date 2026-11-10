// AI 요청 결과 줄 - 보낸 수와 건너뛴 까닭별 수를 사람 말로. 토스트는 금방 사라져 까닭을 읽기 어려워, 닫을 때까지 용지 위에 둔다.
"use client";

import { X } from "lucide-react";

import { useI18n } from "@/lib/i18n";
import { MESSAGES } from "@/lib/i18n-messages";
import type { SplitAiRequestResult } from "@/lib/use-split-ai";

interface SplitAiResultProps {
  result: SplitAiRequestResult;
  onClose: () => void;
}

export function SplitAiResult({ result, onClose }: SplitAiResultProps) {
  const { t } = useI18n();
  const { out } = result;
  const reasons = Object.entries(out.skipped_by_reason).filter(([, count]) => count > 0);
  return (
    <div className="flex items-start gap-2 border-b border-line bg-st-ai-tint px-[var(--pad)] py-1.5 text-xs leading-[18px] text-ink-2" role="status" data-testid="split-ai-result">
      <div className="grid min-w-0 flex-1 gap-0.5">
        <span className="font-semibold text-ink" data-testid="split-ai-result-queued">
          {out.queued > 0 ? t("ai.queuedCount", { n: out.queued }) : t("ai.nothingQueued", { n: out.skipped_total })}
        </span>
        {reasons.length > 0 && (
          <ul className="flex flex-wrap gap-x-3 gap-y-0.5" data-testid="split-ai-result-skips">
            {reasons.map(([reason, count]) => (
              <li key={reason} data-testid={`split-ai-skip-${reason}`}>
                {/* 모르는 까닭(서버가 먼저 늘었을 때)은 일반 문구로 */}
                {t(`ai.skip.${reason}` in MESSAGES.en ? `ai.skip.${reason}` : "ai.skip.other", { n: count })}
              </li>
            ))}
          </ul>
        )}
      </div>
      <button type="button" className="btn ghost icon h-6 w-6 flex-none" aria-label={t("common.close")} data-testid="split-ai-result-close" onClick={onClose}>
        <X size={13} strokeWidth={1.6} aria-hidden />
      </button>
    </div>
  );
}
