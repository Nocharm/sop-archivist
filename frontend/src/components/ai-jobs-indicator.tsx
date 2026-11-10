// 상단 바 AI 작업 표시 - 공용 폴러를 로그인한 동안 켜 두고, 도는 요청 수(스피너)·보지 않은 실패(배지)·상태를 못 받음을 한 단추로 보인다.
// 누르면 작업 목록이 열린다. 내가 한 요청이 끝나면 어느 화면에 있든 알림을 띄운다(실패는 오류, 반영 안 됨·취소는 설명).
"use client";

import { Loader2, Sparkles } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { AiJobsPopover } from "@/components/ai-jobs-popover";
import { showToast } from "@/components/ui/toast";
import { Tooltip } from "@/components/ui/tooltip";
import type { RecentAiJobs, RecentAiRequest } from "@/lib/api-sop";
import { findFinishedRequests, getRequestToast, mergeToastQueue, summarizeAiJobs } from "@/lib/ai-jobs-model";
import { startAiJobsPolling, useAiJobsSnapshot, useSeenFailures } from "@/lib/ai-jobs-store";
import { useI18n } from "@/lib/i18n";
import { useSession } from "@/lib/session";

export function AiJobsIndicator() {
  const { t } = useI18n();
  const { me } = useSession();
  const loginId = me?.login_id ?? null;
  const snapshot = useAiJobsSnapshot();
  const seen = useSeenFailures();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const previousRef = useRef<RecentAiJobs | null>(null);
  // 탭이 가려진 동안 끝난 요청 - 알림은 몇 초 뒤 사라지므로 돌아왔을 때 띄운다
  const hiddenQueueRef = useRef<RecentAiRequest[]>([]);

  useEffect(() => (loginId === null ? undefined : startAiJobsPolling(loginId)), [loginId]);

  const showFinished = useEffectEvent((requests: readonly RecentAiRequest[]) => {
    for (const request of requests) {
      const toast = getRequestToast(request);
      const reasonKey = `ai.error.${toast.reason}`;
      const reason = t(reasonKey) === reasonKey ? toast.reason : t(reasonKey);
      showToast(t(toast.key, { kind: t(`ai.kind.${request.kind}`), n: toast.n, total: request.total, reason, bundle: request.bundle_code }), toast.tone);
    }
  });

  const announce = useEffectEvent((previous: RecentAiJobs | null, next: RecentAiJobs) => {
    const finished = findFinishedRequests(previous, next);
    if (finished.length === 0) return;
    if (document.visibilityState === "visible") showFinished(finished);
    else hiddenQueueRef.current = mergeToastQueue(hiddenQueueRef.current, finished);
  });

  useEffect(() => {
    const flush = () => {
      if (document.visibilityState !== "visible" || hiddenQueueRef.current.length === 0) return;
      const queued = hiddenQueueRef.current;
      hiddenQueueRef.current = [];
      showFinished(queued);
    };
    document.addEventListener("visibilitychange", flush);
    return () => document.removeEventListener("visibilitychange", flush);
  }, []);

  // 새 답마다 한 번 - 앞 답과 견주어 이번에 끝난 내 요청을 알린다. 저장소를 비우면(사용자 전환) 처음부터 다시 잰다
  useEffect(() => {
    const { data } = snapshot;
    if (data === null) {
      previousRef.current = null;
      hiddenQueueRef.current = [];
      return;
    }
    if (previousRef.current === data) return;
    announce(previousRef.current, data);
    previousRef.current = data;
  }, [snapshot]);

  const summary = summarizeAiJobs(snapshot.data, snapshot.error, seen);
  if (loginId === null || (summary.state === "hidden" && !open)) return null;

  const parts: string[] = [];
  if (summary.active > 0) parts.push(t("aiJobs.tipActive", { n: summary.active }));
  if (summary.failedUnseen > 0) parts.push(t("aiJobs.tipFailed", { n: summary.failedUnseen }));
  if (snapshot.error !== null) parts.push(t("aiJobs.tipError"));
  const label = parts.length === 0 ? t("aiJobs.tipIdle") : `${t("aiJobs.title")}: ${parts.join(" · ")}`;

  return (
    <>
      <Tooltip label={label} align="end" suppressed={open}>
        <button
          ref={triggerRef}
          type="button"
          className="ai-ind"
          data-state={summary.state}
          data-testid="top-bar-ai"
          aria-label={label}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {summary.active > 0 ? <Loader2 size={16} strokeWidth={1.5} className="animate-spin" aria-hidden /> : <Sparkles size={16} strokeWidth={1.5} aria-hidden />}
          {summary.active > 0 && (
            <span className="font-mono text-[12px] tabular-nums" data-testid="top-bar-ai-active">
              {summary.active}
            </span>
          )}
          {summary.failedUnseen > 0 && (
            <span className="ai-ind-badge" data-testid="top-bar-ai-failed">
              {summary.failedUnseen}
            </span>
          )}
          {snapshot.error !== null && summary.failedUnseen === 0 && <span className="ai-ind-dot" aria-hidden />}
        </button>
      </Tooltip>
      {open && <AiJobsPopover anchorRef={triggerRef} snapshot={snapshot} onClose={() => setOpen(false)} />}
    </>
  );
}
