// Assign Old 문서 대시보드 - 문서 하나의 줄을 처분별 칸·간 곳·받는 New 문서로 센다(1.2.0 피드백 6번, F3). 줄은 위쪽 상태 칩과 같은 줄(한/영 짝 하나)이고 그림은 따로 센다.

import { countWaitingSuggestions } from "./ai-suggestion-model";
import type { ClassifyRow } from "./classify-model";
import type { AiSuggestion, Disposition, UnitRow } from "./api-sop";
import { isFigureRow, listProgressParts, pickRowDisposition, pickRowPart, type ProgressPart, type ProgressPartKey } from "./progress-model";

export interface DocDashboardTarget {
  docId: number;
  docCode: string;
  /** 이 문서에서 그 New 문서로 간 줄 수 */
  rows: number;
}

export interface DocDashboard {
  /** 그림을 뺀 줄 수 - parts의 합 */
  total: number;
  parts: ProgressPart[];
  figures: { done: number; total: number };
  /** 정한 줄이 간 곳(그림 빼고) - 안 정한 줄과 보류는 unassigned */
  where: Record<Disposition, number>;
  /** 정한 줄(그림 포함)을 받은 New 문서 */
  targets: DocDashboardTarget[];
  /** 안 정한 줄에 남은 AI 제안 */
  aiWaiting: number;
}

type DashboardUnit = Pick<UnitRow, "kind" | "decision" | "target_doc_ids">;

/** docCodeOf는 New 문서 id의 번호 - 모르면(목록을 아직 못 받음) 빈 글이고 그 문서는 id로 보인다 */
export function buildDocDashboard(
  rows: readonly ClassifyRow[],
  docId: number,
  unitMap: ReadonlyMap<number, DashboardUnit>,
  docCodeOf: (targetDocId: number) => string,
  suggestions: readonly AiSuggestion[],
): DocDashboard {
  const counts: Record<ProgressPartKey, number> = { assigned: 0, deleted: 0, moved: 0, on_hold: 0, unassigned: 0 };
  const where: Record<Disposition, number> = { assigned: 0, delete: 0, move_external: 0, unassigned: 0 };
  const figures = { done: 0, total: 0 };
  const rowsByDoc = new Map<number, number>();
  let total = 0;
  for (const row of rows) {
    if (row.documentId !== docId) continue;
    const isDecided = row.status === "confirmed";
    if (isFigureRow(row, unitMap)) {
      figures.total += 1;
      figures.done += Number(isDecided);
    } else {
      total += 1;
      counts[pickRowPart(row, unitMap)] += 1;
      where[isDecided ? pickRowDisposition(row.unitIds, unitMap) : "unassigned"] += 1;
    }
    if (!isDecided) continue;
    const targetDocs = new Set(row.unitIds.flatMap((id) => unitMap.get(id)?.target_doc_ids ?? []));
    for (const targetDocId of targetDocs) rowsByDoc.set(targetDocId, (rowsByDoc.get(targetDocId) ?? 0) + 1);
  }
  const targets = [...rowsByDoc].map(([targetDocId, count]) => ({ docId: targetDocId, docCode: docCodeOf(targetDocId) || `#${targetDocId}`, rows: count }));
  // 많이 받은 문서부터 - 같으면 문서 번호 순
  targets.sort((a, b) => b.rows - a.rows || a.docCode.localeCompare(b.docCode));
  const statusOfUnit = new Map(rows.flatMap((row) => row.unitIds.map((id) => [id, row.status] as const)));
  return { total, parts: listProgressParts(counts), figures, where, targets, aiWaiting: countWaitingSuggestions(suggestions, statusOfUnit, docId) };
}
