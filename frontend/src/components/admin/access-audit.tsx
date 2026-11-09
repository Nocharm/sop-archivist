// 관리 > 권한 > 변경 기록 - 역할·부여 변경을 최신순으로 보여 준다(누가·언제·무엇을). 한 줄 요약은 lib/admin-format이 만든다.
"use client";

import { InlineNotice } from "@/components/inline-notice";
import { DataList, ListViewToggle, type DataColumn } from "@/components/ui/data-list";
import { buildAuditSummary, translateOrRaw } from "@/lib/admin-format";
import { listAudit, type AuditEvent } from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import { formatKst } from "@/lib/datetime";
import { useI18n } from "@/lib/i18n";
import { useListView } from "@/lib/use-list-view";
import { useLoaded } from "@/lib/use-loaded";

// 한 번에 보여 주는 최근 변경 수 - 서버 기본값과 같다
const AUDIT_LIMIT = 100;
const LIST_KEY = "admin-audit";

export function AccessAudit() {
  const { t } = useI18n();
  const audit = useLoaded(() => listAudit(AUDIT_LIMIT));
  const view = useListView(LIST_KEY);

  const columns: DataColumn<AuditEvent>[] = [
    { key: "action", header: t("audit.column.action"), card: "title", nowrap: true, cell: (event) => translateOrRaw(t, `audit.action.${event.action}`, event.action) },
    { key: "time", header: t("audit.column.time"), card: "badge", nowrap: true, cell: (event) => <span className="tabular-nums font-normal text-ink-2">{formatKst(event.occurred_at)}</span> },
    { key: "actor", header: t("audit.column.actor"), cell: (event) => event.actor },
    { key: "summary", header: t("audit.column.summary"), card: "body", grow: true, minWidth: 220, cell: (event) => buildAuditSummary(event, t) },
  ];

  return (
    <section data-testid="access-audit" className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-gray-600">{t("audit.intro")}</p>
        <ListViewToggle listKey={LIST_KEY} view={view} testId="audit-view" />
      </div>

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
        <DataList
          view={view}
          rows={audit.data}
          columns={columns}
          getRowKey={(event) => event.id}
          testId="audit-table"
          rowTestId={(event) => `audit-row-${event.id}`}
          // data-action은 식별 전용(스모크가 어떤 변경인지 읽는다) - 화면 문구는 번역된 작업 이름
          getRowData={(event) => ({ "data-action": event.action })}
          cardMinWidth={320}
          framed
        />
      )}
    </section>
  );
}
