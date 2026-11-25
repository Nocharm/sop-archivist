// Assign의 한 단 ↔ 양 단 전환 움직임 - 폭은 바로 바뀌고, Old 용지가 앞 자리에서 새 자리로 미끄러진다(FLIP).
// 폭을 프레임마다 바꾸면 긴 문서의 글이 매번 다시 흘러 끊기므로 옮기기만 한다(transform). 시간은 CSS 토큰이라 움직임 줄이기에서 0이 된다.
// 움직이는 동안 .assign-panes에 data-motion("one" | "two" | 판 옆으로 비킬 때 "aside")이 붙는다 - CSS가 그 동안 연결선을 숨기고, 끝나면 연결선이 다시 잰다(link-lines가 animationend를 듣는다).
// 한 단으로 접을 때는 사라지는 New 칸의 모습(복제본)을 그 자리에 잠깐 남겨 옅어지게 한다 - 화면이 두 상태를 함께 들지 않아도 되게 그림만 남긴다.
"use client";

import { useLayoutEffect, useRef } from "react";

import { planSpotPlace } from "@/lib/spot-place-model";

const PANES = ".assign-panes";
const OLD_SHEET = `${PANES} [data-pane="old"] .sheet`;
const OLD_PANE = `${PANES} [data-pane="old"]`;
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

/** 앞 자리(first)에서 지금 자리로 용지를 미끄러뜨린다 - 끝나면(또는 MOTION_MAX_MS 뒤) 표시와 복제본을 지운다. 돌려준 함수로 미리 멈춘다 */
function startSlide(first: number | null, motion: string, ghost: PaneGhost | null): (() => void) | undefined {
  const panes = document.querySelector<HTMLElement>(PANES);
  const last = readSheetLeft();
  if (first === null || last === null || !panes) return undefined;
  panes.style.setProperty("--pane-dx", `${first - last}px`);
  panes.dataset.motion = motion;
  if (ghost) {
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
    return startSlide(first, isSingle ? "one" : "two", isSingle ? ghost : null);
  }, [isSingle]);

  return {
    capture: () => {
      firstRef.current = readSheetLeft();
      // New 칸이 지금 보인다 = 곧 접힌다
      ghostRef.current = makeGhost();
    },
  };
}

/**
 * 1단 보기에서 오른쪽 판(짝 엿보기 · 그림 위치)이 열리고 닫힐 때 - 용지는 폭 그대로 두고 자리 있으면 왼쪽으로 비켜서고 다시 가운데로 온다(B7 · §6 S2).
 * 판이 열린 동안 칸 · 용지 폭을 재(`planSpotPlace`) `.assign-panes`에 data-spot("aside" | "cover")과 --spot-w(판 폭)를 단다 - 용지 폭이 줄지 않으니 줄이 다시 접히지 않고 보던 자리가 튀지 않는다. 자리를 비우는 몸은 CSS.
 * partKey(지금 보이는 파트 탭)가 바뀌면 용지가 다시 만들어지니 다시 잰다(탭만 바뀐 때는 first가 null이라 움직임이 없다).
 * capture()는 판을 열거나 닫기 직전에 부른다. 잡지 않고 닫히면(다른 박스를 고름 등) 움직임 없이 바로 돌아온다.
 */
export function useSheetSlide(isAside: boolean, partKey: string): { capture: () => void } {
  const firstRef = useRef<number | null>(null);

  // 한 이펙트에서 먼저 data-spot을 달고(용지의 새 자리를 읽기 전에 있어야 한다) 그다음 슬라이드를 시작한다 - 정리는 둘 다
  useLayoutEffect(() => {
    const first = firstRef.current;
    firstRef.current = null;
    const panes = document.querySelector<HTMLElement>(PANES);
    const pane = document.querySelector<HTMLElement>(OLD_PANE);
    const sheet = document.querySelector<HTMLElement>(OLD_SHEET);
    let stopObserving: (() => void) | undefined;
    if (isAside && panes && pane && sheet) {
      const measure = () => {
        const plan = planSpotPlace({ pane: pane.getBoundingClientRect().width, sheet: sheet.getBoundingClientRect().width });
        if (!plan) return;
        panes.dataset.spot = plan.kind;
        panes.style.setProperty("--spot-w", `${plan.panel}px`);
      };
      measure();
      const observer = new ResizeObserver(measure);
      observer.observe(pane);
      observer.observe(sheet);
      stopObserving = () => {
        observer.disconnect();
        delete panes.dataset.spot;
        panes.style.removeProperty("--spot-w");
      };
    }
    // 자리가 모자라 판이 덮으면 용지는 제자리다 - 움직임 표시를 달지 않는다
    const stopSlide = first === readSheetLeft() ? undefined : startSlide(first, "aside", null);
    return () => {
      stopSlide?.();
      stopObserving?.();
    };
  }, [isAside, partKey]);

  return {
    capture: () => {
      firstRef.current = readSheetLeft();
    },
  };
}
