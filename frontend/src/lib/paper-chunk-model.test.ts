import { describe, expect, it } from "vitest";

import { CHUNK_CARDS, CHUNK_MIN_CARDS, pickNearChunks, sliceCards, sliceFoldEntries } from "@/lib/paper-chunk-model";
import type { FoldEntry } from "@/lib/paper-fold-model";

describe("sliceCards", () => {
  it("keeps a short part as one slice", () => {
    // Arrange
    const count = CHUNK_MIN_CARDS - 1;

    // Act
    const result = sliceCards(count);

    // Assert
    expect(result).toEqual({ isChunked: false, slices: [{ start: 0, count }] });
  });

  it("returns no slice for an empty part", () => {
    expect(sliceCards(0)).toEqual({ isChunked: false, slices: [] });
  });

  it("cuts a long part into chunks with a shorter last one", () => {
    // Arrange
    const count = CHUNK_MIN_CARDS + 5;

    // Act
    const result = sliceCards(count);

    // Assert
    expect(result.isChunked).toBe(true);
    expect(result.slices.map((slice) => slice.count)).toEqual([CHUNK_CARDS, CHUNK_CARDS, CHUNK_CARDS, 5]);
    expect(result.slices.map((slice) => slice.start)).toEqual([0, CHUNK_CARDS, CHUNK_CARDS * 2, CHUNK_CARDS * 3]);
  });
});

describe("sliceFoldEntries", () => {
  const full = (n: number) => Array.from({ length: n }, (_, i): FoldEntry => ({ kind: "full", key: `u${i}` }));

  it("cuts a long folded list into chunks", () => {
    expect(sliceFoldEntries(full(200)).map((slice) => slice.count)).toEqual([40, 40, 40, 40, 40]);
    expect(sliceFoldEntries(full(125)).map((slice) => slice.start)).toEqual([0, 40, 80, 120]);
  });

  it("keeps a short list as one slice and an empty one as none", () => {
    expect(sliceFoldEntries(full(100))).toEqual([{ start: 0, count: 100 }]);
    expect(sliceFoldEntries([])).toEqual([]);
  });

  it("does not part an open run from its head - lines and peeked lines alike", () => {
    // Arrange
    const run: FoldEntry[] = [{ kind: "runHead", runKey: "r", memberKeys: [] }, ...Array.from({ length: 5 }, (_, i): FoldEntry => ({ kind: "line", key: `l${i}`, runKey: "r" }))];
    const peeked: FoldEntry[] = [{ kind: "runHead", runKey: "r", memberKeys: ["l0", "p", "l1"] }, { kind: "line", key: "l0", runKey: "r" }, { kind: "peek", key: "p" }, { kind: "line", key: "l1", runKey: "r" }];

    // Act & Assert: 40번째 자리가 펼친 묶음 안이면 묶음 끝까지 한 덩어리
    expect(sliceFoldEntries([...full(39), ...run, ...full(120)])[0]).toEqual({ start: 0, count: 45 });
    expect(sliceFoldEntries([...full(38), ...peeked, ...full(120)])[0]).toEqual({ start: 0, count: 42 });
  });

  it("cuts between a run and whatever follows it", () => {
    const run: FoldEntry[] = [{ kind: "runHead", runKey: "r", memberKeys: ["l0"] }, { kind: "line", key: "l0", runKey: "r" }];
    // 묶음 뒤의 엿보기 · 다른 묶음은 붙지 않는다
    expect(sliceFoldEntries([...full(38), ...run, { kind: "peek", key: "x" }, ...full(120)])[0]).toEqual({ start: 0, count: 40 });
    expect(sliceFoldEntries([...full(38), ...run, { kind: "runHead", runKey: "s", memberKeys: ["m"] }, { kind: "line", key: "m", runKey: "s" }, ...full(120)])[0]).toEqual({ start: 0, count: 40 });
  });
});

describe("pickNearChunks", () => {
  // 덩어리마다 1,000px, 보이는 칸은 800px - 위아래 한 화면(800px)씩 더 본다
  const boxes = Array.from({ length: 10 }, (_, index) => ({ top: index * 1000, bottom: (index + 1) * 1000 }));

  it("takes the chunks within one screen above and below the view", () => {
    // Arrange: 보이는 칸이 4,100~4,900 → 넓힌 범위 3,300~5,700
    const view = { top: 4100, bottom: 4900 };

    // Act
    const result = pickNearChunks(boxes, view);

    // Assert
    expect(result).toEqual({ from: 3, to: 5 });
  });

  it("counts a chunk that only touches the widened edge", () => {
    // 넓힌 범위 1,000~3,400 - 0번 덩어리의 아래(1,000)가 닿는다
    expect(pickNearChunks(boxes, { top: 1800, bottom: 2600 })).toEqual({ from: 0, to: 3 });
  });

  it("returns -1 when the paper is far from the view", () => {
    expect(pickNearChunks(boxes, { top: -5000, bottom: -4200 })).toEqual({ from: -1, to: -1 });
  });
});
