// History - 이 Bundle의 작업 기록 전체. 최근 것부터 100개씩 받아 끝에 닿으면 더 오래된 쪽을 이어 받는다(before_id).
// 종류 칩으로 거르고, 줄을 누르면 개요 Activity와 같은 설명 모달(전/후 값)이 뜬다.
"use client";

import { History, RefreshCw } from "lucide-react";
import { useParams } from "next/navigation";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { EventIcon, EventModal, getEventLabel, listEventChanges } from "@/components/manage/event-modal";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadMoreRows } from "@/components/ui/load-more";
import { humanizeApiError } from "@/lib/api-errors";
import { listBundleEvents, type BundleEvent } from "@/lib/api-manage";
import { formatKst } from "@/lib/datetime";
import { EVENT_GROUPS, getEventGroup, type EventGroup } from "@/lib/event-kinds";
import { useI18n } from "@/lib/i18n";

// 한 번에 받는 사건 수
const PAGE_SIZE = 100;

export default function HistoryPage() {
  const { t } = useI18n();
  const bundleId = Number(useParams<{ id: string }>().id);
  const [events, setEvents] = useState<BundleEvent[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<unknown>(null);
  // 같은 쪽을 두 번 받지 않게 - 화면에 그릴 값이 아니라 ref로 쥔다
  const inFlight = useRef(false);
  const [group, setGroup] = useState<EventGroup | "all">("all");
  const [opened, setOpened] = useState<BundleEvent | null>(null);
  const [sentinel, setSentinel] = useState<Element | null>(null);

  async function loadMore() {
    if (inFlight.current || !hasMore) return;
    inFlight.current = true;
    try {
      const last = events[events.length - 1];
      const page = await listBundleEvents(bundleId, PAGE_SIZE, last?.id);
      setError(null);
      setEvents((prev) => [...prev, ...page.filter((item) => !prev.some((known) => known.id === item.id))]);
      setHasMore(page.length === PAGE_SIZE);
    } catch (err) {
      setError(err);
    } finally {
      inFlight.current = false;
    }
  }

  // 효과에서 부를 때는 최신 목록(마지막 id)을 읽는다
  const onReachEnd = useEffectEvent(() => {
    void loadMore();
  });

  // 첫 쪽 - 콜백으로 미뤄 이펙트 안에서 동기로 상태를 바꾸지 않는다(react-ts-patterns §3)
  useEffect(() => {
    void Promise.resolve().then(onReachEnd);
  }, []);

  // 받은 수가 바뀔 때마다 다시 건다 - 거르기 칩으로 보이는 줄이 적어 끝 표지가 계속 화면에 있어도,
  // 새로 건 관찰자의 첫 알림이 다음 쪽을 부른다(한 번 건 관찰자는 교차가 바뀔 때만 알린다)
  useEffect(() => {
    if (!sentinel) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) onReachEnd();
    }, { rootMargin: "400px 0px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [sentinel, events.length]);

  const shown = group === "all" ? events : events.filter((event) => getEventGroup(event.action) === group);
  const isFirstLoad = events.length === 0 && hasMore && error === null;

  return (
    <div className="dense min-h-full bg-surface" data-testid="history">
      <div className="flex min-h-[52px] flex-wrap items-center justify-between gap-3 border-b border-line px-[var(--pad)] py-2">
        <h1 className="page-title ul">{t("stage.history")}</h1>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("history.filter")}>
          {(["all", ...EVENT_GROUPS] as const).map((item) => (
            <button
              key={item}
              type="button"
              className="chip-toggle"
              aria-pressed={group === item}
              data-testid={`history-filter-${item}`}
              onClick={() => setGroup(item)}
            >
              {t(`history.group.${item}`)}
            </button>
          ))}
        </div>
      </div>
      {error !== null && events.length === 0 ? (
        <div className="flex items-center gap-3 px-[var(--pad)] py-6 text-ink-2" data-testid="history-error">
          {humanizeApiError(error, t)}
          <button type="button" className="btn" data-testid="history-retry" onClick={() => void loadMore()}>
            <RefreshCw size={14} strokeWidth={1.5} aria-hidden />
            {t("common.retry")}
          </button>
        </div>
      ) : !isFirstLoad && shown.length === 0 && !hasMore ? (
        <EmptyState icon={History} testId="history-empty" title={t("history.emptyTitle")} body={t("history.emptyBody")} />
      ) : (
        <table className="dtable w-full" data-testid="history-list">
          <thead>
            <tr>
              <th className="w-[150px]">{t("history.colWhen")}</th>
              <th className="w-[220px]">{t("history.colKind")}</th>
              <th>{t("history.colChange")}</th>
              <th className="w-[140px]">{t("history.colWho")}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((event) => {
              const changes = listEventChanges(event.detail ?? {}, t);
              return (
                <tr key={event.id} className="cursor-pointer hover:bg-hover" data-testid={`history-row-${event.id}`} onClick={() => setOpened(event)}>
                  <td className="whitespace-nowrap tabular-nums text-ink-2">{formatKst(event.occurred_at)}</td>
                  <td>
                    <span className="inline-flex items-center gap-2">
                      <span className="event-ic" aria-hidden>
                        <EventIcon action={event.action} />
                      </span>
                      {getEventLabel(event.action, t)}
                    </span>
                  </td>
                  <td className="text-ink-2 [overflow-wrap:anywhere]">
                    {changes.length > 0
                      ? changes.map((row) => `${row.field}: ${row.from} → ${row.to}`).join(" · ")
                      : event.reason || (event.target_ids.length > 0 ? t("history.targets", { n: event.target_ids.length }) : "–")}
                  </td>
                  <td className="font-mono text-[12px] text-ink-2">{event.actor}</td>
                </tr>
              );
            })}
            {hasMore && <LoadMoreRows sentinelRef={setSentinel} columns={4} testId="history-more" />}
          </tbody>
        </table>
      )}
      {opened && <EventModal event={opened} onClose={() => setOpened(null)} />}
    </div>
  );
}
