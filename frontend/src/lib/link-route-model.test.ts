// Assign 연결선 경로 - 두 상자 바깥 테두리 사이의 S자, 두 끝에서 가로로 나고 들어간다.
import { describe, expect, it } from "vitest";

import { buildLinkPath } from "./link-route-model";

/** "M x y C c1x c1y c2x c2y x y"를 숫자 여덟 개로 */
function readNumbers(d: string): number[] {
  return [...d.matchAll(/-?[\d.]+/g)].map((m) => Number(m[0]));
}

describe("buildLinkPath", () => {
  it("starts at the Old box edge and ends at the New box edge", () => {
    const d = buildLinkPath({ x: 100, y: 300 }, { x: 160, y: 108 });
    const n = readNumbers(d);
    expect(d.startsWith("M100 300C")).toBe(true);
    expect(n.slice(-2)).toEqual([160, 108]);
  });

  it("leaves and arrives horizontally, bending only between the two boxes", () => {
    const n = readNumbers(buildLinkPath({ x: 100, y: 300 }, { x: 160, y: 108 }));
    // 첫 조절점은 시작 높이, 둘째는 끝 높이 - 두 끝에서 가로
    expect(n[3]).toBe(300);
    expect(n[5]).toBe(108);
    // 조절점이 두 상자 사이(100~160)에 있다
    expect(n[2]).toBe(130);
    expect(n[4]).toBe(130);
  });

  it("keeps a short horizontal lead when the boxes are very close", () => {
    const n = readNumbers(buildLinkPath({ x: 100, y: 0 }, { x: 104, y: 50 }));
    expect(n[2]).toBe(110);
    expect(n[4]).toBe(94);
  });
});
