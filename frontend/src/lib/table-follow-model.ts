// 한글 표 따라 하기 1(11-23 명세 D2-R3) - 벗긴 영어 Old 표 머리의 "짝 표 고르기"를 언제 보이고 무엇을 고르게 하는지. 짝 답은 서버가 센다(table_follow.py)
import type { DocumentView, TableCounterpart } from "@/lib/api-sop";

/** 표 머리에 보일 것 - ask = 고르기(애매 · 사람이 정함 · 짝 없다는 답이지만 후보가 있음), matched = 흐린 "표 n과 짝", none = 아무것도 */
export type CounterpartView = "ask" | "matched" | "none";

export interface CounterpartState {
  lang: "ko" | "en" | null | undefined;
  side: "old" | "new";
  isUnwrapped: boolean;
  status: TableCounterpart["status"];
  /** 사람이 정한 답 - 정했으면 바꿀 수 있게 고르기를 그대로 둔다 */
  decided?: boolean;
  /** 서버가 준 한글 후보 수 - 짝이 없다는 답(점수가 임계값 아래)도 후보가 있으면 사람이 고른다(D2-R3) */
  candidates?: number;
}

/** 고르기 값 - 아직 고르지 않음 · 한글 표 id · 짝 없음 */
export const PICK_VALUE = "pick";
export const NO_COUNTERPART_VALUE = "none";

export function describeCounterpart(state: CounterpartState): CounterpartView {
  if (state.lang !== "en" || state.side !== "old" || !state.isUnwrapped) return "none";
  if (state.status === "ambiguous" || state.decided === true) return "ask";
  if (state.status === "matched") return "matched";
  // 점수가 임계값 아래인 답 - 번갈아 문서(후보 하나)와 임베딩이 꺼진 환경의 토큰 없는 짝도 사람이 정할 길이 있어야 한다
  return (state.candidates ?? 0) > 0 ? "ask" : "none";
}

/** 짝을 물을 표 - Old 문서의 벗긴 영어 본문 표(띠 표 제외, 서버의 후보 표 종류와 같다) */
export function listFollowTableIds(view: DocumentView): number[] {
  if (view.document.side !== "old") return [];
  return view.tables.filter((table) => table.is_layout && table.lang === "en" && table.part === "body" && !table.is_band).map((table) => table.id);
}

/** 고르기의 지금 값과 보기 - 후보(점수 차례) 뒤에 "짝 없음". 사람이 정하지 않았으면 값은 PICK_VALUE(자리표시) */
export function listCounterpartChoices(answer: TableCounterpart): { value: string; choices: { value: string; tableNo: number | null }[] } {
  const choices = [...answer.candidates.map((item) => ({ value: String(item.table_id), tableNo: item.table_no })), { value: NO_COUNTERPART_VALUE, tableNo: null }];
  if (!answer.decided) return { value: PICK_VALUE, choices };
  return { value: answer.source_table_id === null ? NO_COUNTERPART_VALUE : String(answer.source_table_id), choices };
}
