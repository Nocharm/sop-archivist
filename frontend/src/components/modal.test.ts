// 모달 - 요청이 도는 중(isBusy)에는 Esc·바깥 누름·닫기 단추로 닫히지 않는다(닫히면 실패해도 알릴 곳이 없다).
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { LangProvider } from "@/lib/i18n";

import { Modal } from "./modal";

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
