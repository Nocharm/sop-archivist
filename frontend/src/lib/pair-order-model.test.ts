// 짝 카드 안 순서 시험 - 서버 pair_order.order_pair_card와 같은 규칙, 카드 묶음만 다시 늘어놓기, 손잡이 놓을 자리.
import { describe, expect, it } from "vitest";

import { isSameOrder, movePairMember, orderPairCard, orderPairRuns, readPairSlot } from "@/lib/pair-order-model";

describe("orderPairCard", () => {
  const unit = (id: number, pair_seq?: number | null) => ({ id, pair_seq });
  const ids = (units: readonly { id: number }[]) => units.map((entry) => entry.id);
  it("follows pair_seq only when every member has a distinct one", () => {
    expect(ids(orderPairCard([unit(1, 1), unit(2, 0)]))).toEqual([2, 1]);
    expect(ids(orderPairCard([unit(1), unit(2)]))).toEqual([1, 2]);
    // 새로 든 구성원(값 없음)과 겹친 낡은 값은 원문 순서
    expect(ids(orderPairCard([unit(1, 1), unit(2, 0), unit(3, null)]))).toEqual([1, 2, 3]);
    expect(ids(orderPairCard([unit(1, 0), unit(2, 0)]))).toEqual([1, 2]);
  });
});

describe("orderPairRuns", () => {
  const units = new Map([
    [1, { pair_id: null, pair_seq: null }],
    [2, { pair_id: 9, pair_seq: 1 }],
    [3, { pair_id: 9, pair_seq: 0 }],
    [4, { pair_id: null, pair_seq: null }],
    [5, { pair_id: 8, pair_seq: 1 }],
    [6, { pair_id: null, pair_seq: null }],
    [7, { pair_id: 8, pair_seq: 0 }],
  ]);
  it("reorders a run of one pair and leaves split members where they are", () => {
    expect(orderPairRuns([1, 2, 3, 4, 5, 6, 7], (id) => units.get(id))).toEqual([1, 3, 2, 4, 5, 6, 7]);
  });
});

describe("pair handle drop", () => {
  it("readPairSlot counts the other boxes above the pointer", () => {
    expect([readPairSlot([100, 140], 90), readPairSlot([100, 140], 120), readPairSlot([100, 140], 200)]).toEqual([0, 1, 2]);
  });
  it("movePairMember puts the dragged box at the slot among the others", () => {
    expect(movePairMember([1, 2], 2, 0)).toEqual([2, 1]);
    expect(movePairMember([1, 2, 3], 1, 2)).toEqual([2, 3, 1]);
    expect(movePairMember([1, 2, 3], 3, 1)).toEqual([1, 3, 2]);
    expect(movePairMember([1, 2], 1, 9)).toEqual([2, 1]);
  });
  it("isSameOrder", () => {
    expect([isSameOrder([1, 2], [1, 2]), isSameOrder([1, 2], [2, 1]), isSameOrder([1], [1, 2])]).toEqual([true, false, false]);
  });
});
