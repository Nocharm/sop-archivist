// 떨어진 짝 괄호선(11-23 명세 E1) - 떨어진 구성원이 모두 화면 안일 때만, 앞머리 왼쪽에 세로선 하나와 끝마다 가로 눈금
import { describe, expect, it } from "vitest";

import { isPairHintShown, listPairMates, resolvePairBracket, type BracketEnd } from "./pair-bracket-model";

const frame = { top: 50, bottom: 600, left: 20 };
const zero = { left: 0, top: 0 };

function end(unitId: number, top: number, extra: Partial<BracketEnd> = {}): BracketEnd {
  return { unitId, top, left: 60, height: 33, ...extra };
}

/** 세로선의 x - 첫 H 값 */
function xOf(bracket: { d: string } | null): number {
  return Number(/H(-?[\d.]+)/.exec(bracket?.d ?? "")?.[1] ?? Number.NaN);
}

describe("the bracket of a far pair", () => {
  it("draws from the picked box to its mate, left of both leads", () => {
    const b = resolvePairBracket(end(4, 100), [end(8, 300)], frame, zero);
    expect(b?.unitIds).toEqual([4, 8]);
    expect(b?.d).toMatch(/^M/);
    expect(xOf(b)).toBe(50);
    // 첫 글줄 높이 - 위에서 13px(pair-lines와 같은 값)
    expect(b?.d).toContain("113");
    expect(b?.d).toContain("313");
  });

  it("draws nothing when one end is off screen", () => {
    expect(resolvePairBracket(end(4, 100), [null], frame, zero)).toBeNull();
    expect(resolvePairBracket(null, [end(8, 300)], frame, zero)).toBeNull();
  });

  it("draws nothing when an end's first line sits outside the pane", () => {
    expect(resolvePairBracket(end(4, 100), [end(8, 640)], frame, zero)).toBeNull();
    expect(resolvePairBracket(end(4, 20), [end(8, 300)], frame, zero)).toBeNull();
  });

  it("draws a three-way pair with three ticks", () => {
    const b = resolvePairBracket(end(4, 100), [end(8, 300), end(9, 400)], frame, zero);
    expect(b?.unitIds).toEqual([4, 8, 9]);
    expect(b?.d.match(/H/g)).toHaveLength(3);
  });

  it("stays inside the pane", () => expect(xOf(resolvePairBracket(end(4, 100, { left: 5 }), [end(8, 300, { left: 5 })], frame, zero))).toBeGreaterThanOrEqual(frame.left + 2));

  it("draws nothing without mates", () => expect(resolvePairBracket(end(4, 100), [], frame, zero)).toBeNull());

  it("draws in the frame's coordinates", () => {
    const b = resolvePairBracket(end(4, 100), [end(8, 300)], frame, { left: 10, top: 40 });
    expect(xOf(b)).toBe(40);
    expect(b?.d).toContain("73");
  });
});

describe("the mates of a picked box", () => {
  const units = new Map([
    [4, { id: 4, pair_id: 9, pos_seq: 4 }],
    [8, { id: 8, pair_id: 9, pos_seq: 8 }],
    [6, { id: 6, pair_id: 9, pos_seq: 6 }],
    [5, { id: 5, pair_id: null, pos_seq: 5 }],
  ]);

  it("lists the other members in source order", () => expect(listPairMates(units, 8)).toEqual([4, 6]));
  it("lists nothing for a lone box or no pick", () => {
    expect(listPairMates(units, 5)).toEqual([]);
    expect(listPairMates(units, null)).toEqual([]);
  });
});

describe("when the hint under a picked box shows", () => {
  it("waits for the bracket layer to measure this pick - a fresh pick only keeps the hint's line", () => {
    expect(isPairHintShown(null, 4)).toBe(false);
    expect(isPairHintShown({ unitId: 8, shown: false }, 4)).toBe(false);
  });
  it("shows the hint once this pick has no bracket, hides it while the bracket shows", () => {
    expect(isPairHintShown({ unitId: 4, shown: false }, 4)).toBe(true);
    expect(isPairHintShown({ unitId: 4, shown: true }, 4)).toBe(false);
  });
});
