import { describe, expect, it } from "vitest";

import type { ViewUnit } from "./api-sop";
import { buildReachCss, readMenuReach, type MenuReachContext } from "./menu-reach-model";

const u = (id: number, over: Partial<ViewUnit> = {}) => ({ id, group_unit_id: null, ...over }) as ViewUnit;
const ctx: MenuReachContext = { target: u(2), prev: u(1), next: u(3), rowUnitIds: [2], pairIds: [2, 9], place: { kind: "text" }, tableUnitIds: [10] };
const inCell: MenuReachContext = { ...ctx, place: { kind: "cell", table: 1, row: 1, col: 1 } };
const holder = { unitId: 40, kind: "table" as const, displayId: "T1", distance: 1, side: "above" as const };

describe("readMenuReach", () => {
  it("merging marks the target and the neighbour", () => expect(readMenuReach({ action: "merge_prev" }, ctx)).toEqual({ change: [2], touch: [1], around: [] }));
  it("pairing with the next marks the next", () => expect(readMenuReach({ action: "pair_next" }, ctx)).toEqual({ change: [2], touch: [3], around: [] }));
  it("has no touched cell without a neighbour", () => expect(readMenuReach({ action: "merge_prev" }, { ...ctx, prev: null }).touch).toEqual([]));
  it("unpair marks every member, caption of marks its holder", () => {
    expect(readMenuReach({ action: "unpair" }, ctx).change).toEqual([2, 9]);
    expect(readMenuReach({ action: "caption_of", holder }, ctx).touch).toEqual([40]);
  });
  it("detaching a caption touches its table", () => expect(readMenuReach({ action: "caption_detach" }, { ...ctx, target: u(2, { group_unit_id: 10 }) }).touch).toEqual([10]));
  it.each(["table_layout", "table_rewrap", "table_ai_order"] as const)("%s goes around the table", (action) => expect(readMenuReach({ action }, ctx)).toEqual({ change: [], touch: [], around: [10] }));
  it("clear and delete go around the table in a cell, and mark the row elsewhere", () => {
    expect(readMenuReach({ action: "delete" }, inCell).around).toEqual([10]);
    expect(readMenuReach({ action: "clear" }, inCell).change).toEqual([]);
    expect(readMenuReach({ action: "delete" }, ctx).change).toEqual([2]);
  });
  it("marks only the target for a one-cell edit", () => expect(readMenuReach({ action: "split" }, ctx)).toEqual({ change: [2], touch: [], around: [] }));
});

describe("buildReachCss", () => {
  it("writes selectors for one pane only", () => {
    const css = buildReachCss("old", { change: [2], touch: [1], around: [] });
    expect(css).toContain('[data-pane="old"] [data-strip-unit="2"]');
    expect(css).toContain('[data-pane="old"] [data-strip-unit="1"]');
    expect(css).not.toContain("new");
    expect(css).not.toMatch(/#[0-9a-f]{3}/i);
  });
  it("writes nothing when nothing is reached", () => expect(buildReachCss("old", { change: [], touch: [], around: [] })).toBe(""));
  it("does not dash a cell that is already filled", () => expect(buildReachCss("new", { change: [2], touch: [2], around: [] }).match(/data-strip-unit="2"/g)).toHaveLength(1));
});
