// 상단 바 AI 작업 목록 - 내가 속한 Bundle의 대기·실행 중과 하루 안에 끝난 요청을 Bundle → 요청으로 묶어 보인다.
// 요청 한 줄: 종류·문서·진행 n/N·경과·상태와 그 이유(실패 코드·반영 안 됨·취소), 오래 걸림, 취소·다시 시도(내 요청만), 결과를 보는 화면으로 가기.
"use client";

import { ArrowUpRight, Ban, CircleAlert, CircleCheck, Clock3, Loader2, RotateCcw, Square } from "lucide-react";
import Link from "next/link";
import { useEffect, useEffectEvent, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

import { isTopEscLayer, placeBelow, popEscLayer, pushEscLayer, type FloatingPos } from "@/components/ui/floating";
import { BusyLabel, Truncate } from "@/components/ui/motion";
import { Tooltip } from "@/components/ui/tooltip";
import { humanizeApiError } from "@/lib/api-errors";
import { cancelAi, retryAi } from "@/lib/api-manage";
import type { RecentAiRequest } from "@/lib/api-sop";
import {
  formatElapsed,
  getKindStage,
  getRequestDocument,
  getRequestElapsedMs,
  getRequestOutcome,
  getRequestProgress,
  getServerNow,
  groupRequestsByBundle,
  isRequestActive,
  isRequestSlow,
  type RequestOutcome,
} from "@/lib/ai-jobs-model";
import { markFailuresSeen, pokeAiJobs, type AiJobsSnapshot } from "@/lib/ai-jobs-store";
import { formatKstShort } from "@/lib/datetime";
import { useI18n } from "@/lib/i18n";
import { getStageHref } from "@/lib/stages";

// 경과 시간을 다시 그리는 간격(ms) - 목록이 열려 있을 때만 돈다
const TICK_MS = 1000;
// 목록 왼쪽에 알림을 둘 최소 폭(px) - 이보다 좁으면 목록 아래로 내린다
const TOAST_MIN_WIDTH = 220;
const TOAST_GAP = 8;
const PAGE_EDGE = 16;
const TOAST_VARS = ["--toast-right", "--toast-width", "--toast-top"] as const;

/** 목록이 떠 있는 동안 알림(오른쪽 위, 목록보다 위층)이 목록을 덮지 않게 비켜 놓는다 - 왼쪽에 자리가 있으면 왼쪽, 없으면 아래 */
function moveToastsAside(panel: DOMRect, pos: FloatingPos): void {
  const style = document.documentElement.style;
  const room = pos.left - TOAST_GAP - PAGE_EDGE;
  if (room >= TOAST_MIN_WIDTH) {
    style.setProperty("--toast-right", `${window.innerWidth - pos.left + TOAST_GAP}px`);
    style.setProperty("--toast-width", `${Math.min(380, room)}px`);
  } else {
    style.setProperty("--toast-top", `${pos.top + panel.height + TOAST_GAP}px`);
  }
}

function restoreToasts(): void {
  for (const name of TOAST_VARS) document.documentElement.style.removeProperty(name);
}

/** 취소·다시 시도 결과 - 알림 대신 그 줄 안에 보인다(알림이 목록을 덮지 않게) */
interface RowResult {
  requestId: string;
  tone: "ok" | "error";
  text: string;
}

const OUTCOME_ICON: Record<RequestOutcome, ReactNode> = {
  running: <Loader2 size={14} strokeWidth={1.5} className="shrink-0 animate-spin text-accent" aria-hidden />,
  queued: <Clock3 size={14} strokeWidth={1.5} className="shrink-0 text-ink-3" aria-hidden />,
  failed: <CircleAlert size={14} strokeWidth={1.5} className="shrink-0 text-danger" aria-hidden />,
  stale: <Ban size={14} strokeWidth={1.5} className="shrink-0 text-ink-3" aria-hidden />,
  cancelled: <Ban size={14} strokeWidth={1.5} className="shrink-0 text-ink-3" aria-hidden />,
  done: <CircleCheck size={14} strokeWidth={1.5} className="shrink-0 text-accent" aria-hidden />,
};

interface AiJobsPopoverProps {
  anchorRef: RefObject<HTMLElement | null>;
  snapshot: AiJobsSnapshot;
  onClose: () => void;
}

export function AiJobsPopover({ anchorRef, snapshot, onClose }: AiJobsPopoverProps) {
  const { t } = useI18n();
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<FloatingPos | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const [working, setWorking] = useState<string | null>(null);
  const [result, setResult] = useState<RowResult | null>(null);
  const requestClose = useEffectEvent(() => onClose());
  const { data } = snapshot;

  // 메뉴와 같은 층 규칙 - 잰 뒤에 놓고, 바깥 누르기·Esc로 닫고, 닫히면 포커스를 연 곳으로 돌린다
  useEffect(() => {
    const layer = pushEscLayer();
    const anchor = anchorRef.current;
    const panel = panelRef.current;
    const frame = requestAnimationFrame(() => {
      if (!panel || !anchor) return;
      const rect = panel.getBoundingClientRect();
      const next = placeBelow(anchor.getBoundingClientRect(), { width: rect.width, height: rect.height }, "end");
      setPos(next);
      moveToastsAside(rect, next);
      panel.focus({ preventScroll: true });
    });
    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (panel?.contains(target) || anchor?.contains(target)) return;
      // 알림(z가 목록보다 위)을 닫는 클릭은 목록을 닫지 않는다
      if (target instanceof Element && target.closest(".toast-stack")) return;
      requestClose();
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && isTopEscLayer(layer)) {
        event.stopPropagation();
        requestClose();
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      cancelAnimationFrame(frame);
      restoreToasts();
      popEscLayer(layer);
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKey);
      if (!document.activeElement || document.activeElement === document.body || panel?.contains(document.activeElement)) {
        anchor?.focus({ preventScroll: true });
      }
    };
  }, [anchorRef]);

  useEffect(() => {
    const id = window.setInterval(() => setClock(Date.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  // 열어 본 실패는 배지에서 뺀다 - 열려 있는 동안 새로 실패한 것도 보이는 것이니 같다
  useEffect(() => {
    const failed = (data?.requests ?? []).filter((request) => !isRequestActive(request) && request.jobs.failed > 0).map((request) => request.request_id);
    markFailuresSeen(failed);
  }, [data]);

  const serverNow = data ? getServerNow(data.server_time, snapshot.receivedAt, clock) : clock;
  const groups = groupRequestsByBundle(data?.requests ?? []);

  function translateError(code: string): string {
    const key = `ai.error.${code}`;
    const text = t(key);
    return text === key ? code : text;
  }

  // 취소·다시 시도는 묶음의 종류 단위다(요청 단위가 아니다) - 요청에 든 종류마다 보낸다.
  // 한 종류가 실패해도 앞 종류에서 된 수는 알리고, 바뀐 것이 보이게 목록을 바로 다시 묻는다
  async function run(request: RecentAiRequest, action: "cancel" | "retry") {
    setWorking(`${request.request_id}:${action}`);
    setResult(null);
    let count = 0;
    try {
      for (const kind of request.kinds) {
        if (action === "cancel") count += (await cancelAi(request.bundle_id, kind)).cancelled;
        else count += (await retryAi(request.bundle_id, kind)).queued;
      }
      setResult({ requestId: request.request_id, tone: "ok", text: action === "cancel" ? t("ai.cancelled", { n: count }) : t("ai.retried", { n: count }) });
    } catch (err) {
      const done = count > 0 ? `${action === "cancel" ? t("ai.cancelled", { n: count }) : t("ai.retried", { n: count })} · ` : "";
      setResult({ requestId: request.request_id, tone: "error", text: done + humanizeApiError(err, t) });
    } finally {
      setWorking(null);
      pokeAiJobs();
    }
  }

  function renderRequest(request: RecentAiRequest) {
    const outcome = getRequestOutcome(request);
    const progress = getRequestProgress(request);
    const kindLabel = t(`ai.kind.${request.kind}`);
    const documentName = getRequestDocument(request);
    const isActive = isRequestActive(request);
    const isSlow = isRequestSlow(request, serverNow);
    const rowResult = result?.requestId === request.request_id ? result : null;
    const time = isActive ? formatElapsed(getRequestElapsedMs(request, serverNow)) : formatKstShort(request.finished_at);
    const stage = getKindStage(request.kind);
    const testId = `ai-jobs-request-${request.request_id}`;
    const busy = working?.startsWith(`${request.request_id}:`) ?? false;
    const failedReasons = Object.entries(request.error_counts)
      .filter(([, n]) => n > 0)
      .map(([code, n]) => (n > 1 ? `${translateError(code)} ×${n}` : translateError(code)))
      .join(", ");
    return (
      <li key={request.request_id} className="ai-pop-req" data-testid={testId} data-outcome={outcome}>
        <div className="flex min-w-0 items-center gap-2">
          {OUTCOME_ICON[outcome]}
          <span className="shrink-0 font-medium">{kindLabel}</span>
          {documentName && <Truncate text={documentName} className="min-w-0 text-ink-2" />}
          <span className="flex-1" />
          <Tooltip label={t("aiJobs.progressTip", { done: progress.done, total: progress.total })} align="end">
            <span className="shrink-0 font-mono text-[12px] tabular-nums text-ink-2" tabIndex={0} data-testid={`${testId}-progress`}>
              {progress.done} / {progress.total}
            </span>
          </Tooltip>
        </div>
        <div className="flex min-w-0 items-center gap-x-2 pl-[22px] text-[12px] text-ink-3">
          <span className="shrink-0 tabular-nums" data-testid={`${testId}-status`}>
            {t(`status.job.${outcome}`)} · {time}
          </span>
          {!request.requested_by_me && <span className="min-w-0 truncate">{t("aiJobs.otherMember")}</span>}
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {request.requested_by_me && isActive && (
              <Tooltip label={t("aiJobs.cancelTip", { kind: kindLabel })} align="end">
                <button type="button" className="btn h-7" disabled={working !== null} data-testid={`${testId}-cancel`} onClick={() => void run(request, "cancel")}>
                  <BusyLabel busy={busy && working?.endsWith(":cancel") === true} icon={<Square size={12} strokeWidth={1.5} aria-hidden />} label={t("aiJobs.cancel")} />
                </button>
              </Tooltip>
            )}
            {request.requested_by_me && !isActive && request.jobs.failed > 0 && (
              <Tooltip label={t("aiJobs.retryTip", { kind: kindLabel })} align="end">
                <button type="button" className="btn h-7" disabled={working !== null} data-testid={`${testId}-retry`} onClick={() => void run(request, "retry")}>
                  <BusyLabel busy={busy && working?.endsWith(":retry") === true} icon={<RotateCcw size={12} strokeWidth={1.5} aria-hidden />} label={t("aiJobs.retry")} />
                </button>
              </Tooltip>
            )}
            <Tooltip label={t("aiJobs.openTip", { screen: t(`stage.${stage}`) })} align="end">
              <Link href={getStageHref(request.bundle_id, stage)} className="btn ghost icon h-7 w-7" aria-label={t("aiJobs.openTip", { screen: t(`stage.${stage}`) })} data-testid={`${testId}-open`} onClick={onClose}>
                <ArrowUpRight size={14} strokeWidth={1.5} aria-hidden />
              </Link>
            </Tooltip>
          </div>
        </div>
        {(request.jobs.failed > 0 || (!isActive && (request.jobs.stale > 0 || request.jobs.cancelled > 0)) || isSlow) && (
          <div className="grid gap-0.5 pl-[22px] text-[12px]">
            {request.jobs.failed > 0 && (
              <p className="text-danger" data-testid={`${testId}-failed`}>
                {t("aiJobs.failedDetail", { n: request.jobs.failed, reason: failedReasons })}
              </p>
            )}
            {!isActive && request.jobs.stale > 0 && <p className="text-ink-2">{t("aiJobs.staleDetail", { n: request.jobs.stale })}</p>}
            {!isActive && request.jobs.cancelled > 0 && <p className="text-ink-2">{t("aiJobs.cancelledDetail", { n: request.jobs.cancelled })}</p>}
            {isSlow && (
              <p className="text-st-hold" data-testid={`${testId}-slow`}>
                {t("aiJobs.slow")}
              </p>
            )}
          </div>
        )}
        {rowResult && (
          <p className={`pl-[22px] text-[12px] ${rowResult.tone === "error" ? "text-danger" : "text-ink-2"}`} role="status" data-testid={`${testId}-result`}>
            {rowResult.text}
          </p>
        )}
      </li>
    );
  }

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={t("aiJobs.title")}
      tabIndex={-1}
      className="ai-pop"
      data-testid="ai-jobs-popover"
      style={pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0, visibility: "hidden" }}
    >
      <div className="ai-pop-head">
        <b>{t("aiJobs.title")}</b>
        <span className="text-[12px] text-ink-3">{t("aiJobs.window")}</span>
      </div>
      <div className="ai-pop-body">
        {snapshot.error !== null && (
          <p className="px-3 pt-2 text-[12px] text-st-hold" role="status" data-testid="ai-jobs-stale">
            {t("ai.statusStale")}
          </p>
        )}
        {groups.length === 0 ? (
          <p className="px-3 py-6 text-center text-ink-3" data-testid="ai-jobs-empty">
            {t("aiJobs.empty")}
          </p>
        ) : (
          groups.map((group) => (
            <section key={group.bundleId} className="ai-pop-group" data-testid={`ai-jobs-bundle-${group.bundleId}`}>
              <Link href={getStageHref(group.bundleId, "overview")} className="ai-pop-bundle" data-testid={`ai-jobs-bundle-${group.bundleId}-link`} onClick={onClose}>
                <span className="shrink-0 font-mono text-[11px] text-ink-3">{group.bundleCode}</span>
                <Truncate text={group.bundleTitle} className="min-w-0 font-medium" />
              </Link>
              <ul className="grid">{group.requests.map(renderRequest)}</ul>
            </section>
          ))
        )}
        {data !== null && data.requests_total > data.requests.length && (
          <p className="px-3 py-2 text-[12px] text-ink-3" data-testid="ai-jobs-more">
            {t("aiJobs.more", { shown: data.requests.length, total: data.requests_total })}
          </p>
        )}
      </div>
    </div>,
    document.body,
  );
}
