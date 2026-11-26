import { describe, expect, it } from "vitest";

import type { JoinPlan } from "./split-menu-model";
import { findJoinNeighbor, stepMergeArm, type ArmEvent, type MergeArm } from "./merge-arm-model";

const merge: JoinPlan = { kind: "merge" };
const pair: JoinPlan = { kind: "pair" };
const press = (dir: 1 | -1, plan: JoinPlan = merge, ids: { fromId: number; toId: number | null } = { fromId: 5, toId: dir === 1 ? 6 : 4 }): ArmEvent => ({ type: "key", dir, plan, ...ids });

describe("the two-press merge", () => {
  it("arms on the first press and saves nothing", () => {
    const result = stepMergeArm(null, press(1));
    expect(result).toEqual({ arm: { fromId: 5, toId: 6, dir: 1, kind: "merge" }, run: null, refuseKey: null });
  });
  it("runs on the same key again", () => {
    const armed = stepMergeArm(null, press(1)).arm;
    const result = stepMergeArm(armed, press(1));
    expect(result.run).toEqual({ fromId: 5, toId: 6, dir: 1, kind: "merge" });
    expect(result.arm).toBeNull();
    // 다른 언어면 짝
    const pairArmed = stepMergeArm(null, press(-1, pair)).arm;
    expect(stepMergeArm(pairArmed, press(-1, pair)).run?.kind).toBe("pair");
  });
  it("refuses with the plan's reason and does not arm", () => {
    const result = stepMergeArm(null, press(1, { kind: null, reasonKey: "split.noMergeToc" }));
    expect(result).toEqual({ arm: null, run: null, refuseKey: "split.noMergeToc" });
  });
  it("disarms when the armed pair can no longer join", () => {
    const armed: MergeArm = { fromId: 5, toId: 6, dir: 1, kind: "merge" };
    expect(stepMergeArm(armed, press(1, { kind: null, reasonKey: "assign.ctx.why.unsaved" }))).toEqual({ arm: null, run: null, refuseKey: "assign.ctx.why.unsaved" });
  });
  it("re-arms the other way on the other key", () => {
    const armed = stepMergeArm(null, press(1)).arm;
    const result = stepMergeArm(armed, press(-1));
    expect(result.run).toBeNull();
    expect(result.arm).toEqual({ fromId: 5, toId: 4, dir: -1, kind: "merge" });
  });
  it("arms again, not runs, when the same key lands on another box", () => {
    const armed = stepMergeArm(null, press(1)).arm;
    const result = stepMergeArm(armed, press(1, merge, { fromId: 6, toId: 7 }));
    expect(result.run).toBeNull();
    expect(result.arm?.fromId).toBe(6);
  });
  it("disarms on any other key, click or Escape", () => {
    const armed = stepMergeArm(null, press(1)).arm;
    expect(stepMergeArm(armed, { type: "other" })).toEqual({ arm: null, run: null, refuseKey: null });
  });
  it("refuses at the edge with noNeighbor", () => {
    const armed = stepMergeArm(null, press(1)).arm;
    expect(stepMergeArm(null, press(1, merge, { fromId: 9, toId: null }))).toEqual({ arm: null, run: null, refuseKey: "assign.ctx.why.noNeighbor" });
    expect(stepMergeArm(armed, press(1, merge, { fromId: 9, toId: null })).arm).toBeNull();
  });
});

describe("findJoinNeighbor", () => {
  const order = [3, 5, 8];
  it("finds the next and previous box in paper order", () => {
    expect(findJoinNeighbor(order, 5, 1)).toBe(8);
    expect(findJoinNeighbor(order, 5, -1)).toBe(3);
  });
  it("is null at the ends and for a box that is not on the paper", () => {
    expect(findJoinNeighbor(order, 8, 1)).toBeNull();
    expect(findJoinNeighbor(order, 3, -1)).toBeNull();
    expect(findJoinNeighbor(order, 99, 1)).toBeNull();
  });
});
