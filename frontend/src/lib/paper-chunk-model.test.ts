import { describe, expect, it } from "vitest";

import { CHUNK_CARDS, CHUNK_MIN_CARDS, pickNearChunks, sliceCards } from "@/lib/paper-chunk-model";

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
