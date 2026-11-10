import { beforeEach, describe, expect, it } from "vitest";

import { readOutputsView, writeOutputsView } from "./outputs-view-prefs";

describe("outputs view prefs", () => {
  beforeEach(() => window.localStorage.clear());

  it("starts on Output C in Korean", () => {
    expect(readOutputsView()).toEqual({ tab: "c", lang: "ko" });
  });

  it("remembers the last tab and language", () => {
    writeOutputsView({ tab: "a" });
    writeOutputsView({ lang: "en" });
    expect(readOutputsView()).toEqual({ tab: "a", lang: "en" });
  });

  it("ignores values it does not know", () => {
    window.localStorage.setItem("sopa.outputs.tab", "z");
    window.localStorage.setItem("sopa.outputs.lang", "fr");
    expect(readOutputsView()).toEqual({ tab: "c", lang: "ko" });
  });
});
