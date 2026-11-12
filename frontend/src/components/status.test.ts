// 상태 칩 한 벌 - Unit 상태 칩과 Assign 필터 칩의 DOM 계약(색은 CSS, 글자 대문자도 CSS)
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { ListFilter } from "lucide-react";

import { LangProvider } from "@/lib/i18n";

import { FilterChip, UnitStatusChip } from "./status";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function render(node: ReturnType<typeof createElement>): { host: HTMLElement; unmount: () => void } {
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => root.render(createElement(LangProvider, null, node)));
  return { host, unmount: () => act(() => root.unmount()) };
}

describe("UnitStatusChip", () => {
  it("draws icon + the plain status name, and the small size marks data-size", () => {
    const { host, unmount } = render(createElement(UnitStatusChip, { status: "on_hold", size: "sm" }));
    const chip = host.querySelector(".schip");
    expect(chip?.getAttribute("data-tone")).toBe("on_hold");
    expect(chip?.getAttribute("data-size")).toBe("sm");
    expect(chip?.textContent).toBe("On hold");
    expect(chip?.querySelectorAll("svg").length).toBe(1);
    unmount();
  });
});

describe("FilterChip", () => {
  it("is a selected tab button that calls onClick and shows the count", () => {
    const onClick = vi.fn();
    const { host, unmount } = render(createElement(FilterChip, { tone: "all", label: "All", count: 7, selected: true, onClick, testId: "f-all", icon: ListFilter }));
    const btn = host.querySelector<HTMLButtonElement>('[data-testid="f-all"]');
    expect(btn?.getAttribute("role")).toBe("tab");
    expect(btn?.getAttribute("aria-selected")).toBe("true");
    expect(btn?.querySelector(".schip-n")?.textContent).toBe("7");
    act(() => btn?.click());
    expect(onClick).toHaveBeenCalledTimes(1);
    unmount();
  });
});
