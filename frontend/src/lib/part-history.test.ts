import { describe, expect, it } from "vitest";

import type { PaperTabKey } from "./paper-model";
import { readPartState, stepPart, withPartState } from "./part-history";

describe("stepping through the parts", () => {
  it("cycles over the tabs that exist", () => {
    const keys: PaperTabKey[] = ["body", "header", "figures"];
    expect(stepPart(keys, "body", 1)).toBe("header");
    expect(stepPart(keys, "header", 1)).toBe("figures");
    expect(stepPart(keys, "figures", 1)).toBe("body");
    expect(stepPart(keys, "body", -1)).toBe("figures");
    expect(stepPart(["body"], "body", 1)).toBe("body");
    expect(stepPart([], "body", 1)).toBe("body");
  });
});

describe("the part kept in browser history", () => {
  it("keeps Next's own history state", () => {
    expect(withPartState({ __NA: true, x: 1 }, "header")).toEqual({ __NA: true, x: 1, assignPart: "header" });
    expect(withPartState({ __NA: true, assignPart: "body" }, "figures")).toEqual({ __NA: true, assignPart: "figures" });
    expect(withPartState(null, "body")).toEqual({ assignPart: "body" });
  });
  it("ignores a state without a part", () => {
    expect(readPartState(withPartState({ __NA: true }, "footer"))).toBe("footer");
    expect(readPartState(withPartState({ __NA: true }, "tables"))).toBe("tables");
    for (const state of [null, undefined, "body", 3, {}, { __NA: true }, { assignPart: 1 }, { assignPart: "tables-of-old" }]) expect(readPartState(state), JSON.stringify(state)).toBeNull();
  });
});
