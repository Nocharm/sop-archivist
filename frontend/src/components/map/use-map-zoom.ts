// 참조 지도의 Ctrl(⌘)+휠 확대 - 지도 칸 위에서만 가로챈다. 지도 밖에서는 브라우저 확대가 그대로 돈다(use-pane-zoom.ts와 같은 원칙).
"use client";

import { useEffect, useEffectEvent, type RefObject } from "react";

import { stepZoom } from "@/lib/map-layout";

// 트랙패드 핀치는 작은 Ctrl+휠이 잦다 - 이만큼 모이면 한 칸(use-pane-zoom.ts와 같은 값)
const WHEEL_STEP = 40;

/** onZoom(다음 배율, 포인터 자리 - 칸 왼쪽 위 기준 px). 칸은 이 훅을 부르는 부품이 그릴 때 이미 있어야 한다 */
export function useMapZoom(scrollRef: RefObject<HTMLElement | null>, zoom: number, onZoom: (next: number, anchor: { x: number; y: number } | null) => void): void {
  const handleStep = useEffectEvent((dir: 1 | -1, anchor: { x: number; y: number }) => {
    const next = stepZoom(zoom, dir);
    if (next !== zoom) onZoom(next, anchor);
  });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let acc = 0;
    // React onWheel은 passive라 막을 수 없다 - 직접 단다
    const wheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      acc += event.deltaY;
      if (Math.abs(acc) < WHEEL_STEP) return;
      const rect = el.getBoundingClientRect();
      handleStep(acc < 0 ? 1 : -1, { x: event.clientX - rect.left - el.clientLeft, y: event.clientY - rect.top - el.clientTop });
      acc = 0;
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [scrollRef]);
}
