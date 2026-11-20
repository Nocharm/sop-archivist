// 공통 끌기 엔진 시험 - 판단 함수(문턱·가장자리·시작 조건)와 DOM 동작(표·표시·상태 글·놓을 자리 선·클릭 삼키기·Esc·Alt 모드).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyCardDest,
  attachBoxDrag,
  buildCard,
  canStartDrag,
  getCardLeft,
  getEdgeScrollDir,
  hasPassedThreshold,
  isBoxDragActive,
  isPressForConfig,
  pickUnderPoint,
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
  it("getCardLeft: right of the pointer, flipped to its left when the card would leave the window, never past the left edge", () => {
    const left = (x: number, width: number) => getCardLeft(x, width, 1120);
    expect([left(500, 300), left(806, 300), left(807, 300), left(1100, 300), left(200, 1200)]).toEqual([514, 820, 493, 786, 0]);
  });
});

describe("buildCard", () => {
  it("builds one line - id, text, count, then a hidden destination slot - with text as text only", () => {
    const view = buildCard({ id: "A1", text: "<b>x</b>", count: "3 lines" });
    expect([...view.el.children].map((el) => el.className)).toEqual(["drag-card-id", "drag-card-text", "drag-card-count", "drag-card-dest"]);
    expect(view.el.querySelector("b")).toBeNull();
    expect(view.dest.hidden).toBe(true);
    expect([...buildCard({ id: "A1", text: "t", count: null }).el.children].map((el) => el.className)).toEqual(["drag-card-id", "drag-card-text", "drag-card-dest"]);
  });
  it("applyCardDest shows the short destination only where it can land; refusals and nowhere hide it", () => {
    const view = buildCard({ id: "A1", text: "t", count: null });
    applyCardDest(view, { state: "ok", note: "Parent SOP: SOP-PH", dest: "→ SOP-PH" });
    expect([view.dest.hidden, view.dest.textContent]).toEqual([false, "→ SOP-PH"]);
    applyCardDest(view, { state: "refused", note: "why", dest: "→ SOP-PH" });
    expect([view.dest.hidden, view.dest.textContent]).toEqual([true, ""]);
    applyCardDest(view, { state: "ok", dest: "→ 5.2 · indent" });
    expect(view.dest.textContent).toBe("→ 5.2 · indent");
    applyCardDest(view, { state: "ok", note: "go" });
    expect(view.dest.hidden).toBe(true);
    applyCardDest(view, { state: "none", dest: "→ x" });
    expect(view.dest.hidden).toBe(true);
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
  const status = () => document.querySelector<HTMLElement>('[data-testid="drag-status"]');

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

  it("a handle press goes only to the handle drag, a press elsewhere only to the whole-box drag", () => {
    expect([isPressForConfig(true, true), isPressForConfig(false, false), isPressForConfig(true, false), isPressForConfig(false, true)]).toEqual([true, true, false, false]);
    const handle = document.createElement("span");
    handle.dataset.dragHandle = "";
    box.append(handle);
    const wholePicks: EventTarget[] = [];
    const gripPicks: EventTarget[] = [];
    attach({ pick: (event) => (wholePicks.push(event.target!), null) });
    const detachGrip = attachBoxDrag(root, { handleOnly: true, pick: (event) => (gripPicks.push(event.target!), null), getCard: () => ({ id: "", text: "", count: null }), getScrollers: () => [], onMove: () => ({ state: "none" }), onDrop: () => {} });
    press(handle);
    press(box.querySelector("p")!);
    detachGrip();
    expect(wholePicks).toEqual([box.querySelector("p")]);
    expect(gripPicks).toEqual([handle]);
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

  it("a plain press clears an existing text selection (the browser would, but selectstart is blocked); Alt and unpicked presses keep it", () => {
    const select = () => {
      const range = document.createRange();
      range.selectNodeContents(box.querySelector("p")!);
      window.getSelection()!.removeAllRanges();
      window.getSelection()!.addRange(range);
    };
    attach({ pick: vi.fn((event: PointerEvent): string | null => (event.target instanceof Element && event.target.closest("p") ? "src" : null)) });
    select();
    press(box, 10, 10, { altKey: true });
    release(10, 10);
    expect(window.getSelection()!.isCollapsed).toBe(false);
    press(box.querySelector("button")!);
    release(10, 10);
    expect(window.getSelection()!.isCollapsed).toBe(false);
    press(box);
    release(10, 10);
    expect(window.getSelection()!.isCollapsed).toBe(false);
    press(box.querySelector("p")!);
    expect(window.getSelection()!.rangeCount).toBe(0);
    release(10, 10);
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

  it("a wide table drags from its cells but not from its horizontal scrollbar strip", () => {
    // 넓은 표 상자: 글 상자 높이 80px(위 0), 그 아래 막대. jsdom은 배치를 하지 않아 크기를 넣어 준다
    const scroller = document.createElement("div");
    scroller.innerHTML = "<table><tbody><tr><td>cell</td></tr></tbody></table>";
    box.append(scroller);
    Object.defineProperties(scroller, { scrollWidth: { value: 900 }, clientWidth: { value: 300 }, clientHeight: { value: 80 }, clientTop: { value: 0 } });
    scroller.getBoundingClientRect = () => DOMRect.fromRect({ x: 0, y: 0, width: 300, height: 92 });
    const config = attach();
    press(scroller, 10, 86);
    move(30, 86);
    expect(isBoxDragActive()).toBe(false);
    release(30, 86);
    expect(config.pick).toHaveBeenCalledTimes(0);
    press(scroller.querySelector("td")!, 10, 40);
    move(30, 40);
    expect(isBoxDragActive()).toBe(true);
    release(30, 40);
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

  it("Escape during a press that is not yet a drag is left alone, and the press can still become a drag", () => {
    const config = attach();
    const seen = vi.fn();
    box.addEventListener("keydown", seen);
    press(box);
    move(12, 10);
    const escape = key("keydown", "Escape", box);
    expect(escape.defaultPrevented).toBe(false);
    expect(seen).toHaveBeenCalledTimes(1);
    move(30, 10);
    expect(isBoxDragActive()).toBe(true);
    release(30, 10);
    expect(config.onDrop).toHaveBeenCalledTimes(1);
  });

  it("Escape during a press that is not yet a drag leaves the press a click", async () => {
    // 앞 시험의 끌기가 남긴 click 삼키기는 타이머로 거두어진다 - 그 뒤에 누른다
    await new Promise((resolve) => setTimeout(resolve, 0));
    const config = attach();
    const clicks = vi.fn();
    document.body.addEventListener("click", clicks);
    press(box);
    key("keydown", "Escape", box);
    release(11, 10);
    box.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    document.body.removeEventListener("click", clicks);
    expect(clicks).toHaveBeenCalledTimes(1);
    expect(config.onEnd).toHaveBeenCalledTimes(0);
  });

  it("still ends the drag when onDrop throws, and the error surfaces", () => {
    const failure = new Error("drop failed");
    const config = attach({
      onDrop: vi.fn(() => {
        throw failure;
      }),
    });
    const errors: unknown[] = [];
    // 이벤트 리스너의 예외는 window error로 보고된다 - 시험 출력에 찍히지 않게 여기서 받는다
    const onError = (event: ErrorEvent) => {
      errors.push(event.error);
      event.preventDefault();
    };
    window.addEventListener("error", onError);
    press(box);
    move(30, 10);
    release(30, 10);
    window.removeEventListener("error", onError);
    expect(errors).toEqual([failure]);
    expect(config.onEnd).toHaveBeenCalledWith("src", false);
    expect(isBoxDragActive()).toBe(false);
    expect(card()).toBeNull();
    // 다음 끌기가 시작된다(엔진이 끝까지 치웠다)
    press(box);
    move(30, 10);
    expect(isBoxDragActive()).toBe(true);
    key("keydown", "Escape");
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

  it("shows a refusal on the card, the cursor flag and the target; the reason goes to the status text, not the card", () => {
    const target = document.createElement("div");
    document.body.append(target);
    const answers: DragHover[] = [{ state: "refused", note: "why", target }, { state: "ok", note: "go", dest: "→ go", target }];
    attach({ onMove: () => answers.shift() ?? { state: "ok", target } });
    press(box);
    move(30, 10);
    expect(card()!.hasAttribute("data-refused")).toBe(true);
    expect(html.getAttribute("data-box-drag")).toBe("refused");
    expect(card()!.textContent).not.toContain("why");
    expect(status()!.textContent).toBe("why");
    expect(status()!.getAttribute("role")).toBe("status");
    expect(target.dataset.drop).toBe("refused");
    expect(card()!.querySelector<HTMLElement>(".drag-card-dest")!.hidden).toBe(true);
    move(31, 10);
    expect(target.dataset.drop).toBe("over");
    expect(card()!.hasAttribute("data-refused")).toBe(false);
    expect(html.getAttribute("data-box-drag")).toBe("");
    expect(status()!.textContent).toBe("go");
    expect(card()!.querySelector(".drag-card-dest")!.textContent).toBe("→ go");
    move(32, 10);
    expect(status()!.textContent).toBe("");
    release(32, 10);
    expect(target.hasAttribute("data-drop")).toBe(false);
    expect(status()!.textContent).toBe("");
    target.remove();
  });

  it("keeps one status text while attached and removes it with the last detach", () => {
    attach();
    const second = attachBoxDrag(document.createElement("div"), { pick: () => null, getCard: () => ({ id: "", text: "", count: null }), getScrollers: () => [], onMove: () => ({ state: "none" }), onDrop: () => {} });
    expect(document.querySelectorAll('[data-testid="drag-status"]').length).toBe(1);
    second();
    expect(status()).not.toBeNull();
    detach!();
    detach = null;
    expect(status()).toBeNull();
  });

  it("dropping on a refused place reports the reason once; an ok place, a silent refusal or Esc do not", () => {
    const onRefusedDrop = vi.fn();
    let hover: DragHover = { state: "refused", note: "why" };
    const config = attach({ onMove: () => hover, onRefusedDrop });
    press(box);
    move(30, 10);
    move(31, 10);
    release(31, 10);
    expect(config.onDrop).toHaveBeenCalledTimes(1);
    expect(onRefusedDrop).toHaveBeenCalledTimes(1);
    expect(onRefusedDrop).toHaveBeenCalledWith("why");
    for (const next of [{ state: "ok", note: "go" }, { state: "refused" }] as DragHover[]) {
      hover = next;
      press(box);
      move(30, 10);
      release(30, 10);
    }
    hover = { state: "refused", note: "why" };
    press(box);
    move(30, 10);
    key("keydown", "Escape");
    expect(onRefusedDrop).toHaveBeenCalledTimes(1);
  });

  it("draws one drop line in the root from the hover, hides it without one and removes it at the end", () => {
    root.getBoundingClientRect = () => ({ left: 100, top: 50, right: 900, bottom: 650, width: 800, height: 600, x: 100, y: 50, toJSON: () => ({}) });
    const answers: DragHover[] = [{ state: "none" }, { state: "ok", line: { left: 120, top: 80, width: 300 } }, { state: "ok", line: { left: 130, top: 90, width: 200 } }, { state: "none" }];
    attach({ onMove: () => answers.shift() ?? { state: "none" } });
    const line = () => root.querySelector<HTMLElement>('[data-testid="drop-line"]');
    press(box);
    move(30, 10);
    expect(line()).toBeNull();
    move(31, 10);
    expect(line()!.hidden).toBe(false);
    expect([line()!.style.left, line()!.style.top, line()!.style.width]).toEqual(["20px", "30px", "300px"]);
    move(32, 10);
    expect(root.querySelectorAll('[data-testid="drop-line"]').length).toBe(1);
    expect([line()!.style.left, line()!.style.top, line()!.style.width]).toEqual(["30px", "40px", "200px"]);
    move(33, 10);
    expect(line()!.hidden).toBe(true);
    release(33, 10);
    expect(line()).toBeNull();
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

describe("pickUnderPoint", () => {
  it("passes over data-drag-pass elements (the click-place gap strip) to the line under them", () => {
    document.body.innerHTML = '<div class="new-item" data-row="t:1"><p id="line">A</p></div><button id="gap" class="place-gap" data-drag-pass=""></button>';
    const gap = document.getElementById("gap") as HTMLElement;
    const line = document.getElementById("line") as HTMLElement;
    // 틈 띠가 줄 끝을 덮어 맨 위에 있어도 그 밑의 줄 상자를 읽는다(놓을 때는 data-box-drag가 걷혀 CSS로 비킬 수 없다)
    expect(pickUnderPoint([gap, line, document.body], ".new-item[data-row]")?.dataset.row).toBe("t:1");
    expect(pickUnderPoint([line], ".new-item[data-row]")?.dataset.row).toBe("t:1");
    expect(pickUnderPoint([gap, document.body], ".new-item[data-row]")).toBeNull();
    expect(pickUnderPoint([], ".new-item[data-row]")).toBeNull();
  });
});
