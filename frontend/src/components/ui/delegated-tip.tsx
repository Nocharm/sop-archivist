// 맡겨 두는 툴팁 - 아이콘 표시처럼 수천 개가 될 수 있는 것에 `Tooltip`을 하나씩 두지 않고, 감싼 영역 하나가 `data-tip`을 가진 요소의 툴팁을 띄운다.
// 모양·뜨는 시간은 `Tooltip`과 같다(150ms, `.tip`). 포인터를 올리거나 키보드 포커스가 가면 뜬다.
"use client";

import { useEffect, useRef, useState, type FocusEvent, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { placeAbove, placeBelow, type FloatingPos } from "@/components/ui/floating";

const SHOW_DELAY_MS = 150;

interface DelegatedTip {
  /** 툴팁을 맡을 영역에 펼쳐 넣는 핸들러 */
  handlers: {
    onPointerOver: (event: PointerEvent<HTMLElement>) => void;
    onPointerOut: (event: PointerEvent<HTMLElement>) => void;
    onPointerDown: () => void;
    onFocus: (event: FocusEvent<HTMLElement>) => void;
    onBlur: () => void;
  };
  /** 영역 안 어디에든 그려 둔다(body로 나간다) */
  node: ReactNode;
}

function findHost(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>("[data-tip]") : null;
}

export function useDelegatedTip(): DelegatedTip {
  const hostRef = useRef<HTMLElement | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | null>(null);
  const [label, setLabel] = useState<string | null>(null);
  const [pos, setPos] = useState<FloatingPos | null>(null);

  useEffect(() => {
    if (label === null) return;
    const frame = requestAnimationFrame(() => {
      const host = hostRef.current;
      const tip = tipRef.current;
      if (host && tip) {
        // data-tip-side="top" - 아래에 다른 창이 뜨는 자리(나눌 선)는 위로
        const place = host.dataset.tipSide === "top" ? placeAbove : placeBelow;
        setPos(place(host.getBoundingClientRect(), tip.getBoundingClientRect(), "center"));
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [label]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  function hide() {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    hostRef.current = null;
    setLabel(null);
    setPos(null);
  }

  function show(host: HTMLElement | null) {
    if (host === hostRef.current) return;
    hide();
    if (!host) return;
    hostRef.current = host;
    timerRef.current = window.setTimeout(() => setLabel(host.dataset.tip ?? null), SHOW_DELAY_MS);
  }

  return {
    handlers: {
      onPointerOver: (event) => show(findHost(event.target)),
      onPointerOut: (event) => {
        // 같은 요소 안에서 옮겨 간 것은 나간 것이 아니다
        if (hostRef.current && !(event.relatedTarget instanceof Node && hostRef.current.contains(event.relatedTarget))) hide();
      },
      onPointerDown: hide,
      onFocus: (event) => show(findHost(event.target)),
      onBlur: hide,
    },
    node:
      label !== null &&
      createPortal(
        <div ref={tipRef} role="tooltip" className="tip" data-testid="paper-tip" style={pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0, visibility: "hidden" }}>
          {label}
        </div>,
        document.body,
      ),
  };
}
