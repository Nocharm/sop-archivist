// 관리 > 권한 > 변경 기록 - 역할·부여 변경을 최신순으로 보여 준다(누가·언제·무엇을). 한 줄 요약은 lib/admin-format이 만든다.
"use client";

import { InlineNotice } from "@/components/inline-notice";
import { buildAuditSummary, translateOrRaw } from "@/lib/admin-format";
import { listAudit } from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import { formatKst } from "@/lib/datetime";
import { useI18n } from "@/lib/i18n";
import { TABLE_CELL, TABLE_HEAD_CELL } from "@/lib/ui-classes";
import { useLoaded } from "@/lib/use-loaded";

// 한 번에 보여 주는 최근 변경 수 - 서버 기본값과 같다
const AUDIT_LIMIT = 100;

export function AccessAudit() {
  const { t } = useI18n();
  const audit = useLoaded(() => listAudit(AUDIT_LIMIT));

  return (
    <section data-testid="access-audit" className="space-y-4">
      <p className="text-sm text-gray-600">{t("audit.intro")}</p>

      {audit.error !== null && (
        <InlineNotice testId="audit-error" tone="error">
          {humanizeApiError(audit.error, t)}
        </InlineNotice>
      )}
      {audit.data !== null && audit.data.length === 0 && (
        <p data-testid="audit-empty" className="text-sm text-gray-500">
          {t("audit.empty")}
        </p>
      )}
      {audit.data !== null && audit.data.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-gray-200">
          <table data-testid="audit-table" className="w-full min-w-[40rem]">
            <thead className="border-b border-gray-200 bg-gray-50">
              <tr>
                <th className={TABLE_HEAD_CELL}>{t("audit.column.time")}</th>
                <th className={TABLE_HEAD_CELL}>{t("audit.column.actor")}</th>
                <th className={TABLE_HEAD_CELL}>{t("audit.column.action")}</th>
                <th className={TABLE_HEAD_CELL}>{t("audit.column.summary")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {audit.data.map((event) => (
                // data-action은 식별 전용(스모크가 어떤 변경인지 읽는다) - 화면 문구는 번역된 작업 이름
                <tr key={event.id} data-testid={`audit-row-${event.id}`} data-action={event.action}>
                  <td className={`${TABLE_CELL} whitespace-nowrap`}>{formatKst(event.occurred_at)}</td>
                  <td className={TABLE_CELL}>{event.actor}</td>
                  <td className={`${TABLE_CELL} whitespace-nowrap`}>{translateOrRaw(t, `audit.action.${event.action}`, event.action)}</td>
                  <td className={TABLE_CELL}>{buildAuditSummary(event, t)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
