// 참조 지도의 겉 상자 - 스크롤 칸 · 크기 상자(확대한 세계의 크기) · 세계. 위임 툴팁은 여기에만 두고 세계(map-world)는 따로 떼어 툴팁이 떠도 다시 그려지지 않는다.
// 움직이기는 스크롤이다(휠·트랙패드·스크롤 막대·터치, 바탕 끌기 use-map-pan). 지도 위의 Ctrl(⌘)+휠은 확대(use-map-zoom). 바탕(마디·단추가 아닌 곳)을 누르면 고름을 푼다.
"use client";

import { useRef, type MouseEvent, type PointerEvent, type RefObject } from "react";

import { useMapPan } from "@/components/map/use-map-pan";
import { useMapZoom } from "@/components/map/use-map-zoom";
import { MapWorld } from "@/components/map/map-world";
import { useDelegatedTip } from "@/components/ui/delegated-tip";
import { flashElement } from "@/components/ui/motion";
import { useI18n } from "@/lib/i18n";
import type { MapLayout } from "@/lib/map-layout";
import type { MapView } from "@/lib/map-model";
import { isBackgroundClick } from "@/lib/map-pointer";

/** 스크롤 칸 안쪽 여백(px) - Fit all의 칸 여백(FIT_MARGIN 32)의 한쪽 몫 */
export const CANVAS_PAD = 16;

interface MapCanvasProps {
  view: MapView;
  layout: MapLayout;
  zoom: number;
  selectedId: string | null;
  onSelect(nodeId: string | null): void;
  onToggleLane(laneKey: string): void;
  onMore(laneKey: string): void;
  /** anchor는 칸 왼쪽 위 기준의 기준점 - null이면 칸 가운데 */
  onZoom(next: number, anchor: { x: number; y: number } | null): void;
  onFit(): void;
  scrollRef: RefObject<HTMLDivElement | null>;
}

function isReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** 그 마디가 보이게 스크롤하고 한 번 번쩍인다(움직임 줄이기면 바로 - 번쩍임 대신 멈춘 테두리) */
export function revealMapNode(scroller: HTMLElement, nodeId: string): void {
  const el = scroller.querySelector<HTMLElement>(`[data-node="${CSS.escape(nodeId)}"]`);
  if (!el) return;
  const frame = scroller.getBoundingClientRect();
  const box = el.getBoundingClientRect();
  const isOutside = box.left < frame.left || box.right > frame.right || box.top < frame.top || box.bottom > frame.bottom;
  if (isOutside) el.scrollIntoView({ block: "center", inline: "center", behavior: isReducedMotion() ? "auto" : "smooth" });
  flashElement(el);
}

export function MapCanvas({ view, layout, zoom, selectedId, onSelect, onToggleLane, onMore, onZoom, onFit, scrollRef }: MapCanvasProps) {
  const { t } = useI18n();
  const tip = useDelegatedTip();
  useMapPan(scrollRef);
  useMapZoom(scrollRef, zoom, onZoom);

  // 누른 곳 - 마디에서 누르고 밖에서 뗀 click은 공통 조상(바탕)으로 오므로 누른 곳까지 바탕일 때만 고름을 푼다
  const pressRef = useRef<EventTarget | null>(null);

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    pressRef.current = event.target;
    tip.handlers.onPointerDown();
  }

  function handleClick(event: MouseEvent<HTMLDivElement>) {
    const press = pressRef.current;
    pressRef.current = null;
    if (isBackgroundClick(press, event.target)) onSelect(null);
  }

  return (
    <div
      ref={scrollRef}
      className="map-canvas"
      data-testid="map-canvas"
      role="group"
      aria-label={t("map.canvas.label")}
      // Tab 자리가 아니다 - 지도 안의 Tab 자리는 세계의 마디 하나다(브라우저가 스크롤 칸을 저절로 Tab 자리로 삼지 않게 -1)
      tabIndex={-1}
      style={{ padding: CANVAS_PAD }}
      {...tip.handlers}
      onPointerDown={handlePointerDown}
      onClick={handleClick}
    >
      <div className="map-sizer" data-testid="map-sizer" style={{ width: layout.width * zoom, height: layout.height * zoom }}>
        <MapWorld view={view} layout={layout} zoom={zoom} selectedId={selectedId} onSelect={onSelect} onToggleLane={onToggleLane} onMore={onMore} onZoom={onZoom} onFit={onFit} />
      </div>
      {tip.node}
    </div>
  );
}
