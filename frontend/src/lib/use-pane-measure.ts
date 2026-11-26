// 칸 위에 긋는 선 층(.assign-panes 안 SVG)이 자리를 다시 재는 때를 한 곳에 - 스크롤 · 창 크기 · 크기 변경 · 렌더마다, 모두 한 프레임에 한 번으로 묶는다.
// Pair view 짝 선(pair-lines)과 떨어진 짝 괄호선(pair-bracket)이 함께 쓴다. 포인터 올림은 듣지 않는다(올림으로 다시 그리지 않는다 - G11).
"use client";

import { useEffect, useEffectEvent, useRef, type RefObject } from "react";

export interface PaneMeasureOptions {
  /** 선 층(SVG) - 그 부모(.assign-panes)가 듣는 틀이다 */
  rootRef: RefObject<HTMLElement | SVGElement | null>;
  /** 틀 안에서 크기를 지켜볼 요소(querySelectorAll 고르개) - 틀 자신은 늘 지켜본다 */
  observe: string;
  /** 한 프레임에 한 번 부른다 - 재고 그리기 상태를 바꾼다 */
  measure: () => void;
  /** 바뀔 때만 크기 관찰을 다시 건다 - 지켜볼 요소가 바뀌는 값(부모가 렌더마다 새 배열을 넘겨도 같은 글이면 그대로) */
  key: string;
}

export function usePaneMeasure({ rootRef, observe, measure, key }: PaneMeasureOptions): void {
  const frameRef = useRef(0);

  const run = useEffectEvent(() => {
    frameRef.current = 0;
    measure();
  });

  const schedule = useEffectEvent(() => {
    if (frameRef.current === 0) frameRef.current = requestAnimationFrame(() => run());
  });

  // 스크롤(칸 몸통 - scroll은 거품이 일지 않아 캡처로 듣는다)·창 크기·목록 크기(확대·세로선·글꼴·조각이 화면에 들어와 제 높이를 얻을 때)
  useEffect(() => {
    const root = rootRef.current?.parentElement;
    if (!root) return;
    const onChange = () => schedule();
    const observer = new ResizeObserver(onChange);
    observer.observe(root);
    for (const el of root.querySelectorAll(observe)) observer.observe(el);
    root.addEventListener("scroll", onChange, true);
    window.addEventListener("resize", onChange);
    return () => {
      observer.disconnect();
      root.removeEventListener("scroll", onChange, true);
      window.removeEventListener("resize", onChange);
      cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    };
  }, [rootRef, observe, key]);

  // 화면이 다시 그려질 때마다(고른 줄·확대가 바뀌었을 수 있다) 한 번 다시 잰다
  useEffect(() => schedule());
}
