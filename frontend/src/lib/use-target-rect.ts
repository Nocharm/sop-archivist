// 떠 있는 안내(연습 말풍선)가 가리킬 상자의 자리를 무대(stage) 좌표로 잰다 - 스크롤 · 창 크기 · 크기 바뀜 · 화면 바뀜(상자가 생기거나 옮겨 감)을 한 프레임에 한 번으로 묶는다.
// 상자는 고르개 차례로 문서 전체에서 찾는다(도움말처럼 body로 나간 판도). 스크롤 칸에 가려 안 보이는 부분은 잘라 내고, 고르개가 바뀌어 처음 찾았을 때 가려져 있으면 그 상자로 한 번 스크롤한다.
// CSS anchor positioning은 쓰지 않는다(사내 브라우저 버전을 모른다).
"use client";

import { useEffect, useEffectEvent, useRef, useState, type RefObject } from "react";

export interface TargetBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface TargetRects {
  /** 이 값을 잰 고르개(줄바꿈으로 이은 것) - 지금 고르개와 다르면 아직 재기 전이다 */
  key: string;
  stage: { width: number; height: number };
  /** 무대 좌표의 보이는 부분. 못 찾았거나 스크롤 칸 밖이면 null */
  target: TargetBox | null;
  /** 떠 있는 카드의 크기 */
  card: { width: number; height: number };
}

export interface TargetRectOptions {
  /** 좌표의 기준이 되는 무대 - 카드 층이 이 안에 absolute로 깔린다 */
  stageRef: RefObject<HTMLElement | null>;
  /** 크기를 잴 카드 */
  cardRef: RefObject<HTMLElement | null>;
  /** 이 안의 바뀜은 다시 재는 까닭이 아니다(카드 층 자신 - 제 자리를 옮기는 것이 또 재기를 부르지 않게) */
  ignoreRef: RefObject<HTMLElement | null>;
  /** 앞에서부터 처음 찾은 요소가 대상. 빈 배열이면 대상 없음 */
  selectors: readonly string[];
}

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function intersect(a: Rect, b: Rect): Rect {
  return { left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) };
}

const isEmpty = (rect: Rect) => rect.right - rect.left < 1 || rect.bottom - rect.top < 1;

/** 요소를 감싼 스크롤 · 잘림 칸들과 무대가 남겨 둔 보이는 사각형 */
function readVisible(el: Element, stage: Rect): Rect {
  let visible: Rect = intersect(el.getBoundingClientRect(), stage);
  for (let parent = el.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (style.overflowX !== "visible" || style.overflowY !== "visible") visible = intersect(visible, parent.getBoundingClientRect());
  }
  return visible;
}

function findTarget(selectors: readonly string[]): Element | null {
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el) return el;
  }
  return null;
}

const round = (value: number) => Math.round(value);

function isSameRects(a: TargetRects | null, b: TargetRects): boolean {
  if (a === null || a.key !== b.key) return false;
  const sameBox = a.target === null || b.target === null ? a.target === b.target : a.target.left === b.target.left && a.target.top === b.target.top && a.target.width === b.target.width && a.target.height === b.target.height;
  return sameBox && a.stage.width === b.stage.width && a.stage.height === b.stage.height && a.card.width === b.card.width && a.card.height === b.card.height;
}

export function useTargetRect({ stageRef, cardRef, ignoreRef, selectors }: TargetRectOptions): TargetRects | null {
  const [rects, setRects] = useState<TargetRects | null>(null);
  const frameRef = useRef(0);
  // 고르개가 바뀐 뒤 대상을 처음 찾았을 때 한 번만 스크롤한다 - 사람이 스크롤해 비켜 간 뒤에는 따라가지 않는다
  const scrolledRef = useRef("");
  const key = selectors.join("\n");

  const measure = useEffectEvent(() => {
    frameRef.current = 0;
    const stage = stageRef.current;
    if (!stage) return;
    const stageRect = stage.getBoundingClientRect();
    const el = findTarget(selectors);
    if (el && scrolledRef.current !== key) {
      scrolledRef.current = key;
      const box = el.getBoundingClientRect();
      const visible = readVisible(el, stageRect);
      // 반도 안 보이면 그 상자로(가운데) - 다 보이거나 거의 보이면 그대로 둔다
      if (isEmpty(visible) || (visible.bottom - visible.top) * 2 < box.height) el.scrollIntoView({ block: "center", inline: "nearest" });
    }
    const visible = el ? readVisible(el, stageRect) : null;
    const target = visible === null || isEmpty(visible) ? null : { left: round(visible.left - stageRect.left), top: round(visible.top - stageRect.top), width: round(visible.right - visible.left), height: round(visible.bottom - visible.top) };
    const card = cardRef.current;
    const next: TargetRects = {
      key,
      stage: { width: round(stageRect.width), height: round(stageRect.height) },
      target,
      card: { width: card?.offsetWidth ?? 0, height: card?.offsetHeight ?? 0 },
    };
    setRects((prev) => (isSameRects(prev, next) ? prev : next));
  });

  const schedule = useEffectEvent(() => {
    if (frameRef.current === 0) frameRef.current = requestAnimationFrame(() => measure());
  });

  // 스크롤(어느 칸이든 - scroll은 거품이 일지 않아 캡처로)·창 크기·무대와 카드의 크기·화면 바뀜(상자가 생기고 없어지고 옮겨 감)
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onChange = () => schedule();
    const sizes = new ResizeObserver(onChange);
    sizes.observe(stage);
    if (cardRef.current) sizes.observe(cardRef.current);
    const changes = new MutationObserver((records) => {
      const ignore = ignoreRef.current;
      if (records.some((record) => !ignore?.contains(record.target))) schedule();
    });
    changes.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    document.addEventListener("scroll", onChange, true);
    window.addEventListener("resize", onChange);
    schedule();
    return () => {
      sizes.disconnect();
      changes.disconnect();
      document.removeEventListener("scroll", onChange, true);
      window.removeEventListener("resize", onChange);
      cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    };
  }, [stageRef, cardRef, ignoreRef, key]);

  return rects;
}
