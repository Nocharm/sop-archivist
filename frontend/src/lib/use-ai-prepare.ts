// 배정 화면 첫 진입 - 고칠 수 있는 사용자로 열리고 Old 문서가 정해지면 묶음마다 한 번 prepare를 불러 남은 줄을 미리 분류하게 한다.
// 화면에는 이 훅을 부르는 한 줄만 둔다(설계 2026-11-15-ai-prepare-queue-design §5.2). 되풀이는 서버가 막으니 여기서는 화면이 살아 있는 동안 한 번이면 된다.
"use client";

import { useEffect, useEffectEvent, useRef } from "react";

import { ApiError } from "./api";
import { pokeAiJobs } from "./ai-jobs-store";
import { prepareAi } from "./api-manage";

// 화면이 그대로 쓰는 거절 - 검토자(403)·작업 중 아님(409)·AI 꺼짐(503)
const EXPECTED_REFUSALS = new Set([403, 409, 503]);

interface AiPrepareOptions {
  enabled: boolean;
  documentId: number | null;
  /** 쌓인 분류 작업이 있을 때만(queued > 0) 부른다 */
  onQueued: (queued: number) => void;
}

export function useAiPrepare(bundleId: number, { enabled, documentId, onQueued }: AiPrepareOptions): void {
  // 이미 부른 묶음 - 다시 그리기·문서 바꾸기·StrictMode의 이펙트 두 번 돌기에도 한 번만 부른다(그래서 정리에서 취소하지 않는다)
  const calledRef = useRef<number | null>(null);
  const handleQueued = useEffectEvent((queued: number) => onQueued(queued));

  useEffect(() => {
    if (!enabled || documentId === null || calledRef.current === bundleId) return;
    calledRef.current = bundleId;
    prepareAi(bundleId, documentId).then(
      (out) => {
        // 계획만 쌓였어도(queued 0) 공용 폴러를 바로 깨운다 - 안 그러면 결과가 쉬는 간격(최대 30초) 뒤에야 보인다
        pokeAiJobs();
        if (out.queued > 0) handleQueued(out.queued);
      },
      // 사람이 누른 요청이 아니라 알릴 것이 없다 - 예상한 거절은 조용히, 그 밖(서버 오류·끊김)은 화면에 알리지 않고 흔적만 남긴다
      (err: unknown) => {
        if (!(err instanceof ApiError && EXPECTED_REFUSALS.has(err.status))) console.warn("ai prepare failed", err);
      },
    );
  }, [bundleId, enabled, documentId]);
}
