// 연습 말풍선의 자리 - 오른쪽 먼저, 모자라면 아래 · 위, 무대 밖으로 나가지 않고 꼬리는 대상 쪽.
import { describe, expect, it } from "vitest";

import { COACH_GAP, COACH_MARGIN, placeCoach } from "./coach-place";

const STAGE = { width: 1200, height: 800 };
const CARD = { width: 280, height: 140 };

describe("placing the practice coach card", () => {
  it("sits right of the target with its arrow at the target's middle", () => {
    const place = placeCoach(STAGE, { left: 100, top: 300, width: 400, height: 40 }, CARD);
    expect(place.side).toBe("right");
    expect(place.left).toBe(500 + COACH_GAP);
    expect(place.top + place.arrow).toBe(320);
  });

  it("goes below when there is no room on the right, and above when there is none below", () => {
    const wide = { left: 100, top: 200, width: 900, height: 40 };
    expect(placeCoach(STAGE, wide, CARD)).toMatchObject({ side: "below", top: 240 + COACH_GAP });
    const low = { ...wide, top: 700 };
    expect(placeCoach(STAGE, low, CARD)).toMatchObject({ side: "above", top: 700 - COACH_GAP - CARD.height });
  });

  it("never leaves the stage", () => {
    const corner = placeCoach(STAGE, { left: 1000, top: 780, width: 190, height: 30 }, CARD);
    expect(corner.left).toBeGreaterThanOrEqual(COACH_MARGIN);
    expect(corner.left + CARD.width).toBeLessThanOrEqual(STAGE.width - COACH_MARGIN);
    expect(corner.top).toBeGreaterThanOrEqual(COACH_MARGIN);
    const tall = placeCoach({ width: 1200, height: 300 }, { left: 100, top: 20, width: 1000, height: 260 }, CARD);
    expect(tall.top + CARD.height).toBeLessThanOrEqual(300 - COACH_MARGIN);
    const nearTop = placeCoach(STAGE, { left: 100, top: 0, width: 300, height: 10 }, CARD);
    expect(nearTop).toMatchObject({ side: "right", top: COACH_MARGIN });
  });

  it("keeps the arrow off the rounded corners", () => {
    const place = placeCoach(STAGE, { left: 0, top: 200, width: 1100, height: 40 }, CARD);
    expect(place.arrow).toBeGreaterThanOrEqual(14);
    expect(place.arrow).toBeLessThanOrEqual(CARD.width - 14);
  });

  it("floats in the middle under the band when there is no target", () => {
    expect(placeCoach(STAGE, null, CARD)).toEqual({ left: (1200 - 280) / 2, top: COACH_MARGIN + 4, side: "center", arrow: 0 });
  });
});
