// 묶음 진행 숫자(줄 기준 한 벌)에서 화면이 쓰는 값을 뽑는 순수 함수 - 정한 줄을 처분으로 가르고 그림은 따로 센다(F3). 줄 규칙은 서버 snapshot.load_bundle_progress와 같다.

import type { Disposition, RowProgress, UnitRow } from "./api-sop";
import type { ClassifyRow } from "./classify-model";

export type ProgressPartKey = "assigned" | "deleted" | "moved" | "on_hold" | "unassigned";

export interface ProgressPart {
  key: ProgressPartKey;
  count: number;
}

/** 막대와 범례의 채움 색 */
export const PROGRESS_PART_FILL: Record<ProgressPartKey, string> = {
  assigned: "var(--st-ok-fill)",
  deleted: "var(--st-del-fill)",
  moved: "var(--st-move-fill)",
  on_hold: "var(--st-hold-fill)",
  unassigned: "var(--st-none-fill)",
};

const PART_ORDER: readonly ProgressPartKey[] = ["assigned", "deleted", "moved", "on_hold", "unassigned"];

type DecidedDisposition = Exclude<Disposition, "unassigned">;

// 정한 줄의 처분 → 칸. 구성 단위의 처분이 갈리면 앞선 것 - 서버 status.ROW_DISPOSITION_ORDER와 같은 순서여야 한다
const DECIDED_PARTS: readonly (readonly [DecidedDisposition, ProgressPartKey])[] = [
  ["assigned", "assigned"],
  ["delete", "deleted"],
  ["move_external", "moved"],
];

type PartUnit = Pick<UnitRow, "decision">;

/** 줄의 처분 - 구성 단위 가운데 배정 · 삭제 · 이동 차례로 앞선 것, 하나도 없으면 unassigned */
export function pickRowDisposition(unitIds: readonly number[], unitMap: ReadonlyMap<number, PartUnit>): Disposition {
  const found = new Set(unitIds.map((id) => unitMap.get(id)?.decision.disposition));
  return DECIDED_PARTS.find(([disposition]) => found.has(disposition))?.[0] ?? "unassigned";
}

/** 줄이 드는 칸 - 상태가 먼저다: 자리를 둔 보류도 보류(F3-R5), 확정한 줄만 처분으로 가른다(처분 없이 확정한 줄은 서버처럼 배정) */
export function pickRowPart(row: Pick<ClassifyRow, "status" | "unitIds">, unitMap: ReadonlyMap<number, PartUnit>): ProgressPartKey {
  if (row.status === "on_hold") return "on_hold";
  if (row.status !== "confirmed") return "unassigned";
  const disposition = pickRowDisposition(row.unitIds, unitMap);
  return DECIDED_PARTS.find(([name]) => name === disposition)?.[1] ?? "assigned";
}

/** 그림 줄 - 진행 숫자에서 빠지고 따로 센다(F3-R3) */
export function isFigureRow(row: Pick<ClassifyRow, "unitIds">, unitMap: ReadonlyMap<number, Pick<UnitRow, "kind">>): boolean {
  return row.unitIds.some((id) => unitMap.get(id)?.kind === "figure");
}

/** 막대와 범례의 칸 - 이동은 옛 기록이 있을 때만 */
export function listProgressParts(progress: Readonly<Record<ProgressPartKey, number>>): ProgressPart[] {
  return PART_ORDER.filter((key) => key !== "moved" || progress.moved > 0).map((key) => ({ key, count: progress[key] }));
}

/** 정한 줄 수 - 배정 · 삭제 · 이동 칸의 합 */
export function countDecided(parts: readonly ProgressPart[]): number {
  return parts.reduce((sum, part) => sum + (part.key === "on_hold" || part.key === "unassigned" ? 0 : part.count), 0);
}

/** 아직 정하지 못한 줄 수 - 안 정함·보류(그림은 따로) */
export function countPending(progress: RowProgress): number {
  return progress.unassigned + progress.on_hold;
}

export function countFiguresLeft(progress: RowProgress): number {
  return progress.figures_total - progress.figures_decided;
}

/** 정한 비율(반올림 정수 %) - 줄이 없으면 null */
export function getDecidedPercent(progress: RowProgress): number | null {
  if (progress.total === 0) return null;
  return Math.round((progress.confirmed / progress.total) * 100);
}

export interface AssignProgress {
  done: number;
  total: number;
  figuresDone: number;
  figuresTotal: number;
}

/** Assign 위쪽의 진행 - 확정만 정한 것으로 센다(보류는 아직 끝나지 않았다) */
export function buildAssignProgress(rows: readonly ClassifyRow[], unitMap: ReadonlyMap<number, Pick<UnitRow, "kind">>): AssignProgress {
  const progress: AssignProgress = { done: 0, total: 0, figuresDone: 0, figuresTotal: 0 };
  for (const row of rows) {
    const isDone = Number(row.status === "confirmed");
    if (isFigureRow(row, unitMap)) {
      progress.figuresTotal += 1;
      progress.figuresDone += isDone;
    } else {
      progress.total += 1;
      progress.done += isDone;
    }
  }
  return progress;
}
