// 편집 확인창이 묻는 것 - 서버 409 confirm_required를 읽고, New 표를 바꿀 때는 풀릴 이음(n)과 보류로 갈 Old 줄(m)의 글을 고른다(쪼개기 먼저 설계 §8 4-3).
// New 표의 수는 서버가 New 문서의 set_layout_table에만 싣는다(backend detach.count_new_table_links) - 없으면 지금 글(Old 기준)을 쓴다.
import { ApiError } from "@/lib/api";

export interface EditAsk {
  /** 판단이 걸린 단위 수 */
  count: number;
  /** 이음이 풀릴 New 칸 문장 수 - New 표가 아니면 null */
  linkedCells: number | null;
  /** 보류로 갈 Old 줄 수(짝 · 묶음으로 접은 수) - New 표가 아니면 null */
  heldRows: number | null;
}

function readCount(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

/** 서버가 "판단이 걸린 단위를 바꾼다"고 물었으면 그 물음 - 다른 오류면 null */
export function readEditAsk(err: unknown): EditAsk | null {
  const rule = err instanceof ApiError && err.rule?.code === "confirm_required" ? err.rule : null;
  if (rule === null || !Array.isArray(rule.unit_ids)) return null;
  return { count: rule.unit_ids.length, linkedCells: readCount(rule.linked_cells), heldRows: readCount(rule.held_rows) };
}

/** New 표 확인창의 본문 - 이은 칸이 있으면 두 수, 표째 이은 표면 보류 줄만. 수가 없거나 둘 다 0이면 null(지금 글) */
export function describeNewTableAsk(ask: EditAsk): { bodyKey: string; values: { n: number; m: number } } | null {
  const { linkedCells: n, heldRows: m } = ask;
  if (n === null || m === null || (n === 0 && m === 0)) return null;
  return { bodyKey: n > 0 ? "assign.newTable.confirmBody" : "assign.newTable.confirmBodyHeld", values: { n, m } };
}
