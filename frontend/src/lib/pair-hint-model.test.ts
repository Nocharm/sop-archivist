import { describe, expect, it } from "vitest";

import { findPairTarget, getPairHint, type PairHintUnit } from "./pair-hint-model";

// 용지 1-6: 1 ↔ 4, 2 ↔ 5, 3 ↔ 6이 떨어진 짝(한글 절반 1-3, 영어 절반 4-6)
const box = (id: number, lang: "ko" | "en", card: number | null = null): PairHintUnit => ({ id, lang, at: id, card, label: `§${id}` });

describe("getPairHint", () => {
  it.each([
    [1, 4],
    [2, 5],
    [3, 6],
  ])("box %i points down to its English pair %i", (ko, en) => {
    expect(getPairHint(box(ko, "ko"), [box(en, "en")])).toEqual({ dir: "down", lang: "EN", where: `§${en}`, targetUnitId: en, more: 0 });
  });

  it.each([
    [4, 1],
    [5, 2],
    [6, 3],
  ])("box %i points up to its Korean pair %i - same rule whichever side is picked", (en, ko) => {
    expect(getPairHint(box(en, "en"), [box(ko, "ko")])).toEqual({ dir: "up", lang: "KO", where: `§${ko}`, targetUnitId: ko, more: 0 });
  });

  it("says nothing for a pair joined in one card", () => {
    expect(getPairHint(box(1, "ko", 1), [box(2, "en", 1)])).toBeNull();
  });

  it("points at the far member only when part of the pair is in the same card", () => {
    expect(getPairHint(box(1, "ko", 1), [box(2, "en", 1), box(9, "en")])).toMatchObject({ dir: "down", targetUnitId: 9, more: 0 });
  });

  it("names the nearest far member and counts the rest", () => {
    expect(getPairHint(box(5, "ko"), [box(1, "en"), box(7, "en"), box(12, "en")])).toMatchObject({ dir: "down", targetUnitId: 7, more: 2 });
  });

  it("takes the one above when two are as near", () => {
    expect(getPairHint(box(5, "ko"), [box(7, "en"), box(3, "en")])).toMatchObject({ dir: "up", targetUnitId: 3, more: 1 });
  });

  it("works for KO/EN separate documents where the halves are far apart", () => {
    const korean = { id: 10, lang: "ko", at: 3, card: null, label: "§1.2" };
    const english = { id: 80, lang: "en", at: 41, card: null, label: "U-80" };

    expect(getPairHint(korean, [english])).toEqual({ dir: "down", lang: "EN", where: "U-80", targetUnitId: 80, more: 0 });
    expect(getPairHint(english, [korean])).toEqual({ dir: "up", lang: "KO", where: "§1.2", targetUnitId: 10, more: 0 });
  });

  it("is null without mates", () => {
    expect(getPairHint(box(1, "ko"), [])).toBeNull();
  });
});

describe("findPairTarget", () => {
  const order = [10, 11, 12, 13, 14, 15];
  const unit = (id: number) => ({ id, lang: "ko" });

  it("goes to the far member, the way the hint line does", () => {
    expect(findPairTarget(10, [unit(10), unit(14)], order)).toBe(14);
    expect(findPairTarget(14, [unit(10), unit(14)], order)).toBe(10);
    // 이어 붙은 카드의 곁 박스보다 떨어진 짝이 먼저다
    expect(findPairTarget(10, [unit(10), unit(11), unit(14)], order)).toBe(14);
  });

  it("goes between the two boxes of one card", () => {
    expect(findPairTarget(11, [unit(11), unit(12)], order)).toBe(12);
    expect(findPairTarget(12, [unit(11), unit(12)], order)).toBe(11);
  });

  it("has nowhere to go without a pair", () => {
    expect(findPairTarget(10, [], order)).toBeNull();
    expect(findPairTarget(10, [unit(10)], order)).toBeNull();
    expect(findPairTarget(10, [unit(10), unit(99)], order)).toBeNull();
  });
});
