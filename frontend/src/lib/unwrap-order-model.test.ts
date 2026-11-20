// 벗긴 표 덩이 안 줄 순서 시험 - 서버 unwrap_order와 같은 규칙(사례는 rule-cases.test.ts), 덩이를 재는 규칙, 손잡이 놓을 자리.
import { describe, expect, it } from "vitest";

import { findLineTable, moveUnwrapLines, orderUnwrapped, orderUnwrappedLines, readUnwrapSlot, type UnwrapTable } from "@/lib/unwrap-order-model";

describe("orderUnwrapped", () => {
  const line = (id: number, seq: number | null, pos: number) => ({ id, seq, pos });
  const order = (lines: ReturnType<typeof line>[]) => orderUnwrapped(lines, (entry) => entry.seq, (entry) => entry.pos).map((entry) => entry.id);
  it("keeps source order until someone reorders, then follows the seqs", () => {
    expect(order([line(1, null, 0), line(2, null, 1)])).toEqual([1, 2]);
    expect(order([line(1, 1, 0), line(2, 0, 1)])).toEqual([2, 1]);
  });
  it("lets a line without a seq borrow the line before it in source order", () => {
    // 3을 맨 위로 옮긴 뒤 1을 나눈 조각 4 · 5 - 1 자리(2 앞)에 남는다
    expect(order([line(3, 0, 3), line(4, null, 1), line(5, null, 2), line(2, 2, 4), line(1, 1, 0)])).toEqual([3, 1, 4, 5, 2]);
  });
});

describe("orderUnwrappedLines", () => {
  it("refills only the slots of each block and moves a line with its items", () => {
    const items = [{ id: 10, line: null }, { id: 20, line: 20 }, { id: 30, line: 30 }, { id: 31, line: 30 }, { id: 40, line: 40 }, { id: 50, line: 50 }];
    const blocks = new Map([[20, 7], [30, 7], [40, 7], [50, 8]]);
    const seqs = new Map([[40, 0], [20, 1], [30, 2]]);
    const ordered = orderUnwrappedLines(items, (item) => item.line, (lineId) => blocks.get(lineId) ?? null, (lineId) => seqs.get(lineId));
    expect(ordered.map((item) => item.id)).toEqual([10, 40, 20, 30, 31, 50]);
  });
});

describe("findLineTable", () => {
  // 벗긴 7 ⊃ 아직 표인 8 ⊃ 띠 표 9(벗김, 제목 줄) · 벗긴 10
  const tables = new Map<number, UnwrapTable>([
    [7, { parentId: null, isUnwrapped: true }],
    [8, { parentId: 7, isUnwrapped: false }],
    [9, { parentId: 8, isUnwrapped: false }],
    [10, { parentId: 7, isUnwrapped: true }],
  ]);
  it("puts cell lines in their table and inner tables · band headings in the nearest unwrapped table outside", () => {
    expect(findLineTable("cell_sentence", 7, 7, tables)).toBe(7);
    expect(findLineTable("cell_sentence", 10, 10, tables)).toBe(10); // 벗긴 안쪽 표는 제 덩이
    expect(findLineTable("table", 8, 8, tables)).toBe(7);
    expect(findLineTable("heading", 9, 9, tables)).toBe(7);
    expect(findLineTable("figure", null, 8, tables)).toBeNull(); // 아직 표인 표 안의 그림은 표에 그려진다
    expect(findLineTable("sentence", null, null, tables)).toBeNull();
  });
});

describe("unwrap handle drop", () => {
  it("readUnwrapSlot counts the measured lines above the pointer and treats unmeasured ones by where they sit", () => {
    expect([readUnwrapSlot([100, 140], 90), readUnwrapSlot([100, 140], 120), readUnwrapSlot([100, 140], 200)]).toEqual([0, 1, 2]);
    // 화면 위로 지나간 줄(null)은 위, 화면 아래 줄은 아래
    expect([readUnwrapSlot([null, 100, 140], 90), readUnwrapSlot([100, 140, null], 200)]).toEqual([1, 2]);
  });
  it("moveUnwrapLines puts the dragged lines (a pair card together) at the slot among the others", () => {
    expect(moveUnwrapLines([1, 2, 3, 4], [4], 0)).toEqual([4, 1, 2, 3]);
    expect(moveUnwrapLines([1, 2, 3, 4], [2, 3], 2)).toEqual([1, 4, 2, 3]);
    expect(moveUnwrapLines([1, 2, 3], [1], 9)).toEqual([2, 3, 1]);
  });
});
