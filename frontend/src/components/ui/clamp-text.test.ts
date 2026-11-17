// 두 줄 글(ClampText) - 올리면 잘렸는지 재어 다시 그리지만, 상자를 끄는 동안(html[data-box-drag]) 지나가는 글은 재지 않는다(끌어다 놓기 G11).
import { Profiler, act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { ClampText } from "./clamp-text";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** 잘린 글을 그리고 그 상자를 돌려준다 - jsdom은 배치를 하지 않아 높이를 박는다. commits는 그린 뒤 다시 그린 수 */
function renderClamped() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const state = { commits: 0 };
  act(() => root.render(createElement(Profiler, { id: "clamp", onRender: () => (state.commits += 1) }, createElement(ClampText, { text: "a long title", testId: "clamp" }))));
  const box = host.querySelector<HTMLElement>('[data-testid="clamp"]');
  if (!box) throw new Error("ClampText did not render");
  Object.defineProperty(box, "scrollHeight", { value: 60 });
  Object.defineProperty(box, "clientHeight", { value: 40 });
  state.commits = 0;
  const enter = () => act(() => box.dispatchEvent(new MouseEvent("pointerover", { bubbles: true })));
  return { state, enter, unmount: () => act(() => root.unmount()) };
}

afterEach(() => {
  document.documentElement.removeAttribute("data-box-drag");
  document.body.replaceChildren();
});

describe("ClampText", () => {
  it("measures on hover outside a drag", () => {
    const view = renderClamped();
    view.enter();
    expect(view.state.commits).toBeGreaterThan(0);
    view.unmount();
  });

  it("does not re-render while a box is being dragged over it", () => {
    const view = renderClamped();
    document.documentElement.setAttribute("data-box-drag", "");
    view.enter();
    expect(view.state.commits).toBe(0);
    view.unmount();
  });
});
