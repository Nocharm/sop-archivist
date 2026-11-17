// 참조 지도의 바탕 끌기 - 바탕을 누른 채 4px 넘게 끌면 스크롤 위치를 옮긴다(설계 2026-11-17 참조 지도 §6.4, 계획 판단 23).
// 끌기 층(lib/box-drag.ts)의 문턱·판정만 쓰고 attachBoxDrag는 쓰지 않는다 - 놓을 자리가 없는 끌기다.
// pointerdown에서 preventDefault를 부르지 않는다(메뉴 닫기·포커스가 그대로 돈다), 끈 뒤의 click 한 번은 삼킨다, 마디·단추 위에서는 시작하지 않는다.
"use client";

import { useEffect, type RefObject } from "react";

import { DRAG_GUARD_SELECTOR, hasPassedThreshold } from "@/lib/box-drag";

// 마디와 줄기 머리는 누르는 곳이다 - 거기서 시작한 끌기는 스크롤하지 않는다
const PAN_GUARD_SELECTOR = `${DRAG_GUARD_SELECTOR}, .map-node, .map-lane-head`;

interface Press {
  pointerId: number;
  x: number;
  y: number;
  left: number;
  top: number;
  isPanning: boolean;
  /** Esc로 끌기를 거둔 뒤 아직 놓지 않았다 - 놓을 때 따라오는 click을 삼킨다 */
  isCancelled: boolean;
}

/** 놓은 뒤 따라오는 click 한 번을 캡처 단계에서 삼킨다 - 그 click이 바탕 누르기(고름 풀기)가 되지 않게. click이 오지 않으면 다음 틱에 거둔다 */
function swallowNextClick() {
  const stop = (event: MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
  };
  window.addEventListener("click", stop, { capture: true, once: true });
  window.setTimeout(() => window.removeEventListener("click", stop, { capture: true }), 0);
}

export function useMapPan(scrollRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let press: Press | null = null;

    const finish = (restore: boolean) => {
      if (!press) return;
      if (restore) {
        el.scrollLeft = press.left;
        el.scrollTop = press.top;
      }
      delete el.dataset.pan;
      if (el.hasPointerCapture(press.pointerId)) el.releasePointerCapture(press.pointerId);
      press = null;
      window.removeEventListener("keydown", handleKey, true);
    };

    // Esc는 처음 자리로 돌린다 - 지도의 다른 Esc(고름 풀기)까지 가지 않게 캡처에서 멈춘다.
    // 누름은 놓을 때까지 쥐고 있다(포인터 캡처도) - 놓을 때의 click이 바탕 누르기가 되어 고름을 풀지 않게 그때 삼킨다
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !press?.isPanning) return;
      event.preventDefault();
      event.stopPropagation();
      el.scrollLeft = press.left;
      el.scrollTop = press.top;
      delete el.dataset.pan;
      press.isPanning = false;
      press.isCancelled = true;
    };

    const handleDown = (event: PointerEvent) => {
      // 터치는 브라우저 스크롤에 맡긴다
      if (event.button !== 0 || (event.pointerType !== "mouse" && event.pointerType !== "pen")) return;
      if (!(event.target instanceof Element) || event.target.closest(PAN_GUARD_SELECTOR)) return;
      // 스크롤 막대 위의 누름은 막대에 맡긴다
      const rect = el.getBoundingClientRect();
      if (event.clientX - rect.left - el.clientLeft >= el.clientWidth || event.clientY - rect.top - el.clientTop >= el.clientHeight) return;
      press = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: el.scrollLeft, top: el.scrollTop, isPanning: false, isCancelled: false };
      window.addEventListener("keydown", handleKey, true);
    };

    const handleMove = (event: PointerEvent) => {
      if (!press || event.pointerId !== press.pointerId) return;
      // 문턱 전에 칸 밖에서 놓으면 pointerup이 오지 않는다 - 단추가 떼어진 움직임이면 누름을 거둔다
      if ((event.buttons & 1) === 0) {
        finish(false);
        return;
      }
      if (press.isCancelled) return;
      const dx = event.clientX - press.x;
      const dy = event.clientY - press.y;
      if (!press.isPanning) {
        if (!hasPassedThreshold(dx, dy)) return;
        press.isPanning = true;
        el.dataset.pan = "";
        el.setPointerCapture(event.pointerId);
      }
      el.scrollLeft = press.left - dx;
      el.scrollTop = press.top - dy;
    };

    const handleUp = (event: PointerEvent) => {
      if (!press || event.pointerId !== press.pointerId) return;
      const shouldSwallow = press.isPanning || press.isCancelled;
      finish(false);
      if (shouldSwallow) swallowNextClick();
    };

    const handleCancel = (event: PointerEvent) => {
      if (press && event.pointerId === press.pointerId) finish(true);
    };

    el.addEventListener("pointerdown", handleDown);
    el.addEventListener("pointermove", handleMove);
    el.addEventListener("pointerup", handleUp);
    el.addEventListener("pointercancel", handleCancel);
    return () => {
      finish(false);
      el.removeEventListener("pointerdown", handleDown);
      el.removeEventListener("pointermove", handleMove);
      el.removeEventListener("pointerup", handleUp);
      el.removeEventListener("pointercancel", handleCancel);
    };
  }, [scrollRef]);
}
