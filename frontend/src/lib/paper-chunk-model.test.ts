import { describe, expect, it } from "vitest";

import type { PaperPending } from "@/components/paper/paper";
import type { DeletedFold } from "@/lib/deleted-fold-model";
import { CHUNK_CARDS, CHUNK_MIN_CARDS, pickNearChunks, readChunkDeleted, readChunkNoise, readChunkNumbers, readChunkPending, sliceCards, sliceFoldEntries } from "@/lib/paper-chunk-model";
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
    expect(sliceFoldEntries([...full(39), ...peeked, ...full(120)])[0]).toEqual({ start: 0, count: 43 });
  });

  it("cuts at the same cards whether a run is open or not", () => {
    // Arrange: 접힌 묶음 한 칸 ↔ 펼친 머리와 줄 - 펼친 것도 한 칸으로 센다
    const lines = Array.from({ length: 90 }, (_, i): FoldEntry => ({ kind: "line", key: `l${i}`, runKey: "r" }));
    const open: FoldEntry[] = [{ kind: "runHead", runKey: "r", memberKeys: [] }, ...lines];
    const closed: FoldEntry[] = [{ kind: "run", runKey: "r", count: 90, from: "", to: "" }];

    // Act & Assert
    for (const [before, after] of [[10, 140], [30, 60]]) {
      const shut = sliceFoldEntries([...full(before), ...closed, ...full(after)]);
      const opened = sliceFoldEntries([...full(before), ...open, ...full(after)]);
      expect(opened.map((slice) => slice.start + slice.count - 90)).toEqual(shut.map((slice) => slice.start + slice.count));
    }
  });

  it("cuts between a run and whatever follows it", () => {
    const run: FoldEntry[] = [{ kind: "runHead", runKey: "r", memberKeys: ["l0"] }, { kind: "line", key: "l0", runKey: "r" }];
    // 묶음 뒤의 엿보기 · 다른 묶음은 붙지 않고 저마다 한 칸(묶음은 펼쳐도 한 칸)
    expect(sliceFoldEntries([...full(38), ...run, { kind: "peek", key: "x" }, ...full(120)])[0]).toEqual({ start: 0, count: 41 });
    expect(sliceFoldEntries([...full(38), ...run, { kind: "runHead", runKey: "s", memberKeys: ["m"] }, { kind: "line", key: "m", runKey: "s" }, ...full(120)])[0]).toEqual({ start: 0, count: 42 });
  });
});

describe("what a chunk shows", () => {
  const mine = new Set([1, 2]);

  function pending(part: { lockedIds?: number[]; shimmerIds?: number[]; waits?: Array<[number, string]>; pills?: PaperPending["pills"] }): PaperPending {
    return { lockedIds: new Set(part.lockedIds), shimmerIds: new Set(part.shimmerIds), waits: new Map((part.waits ?? []).map(([id, text]) => [id, { kind: "save", text }])), pills: part.pills ?? [] };
  }
  const pill = (id: string, place: PaperPending["pills"][number]["place"], label = "Joining…") => ({ id, kind: "merge", label, place });
  const folds = (items: Array<[number, string, string]>) =>
    new Map(items.map(([id, rowKey, remark]): [number, DeletedFold] => [id, { rowKey, remark, kind: "text", lang: "en", text: "" }]));

  it("reads the pending work of its own boxes only", () => {
    const busy = pending({ lockedIds: [1], shimmerIds: [1], waits: [[2, "Queued · Delete"]] });
    expect(readChunkPending(undefined, mine)).toBe("");
    expect(readChunkPending(busy, mine)).not.toBe("");
    // 남의 덩어리 일은 값이 같다
    expect(readChunkPending(pending({ lockedIds: [1, 9], shimmerIds: [1], waits: [[2, "Queued · Delete"], [8, "Queued · Merge"]] }), mine)).toBe(readChunkPending(busy, mine));
    expect(readChunkPending(pending({ lockedIds: [9], shimmerIds: [9], waits: [[8, "Queued · Merge"]] }), mine)).toBe("");
    // 같은 박스라도 잠금 · 쉬머 · 대기 칩이 다르면 다르다
    expect(readChunkPending(pending({ shimmerIds: [1], waits: [[2, "Queued · Delete"]] }), mine)).not.toBe(readChunkPending(busy, mine));
    expect(readChunkPending(pending({ lockedIds: [1], shimmerIds: [1], waits: [[2, "Queued · Delete +1"]] }), mine)).not.toBe(readChunkPending(busy, mine));
  });

  it("reads the pills placed inside it - a box, a gap or a table", () => {
    expect(readChunkPending(pending({ pills: [pill("a", { at: "box", unitId: 2 })] }), mine)).not.toBe("");
    expect(readChunkPending(pending({ pills: [pill("a", { at: "gap", firstId: 2, secondId: 3 })] }), mine)).not.toBe("");
    expect(readChunkPending(pending({ pills: [pill("a", { at: "table", tableId: 7 })] }), mine, new Set([7]))).not.toBe("");
    expect(readChunkPending(pending({ pills: [pill("a", { at: "box", unitId: 9 }), pill("b", { at: "gap", firstId: 8, secondId: 9 }), pill("c", { at: "table", tableId: 7 }), pill("d", { at: "none" })] }), mine)).toBe("");
  });

  it("reads the deleted lines of its own boxes only", () => {
    expect(readChunkDeleted(undefined, mine)).toBe("");
    expect(readChunkDeleted(folds([[1, "u1", "사유"], [9, "u9", ""]]), mine)).toBe(readChunkDeleted(folds([[1, "u1", "사유"]]), mine));
    expect(readChunkDeleted(folds([[1, "u1", "다른 사유"]]), mine)).not.toBe(readChunkDeleted(folds([[1, "u1", "사유"]]), mine));
    expect(readChunkDeleted(folds([[9, "u9", ""]]), mine)).toBe("");
  });

  it("tells a pressed delete from a saved one", () => {
    const saved = folds([[1, "u1", ""]]);
    const pressed = new Map([...saved].map(([id, item]): [number, DeletedFold] => [id, { ...item, isPending: true }]));
    expect(readChunkDeleted(pressed, mine)).not.toBe(readChunkDeleted(saved, mine));
  });

  it("reads the numbers being saved in its own boxes only", () => {
    expect(readChunkNumbers(undefined, mine)).toBe("");
    expect(readChunkNumbers(new Map([[9, "5.2"]]), mine)).toBe("");
    expect(readChunkNumbers(new Map([[1, "5.2"], [9, "7"]]), mine)).toBe(readChunkNumbers(new Map([[1, "5.2"]]), mine));
    expect(readChunkNumbers(new Map([[1, null]]), mine)).not.toBe(readChunkNumbers(new Map([[1, "5.2"]]), mine));
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

describe("readChunkNoise", () => {
  const mine = new Set([1, 2, 3]);
  it("reads only the blocks and the pick of its own chunk", () => {
    expect(readChunkNoise(undefined, null, mine)).toBe("");
    expect(readChunkNoise(new Set([9]), { key: 9, unitId: 10 }, mine)).toBe("");
    expect(readChunkNoise(new Set([1, 9]), null, mine)).toBe(readChunkNoise(new Set([1]), { key: 9, unitId: null }, mine));
    expect(readChunkNoise(new Set([1]), null, mine)).not.toBe("");
  });
  it("tells the head, a line and another line apart, even when the key left the block", () => {
    const values = [{ key: 1, unitId: null }, { key: 1, unitId: 2 }, { key: 9, unitId: 3 }].map((pick) => readChunkNoise(new Set(), pick, mine));
    expect(new Set(values).size).toBe(3);
    expect(values).not.toContain("");
  });
});
