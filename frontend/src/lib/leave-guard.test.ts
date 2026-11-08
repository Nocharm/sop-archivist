// 이탈 가드 - 고친 것이 있을 때 앱 안 링크 이동과 새로고침·닫기를 붙잡는지, 새 탭·바깥 링크·같은 자리는 놓아주는지 본다.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { findLeaveHref, useLeaveGuard } from "./leave-guard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeLink(href: string, attrs: Record<string, string> = {}): HTMLAnchorElement {
  const link = document.createElement("a");
  link.href = href;
  for (const [name, value] of Object.entries(attrs)) link.setAttribute(name, value);
  const inner = document.createElement("span");
  link.appendChild(inner);
  document.body.appendChild(link);
  return link;
}

function makeClick(target: Element, init: MouseEventInit = {}): MouseEvent {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init });
  Object.defineProperty(event, "target", { value: target });
  return event;
}

afterEach(() => {
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/bundles/1/tobe");
});

describe("findLeaveHref", () => {
  it("catches a plain click on an in-app link to another page, even on a child element", () => {
    window.history.replaceState(null, "", "/bundles/1/tobe");
    const link = makeLink("/bundles/1/classify");
    expect(findLeaveHref(makeClick(link.firstElementChild as Element))).toBe("/bundles/1/classify");
  });

  it("lets new-tab clicks, outside links, downloads and the same page through", () => {
    window.history.replaceState(null, "", "/bundles/1/tobe");
    const link = makeLink("/bundles/1/classify");
    expect(findLeaveHref(makeClick(link, { ctrlKey: true }))).toBeNull();
    expect(findLeaveHref(makeClick(link, { metaKey: true }))).toBeNull();
    expect(findLeaveHref(makeClick(link, { button: 1 }))).toBeNull();
    expect(findLeaveHref(makeClick(makeLink("/bundles/1/classify", { target: "_blank" })))).toBeNull();
    expect(findLeaveHref(makeClick(makeLink("https://example.invalid/x")))).toBeNull();
    expect(findLeaveHref(makeClick(makeLink("/bundles/1/classify", { download: "" })))).toBeNull();
    expect(findLeaveHref(makeClick(makeLink("/bundles/1/tobe")))).toBeNull();
    expect(findLeaveHref(makeClick(document.body))).toBeNull();
  });
});

describe("useLeaveGuard", () => {
  function render(isDirty: boolean, onLeave: (href: string) => void) {
    function Harness() {
      useLeaveGuard(isDirty, onLeave);
      return null;
    }
    const root = createRoot(document.createElement("div"));
    act(() => root.render(createElement(Harness)));
    return root;
  }

  it("asks the browser to confirm reload or close only while dirty", () => {
    const dirty = render(true, () => undefined);
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    act(() => dirty.unmount());

    const clean = render(false, () => undefined);
    const later = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(later);
    expect(later.defaultPrevented).toBe(false);
    act(() => clean.unmount());
  });

  it("stops an in-app link while dirty and hands the destination over", () => {
    const seen: string[] = [];
    const root = render(true, (href) => seen.push(href));
    const link = makeLink("/bundles/1/classify");
    const click = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    link.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(seen).toEqual(["/bundles/1/classify"]);
    act(() => root.unmount());
  });
});
