// 쪼개기 화면 오른쪽 패널의 AI - 고른 단위에 걸린 나누기 제안의 미리보기·적용·거절. 문서 단위 요청은 용지 위 막대(`SplitAiBar`)에 있다.
"use client";

import { Check, WandSparkles, X } from "lucide-react";

import { BusyLabel } from "@/components/ui/motion";
import type { AiSuggestion, ViewUnit } from "@/lib/api-sop";
import { useI18n } from "@/lib/i18n";
import { readSplitOffsets, type SplitAi } from "@/lib/use-split-ai";

interface SplitAiProps {
  ai: SplitAi;
  selected: ViewUnit;
  suggestion: AiSuggestion;
  canEdit: boolean;
  busy: boolean;
}

/** 원문을 제안 위치에서 자른 조각들 */
function cutPieces(text: string, offsets: readonly number[]): string[] {
  const points = [...offsets].filter((at) => at > 0 && at < text.length).sort((a, b) => a - b);
  const pieces: string[] = [];
  let start = 0;
  for (const at of points) {
    pieces.push(text.slice(start, at));
    start = at;
  }
  pieces.push(text.slice(start));
  return pieces.map((piece) => piece.trim()).filter(Boolean);
}

export function SplitAiSection({ ai, selected, suggestion, canEdit, busy }: SplitAiProps) {
  const { t } = useI18n();
  const pieces = cutPieces(selected.text, readSplitOffsets(suggestion.content.offsets));
  const isOff = busy || ai.working !== null;
  return (
    <section className="grid gap-1.5 rounded-md border border-dashed bg-st-ai-tint p-2.5 text-[13px]" style={{ borderColor: "var(--st-ai-line)" }} data-testid="split-ai-suggestion">
      <span className="flex items-center gap-1.5 text-xs font-semibold text-st-ai">
        <WandSparkles size={14} strokeWidth={1.5} aria-hidden />
        {t("ai.splitSuggestion")}
      </span>
      {pieces.map((piece, index) => (
        <p key={index} className="rounded-sm px-1.5 py-0.5 leading-5" style={{ background: index % 2 === 0 ? "var(--split-a)" : "var(--split-b)" }}>
          {piece}
        </p>
      ))}
      {typeof suggestion.content.reason === "string" && suggestion.content.reason && <p className="text-xs text-ink-2">{suggestion.content.reason}</p>}
      {canEdit && (
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className="btn h-7" data-testid="split-ai-apply" disabled={isOff} onClick={() => void ai.apply(selected, suggestion)}>
            <BusyLabel busy={ai.working === "apply"} icon={<Check size={14} strokeWidth={1.5} aria-hidden />} label={t("ai.applySplit")} />
          </button>
          <button type="button" className="btn ghost h-7" data-testid="split-ai-reject" disabled={isOff} onClick={() => void ai.reject(suggestion)}>
            <BusyLabel busy={ai.working === "reject"} icon={<X size={14} strokeWidth={1.5} aria-hidden />} label={t("ai.dismiss")} />
          </button>
        </div>
      )}
      <span className="text-[11px] text-ink-3">{t("classify.aiCheck")}</span>
    </section>
  );
}
