// 문서별 확대 - 마우스를 올린 문서에서만 Ctrl(⌘)+휠과 Ctrl(⌘) +/−/0을 가로챈다. 문서 밖에서는 브라우저 확대가 그대로 돈다.
// 두 문서를 감싼 칸 하나에 리스너를 달고, 이벤트가 난 문서는 [data-pane]으로 가린다(New 칸이 열리고 닫혀도 다시 달 필요가 없다).
"use client";

import { useEffect, useRef, useState } from "react";

export type PaneKey = "old" | "new";
export type ZoomDir = "+" | "-" | "0";

// 트랙패드 핀치는 작은 Ctrl+휠이 잦다 - 이만큼 모이면 한 칸
const WHEEL_STEP = 40;
const KEY_DIRS: Record<string, ZoomDir> = { "=": "+", "+": "+", "-": "-", _: "-", "0": "0" };

function readPane(target: EventTarget | null): PaneKey | null {
  const pane = target instanceof Element ? target.closest<HTMLElement>("[data-pane]")?.dataset.pane : undefined;
  return pane === "old" || pane === "new" ? pane : null;
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

/** 두 문서를 감싼 칸에 줄 ref 콜백을 돌려준다. onStep은 늘 가장 최근 것을 부른다 */
export function usePaneZoom(onStep: (pane: PaneKey, dir: ZoomDir) => void): (el: HTMLElement | null) => void {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const stepRef = useRef(onStep);
  useEffect(() => {
    stepRef.current = onStep;
  });

  useEffect(() => {
    if (!container) return;
    let hovered: PaneKey | null = null;
    let acc = 0;
    const over = (event: PointerEvent) => {
      hovered = readPane(event.target);
    };
    const leave = () => {
      hovered = null;
    };
    // React onWheel은 passive라 막을 수 없다 - 직접 단다
    const wheel = (event: WheelEvent) => {
      const pane = readPane(event.target);
      if (!(event.ctrlKey || event.metaKey) || pane === null) return;
      event.preventDefault();
      acc += event.deltaY;
      if (Math.abs(acc) < WHEEL_STEP) return;
      stepRef.current(pane, acc < 0 ? "+" : "-");
      acc = 0;
    };
    const key = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || hovered === null || isTyping(event.target)) return;
      const dir = KEY_DIRS[event.key];
      if (!dir) return;
      event.preventDefault();
      stepRef.current(hovered, dir);
    };
    container.addEventListener("pointerover", over);
    container.addEventListener("pointerleave", leave);
    container.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("keydown", key);
    return () => {
      container.removeEventListener("pointerover", over);
      container.removeEventListener("pointerleave", leave);
      container.removeEventListener("wheel", wheel);
      window.removeEventListener("keydown", key);
    };
  }, [container]);

  return setContainer;
}
