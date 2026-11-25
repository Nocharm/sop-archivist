import { beforeEach, describe, expect, it } from "vitest";

import { listOutputsTabs, readOrderTemplate, readOutputsView, resolveOutputsTab, writeOrderTemplate, writeOutputsView } from "./outputs-view-prefs";

describe("Output C while drafting is hidden", () => {
  it("falls back to B and keeps the other tabs", () => {
    expect(resolveOutputsTab("c", false)).toBe("b");
    expect(resolveOutputsTab("a", false)).toBe("a");
    expect(resolveOutputsTab("c", true)).toBe("c");
    expect(listOutputsTabs(false)).toEqual(["a", "b"]);
    expect(listOutputsTabs(true)).toEqual(["a", "b", "c"]);
  });
});

describe("outputs view prefs", () => {
  beforeEach(() => window.localStorage.clear());

  it("starts on Output C", () => {
    expect(readOutputsView()).toEqual({ tab: "c" });
  });

  it("remembers the last tab", () => {
    writeOutputsView({ tab: "a" });
    expect(readOutputsView()).toEqual({ tab: "a" });
  });

  it("ignores values it does not know", () => {
    window.localStorage.setItem("sopa.outputs.tab", "z");
    expect(readOutputsView()).toEqual({ tab: "c" });
  });

  it("neither reads nor writes the old output language", () => {
    // 결과물은 한 벌이라 판을 기억하지 않는다 - 남아 있는 옛 값도 읽지 않는다
    window.localStorage.setItem("sopa.outputs.lang", "en");
    expect(readOutputsView()).toEqual({ tab: "c" });
    window.localStorage.removeItem("sopa.outputs.lang");
    writeOutputsView({ tab: "b" });
    expect(window.localStorage.getItem("sopa.outputs.lang")).toBeNull();
  });

  it("opens Order in the basic view and remembers the template choice", () => {
    expect(readOrderTemplate()).toBe(false);
    writeOrderTemplate(true);
    expect(window.localStorage.getItem("sopa.order.template")).toBe("1");
    expect(readOrderTemplate()).toBe(true);
    writeOrderTemplate(false);
    expect(readOrderTemplate()).toBe(false);
  });

  it("keeps the template choice apart from the Outputs tab", () => {
    writeOrderTemplate(true);
    expect(readOutputsView()).toEqual({ tab: "c" });
  });
});
