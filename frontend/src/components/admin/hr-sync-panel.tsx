// 관리 > 직원 동기화 - HR 원본 동기화 실행·변경 미리보기(드라이런)와 최근 실행 이력. HR 미설정(503)·상류 오류(502)는 사람 말 문구로만 보여 준다.
"use client";

import { Eye, Loader2, RefreshCw } from "lucide-react";
import { useState } from "react";

import { InlineNotice } from "@/components/inline-notice";
import { describeRunDetail, getAbortReasonKey, translateOrRaw } from "@/lib/admin-format";
import { getHrSyncPreview, listHrSyncRuns, runHrSync, type HrSyncPreview, type HrSyncSummary } from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import { formatKst } from "@/lib/datetime";
import { useI18n } from "@/lib/i18n";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, TABLE_CELL, TABLE_HEAD_CELL } from "@/lib/ui-classes";
import { useLoaded } from "@/lib/use-loaded";

// 미리보기에서 로그인 ID 목록을 접어 보여 주는 개수 - 서버는 최대 50개를 준다
const LIST_PREVIEW_COUNT = 20;

interface StatItem {
  label: string;
  value: number;
}

function StatGrid({ testId, items }: { testId: string; items: StatItem[] }) {
  return (
    <dl data-testid={testId} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="rounded-md border border-gray-200 px-3 py-2">
          <dt className="text-xs text-gray-500">{item.label}</dt>
          <dd className="text-base font-semibold text-gray-900">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function LoginIdList({ testId, title, ids }: { testId: string; title: string; ids: string[] }) {
  const { t } = useI18n();
  if (ids.length === 0) return null;
  const shown = ids.slice(0, LIST_PREVIEW_COUNT);
  return (
    <div data-testid={testId} className="space-y-1">
      <h4 className="text-sm font-semibold text-gray-700">{title}</h4>
      <p className="text-sm text-gray-700">
        {shown.join(", ")}
        {ids.length > shown.length && <span className="text-gray-500">{` ${t("hr.list.more", { count: ids.length - shown.length })}`}</span>}
      </p>
    </div>
  );
}

function RunSummary({ summary }: { summary: HrSyncSummary }) {
  const { t } = useI18n();
  return (
    <div data-testid="hr-sync-result" className="space-y-3">
      <h3 className="text-sm font-semibold text-gray-900">{t("hr.result.title")}</h3>
      {summary.aborted_reason !== null && (
        <InlineNotice testId="hr-sync-aborted" tone="error">
          {t("hr.aborted", { reason: t(getAbortReasonKey(summary.aborted_reason)) })}
        </InlineNotice>
      )}
      {summary.mass_departure && (
        <InlineNotice testId="hr-sync-mass-departure" tone="info">
          {t("hr.massDeparture")}
        </InlineNotice>
      )}
      <StatGrid
        testId="hr-sync-result-stats"
        items={[
          { label: t("hr.stat.scanned"), value: summary.scanned },
          { label: t("hr.stat.created"), value: summary.created },
          { label: t("hr.stat.reactivated"), value: summary.reactivated },
          { label: t("hr.stat.deactivated"), value: summary.deactivated },
          { label: t("hr.stat.deleted"), value: summary.deleted },
          { label: t("hr.stat.skipped"), value: summary.skipped },
          { label: t("hr.stat.duplicates"), value: summary.duplicates },
          { label: t("hr.stat.orgMismatches"), value: summary.org_mismatches },
          { label: t("hr.stat.departments"), value: summary.departments_upserted },
        ]}
      />
    </div>
  );
}

function PreviewSummary({ preview }: { preview: HrSyncPreview }) {
  const { t } = useI18n();
  return (
    <div data-testid="hr-sync-preview-result" className="space-y-3">
      <h3 className="text-sm font-semibold text-gray-900">{t("hr.preview.title")}</h3>
      <StatGrid
        testId="hr-sync-preview-stats"
        items={[
          { label: t("hr.stat.scanned"), value: preview.scanned },
          { label: t("hr.stat.skipped"), value: preview.skipped },
          { label: t("hr.stat.wouldUpsert"), value: preview.would_upsert },
          { label: t("hr.stat.wouldDeactivate"), value: preview.would_deactivate },
          { label: t("hr.stat.wouldDelete"), value: preview.would_delete },
          { label: t("hr.stat.orgMismatches"), value: preview.org_mismatches },
          { label: t("hr.stat.truncatedLevels"), value: preview.truncated_levels },
          { label: t("hr.stat.koreanOverwrites"), value: preview.korean_overwrites },
        ]}
      />
      <LoginIdList testId="hr-sync-preview-new" title={t("hr.list.new")} ids={preview.new_login_ids} />
      <LoginIdList testId="hr-sync-preview-delete" title={t("hr.list.delete")} ids={preview.delete_login_ids} />
      <LoginIdList testId="hr-sync-preview-case" title={t("hr.list.caseMismatch")} ids={preview.case_mismatches} />
    </div>
  );
}

type SyncResult = { kind: "run"; summary: HrSyncSummary } | { kind: "preview"; preview: HrSyncPreview };

export function HrSyncPanel() {
  const { t } = useI18n();
  const runs = useLoaded(listHrSyncRuns);
  const [busy, setBusy] = useState<"run" | "preview" | null>(null);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);

  const handleRun = async () => {
    setBusy("run");
    setActionError(null);
    setResult(null);
    try {
      setResult({ kind: "run", summary: await runHrSync() });
      runs.reload();
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(null);
    }
  };

  const handlePreview = async () => {
    setBusy("preview");
    setActionError(null);
    setResult(null);
    try {
      setResult({ kind: "preview", preview: await getHrSyncPreview() });
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section data-testid="hr-sync-panel" className="space-y-6">
      <p className="text-sm text-gray-600">{t("hr.intro")}</p>

      <div className="flex flex-wrap gap-2">
        <button type="button" data-testid="hr-sync-run" className={BUTTON_PRIMARY} disabled={busy !== null} onClick={() => void handleRun()}>
          {busy === "run" ? <Loader2 size={16} strokeWidth={1.5} className="animate-spin" /> : <RefreshCw size={16} strokeWidth={1.5} />}
          {busy === "run" ? t("hr.running") : t("hr.run")}
        </button>
        <button type="button" data-testid="hr-sync-preview" className={BUTTON_SECONDARY} disabled={busy !== null} onClick={() => void handlePreview()}>
          {busy === "preview" ? <Loader2 size={16} strokeWidth={1.5} className="animate-spin" /> : <Eye size={16} strokeWidth={1.5} />}
          {busy === "preview" ? t("hr.previewing") : t("hr.preview")}
        </button>
      </div>

      {actionError !== null && (
        <InlineNotice testId="hr-sync-error" tone="error">
          {humanizeApiError(actionError, t)}
        </InlineNotice>
      )}
      {result?.kind === "run" && <RunSummary summary={result.summary} />}
      {result?.kind === "preview" && <PreviewSummary preview={result.preview} />}

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-900">{t("hr.runs.title")}</h3>
        {runs.error !== null && (
          <InlineNotice testId="hr-sync-runs-error" tone="error">
            {humanizeApiError(runs.error, t)}
          </InlineNotice>
        )}
        {runs.data !== null && runs.data.length === 0 && (
          <p data-testid="hr-sync-runs-empty" className="text-sm text-gray-500">
            {t("hr.runs.empty")}
          </p>
        )}
        {runs.data !== null && runs.data.length > 0 && (
          <div className="overflow-x-auto rounded-md border border-gray-200">
            <table data-testid="hr-sync-runs" className="w-full min-w-[40rem]">
              <thead className="border-b border-gray-200 bg-gray-50">
                <tr>
                  <th className={TABLE_HEAD_CELL}>{t("hr.runs.column.time")}</th>
                  <th className={TABLE_HEAD_CELL}>{t("hr.runs.column.outcome")}</th>
                  <th className={TABLE_HEAD_CELL}>{t("hr.runs.column.scanned")}</th>
                  <th className={TABLE_HEAD_CELL}>{t("hr.runs.column.created")}</th>
                  <th className={TABLE_HEAD_CELL}>{t("hr.runs.column.deactivated")}</th>
                  <th className={TABLE_HEAD_CELL}>{t("hr.runs.column.deleted")}</th>
                  <th className={TABLE_HEAD_CELL}>{t("hr.runs.column.notes")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {runs.data.map((run) => (
                  <tr key={run.id} data-testid={`hr-sync-run-row-${run.id}`}>
                    <td className={`${TABLE_CELL} whitespace-nowrap`}>{formatKst(run.ran_at)}</td>
                    <td className={TABLE_CELL}>{translateOrRaw(t, `outcome.${run.outcome}`, run.outcome)}</td>
                    <td className={TABLE_CELL}>{run.scanned}</td>
                    <td className={TABLE_CELL}>{run.created}</td>
                    <td className={TABLE_CELL}>{run.deactivated}</td>
                    <td className={TABLE_CELL}>{run.deleted}</td>
                    <td className={TABLE_CELL}>
                      {run.mass_departure && <div>{t("hr.massDeparture")}</div>}
                      {describeRunDetail(run.outcome, run.detail, t)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
