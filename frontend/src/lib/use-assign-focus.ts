// Assign의 고름 · 처리 중 · 따라가기 한 벌 - 규칙은 순수 모델(assign-focus-model), 이 훅은 그 상태를 쥐고 부를 이름만 낸다.
// 다시 받은 보기는 화면이 렌더 중에 load로 알린다(effect를 화면 파일에 더하지 않는다, 설계 2026-11-20 D1).
"use client";

import { useReducer } from "react";
import {
  applyLoaded,
  INITIAL_FOCUS_STATE,
  isGlobalPending,
  isUnitLocked,
  isUnitUnsettled,
  reduceFocus,
  type FocusEvent,
  type Pending,
  type Picks,
  type SidePick,
} from "./assign-focus-model";
import type { PickSide } from "./doc-shape-model";

/** 응답이 알려 준 따라갈 자리 - pickUnitId가 null이면 고름을 둔다 */
export interface FollowTarget {
  docId: number | null;
  revision: number | null;
  pickUnitId: number | null;
}

export function useAssignFocus() {
  const [state, dispatch] = useReducer(reduceFocus, INITIAL_FOCUS_STATE);

  /** isAuto - 저장 뒤 다음 박스로 옮긴 것(사람이 누른 것이 아니다) */
  function pick(next: SidePick, isAuto = false) {
    dispatch({ type: "pick", isAuto, ...next });
  }

  /** 오른쪽 칸에서 보낼 곳을 골랐다 - 다음에 박스를 누를 때까지 Enter는 확정이다 */
  function chooseDestination() {
    dispatch({ type: "choose_destination" });
  }

  function clear(what: "all" | "new") {
    dispatch({ type: "clear", what });
  }

  /** 멈췄던 때의 고름으로 */
  function restore(picks: Picks) {
    dispatch({ type: "restore", picks });
  }

  /** 일 하나를 처리 중으로 세운다(side - 고치는 문서의 쪽) - 줄에 서는 순간(아직 보내기 전이어도) 부른다. id는 명령 큐의 것이고 그것으로 succeed · end를 부른다 */
  function start(pending: Pending, side?: PickSide) {
    dispatch({ type: "start", pending, side });
  }

  /** 응답이 왔다 - 고름이 누른 때 그대로면 그 박스를 따라간다(보기를 다시 받은 뒤 고른다). 일은 end까지 처리 중으로 남는다 */
  function succeed(pendingId: string, target: FollowTarget) {
    dispatch({ type: "succeed", pendingId, ...target });
  }

  /** 일을 걷는다 - 실패 · 되묻기 · 성공 모두. 두 번 불러도 된다(표 벗기기는 새 보기를 놓을 때 먼저 걷고 큐가 끝에 또 부른다) */
  function end(pendingId: string) {
    dispatch({ type: "fail", pendingId });
  }

  /** 기다리던 묶음 전체 일을 보낼 때 - 그 사이 건 따라가기를 버린다 */
  function dropFollows() {
    dispatch({ type: "dropFollows" });
  }

  /** 렌더 중에 부른다 - 받은 보기를 알리고, 이번에 고른 따라가기와 끝난 따라가기를 돌려준다(화면이 스크롤 · 거르기 목록을 맞춘다) */
  function load(event: Extract<FocusEvent, { type: "loaded" }>) {
    const result = applyLoaded(state, event);
    if (result.state !== state) dispatch(event);
    return { picks: result.state, picked: result.picked, consumed: result.consumed };
  }

  return {
    /** 두 쪽의 고름 */
    picks: state,
    /** 처리 중인 일 - 용지가 알약 · 쉬머를 그린다 */
    pending: state.pending,
    isAnyPending: state.pending.length > 0,
    isGlobalPending: isGlobalPending(state),
    isUnitLocked: (unitId: number) => isUnitLocked(state, unitId),
    isUnitUnsettled: (docId: number, unitId: number) => isUnitUnsettled(state, docId, unitId),
    pick,
    chooseDestination,
    clear,
    restore,
    start,
    succeed,
    end,
    dropFollows,
    load,
  };
}
