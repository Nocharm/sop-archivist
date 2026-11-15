// EQUIS 조회 중인 줄이 있는 동안만 목록을 다시 읽는다 - 조회는 저장 응답 뒤에 끝나므로 화면이 조금 뒤 따라간다. 간격 2초, 30초 뒤 멈춘다.
"use client";

import { useEffect, useEffectEvent } from "react";

import { EQUIS_POLL_MAX, EQUIS_POLL_MS } from "./equis-model";

/** progress - 조회가 여러 번에 나뉘어 도는 목록(참조 줄)은 남은 수를 넘긴다. 수가 바뀌면 30초를 새로 센다(줄어드는 동안은 멈추지 않는다) */
export function useEquisPolling(active: boolean, reload: () => void, progress = 0): void {
  const run = useEffectEvent(reload);
  useEffect(() => {
    if (!active) return;
    let ticks = 0;
    const id = window.setInterval(() => {
      ticks += 1;
      run();
      if (ticks >= EQUIS_POLL_MAX) window.clearInterval(id);
    }, EQUIS_POLL_MS);
    return () => window.clearInterval(id);
  }, [active, progress]);
}
