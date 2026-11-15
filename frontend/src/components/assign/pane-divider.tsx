// 두 문서 사이 세로선 - 끌어서 폭(30~70%), 더블클릭은 반반, 포커스 뒤 ←→. 끄는 동안은 부모의 --split만 바꾸고 놓을 때 알린다(큰 화면을 매 움직임마다 다시 그리지 않게).
// 오른쪽 끝까지 끌어 놓으면 New 칸을 접는다(한 단 보기) - 끄는 동안 선이 강조색으로 바뀌어 놓으면 접힌다는 것을 알린다.
"use client";

import { useRef, type KeyboardEvent, type PointerEvent } from "react";

import { clampSplit, isSingleDrop } from "@/lib/assign-model";
import { useI18n } from "@/lib/i18n";

const KEY_STEP = 0.03;

export function PaneDivider({ value, onCommit, onCollapse }: { value: number; onCommit: (ratio: number) => void; onCollapse: () => void }) {
  const { t } = useI18n();
  const dragging = useRef(false);

  function setLive(el: HTMLElement, ratio: number) {
    el.parentElement?.style.setProperty("--split", `${ratio * 100}%`);
    el.setAttribute("aria-valuenow", String(Math.round(ratio * 100)));
  }

  /** 포인터 자리의 왼쪽 비율 - 자르지 않은 값(끝까지 끌었는지 본다) */
  function readRawRatio(el: HTMLElement, clientX: number): number {
    const rect = el.parentElement?.getBoundingClientRect();
    return rect && rect.width > 0 ? (clientX - rect.left) / rect.width : value;
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    dragging.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.dataset.drag = "";
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!dragging.current) return;
    const raw = readRawRatio(event.currentTarget, event.clientX);
    setLive(event.currentTarget, clampSplit(raw));
    if (isSingleDrop(raw)) event.currentTarget.dataset.collapse = "";
    else delete event.currentTarget.dataset.collapse;
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>) {
    if (!dragging.current) return;
    dragging.current = false;
    delete event.currentTarget.dataset.drag;
    delete event.currentTarget.dataset.collapse;
    const raw = readRawRatio(event.currentTarget, event.clientX);
    if (isSingleDrop(raw)) {
      // 폭은 끌기 전 값으로 돌린다 - 양 단으로 돌아오면 쓰던 폭이 그대로다
      setLive(event.currentTarget, value);
      onCollapse();
      return;
    }
    onCommit(clampSplit(raw));
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
