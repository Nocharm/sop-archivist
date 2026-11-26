// 관리 > 권한 > 변경 기록 - 역할·부여 변경을 최신순으로 보여 준다(누가·언제·무엇을). 한 줄 요약은 lib/admin-format이 만든다.
"use client";

import { ScrollText, Search } from "lucide-react";
import { useState } from "react";

import { InlineNotice } from "@/components/inline-notice";
import { ClampText } from "@/components/ui/clamp-text";
import { DataList, ListViewToggle, type DataColumn } from "@/components/ui/data-list";
import { EmptyState } from "@/components/ui/empty-state";
import { PanelTitle } from "@/components/admin/panel-title";
import { buildAuditSummary, translateOrRaw } from "@/lib/admin-format";
import { AUDIT_KINDS, filterAudit, getAuditDay, getAuditKind, type AuditKind } from "@/lib/audit-model";
import { listAudit, type AuditEvent } from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import { formatKst } from "@/lib/datetime";
import { useI18n } from "@/lib/i18n";
import { useListView } from "@/lib/use-list-view";
import { useCursorList } from "@/lib/use-cursor-list";

// 한 번에 이어 받는 기록 수
const PAGE = 30;
const LIST_KEY = "admin-audit";

export function AccessAudit() {
  const { t, lang } = useI18n();
  const { items, hasMore, error, sentinelRef, retry } = useCursorList<AuditEvent>((last) => listAudit(PAGE, last?.id), PAGE);
  const view = useListView(LIST_KEY);
  const [text, setText] = useState("");
  const [kind, setKind] = useState<AuditKind>("all");

  const getAction = (event: AuditEvent) => translateOrRaw(t, `audit.action.${event.action}`, event.action);
  const rows = filterAudit(items, kind, text, (event) => `${getAction(event)} ${buildAuditSummary(event, t)} ${event.actor}`);

  const columns: DataColumn<AuditEvent>[] = [
    {
      key: "action",
      header: t("audit.column.action"),
      card: "title",
      nowrap: true,
      cell: (event) => (
        <span className="inline-flex items-center gap-2">
          <span className="adm-dot" data-kind={getAuditKind(event.action) ?? undefined} aria-hidden />
          {getAction(event)}
        </span>
      ),
    },
    { key: "summary", header: t("audit.column.summary"), card: "body", grow: true, minWidth: 220, cell: (event) => <ClampText text={buildAuditSummary(event, t)} /> },
    { key: "actor", header: t("audit.column.actor"), nowrap: true, cell: (event) => event.actor },
    { key: "time", header: t("audit.column.time"), card: "badge", align: "end", nowrap: true, cell: (event) => <span className="tabular-nums font-normal text-ink-2">{formatKst(event.occurred_at).slice(11)}</span> },
  ];
  const dayLabel = new Intl.DateTimeFormat(lang === "ko" ? "ko-KR" : "en-US", { timeZone: "Asia/Seoul", year: "numeric", month: "short", day: "numeric", weekday: "short" });

  return (
    <section data-testid="access-audit" className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <PanelTitle title={t("admin.sub.audit")} info={t("audit.intro")} testId="audit-info" />
        <ListViewToggle listKey={LIST_KEY} view={view} testId="audit-view" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="adm-search w-[min(340px,100%)]">
          <Search size={14} strokeWidth={1.5} aria-hidden />
          <input type="text" data-testid="audit-search" value={text} maxLength={200} placeholder={t("audit.search")} aria-label={t("audit.search")} onChange={(event) => setText(event.target.value)} />
        </label>
        <span className="adm-pills" role="group" aria-label={t("audit.filter.label")}>
          {AUDIT_KINDS.map((key) => (
            <button key={key} type="button" className="adm-pill" aria-pressed={kind === key} data-testid={`audit-filter-${key}`} onClick={() => setKind(key)}>
              {key !== "all" && <span className="adm-dot" data-kind={key} aria-hidden />}
              {t(`audit.filter.${key}`)}
            </button>
          ))}
        </span>
        <span className="flex-1" />
        <span className="adm-note" data-testid="audit-shown">
          {t(hasMore ? "audit.shownMore" : "audit.shownAll", { count: rows.length })}
        </span>
      </div>

      {error !== null && (
        <InlineNotice testId="audit-error" tone="error">
          {humanizeApiError(error, t)}{" "}
          <button type="button" className="adm-link" data-testid="audit-retry" onClick={retry}>
            {t("common.retry")}
          </button>
        </InlineNotice>
      )}
      {!hasMore && error === null && rows.length === 0 && (
        <EmptyState icon={ScrollText} testId="audit-empty" title={items.length === 0 ? t("audit.empty") : t("audit.noMatch")} compact />
      )}
      {rows.length > 0 && (
        <DataList
          view={view}
          rows={rows}
          columns={columns}
          getRowKey={(event) => event.id}
          testId="audit-table"
          rowTestId={(event) => `audit-row-${event.id}`}
          // data-action은 식별 전용(스모크가 어떤 변경인지 읽는다) - 화면 문구는 번역된 작업 이름
          getRowData={(event) => ({ "data-action": event.action })}
          getRowGroup={(event) => ({ key: getAuditDay(event), label: dayLabel.format(new Date(event.occurred_at)) })}
          cardMinWidth={320}
          framed
        />
      )}
      {/* 이어 불러오기 - 거른 결과가 적어도 끝 표지가 보이는 동안 계속 받는다 */}
      {hasMore && <div ref={sentinelRef} className="adm-more" data-testid="audit-more" aria-hidden />}
    </section>
  );
}
