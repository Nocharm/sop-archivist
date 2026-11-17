// 상자를 스크롤 칸 안에 보이게 하는 scrollTop - 이미 보이면 그대로(null), 위로 나갔으면 위에, 아래로 나갔으면 아래에 맞춘다(scrollIntoView "nearest"와 같은 규칙).
import { describe, expect, it } from "vitest";

import { getRevealScrollTop, readUntransformedBox } from "./reveal-scroll";

const view = { top: 44, bottom: 720 };

describe("getRevealScrollTop", () => {
  it("leaves a box that is already inside", () => {
    expect(getRevealScrollTop(view, { top: 300, bottom: 356 }, 900)).toBeNull();
    expect(getRevealScrollTop(view, { top: 44, bottom: 720 }, 900)).toBeNull();
  });
  it("brings a box above the view to the top edge", () => expect(getRevealScrollTop(view, { top: -200, bottom: -144 }, 900)).toBe(656));
  it("brings a box below the view to the bottom edge", () => expect(getRevealScrollTop(view, { top: 800, bottom: 856 }, 900)).toBe(1036));
  it("puts a box taller than the view at the top edge", () => expect(getRevealScrollTop(view, { top: 800, bottom: 1600 }, 900)).toBe(1656));
});

describe("readUntransformedBox", () => {
  it("takes the slide offset of the moving item back out of the measured box", () => {
    // 줄이 옛 자리(400px 위)에서 미끄러져 오는 중 - 지금 보이는 자리에서 그만큼을 되돌린 곳이 줄의 진짜 자리다
    expect(readUntransformedBox({ top: 100, bottom: 156 }, -400)).toEqual({ top: 500, bottom: 556 });
    expect(readUntransformedBox({ top: 100, bottom: 156 }, 0)).toEqual({ top: 100, bottom: 156 });
  });
});
