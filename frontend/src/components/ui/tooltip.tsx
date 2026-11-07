// 툴팁 - 150ms 뒤에 뜨고 네이티브 title을 쓰지 않는다. 비활성 버튼의 이유도 이것으로 보인다(감싼 span이 포인터를 받는다).
"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { placeBelow, type FloatingPos } from "@/components/ui/floating";

const SHOW_DELAY_MS = 150;

interface TooltipProps {
  label: string;
  children: ReactNode;
  align?: "start" | "end" | "center";
}

export function Tooltip({ label, children, align = "center" }: TooltipProps) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<FloatingPos | null>(null);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const host = hostRef.current;
      const tip = tipRef.current;
      if (host && tip) setPos(placeBelow(host.getBoundingClientRect(), tip.getBoundingClientRect(), align));
    });
    return () => cancelAnimationFrame(frame);
  }, [open, align]);

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);

  function show() {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setOpen(true), SHOW_DELAY_MS);
  }

  function hide() {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    setOpen(false);
    setPos(null);
  }

  return (
    <span
      ref={hostRef}
      className="inline-flex"
      onPointerEnter={show}
      onPointerLeave={hide}
      onFocus={show}
      onBlur={hide}
      onPointerDown={hide}
    >
      {children}
      {open &&
        createPortal(
          <div
            ref={tipRef}
            role="tooltip"
            className="tip"
            style={pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0, visibility: "hidden" }}
          >
            {label}
          </div>,
          document.body,
        )}
    </span>
  );
}
