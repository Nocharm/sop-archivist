// AI 작업 지켜보기 - 묶음의 AI 상태(/ai/status: 켜짐·종류별 수·채택)를 읽고, 공용 저장소(ai-jobs-store)의 이 묶음 작업 지문이 바뀔 때마다 다시 읽는다.
// 묻는 일은 상단 바의 폴러 하나가 맡는다(화면마다 따로 묻지 않는다). 끝난 작업이 늘면 onFinished로 알려 화면이 단위·제안을 다시 불러오게 한다
// (그러지 않으면 제안이 안 보이고 다음 저장이 낡은 revision으로 409다).
"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";

import { ApiError } from "./api";
import { getAiStatus, type AiJobCounts, type AiStatus } from "./api-sop";
import { getBundleSignature } from "./ai-jobs-model";
import { pokeAiJobs, useAiJobsSelect } from "./ai-jobs-store";

function countFinished(jobs: AiJobCounts): number {
  return jobs.done + jobs.failed + jobs.stale + jobs.cancelled;
}

// 다시 물어도 같은 답인 실패(권한 없음·없는 묶음)는 되풀이하지 않는다
function isRetryable(err: unknown): boolean {
  return !(err instanceof ApiError && err.status >= 400 && err.status < 500);
}

/** watch()는 작업을 요청한 직후에 부른다 - 상태를 바로 다시 읽고 공용 폴러도 바로 묻게 한다 */
export function useAiJobs(bundleId: number, onFinished: () => void): { status: AiStatus | null; error: unknown; watch: () => void } {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [round, setRound] = useState(0);
  const finishedRef = useRef<{ bundleId: number; count: number } | null>(null);
  const handleFinished = useEffectEvent(() => onFinished());
  const signature = useAiJobsSelect((snapshot) => getBundleSignature(snapshot.data, bundleId), "");
  const storeError = useAiJobsSelect((snapshot) => snapshot.error, null);
  // 내 읽기가 실패했으면 공용 폴러가 새 답을 받을 때마다 다시 읽는다(간격은 폴러가 늘린다)
  const retryKey = useAiJobsSelect((snapshot) => (error !== null && isRetryable(error) ? snapshot.receivedAt : 0), 0);

  useEffect(() => {
    let isCancelled = false;
    getAiStatus(bundleId).then(
      (next) => {
        if (isCancelled) return;
        const count = countFinished(next.jobs);
        const previous = finishedRef.current;
        if (previous && previous.bundleId === bundleId && count > previous.count) handleFinished();
        finishedRef.current = { bundleId, count };
        setStatus(next);
        setError(null);
      },
      (err: unknown) => {
        if (!isCancelled) setError(err);
      },
    );
    return () => {
      isCancelled = true;
    };
  }, [bundleId, round, signature, retryKey]);

  return {
    status,
    // 공용 폴러가 못 묻는 동안도 "상태가 따라오지 않는다"를 보인다
    error: error ?? storeError,
    watch: () => {
      pokeAiJobs();
      setRound((value) => value + 1);
    },
  };
}
