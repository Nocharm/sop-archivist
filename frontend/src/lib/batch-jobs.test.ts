import { describe, expect, it } from "vitest";

import { groupBatchRuns } from "./batch-jobs";

const run = (job: string, outcome: string, ran_at: string) => ({ job, outcome, ran_at, detail: null });

describe("groupBatchRuns", () => {
  it("puts the outcomes of a job in one row, newest first", () => {
    const jobs = groupBatchRuns([run("db_backup", "failure", "2026-11-01T04:00:00+09:00"), run("hr_sync", "success", "2026-11-03T04:00:00+09:00"), run("db_backup", "success", "2026-11-04T04:00:00+09:00")]);
    expect(jobs.map((item) => [item.job, item.runs.map((r) => r.outcome), item.latest.outcome])).toEqual([
      ["db_backup", ["success", "failure"], "success"],
      ["hr_sync", ["success"], "success"],
    ]);
  });
});
