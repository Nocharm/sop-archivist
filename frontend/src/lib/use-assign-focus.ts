// Assign의 고름 · 처리 중 · 따라가기 한 벌 - 규칙은 순수 모델(assign-focus-model), 이 훅은 그 상태를 쥐고 부를 이름만 낸다.
// 다시 받은 보기는 화면이 렌더 중에 load로 알린다(effect를 화면 파일에 더하지 않는다, 설계 2026-11-20 D1).
"use client";

import { useReducer } from "react";
import { applyLoaded, INITIAL_FOCUS_STATE, reduceFocus, type Focus, type FocusEvent, type Pending } from "./assign-focus-model";
import { genId } from "./id";

/** 응답이 알려 준 따라갈 자리 - pickUnitId가 null이면 고름을 둔다 */
export interface FollowTarget {
  docId: number | null;
  revision: number | null;
  pickUnitId: number | null;
}

export function useAssignFocus() {
  const [state, dispatch] = useReducer(reduceFocus, INITIAL_FOCUS_STATE);

  function pick(focus: Focus) {
    dispatch({ type: "pick", focus });
  }

  /** 일 하나를 시작한다 - 돌려준 id로 succeed · end를 부른다. 막을지는 부르는 쪽이 isAnyPending으로 본다 */
  function start(pending: Omit<Pending, "id">): string {
    const id = genId();
    dispatch({ type: "start", pending: { ...pending, id } });
    return id;
  }

  /** 응답이 왔다 - 고름이 누른 때 그대로면 그 박스를 따라간다(보기를 다시 받은 뒤 고른다) */
  function succeed(pendingId: string, target: FollowTarget) {
    dispatch({ type: "succeed", pendingId, ...target });
  }

  /** 일을 걷는다 - 실패 · 되묻기 · 따라갈 것 없는 성공 모두. succeed 뒤에 불러도 아무 일도 없다 */
  function end(pendingId: string) {
    dispatch({ type: "fail", pendingId });
  }

  /** 렌더 중에 부른다 - 받은 보기를 알리고, 이번에 고른 따라가기와 끝난 따라가기를 돌려준다(화면이 스크롤 · 거르기 목록을 맞춘다) */
  function load(event: Extract<FocusEvent, { type: "loaded" }>) {
    const result = applyLoaded(state, event);
    if (result.state !== state) dispatch(event);
    return { focus: result.state.focus, picked: result.picked, consumed: result.consumed };
  }

  return {
    focus: state.focus,
    // 스텝 4(문서별 쓰기 줄) 전까지는 일이 하나라도 있으면 화면 전체를 막는다 - 그때 모델의 isUnitLocked · canStart가 Unit 단위로 넘겨받는다
    isAnyPending: state.pending.length > 0,
    pick,
    start,
    succeed,
    end,
    load,
  };
}
