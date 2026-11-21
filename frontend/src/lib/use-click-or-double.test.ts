// useClickOrDouble - 한 번 누름은 기다린 뒤에만, 기다리는 사이 두 번째 누름은 두 번 일만, 사라지면 기다리던 한 번 일은 버린다.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CLICK_OR_DOUBLE_MS, useClickOrDouble } from "@/lib/use-click-or-double";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLElement | null = null;
let root: Root | null = null;
const single = vi.fn();
const double = vi.fn();

// 시험 파일은 .ts만 모이므로 JSX 대신 createElement - 단추 누름이 훅을 부른다
function Probe() {
  const handle = useClickOrDouble();
  return createElement("button", { type: "button", onClick: () => handle(single, double) }, "x");
}

function press() {
  act(() => host!.querySelector("button")!.click());
}

beforeEach(() => {
  vi.useFakeTimers();
  single.mockReset();
  double.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(createElement(Probe)));
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  vi.useRealTimers();
});

describe("useClickOrDouble", () => {
  it("runs the single action only after the wait", () => {
    press();
    vi.advanceTimersByTime(CLICK_OR_DOUBLE_MS - 1);
    expect(single).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(single).toHaveBeenCalledTimes(1);
    expect(double).not.toHaveBeenCalled();
  });

  it("runs only the double action when a second press comes within the wait", () => {
    press();
    vi.advanceTimersByTime(CLICK_OR_DOUBLE_MS - 50);
    press();
    vi.advanceTimersByTime(CLICK_OR_DOUBLE_MS * 2);
    expect(double).toHaveBeenCalledTimes(1);
    expect(single).not.toHaveBeenCalled();
  });

  it("starts over after the wait - two slow presses are two singles", () => {
    press();
    vi.advanceTimersByTime(CLICK_OR_DOUBLE_MS);
    press();
    vi.advanceTimersByTime(CLICK_OR_DOUBLE_MS);
    expect(single).toHaveBeenCalledTimes(2);
    expect(double).not.toHaveBeenCalled();
  });

  it("drops a waiting single action when it unmounts", () => {
    press();
    act(() => root!.unmount());
    root = null;
    vi.advanceTimersByTime(CLICK_OR_DOUBLE_MS);
    expect(single).not.toHaveBeenCalled();
  });
});
