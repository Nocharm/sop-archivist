// useTargetRect - 대상 상자를 무대 좌표로, 스크롤 칸에 가린 부분은 잘라 내고, 가려 있으면 처음 한 번만 그리로 스크롤, 나중에 생긴 상자도 따라간다.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useTargetRect, type TargetRects } from "@/lib/use-target-rect";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let frames: FrameRequestCallback[] = [];

function stubRect(el: Element, left: number, top: number, width: number, height: number) {
  el.getBoundingClientRect = () => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) });
}

// 시험 파일은 .ts만 모이므로 JSX 대신 createElement, 콜백 ref로 요소를 잡는다(use-box-drag.test.ts와 같은 꼴)
const stageRef: { current: HTMLElement | null } = { current: null };
const cardRef: { current: HTMLElement | null } = { current: null };
const layerRef: { current: HTMLElement | null } = { current: null };
const captureStage = (el: HTMLElement | null) => void (stageRef.current = el);
const captureCard = (el: HTMLElement | null) => void (cardRef.current = el);
const captureLayer = (el: HTMLElement | null) => void (layerRef.current = el);

/** 잰 값은 화면에 글로 그려 시험이 읽는다 */
function Probe({ selectors }: { selectors: string[] }) {
  const rects = useTargetRect({ stageRef, cardRef, ignoreRef: layerRef, selectors });
  return createElement(
    "div",
    { ref: captureStage, "data-testid": "stage" },
    createElement("div", { ref: captureLayer }, createElement("section", { ref: captureCard, "data-testid": "card" })),
    createElement("output", { "data-testid": "rects" }, JSON.stringify(rects)),
  );
}

const readSeen = (): TargetRects | null => JSON.parse(document.querySelector('[data-testid="rects"]')?.textContent ?? "null");

async function render(selectors: string[]) {
  await act(async () => root?.render(createElement(Probe, { selectors })));
}

/** 줄 선 프레임을 다 돌린다 - 재기는 한 프레임에 한 번으로 묶여 있다 */
async function flushFrames() {
  await act(async () => {
    const run = frames;
    frames = [];
    for (const frame of run) frame(0);
  });
}

function addTarget(testId: string, parent: Element = document.body) {
  const el = parent.appendChild(document.createElement("div"));
  el.dataset.testid = testId;
  el.scrollIntoView = vi.fn();
  return el;
}

beforeEach(async () => {
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (run: FrameRequestCallback) => frames.push(run));
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await render([]);
  stubRect(document.querySelector('[data-testid="stage"]')!, 100, 50, 1000, 700);
  Object.defineProperty(document.querySelector('[data-testid="card"]')!, "offsetWidth", { value: 300 });
  Object.defineProperty(document.querySelector('[data-testid="card"]')!, "offsetHeight", { value: 140 });
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("measuring the box a coach card points at", () => {
  it("gives the target in stage coordinates with the stage and card sizes, keyed by the selectors", async () => {
    stubRect(addTarget("box"), 300, 250, 400, 40);
    await render(['[data-testid="missing"]', '[data-testid="box"]']);
    await flushFrames();
    expect(readSeen()).toEqual({ key: '[data-testid="missing"]\n[data-testid="box"]', stage: { width: 1000, height: 700 }, target: { left: 200, top: 200, width: 400, height: 40 }, card: { width: 300, height: 140 } });
  });

  it("cuts off the part a scrolling pane hides, and has no target when the pane hides all of it", async () => {
    const pane = document.body.appendChild(document.createElement("div"));
    pane.style.overflowY = "auto";
    stubRect(pane, 100, 100, 600, 300);
    const box = addTarget("box", pane);
    stubRect(box, 120, 380, 400, 40);
    await render(['[data-testid="box"]']);
    await flushFrames();
    expect(readSeen()?.target).toEqual({ left: 20, top: 330, width: 400, height: 20 });
    stubRect(box, 120, 500, 400, 40);
    window.dispatchEvent(new Event("resize"));
    await flushFrames();
    expect(readSeen()?.target).toBeNull();
  });

  it("scrolls to a hidden target once when it is first found, not again after the person scrolls away", async () => {
    const pane = document.body.appendChild(document.createElement("div"));
    pane.style.overflowY = "auto";
    stubRect(pane, 100, 100, 600, 300);
    const box = addTarget("box", pane);
    stubRect(box, 120, 900, 400, 40);
    await render(['[data-testid="box"]']);
    await flushFrames();
    expect(box.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(box.scrollIntoView).toHaveBeenCalledWith({ block: "center", inline: "nearest" });
    pane.dispatchEvent(new Event("scroll"));
    await flushFrames();
    expect(box.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("leaves the scroll alone when the target is already in view", async () => {
    const box = addTarget("box");
    stubRect(box, 300, 250, 400, 40);
    await render(['[data-testid="box"]']);
    await flushFrames();
    expect(box.scrollIntoView).not.toHaveBeenCalled();
  });

  it("follows a target that shows up later in the page", async () => {
    await render(['[data-testid="late"]']);
    await flushFrames();
    expect(readSeen()?.target).toBeNull();
    stubRect(addTarget("late"), 200, 150, 100, 30);
    // MutationObserver는 마이크로태스크에 알린다
    await act(async () => await Promise.resolve());
    await flushFrames();
    expect(readSeen()?.target).toEqual({ left: 100, top: 100, width: 100, height: 30 });
  });
});
