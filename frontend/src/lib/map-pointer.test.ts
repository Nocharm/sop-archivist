import { describe, expect, it } from "vitest";
import { isBackgroundClick, isMapBackground } from "./map-pointer";

function buildWorld() {
  document.body.innerHTML = `
    <div class="map-canvas"><div class="map-sizer"><div class="map-world">
      <div class="map-lane"><div class="map-lane-head"><span class="map-lane-name">BND-1</span><button class="map-lane-toggle"><svg></svg></button></div>
        <button class="map-node"><span class="map-node-no">OLD-1</span></button>
        <button class="map-lane-more">2 more</button>
      </div>
    </div></div></div>`;
  const $ = (selector: string) => document.querySelector(selector)!;
  return { canvas: $(".map-canvas"), world: $(".map-world"), lane: $(".map-lane"), no: $(".map-node-no"), node: $(".map-node"), icon: $(".map-lane-toggle svg"), more: $(".map-lane-more") };
}

describe("map-pointer", () => {
  it("tells the background from documents and buttons", () => {
    const el = buildWorld();
    expect([el.canvas, el.world, el.lane].map(isMapBackground)).toEqual([true, true, true]);
    expect([el.node, el.no, el.icon, el.more].map(isMapBackground)).toEqual([false, false, false, false]);
    expect(isMapBackground(null)).toBe(false);
  });

  it("clears the selection only when the press and the click are both on the background", () => {
    const el = buildWorld();
    expect(isBackgroundClick(el.lane, el.lane)).toBe(true);
    expect(isBackgroundClick(el.canvas, el.world)).toBe(true);
    // 마디에서 누르고 바탕에서 떼면 click은 공통 조상(세계)으로 간다 - 바탕 누르기가 아니다
    expect(isBackgroundClick(el.no, el.world)).toBe(false);
    expect(isBackgroundClick(el.lane, el.node)).toBe(false);
    expect(isBackgroundClick(null, el.world)).toBe(false);
  });
});
