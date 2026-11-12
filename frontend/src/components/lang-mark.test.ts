// 언어 표시 - 막대 + 회색 mono 글자의 DOM 계약(색은 CSS ::before)
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import { LangMark } from "./lang-mark";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function render(node: ReturnType<typeof createElement>): { host: HTMLElement; unmount: () => void } {
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => root.render(node));
  return { host, unmount: () => act(() => root.unmount()) };
}

describe("LangMark", () => {
  it("draws the language letters and marks data-lang for ko and en", () => {
    const { host, unmount } = render(createElement(LangMark, { lang: "ko", testId: "m" }));
    const mark = host.querySelector(".lmark");
    expect(mark?.textContent).toBe("KO");
    expect(mark?.getAttribute("data-lang")).toBe("ko");
    expect(mark?.getAttribute("data-testid")).toBe("m");
    unmount();
    const en = render(createElement(LangMark, { lang: "en" }));
    expect(en.host.querySelector(".lmark")?.textContent).toBe("EN");
    en.unmount();
  });

  it("draws a dash without data-lang for neutral", () => {
    const { host, unmount } = render(createElement(LangMark, { lang: "neutral" }));
    const mark = host.querySelector(".lmark");
    expect(mark?.textContent).toBe("–");
    expect(mark?.hasAttribute("data-lang")).toBe(false);
    unmount();
  });
});
