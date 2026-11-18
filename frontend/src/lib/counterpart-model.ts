// 대응 표 함께 벗기기(MD 1 F8a, 사용자 결정 2026-11-19) - 한/영 따로 문서에서 표 하나를 벗길 때 다른 언어 절반의 같은 꼴 표를 한 번 묻는다.
// 후보와 차례는 서버가 정한다(ViewTable.counterparts, backend app/sop/counterparts.py) - 맨 앞이 가장 비슷한 표이고 비면 묻지 않는다.
// 여기는 창에 보일 고를 것 · 보낼 편집 · 행 수가 달라 짝이 서지 않는다는 알림만 정한다.

import type { EditOp, ViewBlock, ViewTable } from "./api-sop";
import { getTableNumber } from "./unwrap-model";

/** 창의 고를 것 하나 - 함께 벗길 표(맨 앞이 가장 비슷한 표) */
export interface CounterpartChoice {
  tableId: number;
  /** 문서 안 표 순번(1부터) */
  number: number;
  rows: number;
  cols: number;
  /** 표의 첫 칸 글(창에서 어느 표인지 알아보게) - 빈 칸은 건너뛴다 */
  firstText: string;
  /** 행 수가 벗기는 표와 달라 짝이 서지 않는다 */
  rowsDiffer: boolean;
}

/** 이 표를 벗길 때 함께 벗길 표 후보 - 서버가 정한 차례 그대로. 비면 묻지 않고 이 표만 벗긴다 */
export function listCounterpartChoices(table: ViewTable, tables: readonly ViewTable[], blocks: readonly ViewBlock[]): CounterpartChoice[] {
  const byId = new Map(tables.map((item) => [item.id, item]));
  return (table.counterparts ?? []).flatMap((tableId) => {
    const other = byId.get(tableId);
    if (!other || other.is_layout) return [];
    return [{ tableId, number: getTableNumber(other), rows: other.n_rows, cols: other.n_cols, firstText: readFirstCellText(blocks, tableId), rowsDiffer: other.n_rows !== table.n_rows }];
  });
}

/** 표의 첫 글 있는 칸 글 - 원문 순(블록은 seq 순으로 온다), 줄바꿈은 띄어쓰기로 */
export function readFirstCellText(blocks: readonly ViewBlock[], tableId: number): string {
  const cell = blocks.find((block) => block.kind === "table_cell" && block.table_id === tableId && block.text.trim() !== "");
  return cell ? cell.text.replace(/\s+/g, " ").trim() : "";
}

/** 벗기기 편집 - counterpartId가 있으면 같은 편집으로 그 표도 벗긴다(되돌리기 한 번에 둘 다 돌아온다) */
export function buildUnwrapOp(tableId: number, counterpartId: number | null): EditOp {
  return counterpartId === null
    ? { type: "set_layout_table", table_id: tableId, is_layout: true }
    : { type: "set_layout_table", table_id: tableId, is_layout: true, counterpart_table_id: counterpartId };
}

/** 창 제목의 "영어 절반 · 한글 절반" - 벗기는 표의 반대 언어. 언어를 모르면 null(제목에서 절반 말을 뺀다) */
export function readOtherHalf(table: ViewTable): "en" | "ko" | null {
  if (table.lang === "ko") return "en";
  if (table.lang === "en") return "ko";
  return null;
}
