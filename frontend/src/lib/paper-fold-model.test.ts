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
      { kind: "runHead", runKey: "a", memberKeys: ["a", "b", "c"] },
      { kind: "line", key: "a", runKey: "a" },
      { kind: "peek", key: "b" },
      { kind: "line", key: "c", runKey: "a" },
      { kind: "line", key: "d", runKey: null },
      { kind: "full", key: "M" },
    ]);
  });

  it("forceOpenIds: 2개 묶음의 첫 item이면 peek + line, 곁이면 peek", () => {
    const items = ["a", "b", "c", "M", "d"].map((k) => it_(k));
    const plan = buildFoldPlan(items, ids(items, "M"), EMPTY_FOLD_OPEN, ids(items, "a", "c"));
    expect(plan).toEqual([
      { kind: "peek", key: "a" },
      { kind: "line", key: "b", runKey: null },
      { kind: "peek", key: "c" },
      { kind: "full", key: "M" },
      { kind: "line", key: "d", runKey: null },
    ]);
  });

  it("forceOpenIds: 접힌 묶음 가운데면 run / peek / run(각 runKey는 제 첫 item)", () => {
    const items = ["M", "x", "a", "b", "c", "d", "e", "y", "M2"].map((k) => it_(k));
    const plan = buildFoldPlan(items, ids(items, "M", "M2"), EMPTY_FOLD_OPEN, ids(items, "c"));
    expect(kinds(plan)).toEqual(["full:M", "line:x", "run:a", "peek:c", "run:d", "line:y", "full:M2"]);
    expect(plan[2]).toMatchObject({ count: 2 });
    expect(plan[4]).toMatchObject({ count: 2 });
  });

  it("forceOpenIds: 묶음 처음·끝이면 peek + run", () => {
    const items = ["M", "x", "a", "b", "c", "y", "M2"].map((k) => it_(k));
    const atStart = buildFoldPlan(items, ids(items, "M", "M2"), EMPTY_FOLD_OPEN, ids(items, "a"));
    expect(kinds(atStart)).toEqual(["full:M", "line:x", "peek:a", "run:b", "line:y", "full:M2"]);
    const atEnd = buildFoldPlan(items, ids(items, "M", "M2"), EMPTY_FOLD_OPEN, ids(items, "c"));
    expect(kinds(atEnd)).toEqual(["full:M", "line:x", "run:a", "peek:c", "line:y", "full:M2"]);
  });

  it("forceOpenIds: 펼친 묶음이면 runHead + line들, 고른 item은 peek", () => {
    const items = ["M", "x", "a", "b", "c", "y", "M2"].map((k) => it_(k));
    const open = { runs: new Set(["a"]), peeks: new Set<string>() };
    const plan = buildFoldPlan(items, ids(items, "M", "M2"), open, ids(items, "b"));
    expect(plan.slice(2, 6)).toEqual([
      { kind: "runHead", runKey: "a", memberKeys: ["a", "b", "c"] },
      { kind: "line", key: "a", runKey: "a" },
      { kind: "peek", key: "b" },
      { kind: "line", key: "c", runKey: "a" },
    ]);
  });

  it("고른 뒤 접기(runs·peeks 비움, 고른 item은 그대로) - runHead 없이 run / peek / run", () => {
    const items = ["M", "x", "a", "b", "c", "d", "e", "y", "M2"].map((k) => it_(k));
    const expanded = { runs: new Set(["a"]), peeks: new Set(["c"]) };
    const forced = ids(items, "c");
    expect(kinds(buildFoldPlan(items, ids(items, "M", "M2"), expanded, forced))).toContain("runHead:a");
    const collapsed = buildFoldPlan(items, ids(items, "M", "M2"), EMPTY_FOLD_OPEN, forced);
    expect(collapsed.some((e) => e.kind === "runHead")).toBe(false);
    expect(kinds(collapsed)).toEqual(["full:M", "line:x", "run:a", "peek:c", "run:d", "line:y", "full:M2"]);
  });

  it("고른 item 뒤 묶음을 펼치면 그 조각만 runHead(runKey = 제 첫 item)", () => {
    const items = ["M", "x", "a", "b", "c", "d", "e", "y", "M2"].map((k) => it_(k));
    const open = { runs: new Set(["d"]), peeks: new Set<string>() };
    const plan = buildFoldPlan(items, ids(items, "M", "M2"), open, ids(items, "c"));
    expect(kinds(plan)).toEqual(["full:M", "line:x", "run:a", "peek:c", "runHead:d", "line:d", "line:e", "line:y", "full:M2"]);
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
