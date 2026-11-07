// 조건이 일정 시간 넘게 이어질 때만 true - 빠른 응답(150ms 안)에는 스켈레톤도 보이지 않게 한다(디자인 문서 11절).
"use client";

import { useEffect, useState } from "react";

export const SKELETON_DELAY_MS = 150;

export function useDelayedFlag(active: boolean, delayMs = SKELETON_DELAY_MS): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => setShown(true), delayMs);
    return () => {
      window.clearTimeout(timer);
      setShown(false);
    };
  }, [active, delayMs]);
  return active && shown;
}
