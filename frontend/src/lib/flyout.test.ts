// 하위 메뉴 방향 - 오른쪽에 자리가 있으면 오른쪽, 없으면 왼쪽, 양쪽 다 모자라면 넓은 쪽.
import { describe, expect, it } from "vitest";

import { pickFlyoutSide } from "./flyout";

function makeRect(left: number, right: number): DOMRect {
  return { left, right, top: 100, bottom: 132, width: right - left, height: 32, x: left, y: 100, toJSON: () => ({}) };
}

describe("pickFlyoutSide", () => {
  it("opens to the right when there is room", () => {
    expect(pickFlyoutSide(makeRect(300, 540), 220, 1400)).toBe("right");
  });

  it("flips to the left at the right edge", () => {
    expect(pickFlyoutSide(makeRect(1100, 1340), 220, 1366)).toBe("left");
  });

  it("picks the wider side when neither fits", () => {
    expect(pickFlyoutSide(makeRect(150, 300), 220, 420)).toBe("left");
    expect(pickFlyoutSide(makeRect(100, 260), 220, 420)).toBe("right");
  });
});
