// 한글 표 따라 하기(11-23 명세 D2) - 벗긴 영어 Old 표 머리의 "짝 표 고르기"(R3)와 "한글 표처럼 하기"(R8)를 언제 보이고 무엇을 보내는지.
// 짝 답과 규칙 제안은 서버가 센다(table_follow.py) - 화면은 그 답을 칩과 편집 follow_table로 옮기기만 한다
import type { DocumentView, EditOp, FollowItem, FollowItemInput, TableCounterpart, TableFollow } from "@/lib/api-sop";

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

/** 칩 하나 - 메시지 키와 채울 값 */
export interface FollowChip {
  key: string;
  values: Record<string, string | number>;
}

/** 칩이 있는 일인가 - 서버 FollowItem.has_change와 같다 */
export function hasFollowChange(item: FollowItem): boolean {
  return item.unit_ids.length > 1 || item.order !== null || item.number !== null || item.indent || item.delete;
}

/** 줄 하나의 칩 - 지울 줄은 "삭제" 하나만, 그 밖에는 순서 · 합치기 · 들여쓰기 · 번호 차례 */
export function describeFollowItem(item: FollowItem): FollowChip[] {
  if (item.delete) return [{ key: "assign.follow.delete", values: {} }];
  const chips: FollowChip[] = [];
  if (item.order !== null) chips.push({ key: "assign.follow.order", values: { n: item.order } });
  if (item.unit_ids.length > 1) chips.push({ key: "assign.follow.merge", values: { n: item.unit_ids.length } });
  if (item.indent) chips.push({ key: "assign.follow.indent", values: {} });
  if (item.number !== null) chips.push({ key: "assign.follow.number", values: { n: item.number } });
  return chips;
}

function toFollowInput(item: FollowItem): FollowItemInput {
  if (item.delete) return { unit_ids: item.unit_ids, delete: true };
  return {
    unit_ids: item.unit_ids,
    ...(item.number !== null ? { number: item.number } : {}),
    ...(item.indent_shift !== null ? { indent_shift: item.indent_shift } : {}),
  };
}

/** 편집에 실을 일인가 - 순서만 바뀌는 줄은 order가 맡고, 들여쓰기 칩만 있는 줄(번호 깊이 차이)은 번호가 맡는다 */
function isSentItem(item: FollowItem): boolean {
  return item.delete || item.unit_ids.length > 1 || item.number !== null || item.indent_shift !== null;
}

/**
 * 규칙 제안 → 편집 follow_table. only가 없으면 다(적용), 있으면 그 줄(첫 단위 id)만(하나씩 보기의 적용).
 * order는 덩이 줄 전부(합칠 줄은 그 첫 줄)의 새 차례 - 다 맞출 때는 일마다 자리(order, 없으면 지금 자리), 한 줄이면 그 줄만 제자리로 옮긴다. 옮길 것이 없으면 null
 */
export function buildFollowOp(tableId: number, items: readonly FollowItem[], only?: readonly number[]): Extract<EditOp, { type: "follow_table" }> {
  const current = items.map((item) => item.unit_ids[0]);
  const picked = only === undefined ? items : items.filter((item) => only.includes(item.unit_ids[0]));
  let order: number[] | null = null;
  if (only === undefined && items.some((item) => item.order !== null)) {
    order = items
      .map((item, index) => ({ head: item.unit_ids[0], place: (item.order ?? index + 1) - 1, index }))
      .sort((a, b) => a.place - b.place || a.index - b.index)
      .map((entry) => entry.head);
  } else if (only !== undefined) {
    const moving = picked.find((item) => item.order !== null);
    if (moving !== undefined && moving.order !== null) {
      const rest = current.filter((head) => head !== moving.unit_ids[0]);
      order = [...rest.slice(0, moving.order - 1), moving.unit_ids[0], ...rest.slice(moving.order - 1)];
    }
  }
  return { type: "follow_table", table_id: tableId, items: picked.filter(isSentItem).map(toFollowInput), order };
}

/** ⇧O의 뜻 - 보이는 규칙 제안이 있으면 그대로 하기, 아니면 지금처럼 AI 순서 제안(D2-R8) */
export function pickOrderAction(state: { follow: TableFollow["mode"]; count: number }): "follow" | "order" {
  return state.follow === "rule" && state.count > 0 ? "follow" : "order";
}
