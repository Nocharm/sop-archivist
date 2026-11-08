// 쪼개기 화면의 AI - 문서 단위 나누기 제안·한/영 짝 제안 요청, 고른 단위에 걸린 나누기 제안의 미리보기·적용·거절.
// AI는 제안만 한다: 적용은 사람이 누르는 편집(split)이고, 채택 기록(as_is·rejected)은 나누기에서만 사람이 직접 남긴다(계획 2 API 계약).
"use client";

import { Check, Sparkles, X } from "lucide-react";
import { useMemo, useState } from "react";

import { BusyLabel, Collapse } from "@/components/ui/motion";
import { showToast } from "@/components/ui/toast";
import { humanizeApiError } from "@/lib/api-errors";
import { listAppliedSuggestions, requestAi, setSuggestionAdoption, type AiKind } from "@/lib/api-manage";
import { editUnits, type EditResult, type LanguageLayout, type ViewUnit } from "@/lib/api-sop";
import { useI18n } from "@/lib/i18n";
import { useAiJobs } from "@/lib/use-ai-jobs";
import { useLoaded } from "@/lib/use-loaded";

interface SplitAiProps {
  bundleId: number;
  docId: number;
  layout: LanguageLayout;
  revision: number;
  selected: ViewUnit | null;
  canEdit: boolean;
  busy: boolean;
  /** 나누기를 적용했거나 작업이 끝났다 - 화면이 문서를 다시 읽는다 */
  onChanged: (result: EditResult | null) => void;
}

/** 제안의 자를 위치 - 응답 JSON이라 숫자만 골라 쓴다 */
function readOffsets(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((item): item is number => typeof item === "number") : [];
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

export function SplitAiSection({ bundleId, docId, layout, revision, selected, canEdit, busy, onChanged }: SplitAiProps) {
  const { t } = useI18n();
  const [round, setRound] = useState(0);
  const [working, setWorking] = useState<"split" | "pair" | "apply" | "reject" | null>(null);
  const jobs = useAiJobs(bundleId, () => {
    setRound((value) => value + 1);
    onChanged(null);
  });
  const suggestions = useLoaded(() => listAppliedSuggestions(bundleId, "split", docId), `${docId}:${round}:${revision}`);
  const forUnit = useMemo(
    () => (selected ? (suggestions.data ?? []).filter((item) => item.content.unit_id === selected.id && item.adoption === null).at(-1) ?? null : null),
    [suggestions.data, selected],
  );
  const pending = (suggestions.data ?? []).filter((item) => item.adoption === null).length;
  const aiOn = jobs.status?.ai_enabled === true;
  const running = (jobs.status?.by_kind.split?.queued ?? 0) + (jobs.status?.by_kind.split?.running ?? 0) + (jobs.status?.by_kind.pair?.queued ?? 0) + (jobs.status?.by_kind.pair?.running ?? 0);
  const offsets = forUnit ? readOffsets(forUnit.content.offsets) : [];
  const pieces = forUnit && selected ? cutPieces(selected.text, offsets) : [];

  async function ask(kind: Extract<AiKind, "split" | "pair">) {
    setWorking(kind);
    try {
      const result = await requestAi(bundleId, kind, { document_id: docId });
      showToast(result.queued > 0 ? t("classify.aiQueued") : t("ai.nothingQueued", { n: result.skipped_total }));
      jobs.watch();
    } catch (err) {
      showToast(humanizeApiError(err, t), "error");
    } finally {
      setWorking(null);
    }
  }

  async function apply() {
    if (!forUnit || !selected) return;
    setWorking("apply");
    try {
      // 뒤쪽 위치부터 자르면 앞 조각의 위치가 바뀌지 않는다 - 매번 왼쪽 조각(새 ID)을 다음 대상으로 삼는다
      let unitId = selected.id;
      let docRevision = revision;
      let last: EditResult | null = null;
      for (const at of [...offsets].sort((a, b) => b - a)) {
        last = await editUnits(bundleId, docId, docRevision, { type: "split", unit_id: unitId, at });
        docRevision = last.document_revision;
        unitId = last.created_unit_ids[0] ?? unitId;
      }
      await setSuggestionAdoption(bundleId, forUnit.id, "as_is");
      showToast(t("split.didSplit"));
      setRound((value) => value + 1);
      onChanged(last);
    } catch (err) {
      showToast(humanizeApiError(err, t), "error");
      onChanged(null);
    } finally {
      setWorking(null);
    }
  }

  async function reject() {
    if (!forUnit) return;
    setWorking("reject");
    try {
      await setSuggestionAdoption(bundleId, forUnit.id, "rejected");
      setRound((value) => value + 1);
    } catch (err) {
      showToast(humanizeApiError(err, t), "error");
    } finally {
      setWorking(null);
    }
  }

  if (!aiOn) return null;
  return (
    <section className="grid gap-2 rounded-md border border-dashed px-3 py-2.5 text-[13px]" style={{ borderColor: "var(--st-ai-line)" }} data-testid="split-ai">
      <span className="flex items-center gap-1.5 text-xs font-semibold text-st-ai">
        <Sparkles size={14} strokeWidth={1.5} aria-hidden />
        AI
        {pending > 0 && <span className="pill ai">{t("ai.pendingCount", { n: pending })}</span>}
        {running > 0 && <span className="font-normal text-ink-3">{t("classify.aiRunning", { n: running })}</span>}
      </span>
      <Collapse open={forUnit !== null}>
        <div className="grid gap-1.5 rounded-md bg-st-ai-tint p-2" data-testid="split-ai-suggestion">
          <span className="text-xs text-ink-2">{t("ai.splitSuggestion")}</span>
          {pieces.map((piece, index) => (
            <p key={index} className="rounded-sm px-1.5 py-0.5 leading-5" style={{ background: index % 2 === 0 ? "var(--split-a)" : "var(--split-b)" }}>
              {piece}
            </p>
          ))}
          {typeof forUnit?.content.reason === "string" && forUnit.content.reason && <p className="text-xs text-ink-2">{forUnit.content.reason}</p>}
          {canEdit && (
            <div className="flex gap-1.5">
              <button type="button" className="btn h-7" data-testid="split-ai-apply" disabled={busy || working !== null} onClick={() => void apply()}>
                <BusyLabel busy={working === "apply"} icon={<Check size={14} strokeWidth={1.5} aria-hidden />} label={t("ai.applySplit")} />
              </button>
              <button type="button" className="btn ghost h-7" data-testid="split-ai-reject" disabled={busy || working !== null} onClick={() => void reject()}>
                <BusyLabel busy={working === "reject"} icon={<X size={14} strokeWidth={1.5} aria-hidden />} label={t("ai.dismiss")} />
              </button>
            </div>
          )}
          <span className="text-[11px] text-ink-3">{t("classify.aiCheck")}</span>
        </div>
      </Collapse>
      {canEdit && (
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className="btn h-7" data-testid="split-ai-request" disabled={busy || working !== null} onClick={() => void ask("split")}>
            <BusyLabel busy={working === "split"} label={t("ai.askSplit")} />
          </button>
          {layout === "ko_en_separate" && (
            <button type="button" className="btn h-7" data-testid="split-ai-pair" disabled={busy || working !== null} onClick={() => void ask("pair")}>
              <BusyLabel busy={working === "pair"} label={t("ai.askPair")} />
            </button>
          )}
        </div>
      )}
    </section>
  );
}
