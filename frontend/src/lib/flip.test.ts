// FLIP 거리 - 바뀌기 전과 뒤에 잰 자리에서 실제로 움직인 줄만 거꾸로 옮길 거리(첫 − 끝)를 낸다.
import { describe, expect, it } from "vitest";

import { computeFlipOffsets } from "./flip";

describe("computeFlipOffsets", () => {
  it("gives each moved line the distance back to where it was", () => {
    const first = new Map([["1", 100], ["2", 140], ["3", 180]]);
    const last = new Map([["1", 140], ["2", 100], ["3", 180]]);
    expect(computeFlipOffsets(first, last)).toEqual(new Map([["1", -40], ["2", 40]]));
  });

  it("leaves out lines measured on one side only", () => {
    // 아직 그리지 않은 구간의 이웃 줄은 처음에 재지 못한다
    expect(computeFlipOffsets(new Map([["1", 100]]), new Map([["1", 130], ["2", 100]]))).toEqual(new Map([["1", -30]]));
  });
});
