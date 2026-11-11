import { describe, expect, it } from "vitest";

import { buildAiTabs, countBatchLeft, type PendingSplit } from "@/lib/split-ai-tabs-model";

const item = (unitId: number, position: number, batch = false): PendingSplit => ({ unitId, label: `U${unitId}`, position, batch });

describe("buildAiTabs", () => {
  it("keeps one tab per unit even when it has several suggestions", () => {
    const tabs = buildAiTabs([item(1, 0), item(1, 0), item(2, 1)], new Set());
    expect(tabs.map((tab) => tab.unitId)).toEqual([1, 2]);
  });

  it("marks seen units as not unseen", () => {
    const tabs = buildAiTabs([item(1, 0), item(2, 1)], new Set([2]));
    expect(tabs.map((tab) => tab.unseen)).toEqual([true, false]);
  });

  it("orders by document position, not by arrival", () => {
    const tabs = buildAiTabs([item(9, 5), item(3, 1), item(4, 3)], new Set());
    expect(tabs.map((tab) => tab.unitId)).toEqual([3, 4, 9]);
  });

  it("tells batch results from single requests and counts the batch ones", () => {
    const tabs = buildAiTabs([item(1, 0, true), item(2, 1), item(3, 2, true)], new Set());
    expect(tabs.map((tab) => tab.batch)).toEqual([true, false, true]);
    expect(countBatchLeft(tabs)).toBe(2);
  });

  it("returns nothing for no suggestions", () => {
    expect(buildAiTabs([], new Set())).toEqual([]);
  });
});
