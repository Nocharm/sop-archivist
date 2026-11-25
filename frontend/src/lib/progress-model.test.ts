import { describe, expect, it } from "vitest";

import type { Decision, RowProgress, UnitKind } from "./api-sop";
import type { ClassifyRow } from "./classify-model";
import { buildAssignProgress, countDecided, countFiguresLeft, countPending, getDecidedPercent, listProgressParts, pickRowDisposition } from "./progress-model";

// 명세 S10 - 503줄: 배정 282 · 삭제 106 · 이동 24(옛 기록) · 보류 21 · 안 정함 70, 그림 9개 중 7 정함
const s10: RowProgress = { total: 503, unassigned: 70, on_hold: 21, confirmed: 412, assigned: 282, deleted: 106, moved: 24, figures_total: 9, figures_decided: 7, single_language: 0 };

function row(key: string, unitIds: number[], status: ClassifyRow["status"]): ClassifyRow {
  return { key, documentId: 1, unitIds, status, pairStatus: null, pairId: null };
}

function unit(kind: UnitKind, disposition: Decision["disposition"] = "unassigned") {
  return { kind, decision: { disposition } as Decision };
}

describe("progress-model", () => {
  it("S10: 82% decided", () => expect(getDecidedPercent(s10)).toBe(82));
  it("has no rate for an empty bundle", () => expect(getDecidedPercent({ ...s10, total: 0, confirmed: 0 })).toBeNull());
  it("counts rows that are not decided, figures apart", () => {
    expect(countPending(s10)).toBe(91);
    expect(countFiguresLeft(s10)).toBe(2);
  });
  it("S10: the parts in order", () =>
    expect(listProgressParts(s10).map((p) => [p.key, p.count])).toEqual([["assigned", 282], ["deleted", 106], ["moved", 24], ["on_hold", 21], ["unassigned", 70]]));
  it("the parts add up to the rows", () => expect(listProgressParts(s10).reduce((sum, part) => sum + part.count, 0)).toBe(s10.total));
  it("the decided parts add up to the decided rows", () => expect(countDecided(listProgressParts(s10))).toBe(s10.confirmed));
  it("leaves moved out when nothing moved", () => expect(listProgressParts({ ...s10, moved: 0 }).some((p) => p.key === "moved")).toBe(false));
  it("keeps the other parts at zero so the legend reads the same on every bundle", () =>
    expect(listProgressParts({ assigned: 0, deleted: 0, moved: 0, on_hold: 0, unassigned: 0 }).map((p) => p.key)).toEqual(["assigned", "deleted", "on_hold", "unassigned"]));
});

describe("pickRowDisposition", () => {
  // 서버 status.ROW_DISPOSITION_ORDER와 같은 순서 - 배정 · 삭제 · 이동
  it("takes the first of assigned, deleted, moved among the members", () => {
    const unitMap = new Map([[1, unit("sentence", "move_external")], [2, unit("sentence", "delete")], [3, unit("sentence", "assigned")]]);
    expect(pickRowDisposition([1, 2, 3], unitMap)).toBe("assigned");
    expect(pickRowDisposition([1, 2], unitMap)).toBe("delete");
    expect(pickRowDisposition([1], unitMap)).toBe("move_external");
    expect(pickRowDisposition([9], unitMap)).toBe("unassigned");
  });
});

describe("buildAssignProgress", () => {
  it("the top of Assign counts rows without figures", () => {
    const rows = [
      row("u1", [1, 2], "confirmed"),
      row("u3", [3], "confirmed"),
      row("u4", [4], "on_hold"),
      row("u5", [5], "confirmed"),
      row("u6", [6], "unassigned"),
    ];
    const unitMap = new Map([[1, unit("sentence")], [2, unit("sentence")], [3, unit("table")], [4, unit("heading")], [5, unit("figure")], [6, unit("figure")]]);

    expect(buildAssignProgress(rows, unitMap)).toEqual({ done: 2, total: 3, figuresDone: 1, figuresTotal: 2 });
  });
});
