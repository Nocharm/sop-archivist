// 시트 보기의 옮기기 - 끌기 · 휠 · 글쇠가 본문 transform과 위치 막대를 바꾸는지, 끌기 뒤 click을 삼키는지, Alt 누르기는 글자 고르기로 남기는지.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { attachSheetPan, type SheetPan } from "./sheet-pan";

// jsdom에는 ResizeObserver가 없다 - 크기 변화 대신 refresh를 직접 부른다
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

// jsdom은 배치를 하지 않는다 - 보이는 틀 1000×400, 본문 1180×2000으로 잰 값처럼 둔다
function setSize(el: HTMLElement, sizes: Record<string, number>): void {
  for (const [name, value] of Object.entries(sizes)) Object.defineProperty(el, name, { configurable: true, value });
}

function firePointer(target: HTMLElement, type: string, init: MouseEventInit & { pointerId?: number }): MouseEvent {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
  Object.defineProperty(event, "pointerId", { value: init.pointerId ?? 1 });
  target.dispatchEvent(event);
  return event;
}

let frame: HTMLDivElement;
let head: HTMLTableElement;
let clip: HTMLDivElement;
let body: HTMLTableElement;
let rail: HTMLDivElement;
let thumb: HTMLSpanElement;
let mark: HTMLSpanElement;
let cell: HTMLTableCellElement;
let pan: SheetPan;

beforeEach(() => {
  frame = document.createElement("div");
  head = document.createElement("table");
  clip = document.createElement("div");
  body = document.createElement("table");
  rail = document.createElement("div");
  thumb = document.createElement("span");
  mark = document.createElement("span");
  const tbody = body.createTBody();
  const tr = tbody.insertRow();
  cell = tr.insertCell();
  rail.append(thumb, mark);
  clip.append(body, rail);
  frame.append(head, clip);
  document.body.appendChild(frame);
  setSize(clip, { clientWidth: 1000, clientHeight: 400 });
  setSize(body, { offsetWidth: 1180, offsetHeight: 2000 });
  frame.setPointerCapture = vi.fn();
  frame.releasePointerCapture = vi.fn();
  frame.hasPointerCapture = () => true;
  pan = attachSheetPan({ frame, head, clip, body, rail, thumb, mark });
});

afterEach(() => {
  pan.detach();
  frame.remove();
});

describe("attachSheetPan", () => {
  it("shows the rail and marks the frame movable only when there is somewhere to move", () => {
    expect(rail.hidden).toBe(false);
    expect(frame.hasAttribute("data-movable")).toBe(true);
    expect(thumb.style.height).toBe("20%");

    setSize(body, { offsetWidth: 900, offsetHeight: 300 });
    pan.refresh();
    expect(rail.hidden).toBe(true);
    expect(frame.hasAttribute("data-movable")).toBe(false);
  });

  it("moves the body with the wheel, the head only sideways, and keeps the page from scrolling", () => {
    const event = new WheelEvent("wheel", { deltaX: 40, deltaY: 120, cancelable: true, bubbles: true });
    frame.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(body.style.transform).toBe("translate(-40px, -120px)");
    expect(head.style.transform).toBe("translateX(-40px)");
    expect(thumb.style.top).toBe("6%");
  });

  it("drags past the 3px threshold and swallows the click that ends the drag", () => {
    const onClick = vi.fn();
    cell.addEventListener("click", onClick);
    firePointer(cell, "pointerdown", { button: 0, buttons: 1, clientX: 500, clientY: 300 });
    firePointer(cell, "pointermove", { buttons: 1, clientX: 400, clientY: 200 });
    expect(frame.hasAttribute("data-grabbing")).toBe(true);
    expect(body.style.transform).toBe("translate(-100px, -100px)");
    firePointer(cell, "pointerup", { button: 0, clientX: 400, clientY: 200 });
    cell.click();
    expect(onClick).not.toHaveBeenCalled();
    expect(frame.hasAttribute("data-grabbing")).toBe(false);
  });

  it("keeps a press that moved less than 3px as a click", () => {
    const onClick = vi.fn();
    cell.addEventListener("click", onClick);
    firePointer(cell, "pointerdown", { button: 0, buttons: 1, clientX: 500, clientY: 300 });
    firePointer(cell, "pointermove", { buttons: 1, clientX: 501, clientY: 301 });
    firePointer(cell, "pointerup", { button: 0, clientX: 501, clientY: 301 });
    cell.click();
    expect(onClick).toHaveBeenCalledOnce();
    expect(body.style.transform).toBe("translate(0px, 0px)");
  });

  it("leaves an Alt press to text selection and does not move", () => {
    firePointer(cell, "pointerdown", { button: 0, buttons: 1, altKey: true, clientX: 500, clientY: 300 });
    firePointer(cell, "pointermove", { buttons: 1, altKey: true, clientX: 300, clientY: 100 });
    expect(frame.hasAttribute("data-select")).toBe(true);
    expect(body.style.transform).toBe("translate(0px, 0px)");

    firePointer(cell, "pointerdown", { button: 0, buttons: 1, clientX: 500, clientY: 300 });
    expect(frame.hasAttribute("data-select")).toBe(false);
  });

  it("moves with the keys", () => {
    frame.dispatchEvent(new KeyboardEvent("keydown", { key: "End", cancelable: true }));
    expect(body.style.transform).toBe("translate(0px, -1600px)");
    frame.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", cancelable: true }));
    expect(body.style.transform).toBe("translate(0px, 0px)");
  });

  it("centres the picked row and marks it on the rail", () => {
    const picked = body.tBodies[0].insertRow();
    picked.setAttribute("data-mark", "picked");
    setSize(picked, { offsetTop: 1000, offsetHeight: 20 });
    pan.centrePicked();
    expect(body.style.transform).toBe("translate(0px, -810px)");
    expect(mark.hidden).toBe(false);
    expect(mark.style.top).toBe("50.5%");
  });
});
