// 배정 화면 오른쪽 칸의 AI 나누기 제안 - 고른 줄의 문장에 정하지 않은 제안이 있으면 잘린 모습을 미리 보이고 적용·거절한다.
// AI는 제안만 한다: 적용은 사람이 누르는 나누기(편집)이고 되돌리기 기록에 들어간다. 전에는 쪼개기 화면에서만 적용했다.
"use client";

import { Check, WandSparkles, X } from "lucide-react";

import { Tooltip } from "@/components/ui/tooltip";
import type { AiSuggestion, ViewUnit } from "@/lib/api-sop";
import { useI18n } from "@/lib/i18n";
import { cutSplitPieces } from "@/lib/split-ai-tabs-model";
import { readSplitOffsets } from "@/lib/use-split-ai";

interface SplitSuggestionCardProps {
  unit: ViewUnit;
  suggestion: AiSuggestion;
  canEdit: boolean;
  busy: boolean;
  /** 적용할 수 없는 까닭(배정이 있음·저장 전 고름) - 적용할 수 있으면 null */
  blockedReason: string | null;
  /** 이 문서에 남은 제안 수(이것 포함) - 둘 이상이면 다음으로 가는 단추를 둔다 */
  left: number;
  onApply: () => void;
  onDismiss: () => void;
  onNext: () => void;
}

export function SplitSuggestionCard({ unit, suggestion, canEdit, busy, blockedReason, left, onApply, onDismiss, onNext }: SplitSuggestionCardProps) {
  const { t } = useI18n();
  const pieces = cutSplitPieces(unit.text, readSplitOffsets(suggestion.content.offsets));
  const reason = typeof suggestion.content.reason === "string" ? suggestion.content.reason : "";
  return (
    <section className="mx-[var(--pad)] mt-[var(--pad)] grid gap-1.5 rounded-md border border-dashed bg-st-ai-tint p-2.5 text-[13px]" style={{ borderColor: "var(--st-ai-line)" }} data-testid="assign-split-suggestion">
      <span className="flex items-center gap-1.5 text-xs font-semibold text-st-ai">
        <WandSparkles size={14} strokeWidth={1.5} aria-hidden />
        <span className="min-w-0 flex-1">{t("ai.splitSuggestion")}</span>
        <span className="flex-none whitespace-nowrap font-mono font-normal text-ink-3">{unit.display_id}</span>
      </span>
      {pieces.map((piece, index) => (
        <p key={index} className="rounded-sm px-1.5 py-0.5 leading-5" style={{ background: index % 2 === 0 ? "var(--split-a)" : "var(--split-b)" }} data-testid={`assign-split-piece-${index}`}>
          {piece}
        </p>
      ))}
      {reason && <p className="text-xs text-ink-2">{reason}</p>}
      {canEdit && (
        <div className="flex flex-wrap gap-1.5">
          <Tooltip label={blockedReason ?? ""} suppressed={blockedReason === null}>
            <button type="button" className="btn h-7" data-testid="assign-split-apply" aria-disabled={blockedReason !== null || busy ? "true" : undefined} onClick={() => blockedReason === null && !busy && onApply()}>
              <Check size={14} strokeWidth={1.5} aria-hidden />
              {t("ai.applySplit")}
            </button>
          </Tooltip>
          <button type="button" className="btn ghost h-7" data-testid="assign-split-dismiss" disabled={busy} onClick={onDismiss}>
            <X size={14} strokeWidth={1.5} aria-hidden />
            {t("ai.dismiss")}
          </button>
          {left > 1 && (
            <button type="button" className="btn ghost h-7" data-testid="assign-split-next" onClick={onNext}>
              {t("ai.leftNext", { n: left - 1 })}
            </button>
          )}
        </div>
      )}
      <span className="text-[11px] text-ink-3">{t("classify.aiCheck")}</span>
    </section>
  );
}
