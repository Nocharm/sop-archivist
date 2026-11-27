// 연습 틀 - 띠의 진행 점 열넷 · 말풍선(설계 §3 · D9 · D10, 말풍선 2026-11-27 시안 A): 자동 체크 · 이루면 뒤집혀 체크 · 애니메이션이 끝나면 다음 · 순서 자유 · 건너뛰기 · 마치는 카드.
// 안내형(2026-11-27): 과제에 없는 Assign 글쇠는 막고 말풍선이 알린다 · 누른 뒤 포커스는 용지로 · 보기(한 단 · 양 단)를 읽어 V를 안내하고 바꾼 보기를 적는다.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LangProvider } from "@/lib/i18n";
import { notePracticeAct, readPracticeSnapshot, resetPracticeServer } from "@/lib/practice/practice-server";
import { buildPracticeTestFixture } from "@/lib/practice/practice-test-fixture";

import { PracticeCoach } from "./practice-coach";
import { PracticeFrame } from "./practice-frame";

let root: Root | null = null;

async function renderFrame() {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // Assign 대신 손짓을 받을 자리 - 용지 칸(양 단, Old 용지의 한 줄)과 도움말의 키보드 그림 단추 · 위쪽 줄의 보기 단추
  const children = createElement(
    "div",
    { className: "assign-panes", "data-testid": "panes" },
    createElement("div", { "data-pane": "old" }, createElement("div", { className: "pane-body", tabIndex: -1, "data-testid": "paper" }, createElement("div", { "data-testid": "paper-line", tabIndex: -1 }))),
    createElement("button", { type: "button", "data-testid": "assign-help-keyboard-map" }),
    createElement("button", { type: "button", "data-testid": "assign-view-one" }),
    createElement("button", { type: "button", "data-testid": "assign-view-two" }),
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
/** Assign이 보기를 바꾼 것처럼 용지 칸의 표시를 바꾼다(MutationObserver가 읽는다) */
const setPane = (pane: "one" | "two") => act(async () => void find("panes")!.toggleAttribute("data-single", pane === "one"));
const listActs = () => readPracticeSnapshot().log.flatMap((entry) => ("act" in entry ? [entry.act] : []));

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
  it("draws fourteen dots, none done, the first one now, and 0/14", async () => {
    await renderFrame();
    expect(document.querySelectorAll('[data-testid^="practice-dot-"]')).toHaveLength(14);
    expect(document.querySelectorAll('[data-testid^="practice-dot-"][data-done="true"]')).toHaveLength(0);
    expect(readNowDots()).toEqual(["practice-dot-pick"]);
    expect(find("practice-progress")?.textContent).toBe("0/14");
    expect(find("practice-dot-hold")?.getAttribute("aria-label")).toBe("Task 6 · Put on hold");
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
    expect(find("practice-coach")?.textContent).toContain("Task 1 / 14 · Two documents");
    expect(find("practice-coach")?.querySelector("kbd")?.textContent).toBe("J · ↓ · Tab");
    expect(find("practice-coach-manual")?.getAttribute("href")).toBe("/manual#assign");
    expect(find("practice-coach-manual")?.getAttribute("target")).toBe("_blank");
    expect(find("practice-finish")).toBeNull();
  });

  it("flips to the check when the task is done, then moves to the next open task when the flip ends", async () => {
    await renderFrame();
    await press(find("paper-line")!, { key: "j" });
    expect(find("practice-dot-pick")?.dataset.done).toBe("true");
    expect(find("practice-progress")?.textContent).toBe("1/14");
    expect([readCoach(), readFlip()]).toEqual(["pick", "true"]);
    expect(find("practice-coach-flip")?.textContent).toContain("Done!");
    await endFlip();
    expect([readCoach(), readFlip()]).toEqual(["link", "false"]);
    expect(readNowDots()).toEqual(["practice-dot-link"]);
  });

  it("does not take J typed in a text box as moving a line, nor Tab outside the paper", async () => {
    await renderFrame();
    const input = find("paper-line")!.appendChild(document.createElement("input"));
    await press(input, { key: "j" });
    await press(find("practice-coach-skip")!, { key: "Tab" });
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
    const coach = createElement(PracticeCoach, { stageRef, log: [], view: { id: null, isDone: false }, pane: "two", nudge: null, onNudgeEnd: () => {}, onSkip: () => {}, onAdvance: () => {} });
    await act(async () => root?.render(createElement(LangProvider, null, coach)));
    expect(find("practice-coach")).toBeNull();
    expect(find("practice-finish")?.textContent).toContain("14 / 14 — Assign basics done");
    expect(find("practice-finish-home")?.textContent).toBe("Go to my Bundles");
    expect(find("practice-finish-again")?.textContent).toBe("Start over again");
    expect(find("practice-coach-hole")).toBeNull();
  });
});

describe("only the task's keys get through", () => {
  /** Assign 대신 window 버블에서 듣는다 - 틀이 막으면 여기까지 오지 않는다 */
  function listenLikeAssign() {
    const heard: string[] = [];
    const listen = (event: KeyboardEvent) => heard.push(event.key);
    window.addEventListener("keydown", listen);
    return { heard, stop: () => window.removeEventListener("keydown", listen) };
  }

  it("stops an Assign key the task does not use before Assign hears it, and says so on the card", async () => {
    await renderFrame();
    const assign = listenLikeAssign();
    await press(find("paper-line")!, { key: "Delete" });
    await press(find("paper-line")!, { key: "j" });
    assign.stop();
    expect(assign.heard).toEqual(["j"]);
    expect(find("practice-coach-nudge")?.textContent).toBe("Del is not used in this task — follow the card");
  });

  it("clears the notice when its animation ends, and draws it afresh on the next blocked key", async () => {
    await renderFrame();
    await press(find("paper-line")!, { key: "u" });
    const first = find("practice-coach-nudge")!;
    await press(find("paper-line")!, { key: "H", shiftKey: true });
    expect(find("practice-coach-nudge")).not.toBe(first);
    expect(find("practice-coach-nudge")?.textContent).toContain("⇧H");
    await sendAnimationEnd(find("practice-coach-nudge")!);
    expect(find("practice-coach-nudge")).toBeNull();
  });

  it("lets keys typed in a text box, keys that are no Assign key and a button's own Space through", async () => {
    await renderFrame();
    const assign = listenLikeAssign();
    const input = find("paper-line")!.appendChild(document.createElement("input"));
    await press(input, { key: "u" });
    await press(find("paper-line")!, { key: "c", ctrlKey: true });
    await press(find("practice-coach-skip")!, { key: " " });
    assign.stop();
    expect(assign.heard).toEqual(["u", "c", " "]);
    expect(find("practice-coach-nudge")).toBeNull();
  });

  it("switches the keys let through with the task picked on the band", async () => {
    await renderFrame();
    await click(find("practice-dot-hold")!);
    const assign = listenLikeAssign();
    await press(find("paper-line")!, { key: "H", shiftKey: true });
    await press(find("paper-line")!, { key: "u" });
    assign.stop();
    expect(assign.heard).toEqual(["H"]);
  });
});

describe("focus stays where the keys work", () => {
  it("takes the focus on the frame at first, and moves it to the paper on the first key there", async () => {
    await renderFrame();
    const frame = document.querySelector<HTMLElement>(".practice")!;
    expect(document.activeElement).toBe(frame);
    await press(frame, { key: "j" });
    expect(document.activeElement).toBe(find("paper"));
    expect(find("practice-dot-pick")?.dataset.done).toBe("true");
  });

  it("returns the focus to the paper after a dot or Skip is pressed", async () => {
    await renderFrame();
    find("practice-dot-hold")!.focus();
    await click(find("practice-dot-hold")!);
    expect(document.activeElement).toBe(find("paper"));
    find("practice-coach-skip")!.focus();
    await click(find("practice-coach-skip")!);
    expect(document.activeElement).toBe(find("paper"));
  });
});

describe("the view the task is shown in", () => {
  it("points a one-document task at V while Assign shows two documents, and lets V through", async () => {
    await renderFrame();
    await click(find("practice-dot-hold")!);
    expect(find("practice-coach-pane")?.textContent).toContain("V");
    const assign = { heard: 0 };
    const listen = () => void (assign.heard += 1);
    window.addEventListener("keydown", listen);
    await press(find("paper-line")!, { key: "v" });
    window.removeEventListener("keydown", listen);
    expect(assign.heard).toBe(1);
    await setPane("one");
    expect(find("practice-coach-pane")).toBeNull();
  });

  it("does not let V through for a task already in its view", async () => {
    await renderFrame();
    await press(find("paper-line")!, { key: "v" });
    expect(find("practice-coach-nudge")?.textContent).toContain("V");
    expect(listActs()).toEqual([]);
  });

  it("writes the view V lands on, and ticks the view task", async () => {
    await renderFrame();
    await click(find("practice-dot-view_one")!);
    await press(find("paper-line")!, { key: "v" });
    expect(listActs()).toEqual([{ view: "one" }]);
    expect(find("practice-dot-view_one")?.dataset.done).toBe("true");
  });

  it("writes the view a view button switches to, and nothing for the view already shown", async () => {
    await renderFrame();
    await click(find("assign-view-two")!);
    expect(listActs()).toEqual([]);
    await click(find("assign-view-one")!);
    await setPane("one");
    await click(find("assign-view-two")!);
    expect(listActs()).toEqual([{ view: "one" }, { view: "two" }]);
  });

  it("tells a view task it is already there", async () => {
    await renderFrame();
    await setPane("one");
    await click(find("practice-dot-view_one")!);
    expect(find("practice-coach-already")?.textContent).toContain("already in One document view");
  });
});
