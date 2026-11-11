import { describe, expect, it } from "vitest";

import { buildAiTabs, getAiTabsHead, type AiOrigin, type PendingSplit } from "@/lib/split-ai-tabs-model";

const item = (unitId: number, position: number, origin: AiOrigin = "single"): PendingSplit => ({ unitId, label: `U${unitId}`, position, origin });

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

  it("keeps the request origin and heads batch results with their count", () => {
    const tabs = buildAiTabs([item(1, 0, "batch"), item(2, 1), item(3, 2, "batch")], new Set());
    expect(tabs.map((tab) => tab.origin)).toEqual(["batch", "single", "batch"]);
    expect(getAiTabsHead(tabs)).toEqual({ kind: "batch", n: 2 });
  });

  it("uses a neutral head when the origin is unknown and none is batch", () => {
    expect(getAiTabsHead(buildAiTabs([item(1, 0, "unknown"), item(2, 1, "unknown"), item(3, 2)], new Set()))).toEqual({ kind: "plain", n: 2 });
    expect(getAiTabsHead(buildAiTabs([item(1, 0)], new Set()))).toBeNull();
  });

  it("returns nothing for no suggestions", () => {
    expect(buildAiTabs([], new Set())).toEqual([]);
  });
});
