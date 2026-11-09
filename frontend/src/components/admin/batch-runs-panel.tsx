// 관리 > 배치 작업 - 작업별 가장 최근 결과(성공/실패 각각 최신 1행). 직원 동기화·DB 백업 같은 백그라운드 작업이 잘 도는지 한눈에 본다.
"use client";

import { InlineNotice } from "@/components/inline-notice";
import { OutcomePill } from "@/components/status";
import { DataList, ListViewToggle, type DataColumn } from "@/components/ui/data-list";
import { describeRunDetail, translateOrRaw } from "@/lib/admin-format";
import { listBatchRuns, type BatchRun } from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import { formatKst } from "@/lib/datetime";
import { useI18n } from "@/lib/i18n";
import { useListView } from "@/lib/use-list-view";
import { useLoaded } from "@/lib/use-loaded";

const LIST_KEY = "admin-batch";

export function BatchRunsPanel() {
  const { t } = useI18n();
  const runs = useLoaded(listBatchRuns);
  const view = useListView(LIST_KEY);

  const columns: DataColumn<BatchRun>[] = [
    { key: "job", header: t("batch.column.job"), card: "title", cell: (run) => translateOrRaw(t, `batch.job.${run.job}`, run.job) },
    { key: "outcome", header: t("batch.column.outcome"), card: "badge", nowrap: true, cell: (run) => <OutcomePill outcome={run.outcome} /> },
    { key: "time", header: t("batch.column.time"), nowrap: true, cell: (run) => <span className="tabular-nums">{formatKst(run.ran_at)}</span> },
    { key: "detail", header: t("batch.column.detail"), card: "body", grow: true, minWidth: 200, cell: (run) => describeRunDetail(run.outcome, run.detail, t) },
  ];

  return (
    <section data-testid="batch-runs-panel" className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-gray-600">{t("batch.intro")}</p>
        <ListViewToggle listKey={LIST_KEY} view={view} testId="batch-view" />
      </div>

      {runs.error !== null && (
        <InlineNotice testId="batch-error" tone="error">
          {humanizeApiError(runs.error, t)}
        </InlineNotice>
      )}
      {runs.data !== null && runs.data.length === 0 && (
        <p data-testid="batch-empty" className="text-sm text-gray-500">
          {t("batch.empty")}
        </p>
      )}
      {runs.data !== null && runs.data.length > 0 && (
        <DataList
          view={view}
          rows={runs.data}
          columns={columns}
          getRowKey={(run) => `${run.job}-${run.outcome}`}
          testId="batch-table"
          rowTestId={(run) => `batch-row-${run.job}-${run.outcome}`}
          cardMinWidth={300}
          framed
        />
      )}
    </section>
  );
}
