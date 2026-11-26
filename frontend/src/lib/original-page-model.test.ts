import { describe, expect, it } from "vitest";

import type { PlaceMark } from "./original-place-model";
import {
  PAGE_SLACK_PX,
  type FlowBox,
  pickFollowTarget,
  planPageBreaks,
  planRowBreaks,
  readFollowMotion,
} from "./original-page-model";

const stack = (heights: readonly number[], floating: readonly boolean[] = []): FlowBox[] => {
  let top = 0;
  return heights.map((height, i) => {
    const box = { top, bottom: top + height, floating: floating[i] ?? false };
    top += height;
    return box;
  });
};

describe("planPageBreaks", () => {
  it("starts a new page at the first child that runs past the paper", () => {
    expect(planPageBreaks(stack(Array(12).fill(100)), 400)).toEqual([4, 8]);
  });

  it("keeps a child that spills only into the bottom slack", () => {
    const boxes = stack([100, 100, 100, 100 + PAGE_SLACK_PX - 2, 100]);
    expect(planPageBreaks(boxes, 400)).toEqual([4]);
  });

  it("does not break for a floating box that reaches past the end", () => {
    const boxes = stack([100, 100, 100]);
    boxes.splice(1, 0, { top: 100, bottom: 900, floating: true });
    expect(planPageBreaks(boxes, 400)).toEqual([]);
  });

  it("puts a child taller than a page on its own page", () => {
    expect(planPageBreaks(stack([100, 900, 100]), 400)).toEqual([1, 2]);
    expect(planPageBreaks(stack([900, 100]), 400)).toEqual([1]);
  });

  it("measures each page from its first child", () => {
    const boxes = stack([100, 100, 100]).map((box) => ({ ...box, top: box.top + 50, bottom: box.bottom + 50 }));
    expect(planPageBreaks(boxes, 250)).toEqual([2]);
  });
});

describe("planRowBreaks", () => {
  it("splits rows by the first page's room, then whole pages", () => {
    const bottoms = Array.from({ length: 12 }, (_, i) => 50 * (i + 1));
    expect(planRowBreaks(bottoms, 150, 400)).toEqual([3, 11]);
  });

  it("returns a break at 0 when not even the first row fits", () => {
    expect(planRowBreaks([300, 350], 100, 400)).toEqual([0]);
  });
});

describe("readFollowMotion", () => {
  const view = { scrollTop: 1000, viewHeight: 600, repeating: false, reduced: false };

  it("only repaints when the target is already on screen", () => {
    expect(readFollowMotion({ ...view, targetTop: 1200, targetBottom: 1240 })).toBe("none");
  });

  it("scrolls smoothly for about a screen away", () => {
    expect(readFollowMotion({ ...view, targetTop: 1900, targetBottom: 1940 })).toBe("smooth");
    expect(readFollowMotion({ ...view, targetTop: 400, targetBottom: 440 })).toBe("smooth");
  });

  it("fades for far targets", () => {
    expect(readFollowMotion({ ...view, targetTop: 5000, targetBottom: 5040 })).toBe("fade");
  });

  it("jumps while a key repeats or motion is reduced", () => {
    expect(readFollowMotion({ ...view, targetTop: 5000, targetBottom: 5040, repeating: true })).toBe("instant");
    expect(readFollowMotion({ ...view, targetTop: 1900, targetBottom: 1940, reduced: true })).toBe("instant");
  });
});

describe("pickFollowTarget", () => {
  const mark = (id: string): PlaceMark => ({ id, cell: false, exact: true, page: 1 });
  const marks = new Map<number, PlaceMark[]>([
    [1, [mark("sopa_0")]],
    [2, [mark("sopa_1"), mark("sopa_2")]],
  ]);

  it("uses the latest pick after rendering", () => {
    expect(pickFollowTarget({ renderedDocId: 5, docId: 5, pickedUnitIds: [1], marks })?.unitId).toBe(1);
    const later = pickFollowTarget({ renderedDocId: 5, docId: 5, pickedUnitIds: [2], marks });
    expect(later).toEqual({ unitId: 2, marks: [mark("sopa_1"), mark("sopa_2")] });
  });

  it("drops a stale render when the document changes", () => {
    expect(pickFollowTarget({ renderedDocId: 5, docId: 6, pickedUnitIds: [1], marks })).toBeNull();
    expect(pickFollowTarget({ renderedDocId: null, docId: 6, pickedUnitIds: [1], marks })).toBeNull();
  });

  it("skips picked units without marks", () => {
    expect(pickFollowTarget({ renderedDocId: 5, docId: 5, pickedUnitIds: [99, 2], marks })?.unitId).toBe(2);
    expect(pickFollowTarget({ renderedDocId: 5, docId: 5, pickedUnitIds: [99], marks })).toBeNull();
  });
});
