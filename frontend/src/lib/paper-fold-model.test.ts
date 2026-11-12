import { describe, expect, it } from "vitest";

import { buildFoldPlan, EMPTY_FOLD_OPEN, type FoldItem } from "./paper-fold-model";

let nextId = 1;
function it_(key: string, ids?: number[], section = ""): FoldItem {
  return { key, unitIds: ids ?? [nextId++], section };
}
const ids = (items: FoldItem[], ...keys: string[]) =>
  new Set(items.filter((i) => keys.includes(i.key)).flatMap((i) => i.unitIds));
const kinds = (plan: ReturnType<typeof buildFoldPlan>) =>
  plan.map((e) => `${e.kind}:${"key" in e ? e.key : e.runKey}`);

describe("buildFoldPlan", () => {
  it("맞음 1개가 가운데면 곁 한 줄씩, 먼 쪽은 묶음", () => {
    const items = ["a", "b", "c", "M", "d", "e", "f"].map((k) => it_(k));
    const plan = buildFoldPlan(items, ids(items, "M"), EMPTY_FOLD_OPEN);
    expect(kinds(plan)).toEqual(["run:a", "line:c", "full:M", "line:d", "run:e"]);
    expect(plan[0]).toMatchObject({ kind: "run", count: 2 });
  });

  it("한 개뿐인 묶음은 line(runKey null)", () => {
    const items = ["a", "M", "b", "c"].map((k) => it_(k));
    const plan = buildFoldPlan(items, ids(items, "M"), EMPTY_FOLD_OPEN);
    expect(plan).toEqual([
      { kind: "line", key: "a", runKey: null },
      { kind: "full", key: "M" },
      { kind: "line", key: "b", runKey: null },
      { kind: "line", key: "c", runKey: null },
    ]);
  });

  it("from/to는 묶음의 첫·끝 section, 빈 section은 건너뛴다", () => {
    const items = [
      it_("M"), it_("x"), it_("a", undefined, ""), it_("b", undefined, "5.1"),
      it_("c", undefined, "5.2"), it_("d", undefined, ""), it_("e"), it_("M2"),
    ];
    const plan = buildFoldPlan(items, ids(items, "M", "M2"), EMPTY_FOLD_OPEN);
    expect(plan[2]).toMatchObject({ kind: "run", from: "5.1", to: "5.2" });
    const same = [it_("M"), it_("x"), it_("a", undefined, "5.1"), it_("b", undefined, "5.1"), it_("y"), it_("M2")];
    const p2 = buildFoldPlan(same, ids(same, "M", "M2"), EMPTY_FOLD_OPEN);
    expect(p2.find((e) => e.kind === "run")).toMatchObject({ from: "5.1", to: "5.1" });
  });

  it("count는 묶음 안 unitIds 수 합, unit 없는 item은 1", () => {
    const items = [it_("M"), it_("x"), it_("a", [101, 102]), it_("b", []), it_("c", [103]), it_("y"), it_("M2")];
    const plan = buildFoldPlan(items, ids(items, "M", "M2"), EMPTY_FOLD_OPEN);
    expect(plan.find((e) => e.kind === "run")).toMatchObject({ count: 4 });
  });

  it("짝 item은 둘 중 하나만 맞아도 full", () => {
    const items = [it_("p", [7, 8]), it_("z")];
    expect(kinds(buildFoldPlan(items, new Set([8]), EMPTY_FOLD_OPEN))).toEqual(["full:p", "line:z"]);
  });

  it("open.runs 묶음은 runHead + line들, open.peeks key는 peek", () => {
    const items = ["a", "b", "c", "d", "M"].map((k) => it_(k));
    const open = { runs: new Set(["a"]), peeks: new Set(["b"]) };
    const plan = buildFoldPlan(items, ids(items, "M"), open);
    expect(plan).toEqual([
      { kind: "runHead", runKey: "a" },
      { kind: "line", key: "a", runKey: "a" },
      { kind: "peek", key: "b" },
      { kind: "line", key: "c", runKey: "a" },
      { kind: "line", key: "d", runKey: null },
      { kind: "full", key: "M" },
    ]);
  });

  it("forceOpenIds: 묶음 안이면 묶음이 펼쳐지고 peek, 곁이면 peek", () => {
    const items = ["a", "b", "c", "M", "d"].map((k) => it_(k));
    const plan = buildFoldPlan(items, ids(items, "M"), EMPTY_FOLD_OPEN, ids(items, "a", "c"));
    expect(plan).toEqual([
      { kind: "runHead", runKey: "a" },
      { kind: "peek", key: "a" },
      { kind: "line", key: "b", runKey: "a" },
      { kind: "peek", key: "c" },
      { kind: "full", key: "M" },
      { kind: "line", key: "d", runKey: null },
    ]);
  });

  it("맞음 0개면 빈 배열", () => {
    const items = [it_("a"), it_("b")];
    expect(buildFoldPlan(items, new Set(), EMPTY_FOLD_OPEN)).toEqual([]);
  });

  it("맞음끼리 이웃하면 사이에 아무것도 없다", () => {
    const items = [it_("M1"), it_("M2")];
    expect(kinds(buildFoldPlan(items, ids(items, "M1", "M2"), EMPTY_FOLD_OPEN))).toEqual(["full:M1", "full:M2"]);
  });

  it("5,000 item 한 번 계산이 200ms 안", () => {
    const items = Array.from({ length: 5000 }, (_, i) => ({ key: `k${i}`, unitIds: [90000 + i], section: `${i}` }));
    const match = new Set(items.filter((_, i) => i % 97 === 0).flatMap((i) => i.unitIds));
    const t0 = performance.now();
    buildFoldPlan(items, match, EMPTY_FOLD_OPEN);
    expect(performance.now() - t0).toBeLessThan(200);
  });
});
