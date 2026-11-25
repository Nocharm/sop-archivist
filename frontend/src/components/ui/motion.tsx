// 움직임 부품 - 접기·펼치기, 내용이 바뀐 자리의 쉬머, 라벨에 따라 폭이 바뀌는 단추의 모핑, 넘치는 글의 말줄임과 호버 툴팁, 목록 자리 바꿈(FLIP), 옮겨 간 자리 번쩍임,
// 풀기 전환(걷기 · 펼치기 · 붙이기 - useUnwrapMotion).
// 값은 tokens(--dur-*, --ease-*)를 쓰고, 움직임 줄이기 설정에서는 토큰이 0이 되어 바로 바뀐다.
"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { createPortal, flushSync } from "react-dom";

import { placeBelow, type FloatingPos } from "@/components/ui/floating";
import { isBoxDragActive } from "@/lib/box-drag";
import { computeFlipOffsets } from "@/lib/flip";
import {
  buildMarkerKeyframes,
  computeAnchoredScrollTop,
  computeStaggerDelays,
  computeUnwrapShifts,
  getSpreadEnd,
  isOnScreen,
  parseDurationMs,
  pickOnScreenKeys,
  pickScrollAnchor,
  planUnwrapPhases,
  planUnwrapRevert,
  type MarkerPhase,
  type MotionBox,
  type MotionSnapshot,
  type ScrollAnchor,
  type UnwrapMarker,
  type UnwrapTimings,
} from "@/lib/unwrap-motion";

/** 이동해 간 자리를 잠깐 번쩍인다([data-flash], components.css) - 다시 이동하면 처음부터. Assign 이동과 Order의 다른 칸 놓기가 같이 쓴다 */
export function flashElement(el: HTMLElement): void {
  delete el.dataset.flash;
  void el.offsetWidth; // 애니메이션을 다시 시작하게 스타일을 한 번 계산시킨다
  el.dataset.flash = "";
  window.setTimeout(() => delete el.dataset.flash, 1300);
}

// 줄마다 마지막으로 건 FLIP 순번 - 앞선 움직임의 끝 알림이 늦게 와서 새 움직임의 스타일을 지우지 않게
const flipRuns = new WeakMap<HTMLElement, number>();
let flipSequence = 0;

function findFlipElements(container: HTMLElement, keys: readonly string[]): Map<string, HTMLElement> {
  const elements = new Map<string, HTMLElement>();
  for (const key of keys) {
    const element = container.querySelector<HTMLElement>(`[data-flip-key=${JSON.stringify(key)}]`);
    if (element) elements.set(key, element);
  }
  return elements;
}

/** 감싼 요소 안에서의 위쪽 자리 - 스크롤해도 변하지 않는다(재는 사이에 화면이 따라 스크롤해도 거리가 어긋나지 않게) */
function measureTops(container: HTMLElement, elements: ReadonlyMap<string, HTMLElement>): Map<string, number> {
  const base = container.getBoundingClientRect().top;
  return new Map([...elements].map(([key, element]) => [key, element.getBoundingClientRect().top - base]));
}

/**
 * 목록 자리 바꿈 - 바뀌기 전에 capture(바뀔 줄의 키)로 [data-flip-key] 요소 자리를 재면, 다음 커밋에서 다시 재 거꾸로 옮긴 뒤(translateY)
 * 다음 프레임에 --dur-slow·--ease-move로 제자리에 미끄러져 온다. 첫 키가 옮긴 줄이라 미끄러지는 동안 .flip-lead로 이웃 위에 둔다.
 * 긴 목록에서 줄 전체를 재지 않게 넘긴 키만 잰다(그리지 않은 줄은 건너뛴다). 움직임 줄이기 설정이면 아무것도 하지 않아 바로 바뀐다.
 */
export function useFlip(containerRef: RefObject<HTMLElement | null>): { capture: (keys: readonly string[]) => void } {
  const pendingRef = useRef<{ keys: readonly string[]; first: Map<string, number> } | null>(null);

  // 커밋마다 돈다 - 잰 것이 없으면 바로 끝난다
  useLayoutEffect(() => {
    const pending = pendingRef.current;
    const container = containerRef.current;
    pendingRef.current = null;
    if (!pending || !container) return;
    const elements = findFlipElements(container, pending.keys);
    // 앞선 움직임이 아직 돌면 멈추고 제자리에서 잰다 - 처음 자리는 그때 보이던 자리라 이어서 미끄러진다
    for (const element of elements.values()) {
      element.style.transition = "none";
      element.style.transform = "";
    }
    const offsets = computeFlipOffsets(pending.first, measureTops(container, elements));
    const run = ++flipSequence;
    const moving: HTMLElement[] = [];
    for (const [key, element] of elements) {
      const offset = offsets.get(key);
      flipRuns.set(element, run);
      if (offset === undefined) {
        // 움직이지 않은 줄 - 재려고 건 스타일을 지운다(앞선 움직임의 끝 알림도 이 순번 때문에 무시된다)
        element.style.transition = "";
        element.classList.remove("flip-lead");
        continue;
      }
      element.style.transform = `translateY(${offset}px)`;
      element.classList.toggle("flip-lead", key === pending.keys[0]);
      moving.push(element);
    }
    if (moving.length === 0) return;
    // 거꾸로 옮긴 자리를 스타일에 올려 둔다 - 안 하면 다음 프레임의 바꿈과 합쳐져 전환이 일어나지 않는다
    void container.offsetHeight;
    requestAnimationFrame(() => {
      for (const element of moving) {
        if (flipRuns.get(element) !== run) continue;
        const finish = (event: TransitionEvent) => {
          // 줄 안 단추의 투명도 전환도 거품으로 올라온다 - 이 줄의 transform만 본다
          if (event.target !== element || event.propertyName !== "transform") return;
          element.removeEventListener("transitionend", finish);
          element.removeEventListener("transitioncancel", finish);
          if (flipRuns.get(element) !== run) return;
          element.style.transition = "";
          element.classList.remove("flip-lead");
        };
        element.addEventListener("transitionend", finish);
        element.addEventListener("transitioncancel", finish);
        element.style.transition = "transform var(--dur-slow) var(--ease-move)";
        element.style.transform = "";
      }
    });
  });

  function capture(keys: readonly string[]) {
    const container = containerRef.current;
    if (!container || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    pendingRef.current = { keys, first: measureTops(container, findFlipElements(container, keys)) };
  }

  return { capture };
}

/** 그려져 있는 요소인가 - 화면 밖이라 브라우저가 건너뛴 덩어리(content-visibility) 안의 것은 재지 않는다(재면 그 덩어리를 배치하게 된다) */
function isRendered(element: HTMLElement): boolean {
  return typeof element.checkVisibility !== "function" || element.checkVisibility({ contentVisibilityAuto: true });
}

/** 그려져 있고 창의 세로 범위에 걸친 요소인가 */
function isInWindow(element: HTMLElement): boolean {
  if (!isRendered(element)) return false;
  const { left, top, bottom } = element.getBoundingClientRect();
  return isOnScreen({ left, top, bottom }, { top: 0, bottom: window.innerHeight });
}

/** [data-flip-key] 요소의 자리와 그때 창에 보이던 범위 - 감싼 요소 기준이라 재는 사이에 스크롤해도 어긋나지 않는다. 그려진 것만 잰다 */
function takeUnwrapSnapshot(container: HTMLElement): { snapshot: MotionSnapshot; elements: Map<string, HTMLElement> } {
  const base = container.getBoundingClientRect();
  const elements = new Map<string, HTMLElement>();
  const boxes = new Map<string, MotionBox>();
  for (const element of container.querySelectorAll<HTMLElement>("[data-flip-key]")) {
    const key = element.dataset.flipKey;
    if (key === undefined || elements.has(key) || !isRendered(element)) continue;
    const rect = element.getBoundingClientRect();
    elements.set(key, element);
    boxes.set(key, { left: rect.left - base.left, top: rect.top - base.top, bottom: rect.bottom - base.top });
  }
  return { snapshot: { boxes, view: { top: -base.top, bottom: window.innerHeight - base.top } }, elements };
}

/** 바뀌는 곳([data-unwrap-scope]) 가운데 화면에 있는 것 */
function findUnwrapScopes(container: HTMLElement, scopes: readonly string[]): HTMLElement[] {
  return scopes.flatMap((scope) => [...container.querySelectorAll<HTMLElement>(`[data-unwrap-scope=${JSON.stringify(scope)}]`)]).filter(isInWindow);
}

/** 바뀌는 곳에 바로 딸린 표시 가운데 화면에 있는 것 - 안쪽 표처럼 그 안의 다른 scope에 딸린 표시는 그 표를 풀 때 움직인다 */
function findUnwrapMarks(container: HTMLElement, scopes: readonly string[], marker: UnwrapMarker): HTMLElement[] {
  const attribute = `data-unwrap-${marker}`;
  return findUnwrapScopes(container, scopes).flatMap((scope) =>
    [scope, ...scope.querySelectorAll<HTMLElement>(`[${attribute}]`)].filter((element) => element.hasAttribute(attribute) && element.closest("[data-unwrap-scope]") === scope && isInWindow(element)),
  );
}

/** tokens.css의 풀기 전환 값 - 시간은 ms로, 곡선은 animate에 넘길 글 그대로 */
function readUnwrapTokens(): { timings: UnwrapTimings; easing: Record<MarkerPhase["easing"] | "move", string> } {
  const style = getComputedStyle(document.documentElement);
  const readMs = (name: string) => parseDurationMs(style.getPropertyValue(name));
  const readEasing = (name: string) => style.getPropertyValue(name).trim();
  return {
    timings: { clear: readMs("--dur-base"), spread: readMs("--dur-spread"), attach: readMs("--dur-attach"), staggerStep: readMs("--stagger-step"), staggerMax: readMs("--stagger-max") },
    easing: { exit: readEasing("--ease-exit"), move: readEasing("--ease-move"), pop: readEasing("--ease-pop") },
  };
}

/** 움직일 수 있는가 - 없는 칸 · animate가 없는 곳 · 움직임 줄이기면 바로 바꾸고 번쩍이기만 한다 */
function canAnimate(container: HTMLElement | null): container is HTMLElement {
  return container !== null && typeof container.animate === "function" && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

const readMarkKind = (mark: HTMLElement, marker: UnwrapMarker) => mark.getAttribute(`data-unwrap-${marker}`) ?? "";

/** 걷기 - 사라질 표시가 옅어진다. revert는 그 움직임을 지금 자리에서 반대로 튼 것 */
function playUnwrapClear(container: HTMLElement | null, scopes: readonly string[], reverse: boolean): { animation: Animation; revert: () => Animation }[] {
  if (!canAnimate(container)) return [];
  const { timings, easing: easings } = readUnwrapTokens();
  const { before, direction } = planUnwrapPhases(timings, reverse);
  const back = planUnwrapRevert(timings, reverse);
  const easing = easings[before.easing];
  return findUnwrapMarks(container, scopes, before.marker).map((mark) => {
    const keyframes = buildMarkerKeyframes(before.marker, readMarkKind(mark, before.marker));
    // 끝난 모양으로 붙들어 둔다(fill) - 응답을 기다리는 동안과 바꿈이 그려지기 전에 다시 나타나지 않게
    const animation = mark.animate(keyframes, { duration: before.duration, easing, direction, fill: "forwards" });
    return {
      animation,
      revert: () => {
        const played = Math.min(Number(animation.currentTime ?? before.duration), before.duration);
        animation.cancel();
        return mark.animate(keyframes, { ...back, easing, delay: played - back.duration });
      },
    };
  });
}

interface UnwrapRun {
  animations: Animation[];
  /** 걷는 동안 미뤄 둔 바꿈 - 응답 전이거나 적용했으면 null */
  change: (() => void) | null;
  /** 전환이 끝나면 부를 일(afterMotion) */
  settled: (() => void)[];
}

/** 바꾸기 직전 보던 자리(B3) - 칸(.pane-body)과 그 안 기준 요소. 브라우저 스크롤 고정은 고정한 요소가 바뀌는 표 안이면 놓친다 */
function readScrollAnchor(container: HTMLElement, scopes: readonly string[]): { pane: HTMLElement; anchor: ScrollAnchor } | null {
  const pane = container.querySelector<HTMLElement>(".pane-body");
  if (!pane) return null;
  const frame = pane.getBoundingClientRect();
  const measure = (element: HTMLElement | null): MotionBox | null => {
    if (!element || !isRendered(element)) return null;
    const { left, top, bottom } = element.getBoundingClientRect();
    return { left, top, bottom };
  };
  const scopeBoxes = new Map<string, MotionBox>();
  for (const scope of scopes) {
    const box = measure(pane.querySelector<HTMLElement>(`[data-unwrap-scope=${JSON.stringify(scope)}]`));
    if (box) scopeBoxes.set(scope, box);
  }
  const view = { top: frame.top, bottom: frame.bottom };
  // 표 머리가 보이면 글 줄은 재지 않는다 - 긴 문서는 줄이 수천이다
  const head = pickScrollAnchor(scopeBoxes, new Map(), view);
  if (head) return { pane, anchor: head };
  const lineBoxes = new Map<string, MotionBox>();
  for (const element of pane.querySelectorAll<HTMLElement>("[data-flip-key]")) {
    const key = element.dataset.flipKey;
    const box = key === undefined || lineBoxes.has(key) ? null : measure(element);
    if (key !== undefined && box && isOnScreen(box, view)) lineBoxes.set(key, box);
  }
  const anchor = pickScrollAnchor(new Map(), lineBoxes, view);
  return anchor ? { pane, anchor } : null;
}

/** 바꾼 뒤 같은 기준 요소가 칸의 같은 높이에 오도록 scrollTop을 되맞춘다 - 요소가 사라졌으면 그대로 둔다 */
function restoreScrollAnchor(kept: { pane: HTMLElement; anchor: ScrollAnchor } | null): void {
  if (!kept || !kept.pane.isConnected) return;
  const { pane, anchor } = kept;
  const element = pane.querySelector<HTMLElement>(`[${anchor.attribute}=${JSON.stringify(anchor.value)}]`);
  if (!element) return;
  pane.scrollTop = computeAnchoredScrollTop(pane.scrollTop, anchor.top, element.getBoundingClientRect().top);
}

/** 돌던 전환을 멈춰 모두 제자리에 둔다 - 아직 걷는 중이라 적용하지 못한 바꿈이 있으면 돌려준다(부른 쪽이 적용해 잃지 않게) */
function stopUnwrapRun(activeRef: RefObject<UnwrapRun | null>): (() => void) | null {
  const active = activeRef.current;
  activeRef.current = null;
  if (!active) return null;
  for (const animation of active.animations) animation.cancel();
  const pending = active.change;
  active.change = null;
  return pending;
}

export interface UnwrapRunOptions {
  /** 바뀌는 곳 - 옛 화면과 새 화면에서 그곳을 감싼 요소의 data-unwrap-scope 값(표 하나면 하나, 같은 꼴 표 모두면 여럿) */
  scopes: readonly string[];
  /** 되돌리기(다시 표로 · 떼기 · 접기) - 같은 표시로 같은 길을 거꾸로 간다 */
  reverse?: boolean;
}

/** 누른 순간 시작한 풀기 전환 하나 - commit이나 revert 가운데 하나를 꼭 부른다(부를 때까지 걷은 채로 있다) */
export interface UnwrapHandle {
  /** 응답이 왔다 - 걷기가 끝나면 change를 그리고 펼친다. 전환이 끝나면(다음 begin이 앞지르면 그때) 풀린다 */
  commit: (change: () => void) => Promise<void>;
  /** 거절 · 되묻기 - 걷은 것을 거꾸로 되돌린다 */
  revert: () => void;
}

/**
 * 풀기 전환 - 표 벗기기처럼 원문 모양이 바뀔 때 누르면 begin, 새 모양을 받으면 그 손잡이의 commit(change)로 세 단계로 바뀐다(명세 F10, 누르는 순간 시작은 A2-R6).
 * 화면은 표시만 단다:
 * - `data-unwrap-scope="<id>"` 바뀌는 곳을 감싼 요소(바꾸기 전과 뒤 모두)
 * - `data-unwrap-leave` 바꾸면 사라지는 것(TABLE 표시 · "캡션 필요" 줄), `data-unwrap-enter` 바꾸면 생기는 것("다시 표로" · 캡션 칩).
 *   값이 "frame"이면 글은 두고 틀(테두리 · 바탕 · 그림자)만 - 표 선과 음영, 왼쪽 세로선. 미끄러지는 글이 든 표시(캡션 칩)도 frame으로 단다(요소째 숨기면 글도 안 보인다)
 * - `data-flip-key` 같은 글(같은 Unit · span)의 옛 자리와 새 자리. 뒤따르는 줄에도 달면 밀려나는 것이 함께 미끄러진다. 글 조각(span)은 inline-block이어야 움직이고,
 *   키를 단 요소 안에 또 달지 않는다(안팎이 함께 옮겨져 두 번 움직인다)
 *
 * 1 걷기: 누르면 leave 표시가 옅어진다(--dur-base · --ease-exit) - commit까지 걷은 채 기다리고, 거절이면 거꾸로(revert). 걷는 동안 온 change는 미뤄 둔다 - 사라질 표시가 화면에 없으면 바로 바꾼다.
 * 2 펼치기: change를 그 자리에서 그려(flushSync) 같은 키가 새 자리로 미끄러진다(--dur-spread · --ease-move, 위 줄부터 --stagger-step씩 늦게, --stagger-max까지).
 * 3 붙이기: enter 표시가 펼치기 뒤에 나타난다(--dur-attach · --ease-pop).
 * 긴 문서에서는 창에 보이는 것만 움직이고 나머지는 재지도 않고 바로 제자리다. 움직임 줄이기 설정이면 바로 바꾸고 바뀐 곳(scope)만 한 번 번쩍인다.
 * 되돌리기 알림은 부른 쪽이 띄운다. begin은 어디서든, commit은 이펙트 밖에서 부른다(이펙트 안에서는 flushSync를 쓸 수 없다)
 */
export function useUnwrapMotion(containerRef: RefObject<HTMLElement | null>): { begin: (options: UnwrapRunOptions) => UnwrapHandle; afterMotion: (callback: () => void) => boolean } {
  const activeRef = useRef<UnwrapRun | null>(null);

  // 걷는 중에 화면을 떠나면 미뤄 둔 바꿈을 그대로 적용한다 - 사람이 한 편집이다
  useEffect(() => () => stopUnwrapRun(activeRef)?.(), []);

  function begin({ scopes, reverse = false }: UnwrapRunOptions): UnwrapHandle {
    // 앞선 전환이 아직 걷는 중이면 그 바꿈부터 - 차례가 바뀌지 않게
    stopUnwrapRun(activeRef)?.();
    const clears = playUnwrapClear(containerRef.current, scopes, reverse);
    const active: UnwrapRun = { animations: clears.map((clear) => clear.animation), change: null, settled: [] };
    activeRef.current = active;

    function finish() {
      if (activeRef.current === active) activeRef.current = null;
      for (const callback of active.settled.splice(0)) callback();
    }

    async function commit(change: () => void): Promise<void> {
      try {
        // 응답을 기다리는 사이 다음 전환이나 화면 떠나기가 앞질렀다 - 움직이지 않고 바꾼다
        if (activeRef.current !== active) flushSync(change);
        else {
          active.change = change;
          await playUnwrapChange(containerRef.current, active, change, scopes, reverse);
        }
      } finally {
        finish();
      }
    }

    function revert(): void {
      if (activeRef.current === active) active.animations = clears.map((clear) => clear.revert());
      void Promise.allSettled(active.animations.map((animation) => animation.finished)).then(finish);
    }

    return { commit, revert };
  }

  async function playUnwrapChange(container: HTMLElement | null, active: UnwrapRun, change: () => void, scopes: readonly string[], reverse: boolean): Promise<void> {
    if (!canAnimate(container)) {
      active.change = null;
      const kept = container ? readScrollAnchor(container, scopes) : null;
      flushSync(change);
      restoreScrollAnchor(kept);
      for (const place of container ? findUnwrapScopes(container, scopes) : []) flashElement(place);
      return;
    }
    const { timings, easing } = readUnwrapTokens();
    const { after, direction } = planUnwrapPhases(timings, reverse);
    if (active.animations.length > 0) await Promise.allSettled(active.animations.map((animation) => animation.finished));
    // 그사이 다음 begin이나 화면 떠나기가 앞질렀다 - 바꿈은 거기서 적용했다
    if (activeRef.current !== active) return;

    const first = takeUnwrapSnapshot(container);
    // 바뀐 뒤에도 남은 표시가 숨은 채 굳지 않게 푼다. 바꾸기 전에 풀어 보던 자리를 잰다(같은 그리기라 보이지 않는다) -
    // 되돌리기의 걷기는 enter 표시를 작게 줄여 윗변이 밀리고, 누른 때 재면 기다리는 동안의 스크롤을 되감는다
    for (const animation of active.animations) animation.cancel();
    const kept = readScrollAnchor(container, scopes);
    active.change = null;
    flushSync(change);
    // 보던 자리부터 되맞춘 뒤 끝 자리를 잰다 - 글은 옛 화면 자리에서 새 화면 자리로 미끄러진다
    restoreScrollAnchor(kept);
    const last = takeUnwrapSnapshot(container);
    const shifts = computeUnwrapShifts(first.snapshot.boxes, last.snapshot.boxes, pickOnScreenKeys(first.snapshot, last.snapshot));
    // 줄 차례는 펼친 쪽 화면의 자리로 센다 - 앞으로는 끝 자리, 되돌리기는 처음 자리
    const spreadBoxes = (reverse ? first : last).snapshot.boxes;
    const delays = computeStaggerDelays(new Map([...shifts.keys()].map((key) => [key, spreadBoxes.get(key)?.top ?? 0])), timings, reverse);
    const animations: Animation[] = [];
    for (const [key, { dx, dy }] of shifts) {
      const element = last.elements.get(key);
      // 늦게 떠나는 줄은 그때까지 옛 자리에 붙들어 둔다(fill)
      if (element) animations.push(element.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: timings.spread, easing: easing.move, delay: delays.get(key) ?? 0, fill: "backwards" }));
    }
    const spreadEnd = getSpreadEnd(delays, timings.spread);
    for (const mark of findUnwrapMarks(container, scopes, after.marker)) {
      // 펼치기가 끝날 때까지 숨은 모양으로 붙들어 둔다(fill)
      animations.push(mark.animate(buildMarkerKeyframes(after.marker, readMarkKind(mark, after.marker)), { duration: after.duration, easing: easing[after.easing], direction, delay: spreadEnd, fill: "backwards" }));
    }
    active.animations = animations;
    await Promise.allSettled(animations.map((animation) => animation.finished));
  }

  /** 도는(또는 응답을 기다리는) 전환이 있으면 끝난 뒤(다음 begin이 앞질러도 그때) callback을 부르고 true - 없으면 부르지 않고 false(부른 쪽이 바로 한다).
   *  바꿈을 그리는 렌더에서 불러도 된다 - 따라가기 스크롤을 전환 뒤로 미룬다 */
  function afterMotion(callback: () => void): boolean {
    const active = activeRef.current;
    if (!active) return false;
    active.settled.push(callback);
    return true;
  }

  return { begin, afterMotion };
}

// 접힘 전환(--dur-slow 240ms)보다 조금 길게 기다린 뒤 내용을 뗀다
const COLLAPSE_EXIT_MS = 260;

/** 열릴 때 붙이고 다음 프레임에 펼치며, 닫힐 때 접은 뒤 뗀다 - 닫힌 내용은 DOM에 남지 않는다. appear면 열린 채 처음 붙어도 접힌 모양에서 펼치고,
 * startOpen이면 닫힌 채 처음 붙어도 펼친 모양에서 접는다(방금까지 감싸지 않고 그리던 것) */
function usePresence(open: boolean, appear = false, startOpen = false): { mounted: boolean; shown: boolean } {
  const [mounted, setMounted] = useState(open || startOpen);
  const [shown, setShown] = useState(startOpen || (open && !appear));
  useEffect(() => {
    let frame = 0;
    let timer = 0;
    if (open) {
      frame = requestAnimationFrame(() => {
        setMounted(true);
        frame = requestAnimationFrame(() => setShown(true));
      });
    } else {
      frame = requestAnimationFrame(() => setShown(false));
      timer = window.setTimeout(() => setMounted(false), COLLAPSE_EXIT_MS);
    }
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [open]);
  return { mounted: mounted || open, shown: shown && (open || startOpen) };
}

/** 접기·펼치기 - 높이를 grid 0fr↔1fr로 전환한다(높이를 재지 않아 내용이 바뀌어도 튀지 않는다). children이 함수면 붙어 있는 동안만 그린다.
 * appear면 열린 채 새로 붙어도 펼치며 나타나고, startOpen이면 닫힌 채 새로 붙어도 접히며 사라진다. 접히는 동안 안쪽은 inert라 눌리거나 포커스를 받지 않는다 */
export function Collapse({ open, children, testId, className, appear = false, startOpen = false }: { open: boolean; children: ReactNode | (() => ReactNode); testId?: string; className?: string; appear?: boolean; startOpen?: boolean }) {
  const { mounted, shown } = usePresence(open, appear, startOpen);
  if (!mounted) return null;
  return (
    <div className={className ? `fold ${className}` : "fold"} data-open={shown ? "" : undefined} data-testid={testId} inert={!open || undefined}>
      <div className="fold-inner">{typeof children === "function" ? children() : children}</div>
    </div>
  );
}

/** token이 바뀔 때마다 위를 한 번 쓸고 지나가는 쉬머 - 같은 자리의 내용이 바뀌었음을 알린다. 첫 그림에는 쓸지 않는다(움직임 줄이기면 --dur-refresh 0으로 그리지 않는다) */
export function Refresh({ token, children, className = "", testId }: { token: string | number; children: ReactNode; className?: string; testId?: string }) {
  const [first] = useState(token);
  const isFirst = first === token;
  return (
    <div className={`refresh ${className}`} data-testid={testId}>
      {children}
      {!isFirst && <span key={String(token)} className="refresh-sweep" aria-hidden />}
    </div>
  );
}

/** 안쪽 내용의 폭을 재서 바깥 폭을 전환한다 - 단추 라벨이 바뀌어도 폭이 툭 바뀌지 않는다. 첫 측정은 전환 없이 */
export function MorphWidth({ children }: { children: ReactNode }) {
  const innerRef = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  const [animate, setAnimate] = useState(false);

  useLayoutEffect(() => {
    const inner = innerRef.current;
    if (!inner) return;
    const observer = new ResizeObserver(() => {
      setWidth(inner.offsetWidth);
      requestAnimationFrame(() => setAnimate(true));
    });
    observer.observe(inner);
    return () => observer.disconnect();
  }, []);

  const style: CSSProperties = width === null ? {} : { width };
  return (
    <span className="morph" data-animate={animate ? "" : undefined} style={style}>
      <span ref={innerRef} className="morph-inner">
        {children}
      </span>
    </span>
  );
}

/** 비동기 단추의 라벨 - 일하는 동안 스피너와 진행 라벨로 바뀌고 폭은 모핑한다 */
export function BusyLabel({ busy, label, busyLabel, icon }: { busy: boolean; label: ReactNode; busyLabel?: ReactNode; icon?: ReactNode }) {
  return (
    <MorphWidth>
      {busy ? <Loader2 size={14} strokeWidth={1.5} className="animate-spin" aria-hidden /> : icon}
      {busy ? (busyLabel ?? label) : label}
    </MorphWidth>
  );
}

const TIP_DELAY_MS = 150;

/** 한 줄 말줄임. 실제로 잘렸을 때만 호버(150ms)로 전체 글을 띄운다 - 네이티브 title은 쓰지 않는다 */
export function Truncate({ text, className = "", lang, testId, revealOnFocus = false }: { text: string; className?: string; lang?: string; testId?: string; revealOnFocus?: boolean }) {
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
      if (host && tip) setPos(placeBelow(host.getBoundingClientRect(), tip.getBoundingClientRect(), "start"));
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);

  // 글이 단추 안에 있으면 포인터 대신 단추의 키보드 포커스가 전체 글을 띄운다(opt-in - 다른 곳의 호버 동작은 그대로)
  const revealFocus = useEffectEvent(() => {
    if (hostRef.current?.closest("button, a, [tabindex]")?.matches(":focus-visible")) show();
  });
  useEffect(() => {
    if (!revealOnFocus) return;
    const holder = hostRef.current?.closest<HTMLElement>("button, a, [tabindex]");
    if (!holder) return;
    const handleFocus = () => revealFocus();
    const handleBlur = () => hide();
    holder.addEventListener("focus", handleFocus);
    holder.addEventListener("blur", handleBlur);
    return () => {
      holder.removeEventListener("focus", handleFocus);
      holder.removeEventListener("blur", handleBlur);
    };
  }, [revealOnFocus]);

  function show() {
    const host = hostRef.current;
    // 한 줄 말줄임(가로)과 카드 제목의 두 줄 자르기(세로) 둘 다 잘렸을 때만 띄운다
    if (!host || (host.scrollWidth <= host.clientWidth && host.scrollHeight <= host.clientHeight)) return;
    // 상자를 끄는 동안은 띄우지 않는다(끌어다 놓기 G10 - Tooltip과 같다)
    if (isBoxDragActive()) return;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setOpen(true), TIP_DELAY_MS);
  }

  function hide() {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    setOpen(false);
    setPos(null);
  }

  return (
    <span ref={hostRef} className={`block min-w-0 truncate ${className}`} lang={lang} data-testid={testId} onPointerEnter={show} onPointerLeave={hide}>
      {text}
      {open &&
        createPortal(
          <div
            ref={tipRef}
            role="tooltip"
            className="tip tip-wide"
            lang={lang}
            style={pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0, visibility: "hidden" }}
          >
            {text}
          </div>,
          document.body,
        )}
    </span>
  );
}
