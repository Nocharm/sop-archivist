// Assign의 고름 · 처리 중 · 따라가기 한 벌 - 규칙은 순수 모델(assign-focus-model), 이 훅은 그 상태를 쥐고 부를 이름만 낸다.
// 다시 받은 보기는 화면이 렌더 중에 load로 알린다(effect를 화면 파일에 더하지 않는다, 설계 2026-11-20 D1).
"use client";

import { useReducer, useRef } from "react";
import {
  applyLoaded,
  canStart,
  INITIAL_FOCUS_STATE,
  isGlobalPending,
  isUnitLocked,
  isUnitUnsettled,
  reduceFocus,
  type Focus,
  type FocusEvent,
  type Pending,
} from "./assign-focus-model";
import { enqueueDocWrite } from "./doc-write-queue";
import { genId } from "./id";

/** 응답이 알려 준 따라갈 자리 - pickUnitId가 null이면 고름을 둔다 */
export interface FollowTarget {
  docId: number | null;
  revision: number | null;
  pickUnitId: number | null;
}

export function useAssignFocus() {
  const [state, dispatch] = useReducer(reduceFocus, INITIAL_FOCUS_STATE);
  // 시작했고 아직 걷지 않은 일 - 상태는 다음 렌더에야 바뀌어, 같은 렌더의 함수로 잇달아 눌러도 canStart가 앞 일을 보게 따로 쥔다
  const liveRef = useRef<readonly Pending[]>([]);

  function pick(focus: Focus) {
    dispatch({ type: "pick", focus });
  }

  /** 일 하나를 처리 중으로 세운다 - 돌려준 id로 succeed · end를 부른다. 막을지는 부르는 쪽이 본다(runPending은 canStart로) */
  function start(pending: Omit<Pending, "id">): string {
    const id = genId();
    liveRef.current = [...liveRef.current, { ...pending, id }];
    dispatch({ type: "start", pending: { ...pending, id } });
    return id;
  }

  /** 응답이 왔다 - 고름이 누른 때 그대로면 그 박스를 따라간다(보기를 다시 받은 뒤 고른다). 일은 end까지 처리 중으로 남는다 */
  function succeed(pendingId: string, target: FollowTarget) {
    dispatch({ type: "succeed", pendingId, ...target });
  }

  /** 일을 걷는다 - 실패 · 되묻기 · 성공 모두. 두 번 불러도 된다(표 벗기기는 새 보기를 놓을 때 먼저 걷고 runPending이 끝에 또 부른다) */
  function end(pendingId: string) {
    liveRef.current = liveRef.current.filter((item) => item.id !== pendingId);
    dispatch({ type: "fail", pendingId });
  }

  /**
   * 일 하나 - 시작할 수 없으면(잠긴 Unit과 겹침 · 묶음 전체 일) null. 누르는 즉시 처리 중(알약 · 쉬머 · 잠금)으로 세우고,
   * 원문 편집은 같은 문서의 앞 쓰기 응답 뒤에 보낸다(doc-write-queue, 설계 D4). send가 끝나면(실패해도) 걷는다 - 알림 · 다시 받기는 send가 한다
   */
  function runPending(pending: Omit<Pending, "id">, send: (pendingId: string) => Promise<void>): Promise<void> | null {
    if (!canStart({ pending: liveRef.current }, { ...pending, id: "" })) return null;
    const id = start(pending);
    // 판단 저장은 문서 revision을 쓰지 않는다 - 원문 편집 뒤에 줄 세우지 않는다
    const lane = pending.kind === "save" ? null : pending.docId;
    return enqueueDocWrite(lane, () => send(id)).finally(() => end(id));
  }

  /** 렌더 중에 부른다 - 받은 보기를 알리고, 이번에 고른 따라가기와 끝난 따라가기를 돌려준다(화면이 스크롤 · 거르기 목록을 맞춘다) */
  function load(event: Extract<FocusEvent, { type: "loaded" }>) {
    const result = applyLoaded(state, event);
    if (result.state !== state) dispatch(event);
    return { focus: result.state.focus, picked: result.picked, consumed: result.consumed };
  }

  return {
    focus: state.focus,
    /** 처리 중인 일 - 용지가 알약 · 쉬머를 그린다 */
    pending: state.pending,
    isAnyPending: state.pending.length > 0,
    isGlobalPending: isGlobalPending(state),
    isUnitLocked: (unitId: number) => isUnitLocked(state, unitId),
    isUnitUnsettled: (docId: number, unitId: number) => isUnitUnsettled(state, docId, unitId),
    pick,
    start,
    succeed,
    end,
    load,
    runPending,
  };
}
