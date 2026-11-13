// 모달 - 요청이 도는 중(isBusy)에는 Esc·바깥 누름·닫기 단추로 닫히지 않는다(닫히면 실패해도 알릴 곳이 없다).
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { LangProvider } from "@/lib/i18n";

import { ConfirmModal } from "./ui/confirm-modal";
import { Modal, type ModalSize } from "./modal";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function renderModal(isBusy: boolean, onClose: () => void) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  // .ts 시험이라 JSX가 없다 - children이 필수 prop이어서 createElement의 셋째 인자로는 타입이 맞지 않는다
  // eslint-disable-next-line react/no-children-prop
  act(() => root.render(createElement(LangProvider, null, createElement(Modal, { title: "T", testId: "m", onClose, isBusy, children: "body" }))));
  return { host, root };
}

describe("Modal", () => {
  it("ignores Esc, backdrop and the close button while busy", () => {
    const onClose = vi.fn();
    const { host, root } = renderModal(true, onClose);
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    act(() => host.querySelector('[data-testid="m-backdrop"]')?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    act(() => (host.querySelector('[data-testid="m-close"]') as HTMLButtonElement | null)?.click());
    expect(onClose).not.toHaveBeenCalled();
    act(() => root.unmount());
  });

  it("closes on Esc when idle", () => {
    const onClose = vi.fn();
    const { root } = renderModal(false, onClose);
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });
});

// 창 폭 - 시선이 좌우로 덜 움직이게 기본을 좁게 두고, 넓은 창은 고른 곳에서만 쓴다
function renderPanel(element: ReturnType<typeof createElement>) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(createElement(LangProvider, null, element)));
  const panel = host.querySelector('[data-testid="m"]');
  const classes = panel ? Array.from(panel.classList) : [];
  act(() => root.unmount());
  host.remove();
  return classes.filter((name) => name.startsWith("max-w-"));
}

describe("Modal width", () => {
  it("is the form width unless a size is given", () => {
    // eslint-disable-next-line react/no-children-prop
    expect(renderPanel(createElement(Modal, { title: "T", testId: "m", onClose: vi.fn(), children: "body" }))).toEqual(["max-w-md"]);
  });

  it.each<[ModalSize, string]>([
    ["sm", "max-w-sm"],
    ["md", "max-w-md"],
    ["lg", "max-w-lg"],
    ["xl", "max-w-3xl"],
    ["sheet", "max-w-[min(1280px,calc(100vw-32px))]"],
  ])("draws size %s as %s", (size, expected) => {
    // eslint-disable-next-line react/no-children-prop
    expect(renderPanel(createElement(Modal, { title: "T", testId: "m", onClose: vi.fn(), size, children: "body" }))).toEqual([expected]);
  });

  it("keeps a confirm window at the narrowest width", () => {
    const element = createElement(ConfirmModal, { title: "T", summary: "body", confirmLabel: "OK", testId: "m", onConfirm: vi.fn(), onClose: vi.fn() });
    expect(renderPanel(element)).toEqual(["max-w-sm"]);
  });
});
