// 배치 작업 화면의 한 줄 = 작업 하나 - 결과(성공·실패)마다 온 최신 행을 작업으로 묶는다.
import type { BatchRun } from "./api";

export interface BatchJob {
  job: string;
  /** 결과별 최신 행 - 최근 것이 먼저 */
  runs: BatchRun[];
  latest: BatchRun;
}

export function groupBatchRuns(runs: readonly BatchRun[]): BatchJob[] {
  const byJob = new Map<string, BatchRun[]>();
  for (const run of runs) byJob.set(run.job, [...(byJob.get(run.job) ?? []), run]);
  return [...byJob].map(([job, rows]) => {
    const sorted = [...rows].sort((a, b) => Date.parse(b.ran_at) - Date.parse(a.ran_at));
    return { job, runs: sorted, latest: sorted[0] };
  });
}
