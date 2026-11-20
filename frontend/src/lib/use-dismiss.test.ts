// useDismiss - 열려 있을 때만 바깥 누르기·Esc로 닫고, 안쪽 누르기와 위에 뜬 다른 층의 Esc는 닫지 않는다.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { popEscLayer, pushEscLayer } from "@/components/ui/floating";
import { useDismiss } from "@/lib/use-dismiss";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLElement | null = null;
let root: Root | null = null;

// 시험 파일은 .ts만 모이므로 JSX 대신 createElement, 콜백 ref로 칸을 잡는다(use-box-drag.test와 같다)
const insideRef: { current: HTMLElement | null } = { current: null };

function captureInside(el: HTMLElement | null) {
  insideRef.current = el;
}

function Probe({ open, onClose }: { open: boolean; onClose: () => void }) {
  useDismiss(insideRef, open, onClose);
  return createElement("span", { ref: captureInside }, createElement("button", { type: "button" }, "x"));
}

function mount(open: boolean, onClose: () => void) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(createElement(Probe, { open, onClose })));
}

function press(target: EventTarget) {
  target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
}

function hitEscape() {
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  host = null;
  root = null;
});

describe("useDismiss", () => {
  it("closes on a press outside and on Escape", () => {
    // Arrange
    const onClose = vi.fn();
    mount(true, onClose);
    // Act
    press(document.body);
    hitEscape();
    // Assert
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("keeps open on a press inside", () => {
    const onClose = vi.fn();
    mount(true, onClose);
    press(host!.querySelector("button")!);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does nothing while closed", () => {
    const onClose = vi.fn();
    mount(false, onClose);
    press(document.body);
    hitEscape();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("leaves Escape to a layer opened above it", () => {
    const onClose = vi.fn();
    mount(true, onClose);
    const above = pushEscLayer();
    hitEscape();
    popEscLayer(above);
    expect(onClose).not.toHaveBeenCalled();
  });
});
