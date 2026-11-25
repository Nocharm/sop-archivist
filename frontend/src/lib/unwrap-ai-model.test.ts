import { describe, expect, it } from "vitest";

import { addUnwrapAiAsk, isUnwrapSuggestionApplicable, isUnwrapSuggestionUnchanged, keepSamePreviews, listUnwrapAiBusy, readUnwrapMoves } from "./unwrap-ai-model";

describe("isUnwrapSuggestionApplicable", () => {
  it("같은 줄 집합의 다른 차례면 적용할 수 있다", () => {
    expect(isUnwrapSuggestionApplicable([1, 2, 3], [3, 1, 2])).toBe(true);
  });
  it("줄이 늘거나 줄었거나 다른 줄이 섞이면 낡은 제안이다", () => {
    expect(isUnwrapSuggestionApplicable([1, 2, 3], [1, 2])).toBe(false);
    expect(isUnwrapSuggestionApplicable([1, 2, 3], [1, 2, 4])).toBe(false);
    expect(isUnwrapSuggestionApplicable([1, 2, 3], [1, 2, 2])).toBe(false);
  });
  it("줄이 둘 미만이면 순서랄 것이 없다", () => {
    expect(isUnwrapSuggestionApplicable([1], [1])).toBe(false);
  });
});

describe("readUnwrapMoves", () => {
  it("줄마다 지금 자리와 제안 자리를 1부터 센다", () => {
    const moves = readUnwrapMoves([10, 20, 30, 40], [40, 10, 20, 30]);
    expect(moves.get(40)).toEqual({ from: 4, to: 1, moved: true });
    expect(moves.get(10)).toEqual({ from: 1, to: 2, moved: true });
  });
  it("자리가 같은 줄은 옮기지 않는다", () => {
    const moves = readUnwrapMoves([10, 20, 30], [10, 30, 20]);
    expect(moves.get(10)?.moved).toBe(false);
    expect(moves.get(30)).toEqual({ from: 3, to: 2, moved: true });
  });
  it("적용할 수 없는 제안은 빈 표다", () => {
    expect(readUnwrapMoves([1, 2], [1, 3]).size).toBe(0);
  });
});

describe("isUnwrapSuggestionUnchanged", () => {
  it("차례가 같으면 참, 다르면 거짓", () => {
    expect(isUnwrapSuggestionUnchanged([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(isUnwrapSuggestionUnchanged([1, 2, 3], [2, 1, 3])).toBe(false);
  });
  it("적용할 수 없는 제안은 같다고 보지 않는다", () => {
    expect(isUnwrapSuggestionUnchanged([1, 2], [1, 2, 3])).toBe(false);
  });
});

describe("작업 중 칩", () => {
  it("끝난 작업 수가 기준에 닿기 전까지 보이고 닿으면 걷힌다", () => {
    const asks = addUnwrapAiAsk([], 7, 3);
    expect([...listUnwrapAiBusy(asks, 3)]).toEqual([7]);
    expect(listUnwrapAiBusy(asks, 4).size).toBe(0);
  });
  it("두 표를 잇달아 물으면 하나씩 걷힌다", () => {
    const asks = addUnwrapAiAsk(addUnwrapAiAsk([], 7, 0), 8, 0);
    expect([...listUnwrapAiBusy(asks, 0)].sort()).toEqual([7, 8]);
    expect([...listUnwrapAiBusy(asks, 1)]).toEqual([8]);
    expect(listUnwrapAiBusy(asks, 2).size).toBe(0);
  });
  it("같은 표를 다시 물으면 앞 요청을 대신한다", () => {
    const asks = addUnwrapAiAsk(addUnwrapAiAsk([], 7, 0), 7, 0);
    expect(asks).toHaveLength(1);
  });
});

describe("keepSamePreviews", () => {
  const prev = new Map([[4, [1, 2]]]);

  it("내용이 같으면 앞의 것을 그대로 준다 - 다시 받을 때마다 용지의 덩어리를 다시 그리지 않게", () => {
    expect(keepSamePreviews(prev, new Map([[4, [1, 2]]]))).toBe(prev);
  });
  it("차례 · 표가 다르면 새것을 준다", () => {
    for (const next of [new Map([[4, [2, 1]]]), new Map([[4, [1, 2, 3]]]), new Map([[5, [1, 2]]]), new Map([...prev, [5, [3, 4]]]), new Map<number, number[]>()]) expect(keepSamePreviews(prev, next)).toBe(next);
  });
});
