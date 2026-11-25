import { describe, expect, it } from "vitest";

import type { AiSuggestion, Decision, UnitKind } from "./api-sop";
import type { ClassifyRow } from "./classify-model";
import { buildDocDashboard } from "./doc-dashboard-model";

function row(key: string, documentId: number, unitIds: number[], status: ClassifyRow["status"]): ClassifyRow {
  return { key, documentId, unitIds, status, pairStatus: null, pairId: null };
}

function unit(disposition: Decision["disposition"], targetDocIds: number[] = [], kind: UnitKind = "sentence") {
  return { kind, decision: { disposition } as Decision, target_doc_ids: targetDocIds };
}

function suggestion(id: number, unitIds: number[], extra: Partial<AiSuggestion> = {}): AiSuggestion {
  return {
    id, job_id: 1, kind: "match", document_id: 1, result: "applied", content: { unit_ids: unitIds }, warnings: [], guideline_versions: {}, model: "",
    adoption: null, created_at: "2026-11-26T09:00:00+09:00", ...extra,
  };
}

const CODES: Record<number, string> = { 10: "SOP-B", 20: "SOP-A" };

describe("buildDocDashboard", () => {
  it("counts only the document's rows by part, where the decided rows went and the receiving New documents", () => {
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
    const dashboard = buildDocDashboard(rows, 1, unitMap, (id) => CODES[id] ?? "", []);

    // Assert - 짝 줄은 New 문서마다 한 줄로 세고, 문서 2의 줄과 그 New 문서는 빠진다. 자리를 둔 안 정한 줄 · 보류는 간 곳이 없다(F3-R5)
    expect(dashboard.total).toBe(4);
    expect(dashboard.parts).toEqual([
      { key: "assigned", count: 1 },
      { key: "deleted", count: 0 },
      { key: "on_hold", count: 1 },
      { key: "unassigned", count: 2 },
    ]);
    expect(dashboard.where).toEqual({ assigned: 1, delete: 0, move_external: 0, unassigned: 3 });
    expect(dashboard.targets).toEqual([
      { docId: 20, docCode: "SOP-A", rows: 1 },
      { docId: 10, docCode: "SOP-B", rows: 1 },
    ]);
  });

  it("counts figures apart but still lists where a decided figure went", () => {
    const rows = [row("u1", 1, [1], "confirmed"), row("u2", 1, [2], "confirmed"), row("u3", 1, [3], "unassigned")];
    const unitMap = new Map([[1, unit("delete")], [2, unit("assigned", [20], "figure")], [3, unit("unassigned", [], "figure")]]);

    const dashboard = buildDocDashboard(rows, 1, unitMap, (id) => CODES[id] ?? "", []);

    expect(dashboard.total).toBe(1);
    expect(dashboard.figures).toEqual({ done: 1, total: 2 });
    expect(dashboard.parts.map((part) => part.count)).toEqual([0, 1, 0, 0]);
    expect(dashboard.where).toEqual({ assigned: 0, delete: 1, move_external: 0, unassigned: 0 });
    expect(dashboard.targets).toEqual([{ docId: 20, docCode: "SOP-A", rows: 1 }]);
  });

  it("aiWaiting skips decided, retired and hidden kinds", () => {
    const rows = [row("u1", 1, [1, 2], "unassigned"), row("u3", 1, [3], "confirmed"), row("u4", 1, [4], "unassigned"), row("u9", 2, [9], "unassigned")];
    const unitMap = new Map([1, 2, 3, 4, 9].map((id) => [id, unit("unassigned")]));
    const items = [
      suggestion(1, [1]),
      suggestion(2, [3]), // 정한 줄
      suggestion(3, [77]), // 은퇴한 단위
      suggestion(4, [4], { kind: "classify" }), // 숨긴 종류
      suggestion(5, [9], { document_id: 2 }), // 다른 문서
    ];

    expect(buildDocDashboard(rows, 1, unitMap, () => "", items).aiWaiting).toBe(1);
  });

  it("shows an unknown New document by its id", () => {
    const dashboard = buildDocDashboard([row("u1", 1, [1], "confirmed")], 1, new Map([[1, unit("assigned", [77])]]), () => "", []);

    expect(dashboard.targets).toEqual([{ docId: 77, docCode: "#77", rows: 1 }]);
  });
});
