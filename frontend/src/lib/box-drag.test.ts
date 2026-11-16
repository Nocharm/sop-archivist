// 공통 끌기 엔진 시험 - 판단 함수(문턱·가장자리·시작 조건)와 DOM 동작(표·표시·클릭 삼키기·Esc·Alt 모드).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  attachBoxDrag,
  canStartDrag,
  getEdgeScrollDir,
  hasPassedThreshold,
  isBoxDragActive,
  type BoxDragConfig,
  type DragHover,
} from "@/lib/box-drag";

describe("drag decisions", () => {
  const press = { button: 0, altKey: false, ctrlKey: false, pointerType: "mouse" };
  it("canStartDrag: only a plain left mouse press outside guarded children", () => {
    expect(canStartDrag(press, false)).toBe(true);
    for (const bad of [{ button: 2 }, { ctrlKey: true }, { altKey: true }, { pointerType: "touch" }]) expect(canStartDrag({ ...press, ...bad }, false)).toBe(false);
    expect(canStartDrag(press, true)).toBe(false);
  });
  it("hasPassedThreshold: a drag from 4px of travel", () => {
    expect([hasPassedThreshold(3.9, 0), hasPassedThreshold(4, 0), hasPassedThreshold(3, 3)]).toEqual([false, true, true]);
  });
  it("getEdgeScrollDir: within 44px of the top or bottom edge, up to 24px outside, only inside the frame's width", () => {
    const dir = (x: number, y: number) => getEdgeScrollDir({ x, y }, { left: 0, right: 800, top: 100, bottom: 500 });
    expect([dir(10, 143), dir(10, 144), dir(10, 457), dir(10, 76), dir(10, 75), dir(900, 120)]).toEqual([-1, 0, 1, -1, 0, 0]);
  });
});

describe("attachBoxDrag", () => {
  let root: HTMLElement;
  let box: HTMLElement;
  let detach: (() => void) | null = null;

  const mouse = (type: string, x: number, y: number, init: PointerEventInit = {}) =>
    new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y, pointerType: "mouse", ...init });
  const press = (target: Element, x = 10, y = 10, init: PointerEventInit = {}) => {
    const event = mouse("pointerdown", x, y, init);
    target.dispatchEvent(event);
    return event;
  };
  const move = (x: number, y: number) => window.dispatchEvent(mouse("pointermove", x, y));
  const release = (x: number, y: number) => window.dispatchEvent(mouse("pointerup", x, y));
  const key = (type: "keydown" | "keyup", name: string, target: EventTarget = window) => {
    const event = new KeyboardEvent(type, { key: name, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
  };
  const html = document.documentElement;

  function attach(overrides: Partial<BoxDragConfig<string>> = {}) {
    const config = {
      pick: vi.fn((): string | null => "src"),
      getCard: () => ({ id: "A1", text: "hello", count: "3 lines" }),
      getScrollers: () => [],
      onStart: vi.fn(),
      onMove: vi.fn((): DragHover => ({ state: "ok" })),
      onDrop: vi.fn(),
      onEnd: vi.fn(),
      ...overrides,
    };
    detach = attachBoxDrag(root, config);
    return config;
  }
  const card = () => document.querySelector<HTMLElement>('[data-testid="drag-card"]');

  beforeEach(() => {
    root = document.createElement("div");
    root.innerHTML = `<div data-drag-box data-testid="box"><p>text</p><button>b</button><span data-no-drag>n</span></div>`;
    document.body.append(root);
    box = root.querySelector("[data-drag-box]")!;
  });
  afterEach(() => {
    detach?.();
    detach = null;
    root.remove();
    document.querySelectorAll('[data-testid="drag-card"]').forEach((el) => el.remove());
    window.getSelection()?.removeAllRanges();
    html.removeAttribute("data-box-drag");
    html.removeAttribute("data-box-select");
  });

  it("a press released within 4px stays a click", () => {
    const config = attach();
    const clicks = vi.fn();
    document.body.addEventListener("click", clicks);
    const down = press(box);
    move(13, 10);
    release(13, 10);
    box.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    document.body.removeEventListener("click", clicks);
    expect(down.defaultPrevented).toBe(false);
    expect(config.onDrop).toHaveBeenCalledTimes(0);
    expect(isBoxDragActive()).toBe(false);
    expect(card()).toBeNull();
    expect(clicks).toHaveBeenCalledTimes(1);
  });

  it("starts at 4px: flag, card and cleared selection", () => {
    const config = attach({ getCard: () => ({ id: "A1", text: "<b>x</b>", count: "3 lines" }) });
    const range = document.createRange();
    range.selectNodeContents(box.querySelector("p")!);
    window.getSelection()!.addRange(range);
    press(box);
    move(14, 10);
    expect(html.hasAttribute("data-box-drag")).toBe(true);
    expect(card()!.textContent).toContain("A1");
    expect(card()!.textContent).toContain("<b>x</b>");
    expect(card()!.textContent).toContain("3 lines");
    expect(card()!.querySelector("b")).toBeNull();
    expect(window.getSelection()!.rangeCount).toBe(0);
    expect(config.onStart).toHaveBeenCalledTimes(1);
    release(14, 10);
  });

  it("blocks selectstart and dragstart only while a plain press is held", () => {
    attach();
    const fire = (type: string) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      box.dispatchEvent(event);
      return event.defaultPrevented;
    };
    press(box);
    expect([fire("selectstart"), fire("dragstart")]).toEqual([true, true]);
    release(10, 10);
    expect([fire("selectstart"), fire("dragstart")]).toEqual([false, false]);
  });

  it("an Alt press neither starts a drag nor blocks selectstart", () => {
    const config = attach();
    press(box, 10, 10, { altKey: true });
    move(40, 10);
    const event = new Event("selectstart", { bubbles: true, cancelable: true });
    box.dispatchEvent(event);
    expect(isBoxDragActive()).toBe(false);
    expect(config.pick).toHaveBeenCalledTimes(0);
    expect(event.defaultPrevented).toBe(false);
    release(40, 10);
  });

  it("does not start from a guarded child or inside [data-no-drag]", () => {
    const config = attach();
    for (const el of [box.querySelector("button")!, box.querySelector("span")!]) {
      press(el);
      move(30, 10);
      expect(isBoxDragActive()).toBe(false);
      release(30, 10);
    }
    expect(config.pick).toHaveBeenCalledTimes(0);
  });

  it("does not start when pick returns null", () => {
    attach({ pick: () => null });
    press(box);
    move(30, 10);
    expect(isBoxDragActive()).toBe(false);
    expect(card()).toBeNull();
    release(30, 10);
  });

  it("Escape cancels the drag and reaches no other listener", () => {
    const config = attach();
    const seen = vi.fn();
    box.addEventListener("keydown", seen);
    press(box);
    move(30, 10);
    key("keydown", "Escape", box);
    release(30, 10);
    expect(config.onDrop).toHaveBeenCalledTimes(0);
    expect(config.onEnd).toHaveBeenCalledWith("src", true);
    expect(isBoxDragActive()).toBe(false);
    expect(card()).toBeNull();
    expect(seen).toHaveBeenCalledTimes(0);
  });

  it("drops, then swallows exactly one click", async () => {
    const config = attach();
    const clicks = vi.fn();
    document.body.addEventListener("click", clicks);
    press(box);
    move(30, 10);
    release(31, 12);
    expect(config.onDrop).toHaveBeenCalledTimes(1);
    expect(config.onDrop).toHaveBeenCalledWith("src", { x: 31, y: 12 }, { x: 10, y: 10 });
    expect(config.onEnd).toHaveBeenCalledWith("src", false);
    box.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(clicks).toHaveBeenCalledTimes(0);
    await new Promise((resolve) => setTimeout(resolve, 0));
    box.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    document.body.removeEventListener("click", clicks);
    expect(clicks).toHaveBeenCalledTimes(1);
  });

  it("shows a refusal on the card and the target", () => {
    const target = document.createElement("div");
    document.body.append(target);
    const answers: DragHover[] = [{ state: "refused", note: "why", target }, { state: "ok", target }];
    attach({ onMove: () => answers.shift() ?? { state: "ok", target } });
    press(box);
    move(30, 10);
    expect(card()!.hasAttribute("data-refused")).toBe(true);
    expect(card()!.textContent).toContain("why");
    expect(target.dataset.drop).toBe("refused");
    move(31, 10);
    expect(target.dataset.drop).toBe("over");
    expect(card()!.hasAttribute("data-refused")).toBe(false);
    release(31, 10);
    expect(target.hasAttribute("data-drop")).toBe(false);
    target.remove();
  });

  it("blur mid-drag cancels it and swallows the following click", async () => {
    const config = attach();
    const clicks = vi.fn();
    document.body.addEventListener("click", clicks);
    press(box);
    move(30, 10);
    window.dispatchEvent(new Event("blur"));
    expect(config.onEnd).toHaveBeenCalledTimes(1);
    expect(config.onEnd).toHaveBeenCalledWith("src", true);
    expect(config.onDrop).toHaveBeenCalledTimes(0);
    expect(isBoxDragActive()).toBe(false);
    expect(card()).toBeNull();
    box.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    document.body.removeEventListener("click", clicks);
    expect(clicks).toHaveBeenCalledTimes(0);
    release(30, 10);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(config.onEnd).toHaveBeenCalledTimes(1);
  });

  it("the document turning hidden mid-drag cancels it", () => {
    const config = attach();
    press(box);
    move(30, 10);
    const hidden = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    hidden.mockRestore();
    expect(config.onEnd).toHaveBeenCalledWith("src", true);
    expect(isBoxDragActive()).toBe(false);
    expect(card()).toBeNull();
  });

  it("blur or hiding before the threshold just drops the press", () => {
    const config = attach();
    press(box);
    window.dispatchEvent(new Event("blur"));
    move(30, 10);
    expect(isBoxDragActive()).toBe(false);
    expect(config.onStart).toHaveBeenCalledTimes(0);
    expect(config.onEnd).toHaveBeenCalledTimes(0);
  });

  it("detach mid-drag cancels once and leaves no flag, card or listener", () => {
    const config = attach();
    press(box);
    move(30, 10);
    detach!();
    detach = null;
    expect(config.onEnd).toHaveBeenCalledTimes(1);
    expect(config.onEnd).toHaveBeenCalledWith("src", true);
    expect(isBoxDragActive()).toBe(false);
    expect(card()).toBeNull();
    move(50, 10);
    release(50, 10);
    expect(config.onDrop).toHaveBeenCalledTimes(0);
    expect(card()).toBeNull();
  });

  it("marks Alt select mode and keeps it while text is selected", () => {
    attach();
    key("keydown", "Alt");
    expect(html.hasAttribute("data-box-select")).toBe(true);
    key("keyup", "Alt");
    expect(html.hasAttribute("data-box-select")).toBe(false);
    key("keydown", "Alt");
    window.dispatchEvent(new Event("blur"));
    expect(html.hasAttribute("data-box-select")).toBe(false);

    const range = document.createRange();
    range.selectNodeContents(box.querySelector("p")!);
    window.getSelection()!.addRange(range);
    key("keydown", "Alt");
    key("keyup", "Alt");
    expect(html.hasAttribute("data-box-select")).toBe(true);
    window.getSelection()!.removeAllRanges();
    document.dispatchEvent(new Event("selectionchange"));
    expect(html.hasAttribute("data-box-select")).toBe(false);

    detach!();
    detach = null;
    key("keydown", "Alt");
    expect(html.hasAttribute("data-box-select")).toBe(false);
  });

  it("prevents the Alt keyup only after a press on a drag box", () => {
    attach();
    key("keydown", "Alt");
    press(box, 10, 10, { altKey: true });
    release(10, 10);
    expect(key("keyup", "Alt").defaultPrevented).toBe(true);
    key("keydown", "Alt");
    expect(key("keyup", "Alt").defaultPrevented).toBe(false);
  });
});
