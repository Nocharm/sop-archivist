// 한 번 누름과 두 번 누름을 가른다 - 한 번은 잠깐 기다렸다가(두 번째가 오지 않으면) 하고, 그 사이 두 번째가 오면 한 번 일은 버리고 두 번 일만 한다.
// 1단 보기 짝 안내 줄: 한 번 = 짝 엿보기 판, 두 번 = 짝으로 가기(B7). 타이머는 effect 예산 밖 공용 훅에 둔다(source-rules).
"use client";

import { useCallback, useEffect, useRef } from "react";

/** 두 번째 누름을 기다리는 시간(ms) - 길면 한 번 누름이 굼떠 보이고, 짧으면 느린 두 번 누름이 한 번 둘로 갈린다 */
export const CLICK_OR_DOUBLE_MS = 250;

/** 누를 때마다 handle(onSingle, onDouble)을 부른다. 한 번 일은 그 누름 때의 onSingle을 쥐고 기다린다. 사라질 때 기다리던 한 번 일은 버린다 */
export function useClickOrDouble(delayMs = CLICK_OR_DOUBLE_MS): (onSingle: () => void, onDouble: () => void) => void {
  const timerRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );
  return useCallback(
    (onSingle: () => void, onDouble: () => void) => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
        onDouble();
        return;
      }
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        onSingle();
      }, delayMs);
    },
    [delayMs],
  );
}
