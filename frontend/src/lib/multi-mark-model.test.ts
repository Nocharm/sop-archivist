// 여럿 고른 줄의 덩어리 모델 - 이어진 줄은 덩어리 하나(꼬리표는 첫 카드에만), 떨어진 줄은 덩어리마다
import { describe, expect, it } from "vitest";

import { buildCheckMarks, readCheckKey, readRowEdge } from "./multi-mark-model";

// 카드 a · b · c · d = Unit 1 · 2 · 3 · 4 한 줄씩
const cards = ["a", "b", "c", "d"].map((key, at) => ({ key, unitIds: [at + 1] }));
function all(checked: number[]) {
  return buildCheckMarks(cards, new Set(checked), (id) => `r${id}`);
}
function marks(checked: number[]) {
  return Object.fromEntries(all(checked));
}

describe("buildCheckMarks", () => {
  it("rings a run once and counts its rows", () => expect(marks([1, 2, 3])).toEqual({ a: { edge: "top", count: 3 }, b: { edge: "middle", count: null }, c: { edge: "bottom", count: null } }));
  it("makes two runs of rows apart", () => {
    const m = marks([1, 4]);
    expect(m.a).toEqual({ edge: "only", count: 1 });
    expect(m.d).toEqual({ edge: "only", count: 1 });
  });
  it("counts a pair card as one row", () => expect(buildCheckMarks([{ key: "a", unitIds: [1, 2] }], new Set([1, 2]), () => "r1").get("a")).toEqual({ edge: "only", count: 1 }));
  it("a card between rows that is not picked (a folded noise block) breaks the run", () => expect(marks([1, 3]).c.edge).toBe("only"));
  it("the chunk key changes only with its own cards", () => {
    expect(readCheckKey(all([1]), ["a"])).not.toBe(readCheckKey(all([]), ["a"]));
    expect(readCheckKey(all([4]), ["a"])).toBe(readCheckKey(all([]), ["a"]));
  });
});

describe("readRowEdge", () => {
  it("gives a two-row card its top edge on the first row and bottom edge on the last", () => {
    expect(readRowEdge("only", 0, 2)).toBe("top");
    expect(readRowEdge("only", 1, 2)).toBe("bottom");
  });
  it("keeps a one-row card's edge", () => expect(readRowEdge("middle", 0, 1)).toBe("middle"));
  it("lets a card in the middle of a run stay open on both sides", () => {
    expect(readRowEdge("middle", 0, 2)).toBe("middle");
    expect(readRowEdge("top", 1, 2)).toBe("middle");
  });
});
