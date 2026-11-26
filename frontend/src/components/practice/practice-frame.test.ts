// 연습 틀 - 띠의 진행 점 열둘 · 말풍선(설계 §3 · D9 · D10, 말풍선 2026-11-27 시안 A): 자동 체크 · 이루면 뒤집혀 체크 · 애니메이션이 끝나면 다음 · 순서 자유 · 건너뛰기 · 마치는 카드.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LangProvider } from "@/lib/i18n";
import { notePracticeAct, resetPracticeServer } from "@/lib/practice/practice-server";
import { buildPracticeTestFixture } from "@/lib/practice/practice-test-fixture";

import { PracticeCoach } from "./practice-coach";
import { PracticeFrame } from "./practice-frame";

let root: Root | null = null;

async function renderFrame() {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // Assign 대신 손짓을 받을 자리 둘 - 용지 한 줄과 도움말의 키보드 그림 단추
  const children = createElement(
    "div",
    null,
    createElement("div", { "data-testid": "paper-line", tabIndex: -1 }),
    createElement("button", { type: "button", "data-testid": "assign-help-keyboard-map" }),
  );
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => root?.render(createElement(LangProvider, null, createElement(PracticeFrame, null, children))));
}

const find = (testId: string) => document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
const readCoach = () => find("practice-coach")?.dataset.task ?? null;
const readFlip = () => find("practice-coach-flip")?.dataset.done ?? null;
const readNowDots = () => [...document.querySelectorAll<HTMLElement>('[data-testid^="practice-dot-"][data-now="true"]')].map((el) => el.dataset.testid);
const press = (el: Element, init: KeyboardEventInit) => act(async () => void el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init })));
const click = (el: Element) => act(async () => void (el as HTMLElement).click());
/**
 * 애니메이션의 끝 소식 - jsdom은 CSS 애니메이션을 돌리지 않아 손으로 보낸다. jsdom에는 AnimationEvent가 없어 React가 onAnimationEnd를
 * webkitAnimationEnd로 듣는다(브라우저에서는 animationend).
 */
const sendAnimationEnd = (el: Element) => act(async () => void el.dispatchEvent(Object.assign(new Event("webkitAnimationEnd", { bubbles: true }), { animationName: "practice-coach-flip" })));
const endFlip = () => sendAnimationEnd(find("practice-coach-flip")!);

beforeEach(() => {
  resetPracticeServer(buildPracticeTestFixture());
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("the progress dots on the band", () => {
  it("draws twelve dots, none done, the first one now, and 0/12", async () => {
    await renderFrame();
    expect(document.querySelectorAll('[data-testid^="practice-dot-"]')).toHaveLength(12);
    expect(document.querySelectorAll('[data-testid^="practice-dot-"][data-done="true"]')).toHaveLength(0);
    expect(readNowDots()).toEqual(["practice-dot-pick"]);
    expect(find("practice-progress")?.textContent).toBe("0/12");
    expect(find("practice-dot-hold")?.getAttribute("aria-label")).toBe("Task 4 · Put on hold");
  });

  it("goes to any task when its dot is pressed", async () => {
    await renderFrame();
    await click(find("practice-dot-hold")!);
    expect(readCoach()).toBe("hold");
    expect(readNowDots()).toEqual(["practice-dot-hold"]);
  });
});

describe("the coach card", () => {
  it("shows the first task with its chapter, keys and manual link", async () => {
    await renderFrame();
    expect(readCoach()).toBe("pick");
    expect(readFlip()).toBe("false");
    expect(find("practice-coach")?.textContent).toContain("Task 1 / 12 · Basics");
    expect(find("practice-coach")?.querySelector("kbd")?.textContent).toBe("J · ↓ · Tab");
    expect(find("practice-coach-manual")?.getAttribute("href")).toBe("/manual#assign");
    expect(find("practice-coach-manual")?.getAttribute("target")).toBe("_blank");
    expect(find("practice-finish")).toBeNull();
  });

  it("flips to the check when the task is done, then moves to the next open task when the flip ends", async () => {
    await renderFrame();
    await press(find("paper-line")!, { key: "j" });
    expect(find("practice-dot-pick")?.dataset.done).toBe("true");
    expect(find("practice-progress")?.textContent).toBe("1/12");
    expect([readCoach(), readFlip()]).toEqual(["pick", "true"]);
    expect(find("practice-coach-flip")?.textContent).toContain("Done!");
    await endFlip();
    expect([readCoach(), readFlip()]).toEqual(["link", "false"]);
    expect(readNowDots()).toEqual(["practice-dot-link"]);
  });

  it("does not take J pressed on the coach card or in a text box as moving a line", async () => {
    await renderFrame();
    await press(find("practice-coach-skip")!, { key: "j" });
    const input = find("paper-line")!.appendChild(document.createElement("input"));
    await press(input, { key: "j" });
    expect(find("practice-dot-pick")?.dataset.done).toBe("false");
  });

  it("stays on the task pressed while another task gets done, and flips once the pressed one is done", async () => {
    await renderFrame();
    await click(find("practice-dot-hold")!);
    await click(find("assign-help-keyboard-map")!);
    expect(find("practice-dot-keyboard")?.dataset.done).toBe("true");
    expect([readCoach(), readFlip()]).toEqual(["hold", "false"]);
    await act(async () => notePracticeAct({ key: "move_prev" }));
    await click(find("practice-dot-pick")!);
    expect([readCoach(), readFlip()]).toEqual(["pick", "false"]);
    await press(find("paper-line")!, { key: "k" });
    expect([readCoach(), readFlip()]).toEqual(["pick", "true"]);
    await endFlip();
    expect(readCoach()).toBe("link");
  });

  it("skips to the next task not done yet", async () => {
    await renderFrame();
    await click(find("practice-coach-skip")!);
    expect(readCoach()).toBe("link");
    expect(find("practice-dot-pick")?.dataset.done).toBe("false");
  });

  it("ignores the end of an animation inside the card", async () => {
    await renderFrame();
    await press(find("paper-line")!, { key: "j" });
    await sendAnimationEnd(find("practice-coach-manual")!);
    expect([readCoach(), readFlip()]).toEqual(["pick", "true"]);
  });

  it("shows the finish card with the way home and start over once all twelve are done", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const stageRef = { current: document.body };
    root = createRoot(document.body.appendChild(document.createElement("div")));
    const coach = createElement(PracticeCoach, { stageRef, log: [], view: { id: null, isDone: false }, onSkip: () => {}, onAdvance: () => {} });
    await act(async () => root?.render(createElement(LangProvider, null, coach)));
    expect(find("practice-coach")).toBeNull();
    expect(find("practice-finish")?.textContent).toContain("12 / 12 — Assign basics done");
    expect(find("practice-finish-home")?.textContent).toBe("Go to my Bundles");
    expect(find("practice-finish-again")?.textContent).toBe("Start over again");
    expect(find("practice-coach-hole")).toBeNull();
  });
});
