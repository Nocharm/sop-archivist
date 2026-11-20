// useBoxDrag - config가 끄는 도중 null이 되거나 화면이 사라져도 끌기가 던지지 않고 한 번 깨끗이 끝난다. 못 놓는 자리에 놓으면 이유를 알림으로 한 번.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { dismissToast, listToasts } from "@/components/ui/toast";
import type { BoxDragConfig } from "@/lib/box-drag";
import { useBoxDrag } from "@/lib/use-box-drag";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const html = document.documentElement;
let host: HTMLElement | null = null;
let root: Root | null = null;

// 시험 파일은 .ts만 모이므로 JSX 대신 createElement, 콜백 ref로 root를 잡는다
const rootRef: { current: HTMLElement | null } = { current: null };

function captureRoot(el: HTMLElement | null) {
  rootRef.current = el;
}

function Probe({ config }: { config: BoxDragConfig<string> | null }) {
  useBoxDrag(rootRef, config);
  return createElement("div", { ref: captureRoot }, createElement("div", { "data-drag-box": "" }, "row"));
}

function makeConfig() {
  return {
    pick: vi.fn((): string | null => "src"),
    getCard: () => ({ id: "A1", text: "hello", count: null }),
    getScrollers: () => [],
    onMove: vi.fn(() => ({ state: "ok" as const })),
    onDrop: vi.fn(),
    onEnd: vi.fn(),
  } satisfies BoxDragConfig<string>;
}

function mountAndStartDrag(config: BoxDragConfig<string> | null) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(createElement(Probe, { config })));
  const box = host.querySelector("[data-drag-box]")!;
  const mouse = (type: string, x: number) => new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: 10, pointerType: "mouse" });
  box.dispatchEvent(mouse("pointerdown", 10));
  window.dispatchEvent(mouse("pointermove", 30));
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  document.querySelectorAll('[data-testid="drag-card"]').forEach((el) => el.remove());
  html.removeAttribute("data-box-drag");
});

const expectCleanEnd = (config: ReturnType<typeof makeConfig>) => {
  expect(config.onEnd).toHaveBeenCalledTimes(1);
  expect(config.onEnd).toHaveBeenCalledWith("src", true);
  expect(config.onDrop).toHaveBeenCalledTimes(0);
  expect(html.hasAttribute("data-box-drag")).toBe(false);
  expect(document.querySelector('[data-testid="drag-card"]')).toBeNull();
};

describe("useBoxDrag", () => {
  it("ends the drag cleanly when config becomes null mid-drag", () => {
    const config = makeConfig();
    mountAndStartDrag(config);
    expect(html.hasAttribute("data-box-drag")).toBe(true);
    expect(() => act(() => root!.render(createElement(Probe, { config: null })))).not.toThrow();
    expectCleanEnd(config);
  });

  it("ends the drag cleanly when the component unmounts mid-drag", () => {
    const config = makeConfig();
    mountAndStartDrag(config);
    expect(() => act(() => root!.unmount())).not.toThrow();
    root = null;
    expectCleanEnd(config);
  });

  it("a drop on a refused place shows its reason as one info toast", () => {
    const config = { ...makeConfig(), onMove: vi.fn(() => ({ state: "refused" as const, note: "Already under this SOP" })) };
    mountAndStartDrag(config);
    window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, button: 0, clientX: 30, clientY: 10, pointerType: "mouse" }));
    const shown = listToasts().filter((toast) => toast.text === "Already under this SOP");
    expect(shown.map((toast) => toast.tone)).toEqual(["info"]);
    for (const toast of shown) dismissToast(toast.id);
  });
});
