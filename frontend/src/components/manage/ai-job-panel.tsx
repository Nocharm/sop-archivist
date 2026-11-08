// 개요의 AI 작업 칸 - 종류별 진행(대기·실행·실패), 실패 이유, 채택 결과, 취소·다시 시도. 작업이 남아 있는 동안 숫자가 따라온다.
// 비율 대신 건수만 보인다(유사도·퍼센트 표시 금지 - 디자인 문서 3절의 정신을 채택 결과에도 적용).
"use client";

import { RotateCcw, Square } from "lucide-react";
import { useState } from "react";

import { BusyLabel, Collapse, Refresh } from "@/components/ui/motion";
import { showToast } from "@/components/ui/toast";
import { humanizeApiError } from "@/lib/api-errors";
import { cancelAi, retryAi } from "@/lib/api-manage";
import type { AiJobCounts, Bundle } from "@/lib/api-sop";
import { loadBundle } from "@/lib/bundle-store";
import { useI18n } from "@/lib/i18n";
import { useAiJobs } from "@/lib/use-ai-jobs";

const KINDS = ["classify", "translate", "match", "pair", "split"] as const;

function hasAny(counts: AiJobCounts | undefined): boolean {
  if (!counts) return false;
  return counts.queued + counts.running + counts.done + counts.failed + counts.stale + counts.cancelled > 0;
}

export function AiJobPanel({ bundle }: { bundle: Bundle }) {
  const { t } = useI18n();
  const { status, watch } = useAiJobs(bundle.id, () => void loadBundle(bundle.id));
  const [working, setWorking] = useState<"cancel" | "retry" | null>(null);
  const canEdit = bundle.my_role === "author" && bundle.status === "in_progress";
  const active = (status?.jobs.queued ?? 0) + (status?.jobs.running ?? 0);
  const failed = status?.jobs.failed ?? 0;
  const kinds = KINDS.filter((kind) => hasAny(status?.by_kind[kind]));
  const errors = Object.entries(status?.failed_errors ?? {}).filter(([, count]) => count > 0);

  async function run(kind: "cancel" | "retry") {
    setWorking(kind);
    try {
      const result = kind === "cancel" ? await cancelAi(bundle.id) : await retryAi(bundle.id);
      showToast(kind === "cancel" ? t("ai.cancelled", { n: "cancelled" in result ? result.cancelled : 0 }) : t("ai.retried", { n: "queued" in result ? result.queued : 0 }));
      watch();
    } catch (err) {
      showToast(humanizeApiError(err, t), "error");
    } finally {
      setWorking(null);
    }
  }

  let summary: string;
  if (status === null) summary = "";
  else if (!status.ai_enabled) summary = t("overview.aiOff");
  else summary = t("overview.aiJobs", { running: status.jobs.running, queued: status.jobs.queued, failed });

  return (
    <section className="grid gap-2" data-testid="overview-ai">
      <h2 className="text-xs font-semibold text-ink-3">{t("overview.aiJob")}</h2>
      <Refresh token={`${status?.jobs.running ?? 0}:${status?.jobs.queued ?? 0}:${failed}`}>
        <p className="min-h-[22px] text-ink-2 tabular-nums">{summary}</p>
      </Refresh>
      <Collapse open={status?.ai_enabled === true && kinds.length > 0}>
        <table className="w-full text-[13px] tabular-nums" data-testid="overview-ai-kinds">
          <thead>
            <tr className="text-xs text-ink-3">
              <th className="py-1 text-left font-normal">{t("ai.kindHead")}</th>
              <th className="py-1 text-right font-normal">{t("ai.active")}</th>
              <th className="py-1 text-right font-normal">Done</th>
              <th className="py-1 text-right font-normal">Failed</th>
              <th className="py-1 text-right font-normal">{t("ai.adopted")}</th>
            </tr>
          </thead>
          <tbody>
            {kinds.map((kind) => {
              const counts = status?.by_kind[kind];
              const adoption = status?.adoption[kind];
              return (
                <tr key={kind} className="border-t border-line" data-testid={`overview-ai-kind-${kind}`}>
                  <td className="py-1">{t(`ai.kind.${kind}`)}</td>
                  <td className="py-1 text-right">{(counts?.queued ?? 0) + (counts?.running ?? 0)}</td>
                  <td className="py-1 text-right">{counts?.done ?? 0}</td>
                  <td className={`py-1 text-right ${(counts?.failed ?? 0) > 0 ? "text-danger" : ""}`}>{counts?.failed ?? 0}</td>
                  <td className="py-1 text-right text-ink-2">{adoption ? adoption.as_is + adoption.edited : "–"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Collapse>
      <Collapse open={errors.length > 0}>
        <div className="flex flex-wrap gap-1" data-testid="overview-ai-errors">
          {errors.map(([code, count]) => (
            <span key={code} className="pill danger">
              {t(`ai.error.${code}`) === `ai.error.${code}` ? code : t(`ai.error.${code}`)} · {count}
            </span>
          ))}
        </div>
      </Collapse>
      {canEdit && status?.ai_enabled && (active > 0 || failed > 0) && (
        <div className="flex gap-1.5">
          {active > 0 && (
            <button type="button" className="btn h-7" data-testid="overview-ai-cancel" disabled={working !== null} onClick={() => void run("cancel")}>
              <BusyLabel busy={working === "cancel"} icon={<Square size={12} strokeWidth={1.5} aria-hidden />} label={t("ai.cancel")} />
            </button>
          )}
          {failed > 0 && (
            <button type="button" className="btn h-7" data-testid="overview-ai-retry" disabled={working !== null} onClick={() => void run("retry")}>
              <BusyLabel busy={working === "retry"} icon={<RotateCcw size={12} strokeWidth={1.5} aria-hidden />} label={t("ai.retry")} />
            </button>
          )}
        </div>
      )}
    </section>
  );
}
