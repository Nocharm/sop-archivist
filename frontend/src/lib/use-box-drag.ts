// 끌기 엔진을 root에 붙이는 얇은 훅 - config가 null이면(읽기 전용 등) 붙이지 않는다. 콜백은 렌더마다 최신을 불러 다시 붙이지 않는다.
"use client";

import { useEffect, useRef, type RefObject } from "react";

import { attachBoxDrag, type BoxDragConfig } from "@/lib/box-drag";

export function useBoxDrag<S>(rootRef: RefObject<HTMLElement | null>, config: BoxDragConfig<S> | null): void {
  const enabled = config !== null;
  // 최신 config 미러 - 이펙트 정리(config가 null이 되거나 화면이 사라질 때)가 끄는 중인 끌기를 취소하며 onEnd를 부르는데,
  // 정리 안에서는 useEffectEvent를 못 부르고 null이면 던지지 않아야 하므로 null은 덮지 않고 마지막 config를 남긴다
  const latestRef = useRef<BoxDragConfig<S> | null>(config);
  useEffect(() => {
    if (config !== null) latestRef.current = config;
  });

  useEffect(() => {
    const root = rootRef.current;
    if (!enabled || !root) return;
    const current = (): BoxDragConfig<S> => {
      if (latestRef.current === null) throw new Error("useBoxDrag: callback ran before any config was set");
      return latestRef.current;
    };
    return attachBoxDrag<S>(root, {
      pick: (event) => current().pick(event),
      getCard: (source) => current().getCard(source),
      getScrollers: () => current().getScrollers(),
      onStart: (source, start) => current().onStart?.(source, start),
      onMove: (source, point, start) => current().onMove(source, point, start),
      onDrop: (source, point, start) => current().onDrop(source, point, start),
      onEnd: (source, cancelled) => current().onEnd?.(source, cancelled),
    });
  }, [rootRef, enabled]);
}
