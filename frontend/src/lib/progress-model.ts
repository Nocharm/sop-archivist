// 묶음 진행 숫자(줄 기준 한 벌)에서 화면이 쓰는 값을 뽑는 순수 함수.

import type { RowProgress } from "./api-sop";

/** 아직 확정하지 못한 줄 수 - 미배정·보류 (AI 제안은 판단에 쓰이지 않아 미배정에 든다) */
export function countPending(progress: RowProgress): number {
  return progress.unassigned + progress.on_hold;
}

/** 확정 비율(반올림 정수 %) - 줄이 없으면 null */
export function getConfirmedPercent(progress: RowProgress): number | null {
  if (progress.total === 0) return null;
  return Math.round((progress.confirmed / progress.total) * 100);
}
