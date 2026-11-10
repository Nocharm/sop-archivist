// 요소의 지금 폭(px)을 알려 준다 - 뷰포트가 아니라 요소가 들어갈 자리를 기준으로 배치를 바꿀 때. 처음 잰 값이 나오기 전에는 null.
"use client";

import { useCallback, useState } from "react";

export function useElementWidth(): [(node: HTMLElement | null) => void, number | null] {
  const [width, setWidth] = useState<number | null>(null);
  // 콜백 ref가 바뀌면 React가 옛 observer를 끊고 다시 붙이도록 observer를 cleanup과 함께 둔다
  const ref = useCallback((node: HTMLElement | null) => {
    if (node === null) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}
