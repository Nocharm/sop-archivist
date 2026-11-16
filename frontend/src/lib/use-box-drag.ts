// 끌기 엔진을 root에 붙이는 얇은 훅 - config가 null이면(읽기 전용 등) 붙이지 않는다. 콜백은 렌더마다 최신을 불러 다시 붙이지 않는다.
"use client";

import { useEffect, useEffectEvent, type RefObject } from "react";

import { attachBoxDrag, type BoxDragConfig } from "@/lib/box-drag";

export function useBoxDrag<S>(rootRef: RefObject<HTMLElement | null>, config: BoxDragConfig<S> | null): void {
  const enabled = config !== null;
  const requireConfig = useEffectEvent((): BoxDragConfig<S> => {
    if (config === null) throw new Error("useBoxDrag: callback ran while the drag config is null");
    return config;
  });

  useEffect(() => {
    const root = rootRef.current;
    if (!enabled || !root) return;
    return attachBoxDrag<S>(root, {
      pick: (event) => requireConfig().pick(event),
      getCard: (source) => requireConfig().getCard(source),
      getScrollers: () => requireConfig().getScrollers(),
      onStart: (source, start) => requireConfig().onStart?.(source, start),
      onMove: (source, point, start) => requireConfig().onMove(source, point, start),
      onDrop: (source, point, start) => requireConfig().onDrop(source, point, start),
      onEnd: (source, cancelled) => requireConfig().onEnd?.(source, cancelled),
    });
  }, [rootRef, enabled]);
}
