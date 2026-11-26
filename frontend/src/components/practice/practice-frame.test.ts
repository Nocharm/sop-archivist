// 연습 틀과 과제 칸(설계 §3 · D9 · D10 · D14) - 과제 열둘 · 자동 ✓ · 끝나면 다음 · 순서 자유 · 좁은 창은 처음부터 접힘.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LangProvider } from "@/lib/i18n";
import { notePracticeAct, resetPracticeServer } from "@/lib/practice/practice-server";
import { buildPracticeTestFixture } from "@/lib/practice/practice-test-fixture";

import { PRACTICE_NARROW_QUERY, PracticeFrame } from "./practice-frame";

let root: Root | null = null;

function stubWidth(isNarrow: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === PRACTICE_NARROW_QUERY && isNarrow, addEventListener: () => {}, removeEventListener: () => {} }));
}

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
const readOpen = () => [...document.querySelectorAll<HTMLElement>("[data-testid^='practice-task-'][data-open]")].map((el) => el.dataset.testid);
const press = (el: Element, init: KeyboardEventInit) => act(async () => void el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init })));
const click = (el: Element) => act(async () => void (el as HTMLElement).click());

beforeEach(() => {
  resetPracticeServer(buildPracticeTestFixture());
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("the task column", () => {
  it("lists twelve tasks with none done and opens the first with its keys and manual link", async () => {
    stubWidth(false);
    await renderFrame();
    expect(document.querySelectorAll("[data-testid^='practice-task-'][data-done]")).toHaveLength(12);
    expect(find("practice-progress")?.textContent).toBe("0/12");
    expect(readOpen()).toEqual(["practice-task-pick"]);
    expect(find("practice-task-pick")?.querySelector("kbd")?.textContent).toBe("J · ↓ · Tab");
    expect(find("practice-task-manual")?.getAttribute("href")).toBe("/manual#assign");
    expect(find("practice-task-manual")?.getAttribute("target")).toBe("_blank");
    expect(find("practice-tasks-done")).toBeNull();
  });

  it("ticks Pick when J is pressed in Assign and opens the next open task", async () => {
    stubWidth(false);
    await renderFrame();
    await press(find("paper-line")!, { key: "j" });
    expect(find("practice-task-pick")?.dataset.done).toBe("true");
    expect(find("practice-progress")?.textContent).toBe("1/12");
    expect(readOpen()).toEqual(["practice-task-link"]);
  });

  it("does not take J pressed in the task column or in a text box as moving a line", async () => {
    stubWidth(false);
    await renderFrame();
    await press(find("practice-tasks-fold")!, { key: "j" });
    const input = find("paper-line")!.appendChild(document.createElement("input"));
    await press(input, { key: "j" });
    expect(find("practice-task-pick")?.dataset.done).toBe("false");
  });

  it("opens any task pressed, keeps it open while other tasks get done, and moves on once it is done", async () => {
    stubWidth(false);
    await renderFrame();
    await click(find("practice-task-hold")!.querySelector("button")!);
    expect(readOpen()).toEqual(["practice-task-hold"]);
    await click(find("assign-help-keyboard-map")!);
    expect(find("practice-task-keyboard")?.dataset.done).toBe("true");
    expect(readOpen()).toEqual(["practice-task-hold"]);
    await act(async () => notePracticeAct({ key: "move_prev" }));
    await click(find("practice-task-pick")!.querySelector("button")!);
    expect(readOpen()).toEqual(["practice-task-pick"]);
    await press(find("paper-line")!, { key: "k" });
    expect(readOpen()).toEqual(["practice-task-link"]);
  });
});

describe("folding the task column", () => {
  it("starts folded on a narrow window, still showing the progress, and unfolds when pressed", async () => {
    stubWidth(true);
    await renderFrame();
    const grid = document.querySelector<HTMLElement>(".practice-grid")!;
    expect([grid.dataset.pref, find("practice-tasks")?.hasAttribute("data-folded")]).toEqual(["auto", true]);
    expect(find("practice-progress")?.textContent).toBe("0/12");
    expect(find("practice-tasks-fold")?.getAttribute("aria-expanded")).toBe("false");
    await click(find("practice-tasks-fold")!);
    expect([grid.dataset.pref, find("practice-tasks")?.hasAttribute("data-folded")]).toEqual(["open", false]);
    await click(find("practice-tasks-fold")!);
    expect([grid.dataset.pref, find("practice-tasks")?.hasAttribute("data-folded")]).toEqual(["folded", true]);
  });

  it("starts open on a wide window", async () => {
    stubWidth(false);
    await renderFrame();
    expect(find("practice-tasks")?.hasAttribute("data-folded")).toBe(false);
  });

  it("folds by the same width in CSS before React knows the window (no flash, no hydration gap)", () => {
    const css = readFileSync(join(process.cwd(), "src", "styles", "components.css"), "utf8");
    expect(css.includes(`@media ${PRACTICE_NARROW_QUERY} {\n    .practice-grid[data-pref="auto"]`), "components.css의 접힘 미디어 쿼리를 PRACTICE_NARROW_QUERY와 같은 값으로 두세요").toBe(true);
  });
});
