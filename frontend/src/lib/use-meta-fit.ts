// 한 줄 상자의 줄어드는 단계 - 넘치는 동안 data-fit을 한 단씩 올리고 CSS가 단계마다 무엇을 숨기거나 줄일지 정한다.
// 목록 틀의 폭만 보는 컨테이너 질의로는 같은 폭의 줄마다 든 것이 달라(N/A 이름 · 파일 이름 · 알약) 순서를 지킬 수 없다 - 그 줄의 글로 정한다.
"use client";

import { useLayoutEffect, useRef } from "react";

/** 상자가 넘치지 않을 때까지 0 → `levels` 단계를 올린다. 폭이나 안의 글이 바뀌면 0부터 다시 잰다 */
export function useMetaFit<T extends HTMLElement>(levels: number) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const fit = () => {
      let level = 0;
      element.dataset.fit = "0";
      while (element.scrollWidth > element.clientWidth && level < levels) {
        level += 1;
        element.dataset.fit = String(level);
      }
    };
    fit();
    // 단계를 바꾸는 것은 속성이라 아래 두 관찰자를 다시 부르지 않는다(폭은 목록 틀이 정한다)
    const resize = new ResizeObserver(fit);
    resize.observe(element);
    const mutation = new MutationObserver(fit);
    mutation.observe(element, { childList: true, subtree: true, characterData: true });
    return () => {
      resize.disconnect();
      mutation.disconnect();
    };
  }, [levels]);
  return ref;
}
