// 결과물 의미 묶음 표시 - A는 묶음 첫 줄에만 함께 쓰는 칸(Row·Remark)을 보이고, C는 의미가 바뀌는 줄에서 굵은 선을 시작한다.
// 묶음 자체는 서버가 짓는다(A의 is_group_start, C의 meaning_key - 진행 숫자·배정 화면과 같은 줄). 화면은 그 값을 읽기만 한다.
import type { OutputARow, OutputCItem } from "./api-sop";

export interface AScreenLine {
  row: OutputARow;
  /** 묶음이 함께 쓰는 칸(Row·Remark)을 이 줄에 보이나 - 묶음 첫 줄만 */
  showShared: boolean;
  /** 보낸 곳 종류·새 문서를 이 줄에 보이나 - 묶음 첫 줄, 또는 중복 배정으로 윗줄과 보낸 곳이 다른 줄 */
  showDest: boolean;
}

export function buildAScreenLines(rows: readonly OutputARow[]): AScreenLine[] {
  return rows.map((row, index) => {
    const previous = rows[index - 1];
    const isSameDest = previous !== undefined && previous.dest_kind === row.dest_kind && previous.dest_doc_code === row.dest_doc_code;
    return { row, showShared: row.is_group_start, showDest: row.is_group_start || !isSameDest };
  });
}

/** 줄마다 의미 묶음의 첫 줄인가 - 첫 항목, 또는 키가 윗 항목과 다르거나 없는(출처가 은퇴한 번역) 줄 */
export function listMeaningStarts(items: readonly Pick<OutputCItem, "meaning_key">[]): boolean[] {
  return items.map((item, index) => index === 0 || item.meaning_key === null || item.meaning_key !== items[index - 1].meaning_key);
}
