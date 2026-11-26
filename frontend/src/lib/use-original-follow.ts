// 원본 보기의 따라가기 · 배율 · 쪽 칩 - 고른 Unit의 문단(칸)을 칠하고 거리별 움직임(D8)으로 가운데로 데려간다.
// 판정은 순수 모델 lib/original-page-model.ts readFollowMotion, 여기는 DOM에 칠하고 굴리는 일만. 흐림의 끝은 animationend로 기다린다.
// 설계: docs/superpowers/specs/2026-11-27-original-view-design.md §5.3·§5.4
"use client";

import { useEffect, useEffectEvent, useState, type RefObject } from "react";

import { pickFollowTarget, readCssLength, readFollowMotion } from "@/lib/original-page-model";

/** 부드럽게 굴리는 시간(D8 0.25초) */
const SMOOTH_MS = 250;
const PICKED_CLASS = "is-ov-picked";
const FLASH_CLASS = "is-ov-flash";
const PAGE_SELECTOR = "section.sopa-ov";
// components.css .ov-host[data-ov-fade]의 키프레임 이름
const FADE_OUT = "ov-dim";
const FADE_IN = "ov-undim";

type FollowTarget = ReturnType<typeof pickFollowTarget>;

// DOM 바꾸기는 훅 밖 함수로 - 훅 인자(ref)에서 온 값을 훅 안에서 바로 고치면 React 컴파일러 규칙에 걸린다
function setScrollTop(el: HTMLElement, top: number): void {
  el.scrollTop = top;
}

function setFade(el: HTMLElement, phase: "out" | "in" | null): void {
  if (phase === null) delete el.dataset.ovFade;
  else el.dataset.ovFade = phase;
}

function setZoom(el: HTMLElement, zoom: number): void {
  el.style.zoom = String(zoom);
}

/** 그린 원본의 뿌리 - 그리개는 host의 그림자 뿌리 안에 그린다 */
function readRoot(host: HTMLElement): ShadowRoot | HTMLElement {
  return host.shadowRoot ?? host;
}

function isReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** 칠할 요소들 - 표지가 고른 것(p · td · table)의 가장 가까운 요소. 그린 DOM에 없는 표지는 건너뛴다 */
function findPaintTargets(root: ShadowRoot | HTMLElement, target: NonNullable<FollowTarget>): HTMLElement[] {
  const found = new Set<HTMLElement>();
  for (const mark of target.marks) {
    if (mark.id === "") continue;
    const anchor = root instanceof HTMLElement ? root.querySelector(`[id="${mark.id}"]`) : root.getElementById(mark.id);
    const el = anchor?.closest<HTMLElement>(mark.paint) ?? null;
    if (el !== null) found.add(el);
  }
  return [...found];
}

/** 스크롤 안에서의 위치 - 배율(zoom)이 걸려도 화면 좌표로 잰다 */
function measureIn(scroller: HTMLElement, el: HTMLElement): { top: number; bottom: number } {
  const base = scroller.getBoundingClientRect().top - scroller.scrollTop;
  const rect = el.getBoundingClientRect();
  return { top: rect.top - base, bottom: rect.bottom - base };
}

function flash(el: HTMLElement): void {
  el.classList.remove(FLASH_CLASS);
  void el.offsetWidth; // 같은 문단을 다시 골라도 처음부터 번쩍이게 스타일을 한 번 계산시킨다
  el.classList.add(FLASH_CLASS);
  el.addEventListener("animationend", () => el.classList.remove(FLASH_CLASS), { once: true });
}

export function useOriginalFollow(input: {
  host: RefObject<HTMLElement | null>;
  scroller: RefObject<HTMLElement | null>;
  target: FollowTarget;
  repeating: boolean;
  /** 그리기가 끝난 문서 - 바뀌면 배율과 쪽 칩을 다시 건다 */
  renderedDocId: number | null;
  pageCount: number;
}): { page: number } {
  const { host, scroller, target, repeating, renderedDocId, pageCount } = input;
  const [page, setPage] = useState(1);
  const targetKey = target === null ? "" : `${target.unitId}:${target.marks.map((mark) => `${mark.id}@${mark.page}`).join(",")}`;
  const readTarget = useEffectEvent(() => target);
  const readRepeating = useEffectEvent(() => repeating);

  // 배율(종이가 칸보다 넓으면 칸 폭에 맞춤, 좁으면 1배)과 굴릴 때의 쪽 번호
  useEffect(() => {
    const scrollEl = scroller.current;
    const hostEl = host.current;
    if (scrollEl === null || hostEl === null || renderedDocId === null) return;
    const root = readRoot(hostEl);
    const wrapper = root.querySelector<HTMLElement>(".sopa-ov-wrapper");
    const pages = [...root.querySelectorAll<HTMLElement>(PAGE_SELECTOR)];
    const paperWidth = Math.max(0, ...pages.map((one) => readCssLength(one.style.width)).filter((width) => width > 0));
    let frame = 0;
    const readPage = () => {
      frame = 0;
      const middle = scrollEl.getBoundingClientRect().top + scrollEl.clientHeight / 2;
      let current = 1;
      pages.forEach((one, index) => {
        if (one.getBoundingClientRect().top <= middle) current = index + 1;
      });
      setPage(current);
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(readPage);
    };
    const fit = () => {
      if (wrapper === null || paperWidth <= 0) return;
      const style = getComputedStyle(wrapper);
      const pad = (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0);
      setZoom(wrapper, Math.min(1, scrollEl.clientWidth / (paperWidth + pad)));
      schedule();
    };
    const observer = new ResizeObserver(fit);
    observer.observe(scrollEl);
    scrollEl.addEventListener("scroll", schedule, { passive: true });
    fit();
    schedule();
    return () => {
      observer.disconnect();
      scrollEl.removeEventListener("scroll", schedule);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [host, scroller, renderedDocId, pageCount]);

  // 칠하고 데려가기 - 고른 것이 바뀔 때만(같은 고름의 새 객체로는 다시 굴리지 않는다)
  useEffect(() => {
    const scrollEl = scroller.current;
    const hostEl = host.current;
    const current = readTarget();
    if (scrollEl === null || hostEl === null) return;
    const root = readRoot(hostEl);
    for (const old of root.querySelectorAll(`.${PICKED_CLASS}`)) old.classList.remove(PICKED_CLASS);
    if (current === null) return;
    const painted = findPaintTargets(root, current);
    for (const el of painted) el.classList.add(PICKED_CLASS);
    // 표지를 못 찾으면 그 블록의 쪽 머리로
    const fallbackPage = current.marks.find((mark) => mark.page !== null)?.page ?? null;
    const goal = painted[0] ?? (fallbackPage === null ? null : root.querySelectorAll<HTMLElement>(PAGE_SELECTOR)[fallbackPage - 1] ?? null);
    if (goal === null) return;

    const reduced = isReducedMotion();
    const { top, bottom } = measureIn(scrollEl, goal);
    const viewHeight = scrollEl.clientHeight;
    const centered = bottom - top > viewHeight ? top - 16 : top - (viewHeight - (bottom - top)) / 2;
    const destination = Math.max(0, Math.min(centered, scrollEl.scrollHeight - viewHeight));
    const motion = readFollowMotion({ scrollTop: scrollEl.scrollTop, viewHeight, targetTop: top, targetBottom: bottom, repeating: readRepeating(), reduced });
    const arrive = () => {
      if (!reduced && painted.length > 0) flash(painted[0]);
    };

    let frame = 0;
    let onFadeEnd: ((event: AnimationEvent) => void) | null = null;
    if (motion === "none") arrive();
    else if (motion === "instant") {
      setScrollTop(scrollEl, destination);
      arrive();
    } else if (motion === "smooth") {
      const from = scrollEl.scrollTop;
      let startedAt: number | null = null;
      const step = (now: number) => {
        startedAt ??= now;
        const progress = Math.min(1, (now - startedAt) / SMOOTH_MS);
        const eased = progress < 0.5 ? 2 * progress * progress : 1 - (-2 * progress + 2) ** 2 / 2;
        setScrollTop(scrollEl, from + (destination - from) * eased);
        if (progress < 1) frame = requestAnimationFrame(step);
        else {
          frame = 0;
          arrive();
        }
      };
      frame = requestAnimationFrame(step);
    } else {
      // 멀면 흐렸다(0.09초) 그 자리에서 밝힌다(0.14초) - 끝은 CSS 움직임의 animationend
      onFadeEnd = (event: AnimationEvent) => {
        // 그림자 뿌리 안(번쩍임)의 animationend도 host로 올라온다(대상이 host로 바뀐 채) - 이름으로 가린다
        if (event.animationName !== FADE_OUT && event.animationName !== FADE_IN) return;
        if (hostEl.dataset.ovFade === "out") {
          setScrollTop(scrollEl, destination);
          setFade(hostEl, "in");
        } else {
          setFade(hostEl, null);
          arrive();
        }
      };
      hostEl.addEventListener("animationend", onFadeEnd);
      setFade(hostEl, "out");
    }
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      if (onFadeEnd !== null) {
        hostEl.removeEventListener("animationend", onFadeEnd);
        if (hostEl.dataset.ovFade === "out") setScrollTop(scrollEl, destination);
        setFade(hostEl, null);
      }
    };
  }, [host, scroller, targetKey, renderedDocId]);

  return { page: Math.min(page, Math.max(1, pageCount)) };
}
