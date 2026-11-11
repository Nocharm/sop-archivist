// 쪼개기 화면 오른쪽 패널의 AI - 정하지 않은 나누기 제안을 문장마다 탭으로 쌓고, 고른 탭의 미리보기·적용·거절·다음을 보인다. 문서 단위 요청은 용지 위 막대(`SplitAiBar`)에 있다.
"use client";

import { Check, Layers, WandSparkles, X } from "lucide-react";

import { BusyLabel } from "@/components/ui/motion";
import type { AiSuggestion, ViewUnit } from "@/lib/api-sop";
import { getAiTabsHead, type AiTab } from "@/lib/split-ai-tabs-model";
import { useI18n } from "@/lib/i18n";
import { readSplitOffsets, type SplitAi } from "@/lib/use-split-ai";

interface SplitAiProps {
  ai: SplitAi;
  selected: ViewUnit;
  suggestion: AiSuggestion;
  canEdit: boolean;
  busy: boolean;
  /** 아직 정하지 않은 제안 수 - 둘 이상이면 다음 단추를 둔다 */
  left: number;
  onNext: () => void;
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

function SplitAiSection({ ai, selected, suggestion, canEdit, busy, left, onNext }: SplitAiProps) {
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
          {left > 1 && (
            <button type="button" className="btn ghost h-7" data-testid="split-ai-panel-next" onClick={onNext}>
              {t("ai.leftNext", { n: left - 1 })}
            </button>
          )}
        </div>
      )}
      <span className="text-[11px] text-ink-3">{t("classify.aiCheck")}</span>
    </section>
  );
}

interface SplitAiTabsProps {
  ai: SplitAi;
  tabs: AiTab[];
  selected: ViewUnit | null;
  suggestion: AiSuggestion | null;
  canEdit: boolean;
  busy: boolean;
  onPick: (unitId: number) => void;
  onNext: () => void;
}

/** 오른쪽 칸 맨 위 "AI suggestions" - 문장마다 탭, 일괄 요청분은 머리에 개수와 함께 따로 알린다 */
export function SplitAiTabs({ ai, tabs, selected, suggestion, canEdit, busy, onPick, onNext }: SplitAiTabsProps) {
  const { t } = useI18n();
  if (!ai.isOn || tabs.length === 0) return null;
  const head = getAiTabsHead(tabs);
  return (
    <section className="grid min-w-0 gap-2" data-testid="split-ai-tabs">
      <h2 className="flex flex-wrap items-center gap-x-2 text-xs font-semibold text-ink-3">
        {t("ai.suggestionsTitle")}
        {head && (
          <span className="inline-flex items-center gap-1 font-normal text-st-ai" data-testid="split-ai-batch-head" data-kind={head.kind}>
            {head.kind === "batch" && <Layers size={12} strokeWidth={1.5} aria-hidden />}
            {head.kind === "batch" ? t("ai.batchLeft", { n: head.n }) : `· ${t("ai.leftCount", { n: head.n })}`}
          </span>
        )}
      </h2>
      {/* 탭이 많으면 옆으로 민다 */}
      <div className="flex gap-1 overflow-x-auto pb-1" data-testid="split-ai-tablist">
        {tabs.map((tab) => {
          const isActive = selected?.id === tab.unitId;
          return (
            <button
              key={tab.unitId}
              type="button"
              aria-pressed={isActive}
              className={`pill ai h-7 flex-none cursor-pointer whitespace-nowrap ${isActive ? "font-semibold" : ""}`}
              style={isActive ? { outline: "1.5px solid var(--st-ai-line)" } : undefined}
              data-testid={`split-ai-tab-${tab.unitId}`}
              data-unseen={tab.unseen ? "true" : undefined}
              data-batch={tab.origin === "batch" ? "true" : undefined}
              onClick={() => onPick(tab.unitId)}
            >
              {tab.origin === "batch" && <Layers size={11} strokeWidth={1.5} aria-hidden />}
              {tab.label}
              {tab.unseen && <span className="h-1.5 w-1.5 rounded-full bg-st-ai" aria-label={t("ai.unseen")} />}
            </button>
          );
        })}
      </div>
      {suggestion && selected ? (
        <SplitAiSection ai={ai} selected={selected} suggestion={suggestion} canEdit={canEdit} busy={busy} left={tabs.length} onNext={onNext} />
      ) : (
        <p className="text-xs text-ink-3" data-testid="split-ai-tabs-hint">
          {t("ai.pickTab")}
        </p>
      )}
    </section>
  );
}
