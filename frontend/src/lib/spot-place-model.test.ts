import { describe, expect, it } from "vitest";

import { planSpotPlace } from "./spot-place-model";

describe("planSpotPlace", () => {
  // [칸, 용지] → 모양, 판 폭(칸 − 용지 − 12, 상한 600). 1440/1360은 배율 160%, 500은 92%
  it.each([
    [1440, 860, "aside", 568],
    [1600, 860, "aside", 600],
    [1292, 860, "aside", 420],
    [1291, 860, "cover", 600],
    [1440, 1360, "cover", 600],
    [500, 480, "cover", 460],
  ] as const)("pane %i sheet %i -> %s %i", (pane, sheet, kind, panel) => {
    expect(planSpotPlace({ pane, sheet })).toEqual({ kind, panel });
  });
});
