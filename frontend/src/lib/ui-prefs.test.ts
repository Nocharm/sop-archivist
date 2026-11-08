// 부트 스크립트와 설정 쓰기 - 저장값이 있으면 첫 페인트 전 속성이 그 값이고, 모르는 값과 막힌 저장소는 기본값으로 둔다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildPrefsBootScript, getDefaultPrefAttrs } from "./ui-prefs";
import { setLangPref, setUiPref } from "./use-ui-pref";

function resetHtml(): void {
  const root = document.documentElement;
  for (const [attr, value] of Object.entries(getDefaultPrefAttrs())) root.setAttribute(attr, value);
  root.lang = "en";
}

function runBootScript(): void {
  new Function(buildPrefsBootScript())();
}

describe("prefs boot script", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetHtml();
  });
  afterEach(() => vi.restoreAllMocks());

  it("applies stored values before React mounts", () => {
    window.localStorage.setItem("sopa.shell", "bar");
    window.localStorage.setItem("sopa.sourceFontEn", "times");
    window.localStorage.setItem("sopa.lang", "ko");
    runBootScript();
    const root = document.documentElement;
    expect(root.getAttribute("data-shell")).toBe("bar");
    expect(root.getAttribute("data-src-en")).toBe("times");
    expect(root.getAttribute("data-layout")).toBe("paper");
    expect(root.lang).toBe("ko");
  });

  it("ignores unknown stored values", () => {
    window.localStorage.setItem("sopa.shell", "sidebar");
    window.localStorage.setItem("sopa.lang", "fr");
    runBootScript();
    expect(document.documentElement.getAttribute("data-shell")).toBe("rail");
    expect(document.documentElement.lang).toBe("en");
  });

  it("keeps the defaults when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(runBootScript).not.toThrow();
    expect(document.documentElement.getAttribute("data-shell")).toBe("rail");
  });
});

describe("setUiPref / setLangPref", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetHtml();
  });

  it("writes the attribute and storage together", () => {
    setUiPref("classifyLayout", "list");
    expect(document.documentElement.getAttribute("data-layout")).toBe("list");
    expect(window.localStorage.getItem("sopa.classifyLayout")).toBe("list");
    setLangPref("ko");
    expect(document.documentElement.lang).toBe("ko");
    expect(window.localStorage.getItem("sopa.lang")).toBe("ko");
  });
});
