// Assign Old 문서 대시보드 - 문서 하나의 줄을 상태·간 곳·받는 New 문서로 센다(1.2.0 피드백 6번). 줄은 위쪽 상태 칩과 같은 줄(한/영 짝 하나)이다.

import type { ClassifyRow } from "./classify-model";
import type { CoverStatus, Disposition, UnitRow } from "./api-sop";

export interface DocDashboardTarget {
  docId: number;
  docCode: string;
  /** 이 문서에서 그 New 문서로 간 줄 수 */
  rows: number;
}

export interface DocDashboard {
  total: number;
  status: Record<CoverStatus, number>;
  where: Record<Disposition, number>;
  targets: DocDashboardTarget[];
}

type DashboardUnit = Pick<UnitRow, "decision" | "target_doc_ids">;

/** 줄의 간 곳 - 정한 단위가 하나라도 있으면 그 처리, 아니면 아직 */
function pickDisposition(unitIds: readonly number[], unitMap: ReadonlyMap<number, DashboardUnit>): Disposition {
  for (const id of unitIds) {
    const disposition = unitMap.get(id)?.decision.disposition;
    if (disposition && disposition !== "unassigned") return disposition;
  }
  return "unassigned";
}

/** docCodeOf는 New 문서 id의 번호 - 모르면(목록을 아직 못 받음) 빈 글이고 그 문서는 id로 보인다 */
export function buildDocDashboard(rows: readonly ClassifyRow[], docId: number, unitMap: ReadonlyMap<number, DashboardUnit>, docCodeOf: (targetDocId: number) => string): DocDashboard {
  const status: Record<CoverStatus, number> = { confirmed: 0, on_hold: 0, ai_suggested: 0, unassigned: 0 };
  const where: Record<Disposition, number> = { assigned: 0, delete: 0, move_external: 0, unassigned: 0 };
  const rowsByDoc = new Map<number, number>();
  let total = 0;
  for (const row of rows) {
    if (row.documentId !== docId) continue;
    total += 1;
    status[row.status] += 1;
    where[pickDisposition(row.unitIds, unitMap)] += 1;
    const targetDocs = new Set(row.unitIds.flatMap((id) => unitMap.get(id)?.target_doc_ids ?? []));
    for (const targetDocId of targetDocs) rowsByDoc.set(targetDocId, (rowsByDoc.get(targetDocId) ?? 0) + 1);
  }
  const targets = [...rowsByDoc].map(([targetDocId, count]) => ({ docId: targetDocId, docCode: docCodeOf(targetDocId) || `#${targetDocId}`, rows: count }));
  // 많이 받은 문서부터 - 같으면 문서 번호 순
  targets.sort((a, b) => b.rows - a.rows || a.docCode.localeCompare(b.docCode));
  return { total, status, where, targets };
}
