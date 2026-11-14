// 관리 > 직원 동기화 - HR 원본 동기화 실행·변경 미리보기(드라이런)와 최근 실행 이력. HR 미설정(503)·상류 오류(502)는 사람 말 문구로만 보여 준다.
"use client";

import { Eye, History, Loader2, RefreshCw } from "lucide-react";
import { useState } from "react";

import { InlineNotice } from "@/components/inline-notice";
import { OutcomePill } from "@/components/status";
import { DataList, ListViewToggle, type DataColumn } from "@/components/ui/data-list";
import { EmptyState } from "@/components/ui/empty-state";
import { PanelTitle } from "@/components/admin/panel-title";
import { describeRunDetail, getAbortReasonKey } from "@/lib/admin-format";
import { ApiError, getHrSyncPreview, listHrSyncRuns, runHrSync, type HrSyncPreview, type HrSyncRun, type HrSyncSummary } from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import { formatKst } from "@/lib/datetime";
import { useI18n } from "@/lib/i18n";
import { BUTTON_PRIMARY, BUTTON_SECONDARY } from "@/lib/ui-classes";
import { useListView } from "@/lib/use-list-view";
import { useLoaded } from "@/lib/use-loaded";

const LIST_KEY = "admin-hr-runs";
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
        <div key={item.label} className="rounded-md border border-line px-3 py-2">
          <dt className="text-xs text-ink-3">{item.label}</dt>
          <dd className="text-base font-semibold text-ink">{item.value}</dd>
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
      <h4 className="text-sm font-semibold text-ink-2">{title}</h4>
      <p className="text-sm text-ink-2">
        {shown.join(", ")}
        {ids.length > shown.length && <span className="text-ink-3">{` ${t("hr.list.more", { count: ids.length - shown.length })}`}</span>}
      </p>
    </div>
  );
}

function RunSummary({ summary }: { summary: HrSyncSummary }) {
  const { t } = useI18n();
  return (
    <div data-testid="hr-sync-result" className="space-y-3">
      <h3 className="text-sm font-semibold text-ink">{t("hr.result.title")}</h3>
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
      <h3 className="text-sm font-semibold text-ink">{t("hr.preview.title")}</h3>
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
  const view = useListView(LIST_KEY);
  const countColumn = (key: "scanned" | "created" | "deactivated" | "deleted"): DataColumn<HrSyncRun> => ({
    key,
    header: t(`hr.runs.column.${key}`),
    align: "end",
    cell: (run) => run[key],
  });
  const runColumns: DataColumn<HrSyncRun>[] = [
    { key: "time", header: t("hr.runs.column.time"), card: "title", nowrap: true, cell: (run) => <span className="tabular-nums">{formatKst(run.ran_at)}</span> },
    { key: "outcome", header: t("hr.runs.column.outcome"), card: "badge", nowrap: true, cell: (run) => <OutcomePill outcome={run.outcome} /> },
    countColumn("scanned"),
    countColumn("created"),
    countColumn("deactivated"),
    countColumn("deleted"),
    {
      key: "notes",
      header: t("hr.runs.column.notes"),
      card: "body",
      grow: true,
      minWidth: 160,
      cell: (run) => (
        <>
          {run.mass_departure && <div>{t("hr.massDeparture")}</div>}
          {describeRunDetail(run.outcome, run.detail, t)}
        </>
      ),
    },
  ];
  // 목록 응답이 503이면 이 서버는 HR 연결이 없다 - 실행·미리보기를 막고 한 번만 안내한다
  const isNotConfigured = runs.error instanceof ApiError && runs.error.status === 503;
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
      <PanelTitle title={t("admin.tab.directory")} info={t("hr.intro")} testId="hr-info" />

      {isNotConfigured && (
        <InlineNotice testId="hr-sync-not-configured" tone="info">
          {t("hr.notConfigured")}
        </InlineNotice>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" data-testid="hr-sync-run" className={BUTTON_PRIMARY} disabled={busy !== null || isNotConfigured} onClick={() => void handleRun()}>
          {busy === "run" ? <Loader2 size={16} strokeWidth={1.5} className="animate-spin" /> : <RefreshCw size={16} strokeWidth={1.5} />}
          {busy === "run" ? t("hr.running") : t("hr.run")}
        </button>
        <button type="button" data-testid="hr-sync-preview" className={BUTTON_SECONDARY} disabled={busy !== null || isNotConfigured} onClick={() => void handlePreview()}>
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
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-ink">{t("hr.runs.title")}</h3>
          {!isNotConfigured && <ListViewToggle listKey={LIST_KEY} view={view} testId="hr-sync-runs-view" />}
        </div>
        {runs.error !== null && !isNotConfigured && (
          <InlineNotice testId="hr-sync-runs-error" tone="error">
            {humanizeApiError(runs.error, t)}
          </InlineNotice>
        )}
        {runs.data !== null && runs.data.length === 0 && (
          <EmptyState icon={History} testId="hr-sync-runs-empty" title={t("hr.runs.empty")} compact />
        )}
        {runs.data !== null && runs.data.length > 0 && (
          <DataList
            view={view}
            rows={runs.data}
            columns={runColumns}
            getRowKey={(run) => run.id}
            testId="hr-sync-runs"
            rowTestId={(run) => `hr-sync-run-row-${run.id}`}
            cardMinWidth={300}
            framed
          />
        )}
      </div>
    </section>
  );
}
