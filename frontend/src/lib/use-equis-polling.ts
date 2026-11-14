// EQUIS 조회 중인 줄이 있는 동안만 목록을 다시 읽는다 - 조회는 저장 응답 뒤에 끝나므로 화면이 조금 뒤 따라간다. 간격 2초, 30초 뒤 멈춘다.
"use client";

import { useEffect, useEffectEvent } from "react";

import { EQUIS_POLL_MAX, EQUIS_POLL_MS } from "./equis-model";

export function useEquisPolling(active: boolean, reload: () => void): void {
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
  }, [active]);
}
