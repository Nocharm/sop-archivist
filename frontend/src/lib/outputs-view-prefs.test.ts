import { beforeEach, describe, expect, it } from "vitest";

import { readOutputsView, writeOutputsView } from "./outputs-view-prefs";

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
});
