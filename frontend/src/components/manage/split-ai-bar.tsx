// 쪼개기 화면 용지 위의 AI 막대 - 이 문서의 나누기 제안·한/영 짝 제안을 요청하고, 정하지 않은 나누기 제안 수와 다음 제안으로 가기를 둔다.
// 요청 결과(보낸 수, 건너뛴 까닭별 수)는 사람이 닫을 때까지 아래 줄에 남는다(`SplitAiResult`).
"use client";

import { WandSparkles } from "lucide-react";

import { BusyLabel } from "@/components/ui/motion";
import { Tooltip } from "@/components/ui/tooltip";
import type { LanguageLayout } from "@/lib/api-sop";
import { useI18n } from "@/lib/i18n";
import type { SplitAi } from "@/lib/use-split-ai";

interface SplitAiBarProps {
  ai: SplitAi;
  layout: LanguageLayout;
  canEdit: boolean;
  busy: boolean;
  /** 이 문서에서 아직 정하지 않은 나누기 제안 수 */
  pending: number;
  onNext: () => void;
}

export function SplitAiBar({ ai, layout, canEdit, busy, pending, onNext }: SplitAiBarProps) {
  const { t } = useI18n();
  if (!ai.isOn) return null;
  const isOff = busy || ai.working !== null;
  return (
    <div className="flex flex-none items-center gap-1.5" data-testid="split-ai">
      {ai.running > 0 && (
        <span className="whitespace-nowrap text-xs text-ink-3" role="status" data-testid="split-ai-running">
          {t("classify.aiRunning", { n: ai.running })}
        </span>
      )}
      {ai.isStale && (
        <span className="whitespace-nowrap text-xs text-st-hold" role="status" data-testid="split-ai-stale">
          {t("ai.statusStale")}
        </span>
      )}
      {pending > 0 && (
        <Tooltip label={t("ai.nextSuggestion")}>
          <button type="button" className="pill ai h-7 cursor-pointer whitespace-nowrap" data-testid="split-ai-next" onClick={onNext}>
            <WandSparkles size={13} strokeWidth={1.6} aria-hidden />
            {t("ai.pendingCount", { n: pending })}
          </button>
        </Tooltip>
      )}
      {canEdit && (
        <Tooltip label={t("ai.askSplit")}>
          <button type="button" className="btn h-7 whitespace-nowrap" data-testid="split-ai-request" disabled={isOff} onClick={() => void ai.ask("split")}>
            <BusyLabel busy={ai.working === "split"} icon={<WandSparkles size={14} strokeWidth={1.5} aria-hidden />} label={t("ai.askSplitShort")} />
          </button>
        </Tooltip>
      )}
      {canEdit && layout === "ko_en_separate" && (
        <Tooltip label={t("ai.askPair")}>
          <button type="button" className="btn h-7 whitespace-nowrap" data-testid="split-ai-pair" disabled={isOff} onClick={() => void ai.ask("pair")}>
            <BusyLabel busy={ai.working === "pair"} label={t("ai.askPairShort")} />
          </button>
        </Tooltip>
      )}
    </div>
  );
}
