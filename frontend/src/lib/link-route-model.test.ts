// Assign 연결선 경로 - 맨 왼쪽 칩은 옆에서, 나머지는 위 틈이나 칩 줄 아래로 들어와 칩 왼쪽에서 끝난다.
import { describe, expect, it } from "vitest";

import { buildLinkPath, type RouteTarget } from "./link-route-model";

const target = (patch: Partial<RouteTarget>): RouteTarget => ({
  end: { x: 300, y: 108 },
  chipTop: 100,
  chipBottom: 116,
  rowLeft: 220,
  rowTop: 94,
  isFirst: false,
  ...patch,
});

/** 경로에서 직선(L) 점만 뽑는다 */
function readLinePoints(d: string): Array<[number, number]> {
  return [...d.matchAll(/L(-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
}

describe("buildLinkPath", () => {
  it("enters the first chip straight from the side at the chip's height", () => {
    const d = buildLinkPath({ x: 100, y: 300 }, target({ isFirst: true }));
    expect(d.startsWith("M100 300C")).toBe(true);
    // 띠(줄 왼쪽 4px 앞)에서 칩 높이로 맞춘 뒤 칩 왼쪽까지 가로로
    expect(d).toContain(" 216 108L300 108");
  });

  it("comes through the gap above the paragraph when the Old badge is higher", () => {
    const d = buildLinkPath({ x: 100, y: 20 }, target({}));
    const points = readLinePoints(d);
    // 위 틈 y = 줄 위 끝 - 2, 칩 왼쪽 5px 앞에서 아래로 꺾고 칩 왼쪽에서 끝난다
    expect(points[0]).toEqual([292, 92]);
    expect(points.at(-1)).toEqual([300, 108]);
    expect(d).toContain("Q295 92 295 95");
  });

  it("comes between the chip row and the sentence when the Old badge is lower", () => {
    const d = buildLinkPath({ x: 100, y: 500 }, target({}));
    const points = readLinePoints(d);
    // 칩 줄 아래 y = 칩 아래 끝 + 3, 위로 꺾는다
    expect(points[0]).toEqual([292, 119]);
    expect(d).toContain("Q295 119 295 116");
    expect(points.at(-1)).toEqual([300, 108]);
  });
});
