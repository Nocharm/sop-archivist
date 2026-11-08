// AI 작업 지켜보기 - 묶음의 AI 작업 상태를 읽고, 대기·실행 중인 작업이 있는 동안만 다시 묻는다. 끝난 작업이 늘면 onFinished로 알려
// 화면이 단위·제안을 다시 불러오게 한다(그러지 않으면 제안이 안 보이고 다음 저장이 낡은 revision으로 409다).
"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";

import { getAiStatus, type AiJobCounts, type AiStatus } from "./api-sop";

/** 작업이 남아 있는 동안 상태를 다시 묻는 간격(ms) - 짧으면 서버에 자주 묻고, 길면 끝난 제안이 늦게 보인다 */
export const AI_POLL_MS = 3000;

function countFinished(jobs: AiJobCounts): number {
  return jobs.done + jobs.failed + jobs.stale + jobs.cancelled;
}

function isBusy(jobs: AiJobCounts): boolean {
  return jobs.queued + jobs.running > 0;
}

/** watch()는 작업을 요청한 직후에 부른다 - 상태를 바로 다시 읽고 작업이 남아 있으면 지켜본다 */
export function useAiJobs(bundleId: number, onFinished: () => void): { status: AiStatus | null; error: unknown; watch: () => void } {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [round, setRound] = useState(0);
  const finishedRef = useRef<{ bundleId: number; count: number } | null>(null);
  const handleFinished = useEffectEvent(() => onFinished());

  useEffect(() => {
    let isCancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      try {
        const next = await getAiStatus(bundleId);
        if (isCancelled) return;
        const count = countFinished(next.jobs);
        const previous = finishedRef.current;
        if (previous && previous.bundleId === bundleId && count > previous.count) handleFinished();
        finishedRef.current = { bundleId, count };
        setStatus(next);
        setError(null);
        if (isBusy(next.jobs)) timer = setTimeout(() => void poll(), AI_POLL_MS);
      } catch (err) {
        // 멈추고 오류를 돌려준다 - 다음 watch()나 화면 진입에서 다시 묻는다
        if (!isCancelled) setError(err);
      }
    }
    void poll();
    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [bundleId, round]);

  return { status, error, watch: () => setRound((value) => value + 1) };
}
