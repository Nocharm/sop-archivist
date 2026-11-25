// 떼는 오른쪽 칸의 자리 셈 - 언제 뜨는지, 창 안에 가두기, 처음 자리(오른쪽 아래).
import { describe, expect, it } from "vitest";

import { SIDE_FLOAT_HEAD, SIDE_FLOAT_WIDTH, clampFloat, getFloatHeight, getFloatStart, isSideFloating } from "./side-float-model";

describe("side float model", () => {
  it("floats only below 1440px and only when wanted", () => {
    expect([isSideFloating(1439, true), isSideFloating(1440, true), isSideFloating(1200, false)]).toEqual([true, false, false]);
  });

  it("keeps the panel inside the window", () => {
    expect(clampFloat({ x: 5000, y: -40 }, { w: 320, h: 400 }, { w: 1280, h: 720 })).toEqual({ x: 960, y: 0 });
    expect(clampFloat({ x: 900, y: 700 }, { w: 320, h: 36 }, { w: 1280, h: 720 })).toEqual({ x: 900, y: 684 });
  });

  it("pins to the top left when the window is smaller than the panel", () => {
    expect(clampFloat({ x: 40, y: 40 }, { w: 320, h: 400 }, { w: 300, h: 200 })).toEqual({ x: 0, y: 0 });
  });

  it("starts at the bottom right with a 16px margin", () => {
    expect(getFloatStart({ w: 1280, h: 720 }, { w: 320, h: 504 })).toEqual({ x: 944, y: 200 });
  });

  it("is 70% of the window high and one head line when folded", () => {
    expect(SIDE_FLOAT_WIDTH).toBe(320);
    expect([getFloatHeight(720, false), getFloatHeight(900, false), getFloatHeight(720, true)]).toEqual([504, 630, SIDE_FLOAT_HEAD]);
  });
});
