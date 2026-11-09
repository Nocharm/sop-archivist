// 값 고르기 드롭다운 - 고르면 값이 바뀌고 닫히며, 키보드로 고를 수 있고, 모달 안에서 Esc는 목록만 닫는다.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { Modal } from "@/components/modal";
import { LangProvider } from "@/lib/i18n";

import { Select, type SelectOption } from "./select";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OPTIONS: SelectOption<string>[] = [
  { value: "", label: "None" },
  { value: "apple", label: "Apple" },
  { value: "banana", label: "Banana", disabled: true },
  { value: "cherry", label: "Cherry" },
  { value: "citrus", label: "Citrus" },
];

let cleanup: (() => void) | null = null;

beforeAll(() => {
  // jsdom에는 scrollIntoView가 없다 - 목록이 고른 항목을 보이게 할 때 부른다
  Element.prototype.scrollIntoView = () => undefined;
});

afterEach(() => {
  cleanup?.();
  cleanup = null;
});

function render(node: ReturnType<typeof createElement>) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(createElement(LangProvider, null, node)));
  cleanup = () => {
    act(() => root.unmount());
    host.remove();
  };
}

function byTestId(id: string): HTMLElement | null {
  return document.querySelector(`[data-testid="${id}"]`);
}

async function flushFrame() {
  await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
}

function press(key: string) {
  act(() => {
    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

describe("Select", () => {
  it("opens on click, picks an option and closes", async () => {
    const onChange = vi.fn();
    render(createElement(Select<string>, { value: "apple", options: OPTIONS, onChange, testId: "s" }));
    act(() => byTestId("s")?.click());
    await flushFrame();
    expect(byTestId("s-list")?.getAttribute("role")).toBe("listbox");
    expect(document.activeElement).toBe(byTestId("s-option-apple"));

    act(() => byTestId("s-option-cherry")?.click());
    expect(onChange).toHaveBeenCalledWith("cherry");
    expect(byTestId("s-list")).toBeNull();
  });

  it("does not report a change when the current value is picked again", async () => {
    const onChange = vi.fn();
    render(createElement(Select<string>, { value: "", options: OPTIONS, onChange, testId: "s" }));
    act(() => byTestId("s")?.click());
    await flushFrame();
    act(() => byTestId("s-option-none")?.click());
    expect(onChange).not.toHaveBeenCalled();
  });

  it("moves with arrows past disabled options and jumps by typed letter", async () => {
    const onChange = vi.fn();
    render(createElement(Select<string>, { value: "apple", options: OPTIONS, onChange, testId: "s" }));
    act(() => byTestId("s")?.click());
    await flushFrame();
    press("ArrowDown");
    expect(document.activeElement).toBe(byTestId("s-option-cherry"));
    press("c");
    expect(document.activeElement).toBe(byTestId("s-option-citrus"));
    press("End");
    press("ArrowDown");
    expect(document.activeElement).toBe(byTestId("s-option-none"));
  });

  it("closes only the list on Esc inside a modal and returns focus to the trigger", async () => {
    const onClose = vi.fn();
    const select = createElement(Select<string>, { value: "apple", options: OPTIONS, onChange: vi.fn(), testId: "s" });
    // .ts 시험이라 JSX가 없다 - children이 필수 prop이어서 createElement의 셋째 인자로는 타입이 맞지 않는다
    // eslint-disable-next-line react/no-children-prop
    render(createElement(Modal, { title: "T", testId: "m", onClose, children: select }));
    act(() => byTestId("s")?.click());
    await flushFrame();
    press("Escape");
    expect(byTestId("s-list")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(byTestId("s"));
  });

  it("does not open while disabled", () => {
    render(createElement(Select<string>, { value: "apple", options: OPTIONS, onChange: vi.fn(), testId: "s", disabled: true }));
    act(() => byTestId("s")?.click());
    expect(byTestId("s-list")).toBeNull();
  });
});
