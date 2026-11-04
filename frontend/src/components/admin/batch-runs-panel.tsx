// 관리 > 배치 작업 - 작업별 가장 최근 결과(성공/실패 각각 최신 1행). 직원 동기화·DB 백업 같은 백그라운드 작업이 잘 도는지 한눈에 본다.
"use client";

import { InlineNotice } from "@/components/inline-notice";
import { describeRunDetail, translateOrRaw } from "@/lib/admin-format";
import { listBatchRuns } from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import { formatKst } from "@/lib/datetime";
import { useI18n } from "@/lib/i18n";
import { TABLE_CELL, TABLE_HEAD_CELL } from "@/lib/ui-classes";
import { useLoaded } from "@/lib/use-loaded";

export function BatchRunsPanel() {
  const { t } = useI18n();
  const runs = useLoaded(listBatchRuns);

  return (
    <section data-testid="batch-runs-panel" className="space-y-4">
      <p className="text-sm text-gray-600">{t("batch.intro")}</p>

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
        <div className="overflow-x-auto rounded-md border border-gray-200">
          <table data-testid="batch-table" className="w-full min-w-[36rem]">
            <thead className="border-b border-gray-200 bg-gray-50">
              <tr>
                <th className={TABLE_HEAD_CELL}>{t("batch.column.job")}</th>
                <th className={TABLE_HEAD_CELL}>{t("batch.column.outcome")}</th>
                <th className={TABLE_HEAD_CELL}>{t("batch.column.time")}</th>
                <th className={TABLE_HEAD_CELL}>{t("batch.column.detail")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {runs.data.map((run) => (
                <tr key={`${run.job}-${run.outcome}`} data-testid={`batch-row-${run.job}-${run.outcome}`}>
                  <td className={TABLE_CELL}>{translateOrRaw(t, `batch.job.${run.job}`, run.job)}</td>
                  <td className={TABLE_CELL}>{translateOrRaw(t, `outcome.${run.outcome}`, run.outcome)}</td>
                  <td className={`${TABLE_CELL} whitespace-nowrap`}>{formatKst(run.ran_at)}</td>
                  <td className={TABLE_CELL}>{describeRunDetail(run.outcome, run.detail, t)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
