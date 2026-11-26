// 떠 있는 작은 칸(팝오버)을 바깥 누르기·Esc로 닫는다 - Menu·AI 작업 목록과 같은 층 규칙(맨 위 층만 Esc를 받는다).
"use client";

import { useEffect, useEffectEvent, type RefObject } from "react";

import { isTopEscLayer, popEscLayer, pushEscLayer } from "@/components/ui/floating";

/** open인 동안 ref 밖을 누르거나 Esc를 누르면 onClose를 부른다. 알림(.toast-stack)과 keepOpenOn(그 칸을 연 단추 등)을 누르는 것은 바깥으로 치지 않는다. */
export function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, onClose: () => void, keepOpenOn?: string): void {
  const requestClose = useEffectEvent(() => onClose());
  useEffect(() => {
    if (!open) return;
    const layer = pushEscLayer();
    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || ref.current?.contains(target)) return;
      if (target instanceof Element && target.closest(keepOpenOn ? `.toast-stack, ${keepOpenOn}` : ".toast-stack")) return;
      requestClose();
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !isTopEscLayer(layer)) return;
      event.stopPropagation();
      requestClose();
    };
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      popEscLayer(layer);
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open, ref, keepOpenOn]);
}
