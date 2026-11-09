// 두 문서 사이 세로선 - 끌어서 폭(30~70%), 더블클릭은 반반, 포커스 뒤 ←→. 끄는 동안은 부모의 --split만 바꾸고 놓을 때 알린다(큰 화면을 매 움직임마다 다시 그리지 않게).
"use client";

import { useRef, type KeyboardEvent, type PointerEvent } from "react";

import { clampSplit } from "@/lib/assign-model";
import { useI18n } from "@/lib/i18n";

const KEY_STEP = 0.03;

export function PaneDivider({ value, onCommit }: { value: number; onCommit: (ratio: number) => void }) {
  const { t } = useI18n();
  const dragging = useRef(false);

  function setLive(el: HTMLElement, ratio: number) {
    el.parentElement?.style.setProperty("--split", `${ratio * 100}%`);
    el.setAttribute("aria-valuenow", String(Math.round(ratio * 100)));
  }

  function readRatio(el: HTMLElement, clientX: number): number {
    const rect = el.parentElement?.getBoundingClientRect();
    return rect && rect.width > 0 ? clampSplit((clientX - rect.left) / rect.width) : value;
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    dragging.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.dataset.drag = "";
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (dragging.current) setLive(event.currentTarget, readRatio(event.currentTarget, event.clientX));
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>) {
    if (!dragging.current) return;
    dragging.current = false;
    delete event.currentTarget.dataset.drag;
    onCommit(readRatio(event.currentTarget, event.clientX));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    event.stopPropagation();
    const next = clampSplit(value + (event.key === "ArrowLeft" ? -KEY_STEP : KEY_STEP));
    setLive(event.currentTarget, next);
    onCommit(next);
  }

  return (
    <div
      className="pane-divider"
      role="separator"
      aria-orientation="vertical"
      aria-label={t("assign.divider")}
      aria-valuemin={30}
      aria-valuemax={70}
      aria-valuenow={Math.round(value * 100)}
      tabIndex={0}
      data-testid="assign-divider"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onDoubleClick={() => onCommit(0.5)}
      onKeyDown={handleKeyDown}
    />
  );
}
