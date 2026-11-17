import { describe, expect, it } from "vitest";

import type { Decision } from "./api-sop";
import type { ClassifyRow } from "./classify-model";
import { buildDocDashboard } from "./doc-dashboard-model";

function row(key: string, documentId: number, unitIds: number[], status: ClassifyRow["status"]): ClassifyRow {
  return { key, documentId, unitIds, status, pairStatus: null, pairId: null };
}

function unit(disposition: Decision["disposition"], targetDocIds: number[] = []) {
  return { decision: { disposition } as Decision, target_doc_ids: targetDocIds };
}

const CODES: Record<number, string> = { 10: "SOP-B", 20: "SOP-A" };

describe("buildDocDashboard", () => {
  it("counts only the document's rows by status, where they went and the receiving New documents", () => {
    // Arrange - 문서 1의 줄 넷(짝 줄 하나 포함, 두 단위가 같은 New 문서로), 문서 2의 줄 하나
    const rows = [
      row("u1", 1, [1, 2], "confirmed"),
      row("u3", 1, [3], "ai_suggested"),
      row("u4", 1, [4], "on_hold"),
      row("u5", 1, [5], "unassigned"),
      row("u9", 2, [9], "confirmed"),
    ];
    const unitMap = new Map([
      [1, unit("assigned", [10, 20])],
      [2, unit("assigned", [10])],
      [3, unit("assigned", [20])],
      [4, unit("delete")],
      [5, unit("unassigned")],
      [9, unit("assigned", [30])],
    ]);

    // Act
    const dashboard = buildDocDashboard(rows, 1, unitMap, (id) => CODES[id] ?? "");

    // Assert - 짝 줄은 New 문서마다 한 줄로 세고, 문서 2의 줄과 그 New 문서는 빠진다
    expect(dashboard.total).toBe(4);
    expect(dashboard.status).toEqual({ confirmed: 1, on_hold: 1, ai_suggested: 1, unassigned: 1 });
    expect(dashboard.where).toEqual({ assigned: 2, delete: 1, move_external: 0, unassigned: 1 });
    expect(dashboard.targets).toEqual([
      { docId: 20, docCode: "SOP-A", rows: 2 },
      { docId: 10, docCode: "SOP-B", rows: 1 },
    ]);
  });

  it("shows an unknown New document by its id", () => {
    const dashboard = buildDocDashboard([row("u1", 1, [1], "confirmed")], 1, new Map([[1, unit("assigned", [77])]]), () => "");

    expect(dashboard.targets).toEqual([{ docId: 77, docCode: "#77", rows: 1 }]);
  });
});
