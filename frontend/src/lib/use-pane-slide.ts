// Assign의 한 단 ↔ 양 단 전환 움직임 - 폭은 바로 바뀌고, Old 용지가 앞 자리에서 새 자리로 미끄러진다(FLIP).
// 폭을 프레임마다 바꾸면 긴 문서의 글이 매번 다시 흘러 끊기므로 옮기기만 한다(transform). 시간은 CSS 토큰이라 움직임 줄이기에서 0이 된다.
// 움직이는 동안 .assign-panes에 data-motion("one" | "two")이 붙는다 - CSS가 그 동안 연결선을 숨기고, 끝나면 연결선이 다시 잰다(link-lines가 animationend를 듣는다).
"use client";

import { useLayoutEffect, useRef } from "react";

const PANES = ".assign-panes";
const OLD_SHEET = `${PANES} [data-pane="old"] .sheet`;
// 끝 알림(animationend)이 오지 않아도(가려진 탭 등) 표시가 남지 않게 지우는 시간(ms) - --dur-slow(240ms)보다 넉넉히
const MOTION_MAX_MS = 600;

function readSheetLeft(): number | null {
  return document.querySelector(OLD_SHEET)?.getBoundingClientRect().left ?? null;
}

/** capture()는 보기를 바꾸기 직전에 부른다 - 그때 용지가 보이던 자리를 잰다(앞선 움직임 도중이면 그 자리에서 이어진다) */
export function usePaneSlide(isSingle: boolean): { capture: () => void } {
  const firstRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    const first = firstRef.current;
    firstRef.current = null;
    const panes = document.querySelector<HTMLElement>(PANES);
    const last = readSheetLeft();
    if (first === null || last === null || !panes) return;
    panes.style.setProperty("--pane-dx", `${first - last}px`);
    panes.dataset.motion = isSingle ? "one" : "two";
    const clear = () => {
      delete panes.dataset.motion;
    };
    const handleEnd = (event: AnimationEvent) => {
      if (event.animationName === "pane-slide") clear();
    };
    const timer = window.setTimeout(clear, MOTION_MAX_MS);
    panes.addEventListener("animationend", handleEnd);
    return () => {
      window.clearTimeout(timer);
      panes.removeEventListener("animationend", handleEnd);
      clear();
    };
  }, [isSingle]);

  return {
    capture: () => {
      firstRef.current = readSheetLeft();
    },
  };
}
