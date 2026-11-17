// 참조 지도의 겉 상자 - 스크롤 칸 · 크기 상자(확대한 세계의 크기) · 세계. 위임 툴팁은 여기에만 두고 세계(map-world)는 따로 떼어 툴팁이 떠도 다시 그려지지 않는다.
// 움직이기는 스크롤이다(휠·트랙패드·스크롤 막대·터치). 바탕(마디·단추가 아닌 곳)을 누르면 고름을 푼다.
"use client";

import type { MouseEvent, RefObject } from "react";

import { MapWorld } from "@/components/map/map-world";
import { useDelegatedTip } from "@/components/ui/delegated-tip";
import { flashElement } from "@/components/ui/motion";
import { useI18n } from "@/lib/i18n";
import type { MapLayout } from "@/lib/map-layout";
import type { MapView } from "@/lib/map-model";

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

export function MapCanvas({ view, layout, zoom, selectedId, onSelect, onToggleLane, onMore, scrollRef }: MapCanvasProps) {
  const { t } = useI18n();
  const tip = useDelegatedTip();

  function handleClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target instanceof Element && event.target.closest(".map-node, button, a")) return;
    onSelect(null);
  }

  return (
    <div
      ref={scrollRef}
      className="map-canvas"
      data-testid="map-canvas"
      role="group"
      aria-label={t("map.canvas.label")}
      style={{ padding: CANVAS_PAD }}
      {...tip.handlers}
      onClick={handleClick}
    >
      <div className="map-sizer" data-testid="map-sizer" style={{ width: layout.width * zoom, height: layout.height * zoom }}>
        <MapWorld view={view} layout={layout} zoom={zoom} selectedId={selectedId} onSelect={onSelect} onToggleLane={onToggleLane} onMore={onMore} />
      </div>
      {tip.node}
    </div>
  );
}
