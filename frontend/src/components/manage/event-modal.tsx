// 작업 기록 한 줄의 설명 - 누가·언제·무엇을, 바뀐 값이 남아 있으면 전/후까지. 개요 Activity와 History가 같이 쓴다.
"use client";

import Link from "next/link";
import { createElement } from "react";

import { Modal } from "@/components/modal";
import type { BundleEvent, EventDetail } from "@/lib/api-manage";
import { formatKst } from "@/lib/datetime";
import { getEventIcon } from "@/lib/event-kinds";
import { useI18n } from "@/lib/i18n";

type TFunc = (key: string, vars?: Record<string, string | number>) => string;

export function getEventLabel(action: string, t: TFunc): string {
  const key = `event.${action}`;
  return t(key) === key ? action : t(key);
}

function formatValue(value: string | boolean, t: TFunc): string {
  if (typeof value === "boolean") return value ? t("common.yes") : t("common.no");
  return value === "" ? t("event.empty") : value;
}

/** 전/후 줄 - [칸 이름, 전, 후] */
export function listEventChanges(detail: EventDetail, t: TFunc): Array<{ field: string; from: string; to: string }> {
  const rows: Array<{ field: string; from: string; to: string }> = [];
  for (const field of ["title", "description", "is_synthetic"] as const) {
    const change = detail[field];
    if (change) rows.push({ field: t(`event.field.${field}`), from: formatValue(change.from, t), to: formatValue(change.to, t) });
  }
  for (const member of detail.added ?? []) rows.push({ field: member.login_id, from: "–", to: t(`role.${member.role}`) });
  for (const loginId of detail.removed ?? []) rows.push({ field: loginId, from: t("event.member"), to: "–" });
  for (const member of detail.role_changed ?? []) rows.push({ field: member.login_id, from: t(`role.${member.from}`), to: t(`role.${member.to}`) });
  return rows;
}

/** 사건 종류 아이콘 - 종류마다 다른 lucide 아이콘을 그린다 */
export function EventIcon({ action, size = 14 }: { action: string; size?: number }) {
  return createElement(getEventIcon(action), { size, strokeWidth: 1.5, "aria-hidden": true });
}

export function EventModal({ event, historyHref, onClose }: { event: BundleEvent; historyHref?: string; onClose: () => void }) {
  const { t } = useI18n();
  const changes = listEventChanges(event.detail ?? {}, t);
  return (
    <Modal
      title={getEventLabel(event.action, t)}
      testId="event-modal"
      onClose={onClose}
      footer={
        <>
          {historyHref && (
            <Link href={historyHref} className="btn ghost mr-auto" data-testid="event-modal-history" onClick={onClose}>
              {t("stage.history")}
            </Link>
          )}
          <button type="button" className="btn" data-testid="event-modal-close" onClick={onClose}>
            {t("common.close")}
          </button>
        </>
      }
    >
      <div className="flex items-center gap-3">
        <span className="event-ic" aria-hidden>
          <EventIcon action={event.action} size={16} />
        </span>
        <dl className="grid grid-cols-[72px_minmax(0,1fr)] gap-x-3 gap-y-1 text-[13px]">
          <dt className="text-ink-3">{t("event.who")}</dt>
          <dd className="m-0 font-mono">{event.actor}</dd>
          <dt className="text-ink-3">{t("event.when")}</dt>
          <dd className="m-0 tabular-nums">{formatKst(event.occurred_at)}</dd>
        </dl>
      </div>
      {event.reason && <p className="rounded-md bg-sunken px-3 py-2 text-ink-2">{event.reason}</p>}
      {changes.length > 0 && (
        <table className="w-full text-[13px]" data-testid="event-modal-changes">
          <thead>
            <tr className="text-left text-xs text-ink-3">
              <th className="py-1 font-normal" />
              <th className="py-1 font-normal">{t("event.before")}</th>
              <th className="py-1 font-normal">{t("event.after")}</th>
            </tr>
          </thead>
          <tbody>
            {changes.map((row, index) => (
              <tr key={`${row.field}-${index}`} className="border-t border-line align-top">
                <td className="py-1.5 pr-3 text-ink-3">{row.field}</td>
                <td className="py-1.5 pr-3 text-ink-3 line-through decoration-ink-4 [overflow-wrap:anywhere]">{row.from}</td>
                <td className="py-1.5 [overflow-wrap:anywhere]">{row.to}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}
