// 긴 목록의 점진 렌더(무한 스크롤) - 처음엔 한 묶음만 그리고, 끝 표지가 화면에 가까워지면 다음 묶음을 붙인다.
// 데이터는 이미 다 받아 둔 목록이어도 된다. 수천 행을 한 번에 그리는 멈춤을 없애 로딩을 체감하지 않게 한다.
"use client";

import { useEffect, useState } from "react";

export const PROGRESSIVE_PAGE = 80;
// 끝 표지가 보이기 전 미리 붙이는 거리(px) - 스크롤이 빨라도 빈칸이 보이지 않게
const PRELOAD_MARGIN = "600px 0px";

export interface ProgressiveList<T> {
  visible: T[];
  hasMore: boolean;
  /** 목록 끝에 두는 표지 - 보이면 다음 묶음을 붙인다 */
  sentinelRef: (node: Element | null) => void;
}

interface ProgressiveOptions {
  pageSize?: number;
  /** 이만큼은 늘 그린다 - 키보드로 고른 줄(J/K)이 아직 안 그린 구간에 있어도 보이게 */
  minVisible?: number;
}

/** resetKey가 바뀌면(필터·정렬·판 전환) 처음 한 묶음으로 돌아간다 */
export function useProgressiveList<T>(items: readonly T[], resetKey: string, { pageSize = PROGRESSIVE_PAGE, minVisible = 0 }: ProgressiveOptions = {}): ProgressiveList<T> {
  const [limit, setLimit] = useState({ key: resetKey, count: pageSize });
  const [sentinel, setSentinel] = useState<Element | null>(null);
  const loaded = limit.key === resetKey ? limit.count : pageSize;
  const count = minVisible > loaded ? Math.ceil(minVisible / pageSize) * pageSize + pageSize : loaded;
  const hasMore = items.length > count;

  // count가 바뀔 때마다 다시 건다 - 붙인 뒤에도 표지가 여전히 가까우면 첫 알림으로 한 묶음 더 붙는다
  useEffect(() => {
    if (!sentinel || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setLimit({ key: resetKey, count: count + pageSize });
      },
      { rootMargin: PRELOAD_MARGIN },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [sentinel, hasMore, resetKey, count, pageSize]);

  return { visible: hasMore ? items.slice(0, count) : (items as T[]), hasMore, sentinelRef: setSentinel };
}
