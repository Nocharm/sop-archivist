// Assign 연결선 경로 - 두 상자 바깥 테두리 사이의 S자, 두 끝에서 가로로 나고 들어간다.
import { describe, expect, it } from "vitest";

import { buildLinkPath, buildLinkStubs, FAR_LINK_DY, isFarLink } from "./link-route-model";

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

describe("isFarLink", () => {
  it("treats ends at nearly the same height as near", () => {
    expect(isFarLink({ x: 0, y: 100 }, { x: 30, y: 100 + FAR_LINK_DY })).toBe(false);
  });

  it("treats a long vertical run as far, either direction", () => {
    expect(isFarLink({ x: 0, y: 100 }, { x: 30, y: 101 + FAR_LINK_DY })).toBe(true);
    expect(isFarLink({ x: 0, y: 400 }, { x: 30, y: 100 })).toBe(true);
  });
});

describe("buildLinkStubs", () => {
  it("draws two short tails, one from each box edge, bending toward the other end", () => {
    const [oldStub, newStub] = buildLinkStubs({ x: 100, y: 50 }, { x: 140, y: 300 });
    // Old 쪽 꼬리 - 시작점에서 오른쪽으로 나가 아래(끝 쪽)로 휜다
    expect(oldStub.d.startsWith("M100 50Q")).toBe(true);
    expect(oldStub.from).toEqual({ x: 100, y: 50 });
    expect(oldStub.to.x).toBeGreaterThan(100);
    expect(oldStub.to.y).toBeGreaterThan(50);
    // New 쪽 꼬리 - 끝점에서 왼쪽으로 나가 위(시작 쪽)로 휜다
    expect(newStub.d.startsWith("M140 300Q")).toBe(true);
    expect(newStub.to.x).toBeLessThan(140);
    expect(newStub.to.y).toBeLessThan(300);
  });

  it("never reaches past the middle of a narrow gap", () => {
    const [oldStub, newStub] = buildLinkStubs({ x: 100, y: 0 }, { x: 116, y: 200 });
    expect(oldStub.to.x).toBeLessThanOrEqual(108);
    expect(newStub.to.x).toBeGreaterThanOrEqual(108);
  });
});
