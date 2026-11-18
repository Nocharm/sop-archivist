// 벗긴 표(MD 1 F1) - 레이아웃 표의 칸 줄은 보통 문장 카드로 놓이고, 같은 표의 줄 묶음 왼쪽에 세로선 하나, 묶음 머리에 "↺ 다시 표로" 하나만 둔다.
// 칸 줄은 용지 모델(paper-model buildPaperModel)이 이미 문단처럼 펴 둔다 - 여기는 줄이 어느 벗긴 표에 드는지와 묶음 머리 자리, 다시 표로 단추를 둘 줄만 정한다.
// 명세: docs/superpowers/handoff/2026-11-18-1-unwrap-standardize.md F1 · F12

import type { ViewTable, ViewUnit } from "./api-sop";
import type { PaperRow } from "./paper-model";

/** 줄이 든 벗긴 표 - 줄의 첫 블록이 벗긴 표의 칸이면 그 표 id(번호 칸을 앞 조각으로 받은 줄도 첫 블록이 같은 표의 칸이다), 아니면 null */
export function getRowUnwrapTable(row: PaperRow, unwrapped: ReadonlyMap<number, ViewTable>): number | null {
  const block = row.type === "piece" ? row.parts[0]?.block : row.type === "figure" ? row.block : undefined;
  const tableId = block?.table_id ?? null;
  return tableId !== null && unwrapped.has(tableId) ? tableId : null;
}

/** 묶음 머리를 달 줄 - 같은 벗긴 표의 줄이 이어지는 덩이마다 첫 줄 key → 표 id. 덩이가 끊겼다 다시 이어지면(안쪽 값 표 뒤 등) 그 자리에도 머리가 선다 */
export function findUnwrapHeads(rows: readonly PaperRow[], unwrapped: ReadonlyMap<number, ViewTable>): Map<string, number> {
  const heads = new Map<string, number>();
  let previous: number | null = null;
  for (const row of rows) {
    const tableId = getRowUnwrapTable(row, unwrapped);
    if (tableId !== null && tableId !== previous) heads.set(row.key, tableId);
    previous = tableId;
  }
  return heads;
}

/** 고른 줄의 단위가 벗긴 표의 칸 줄이면 그 표 id - 결정 칸 다듬기의 "↺ 다시 표로"(F12 A3) */
export function getUnitUnwrapTable(units: readonly ViewUnit[], unwrapped: ReadonlyMap<number, ViewTable>): number | null {
  for (const unit of units) {
    if (unit.kind === "cell_sentence" && unit.group_unit_id === null && unit.table_id !== null && unwrapped.has(unit.table_id)) return unit.table_id;
  }
  return null;
}

/** 다시 표로 묶으면 판단이 풀릴 줄 수 - 그 벗긴 표의 줄 가운데 미배정이 아닌 것. 0보다 크면 서버에 묻기 전에 확인창부터 연다(F12 A6, 한 번 묻는다).
 *  서버가 같은 규칙을 다시 본다(409 confirm_required) - 화면 상태가 낡았으면 그쪽 확인창이 대신 뜬다 */
export function countDecidedLines(units: Iterable<ViewUnit>, tableId: number, statusOf: (unitId: number) => ViewUnit["status"] | undefined): number {
  let count = 0;
  for (const unit of units) {
    if (unit.kind === "cell_sentence" && unit.group_unit_id === null && unit.table_id === tableId && (statusOf(unit.id) ?? unit.status) !== "unassigned") count += 1;
  }
  return count;
}

/** 확인창·알림의 표 번호 - 그 Old 문서 안 표 순번(1부터, 결과물 A 위치 칸의 "표 n"과 같다) */
export function getTableNumber(table: ViewTable): number {
  return table.table_index + 1;
}
