// 관리 > 배치 작업 - 작업마다 한 줄에 성공·실패의 최근 결과. 직원 동기화·DB 백업 같은 백그라운드 작업이 잘 도는지 한눈에 본다.
"use client";

import { Clock3 } from "lucide-react";
import { InlineNotice } from "@/components/inline-notice";
import { OutcomePill } from "@/components/status";
import { DataList, ListViewToggle, type DataColumn } from "@/components/ui/data-list";
import { EmptyState } from "@/components/ui/empty-state";
import { PanelTitle } from "@/components/admin/panel-title";
import { describeRunDetail, translateOrRaw } from "@/lib/admin-format";
import { listBatchRuns } from "@/lib/api";
import { groupBatchRuns, type BatchJob } from "@/lib/batch-jobs";
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

  // 서버는 (작업, 결과)마다 최신 한 줄을 준다 - 한 작업을 한 줄로, 결과는 옆으로 나란히
  const jobs = groupBatchRuns(runs.data ?? []);
  const columns: DataColumn<BatchJob>[] = [
    { key: "job", header: t("batch.column.job"), card: "title", nowrap: true, cell: (item) => translateOrRaw(t, `batch.job.${item.job}`, item.job) },
    {
      key: "outcome",
      header: t("batch.column.outcome"),
      card: "badge",
      nowrap: true,
      cell: (item) => (
        <span className="inline-flex flex-wrap items-center gap-x-4 gap-y-1">
          {item.runs.map((run) => (
            <span key={run.outcome} className="inline-flex items-center gap-2" data-testid={`batch-row-${item.job}-${run.outcome}`}>
              <OutcomePill outcome={run.outcome} />
              <span className="tabular-nums text-ink-2">{formatKst(run.ran_at)}</span>
            </span>
          ))}
        </span>
      ),
    },
    { key: "detail", header: t("batch.column.detail"), card: "body", grow: true, minWidth: 200, cell: (item) => describeRunDetail(item.latest.outcome, item.latest.detail, t) },
  ];

  return (
    <section data-testid="batch-runs-panel" className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <PanelTitle title={t("admin.tab.batch")} info={t("batch.intro")} testId="batch-info" />
        <ListViewToggle listKey={LIST_KEY} view={view} testId="batch-view" />
      </div>

      {runs.error !== null && (
        <InlineNotice testId="batch-error" tone="error">
          {humanizeApiError(runs.error, t)}
        </InlineNotice>
      )}
      {runs.data !== null && runs.data.length === 0 && (
        <EmptyState icon={Clock3} testId="batch-empty" title={t("batch.empty")} compact />
      )}
      {runs.data !== null && runs.data.length > 0 && (
        <DataList
          view={view}
          rows={jobs}
          columns={columns}
          getRowKey={(item) => item.job}
          testId="batch-table"
          rowTestId={(item) => `batch-job-${item.job}`}
          cardMinWidth={300}
          framed
        />
      )}
    </section>
  );
}
