// Assign의 한 단 ↔ 양 단 전환 움직임 - 폭은 바로 바뀌고, Old 용지가 앞 자리에서 새 자리로 미끄러진다(FLIP).
// 폭을 프레임마다 바꾸면 긴 문서의 글이 매번 다시 흘러 끊기므로 옮기기만 한다(transform). 시간은 CSS 토큰이라 움직임 줄이기에서 0이 된다.
// 움직이는 동안 .assign-panes에 data-motion("one" | "two")이 붙는다 - CSS가 그 동안 연결선을 숨기고, 끝나면 연결선이 다시 잰다(link-lines가 animationend를 듣는다).
// 한 단으로 접을 때는 사라지는 New 칸의 모습(복제본)을 그 자리에 잠깐 남겨 옅어지게 한다 - 화면이 두 상태를 함께 들지 않아도 되게 그림만 남긴다.
"use client";

import { useLayoutEffect, useRef } from "react";

const PANES = ".assign-panes";
const OLD_SHEET = `${PANES} [data-pane="old"] .sheet`;
const NEW_PANE = `${PANES} [data-pane="new"]`;
// 복제본에서 떼는 속성 - 테스트·코드가 진짜 요소로 잘못 찾거나(id) 들어오는 움직임이 다시 돌지 않게
const GHOST_STRIP = ["data-testid", "id", "data-enter", "data-leave"];
// 끝 알림(animationend)이 오지 않아도(가려진 탭 등) 표시가 남지 않게 지우는 시간(ms) - --dur-slow(240ms)보다 넉넉히
const MOTION_MAX_MS = 600;

function readSheetLeft(): number | null {
  return document.querySelector(OLD_SHEET)?.getBoundingClientRect().left ?? null;
}

interface PaneGhost {
  el: HTMLElement;
  scrollTop: number;
}

/** 지금 보이는 New 칸의 복제본 - 자리와 스크롤을 그대로 지닌 그림이다(누르기·포커스·읽어 주기에서 빠진다). 움직임 줄이기면 만들지 않는다 */
function makeGhost(): PaneGhost | null {
  const panes = document.querySelector<HTMLElement>(PANES);
  const pane = document.querySelector<HTMLElement>(NEW_PANE);
  if (!panes || !pane || matchMedia("(prefers-reduced-motion: reduce)").matches) return null;
  const el = pane.cloneNode(true);
  if (!(el instanceof HTMLElement)) return null;
  for (const node of [el, ...el.querySelectorAll<HTMLElement>("*")]) for (const name of GHOST_STRIP) node.removeAttribute(name);
  const box = pane.getBoundingClientRect();
  const frame = panes.getBoundingClientRect();
  el.dataset.ghost = "";
  el.inert = true;
  el.setAttribute("aria-hidden", "true");
  Object.assign(el.style, { left: `${box.left - frame.left}px`, top: `${box.top - frame.top}px`, width: `${box.width}px`, height: `${box.height}px` });
  return { el, scrollTop: pane.querySelector(".pane-body")?.scrollTop ?? 0 };
}

/** capture()는 보기를 바꾸기 직전에 부른다 - 그때 용지가 보이던 자리를 잰다(앞선 움직임 도중이면 그 자리에서 이어진다) */
export function usePaneSlide(isSingle: boolean): { capture: () => void } {
  const firstRef = useRef<number | null>(null);
  const ghostRef = useRef<PaneGhost | null>(null);

  useLayoutEffect(() => {
    const first = firstRef.current;
    const ghost = ghostRef.current;
    firstRef.current = null;
    ghostRef.current = null;
    const panes = document.querySelector<HTMLElement>(PANES);
    const last = readSheetLeft();
    if (first === null || last === null || !panes) return;
    panes.style.setProperty("--pane-dx", `${first - last}px`);
    panes.dataset.motion = isSingle ? "one" : "two";
    if (isSingle && ghost) {
      panes.appendChild(ghost.el);
      // 복제본은 스크롤 자리를 잃는다 - 보던 자리 그대로 옅어지게 되돌린다
      const body = ghost.el.querySelector(".pane-body");
      if (body) body.scrollTop = ghost.scrollTop;
    }
    const clear = () => {
      delete panes.dataset.motion;
      ghost?.el.remove();
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
      // New 칸이 지금 보인다 = 곧 접힌다
      ghostRef.current = makeGhost();
    },
  };
}
