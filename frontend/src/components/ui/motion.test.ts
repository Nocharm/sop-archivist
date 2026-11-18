// 목록 자리 바꿈(useFlip) - 움직이지 않은 줄에는 잴 때 건 인라인 스타일이 남지 않는다.
// 풀기 전환(useUnwrapMotion) - 표를 문장 카드로 푸는 작은 화면으로 세 단계의 차례 · 시간 · 늦춤, 되돌리기, 움직임 줄이기, 화면 밖, 앞지르기를 못 박는다.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { act, createElement, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { useFlip, useUnwrapMotion, type UnwrapRunOptions } from "./motion";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("useFlip", () => {
  it("leaves no inline transition on lines that did not move", () => {
    let press: () => void = () => {};
    function List() {
      const ref = useRef<HTMLDivElement>(null);
      const [count, setCount] = useState(0);
      const flip = useFlip(ref);
      press = () => {
        flip.capture(["1", "2"]);
        setCount((value) => value + 1);
      };
      // jsdom은 자리를 모두 0으로 재므로 거리가 없다 - 거리 없는 길에서도 스타일을 지워야 한다
      return createElement("div", { ref, "data-count": count }, createElement("p", { "data-flip-key": "1" }, "a"), createElement("p", { "data-flip-key": "2" }, "b"));
    }
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => root.render(createElement(List)));
    act(() => press());
    for (const line of host.querySelectorAll<HTMLElement>("[data-flip-key]")) {
      expect(line.style.transition).toBe("");
      expect(line.style.transform).toBe("");
    }
    act(() => root.unmount());
  });
});

interface AnimateCall {
  target: HTMLElement;
  keyframes: Keyframe[];
  options: KeyframeAnimationOptions;
  /** animate를 부른 때 화면이 이미 문장 카드였는가 */
  wasUnwrapped: boolean;
}

describe("useUnwrapMotion", () => {
  const SCOPES: UnwrapRunOptions = { scopes: ["t1"] };
  const tokens = document.createElement("style");
  let calls: AnimateCall[] = [];
  // true면 animate가 cancel 전까지 끝나지 않는다 - 걷는 도중을 붙잡아 둔다
  let holdAnimations = false;
  let host: HTMLDivElement;
  let root: Root;
  let motion: { run: (change: () => void, options: UnwrapRunOptions) => Promise<void> };
  let setUnwrapped: (value: boolean) => void = () => {};

  /** 표(칸 글 a · b는 한 행, c는 다음 행)를 문장 카드 세 장으로 푸는 화면 - 뒤따르는 줄(after)은 밀려나고 far는 화면 밖이다. 자리는 data-left · data-top으로 준다(jsdom은 재지 못한다) */
  function Story() {
    const ref = useRef<HTMLDivElement>(null);
    const [unwrapped, setValue] = useState(false);
    motion = useUnwrapMotion(ref);
    setUnwrapped = setValue;
    const text = (key: string, left: number, top: number) => createElement("span", { key, "data-flip-key": key, "data-left": left, "data-top": top }, key);
    return createElement(
      "div",
      { ref },
      unwrapped
        ? createElement(
            "div",
            { key: "cards", "data-unwrap-scope": "t1", "data-unwrap-enter": "frame", "data-top": 100 },
            createElement("button", { "data-unwrap-enter": "", "data-testid": "story-back", "data-top": 80 }, "Back to table"),
            text("a", 20, 100),
            text("b", 20, 140),
            text("c", 20, 180),
          )
        : createElement(
            "div",
            { key: "table", "data-unwrap-scope": "t1", "data-unwrap-leave": "frame", "data-top": 100 },
            createElement("span", { "data-unwrap-leave": "", "data-testid": "story-mark", "data-top": 80 }, "TABLE"),
            text("a", 0, 100),
            text("b", 200, 100),
            text("c", 0, 130),
          ),
      text("after", 0, unwrapped ? 220 : 160),
      text("far", 0, unwrapped ? 5060 : 5000),
    );
  }

  const readToken = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const listMoves = () => calls.filter((call) => call.target.dataset.flipKey !== undefined).map((call) => [call.target.dataset.flipKey, call.keyframes[0].transform, call.options.delay]);
  const listMarks = (marker: "leave" | "enter") => calls.filter((call) => call.target.hasAttribute(`data-unwrap-${marker}`));

  beforeAll(() => {
    // 시간과 곡선은 실제 tokens.css에서 읽힌다 - 토큰 이름이나 값이 바뀌면 여기서 걸린다
    tokens.textContent = readFileSync(join(process.cwd(), "src", "styles", "tokens.css"), "utf8");
    document.head.append(tokens);
  });
  afterAll(() => tokens.remove());

  beforeEach(() => {
    calls = [];
    holdAnimations = false;
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const left = Number(this.getAttribute("data-left") ?? 0);
      const top = Number(this.getAttribute("data-top") ?? 0);
      return { left, top, right: left + 100, bottom: top + 20, width: 100, height: 20, x: left, y: top, toJSON: () => ({}) };
    });
    // jsdom에는 animate가 없다 - 부른 것을 적어 두고, 끝남(finished)은 바로 또는 cancel 때 알린다
    Element.prototype.animate = function (this: Element, keyframes, options) {
      let settle: () => void = () => {};
      const finished = new Promise<void>((resolve) => {
        settle = resolve;
      });
      if (!holdAnimations) settle();
      calls.push({ target: this as HTMLElement, keyframes: keyframes as Keyframe[], options: options as KeyframeAnimationOptions, wasUnwrapped: host.querySelector("[data-testid='story-back']") !== null });
      return { finished, cancel: settle } as unknown as Animation;
    };
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root.render(createElement(Story)));
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    Reflect.deleteProperty(Element.prototype, "animate");
    Reflect.deleteProperty(window, "matchMedia");
  });

  it("clears the table marks, then spreads the text top row first, then attaches the new marks", async () => {
    await act(() => motion.run(() => setUnwrapped(true), SCOPES));

    // 1 걷기 - 옛 화면에서, 바꾸기 전에
    const cleared = listMarks("leave");
    expect(cleared.map((call) => [call.target.dataset.testid ?? "scope", call.keyframes, call.wasUnwrapped])).toEqual([
      ["scope", [{ offset: 1, borderColor: "transparent", backgroundColor: "transparent", boxShadow: "none" }], false],
      ["story-mark", [{ offset: 1, opacity: 0 }], false],
    ]);
    expect(cleared[0].options).toEqual({ duration: 160, easing: readToken("--ease-exit"), direction: "normal", fill: "forwards" });

    // 2 펼치기 - 새 화면에서 옛 자리로 거꾸로 옮긴 데서 출발한다. 화면 밖(far)은 움직이지 않는다
    expect(listMoves()).toEqual([
      ["a", "translate(-20px, 0px)", 0],
      ["b", "translate(180px, -40px)", 28],
      ["c", "translate(-20px, -50px)", 56],
      ["after", "translate(0px, -60px)", 84],
    ]);
    const spread = calls.find((call) => call.target.dataset.flipKey === "a");
    expect(spread?.options).toEqual({ duration: 520, easing: readToken("--ease-move"), delay: 0, fill: "backwards" });
    expect(spread?.wasUnwrapped).toBe(true);

    // 3 붙이기 - 가장 늦은 줄이 닿은 뒤(84 + 520)
    const attached = listMarks("enter");
    expect(attached.map((call) => [call.target.dataset.testid ?? "scope", call.keyframes[0].offset])).toEqual([
      ["scope", 0],
      ["story-back", 0],
    ]);
    expect(attached[1].keyframes).toEqual([{ offset: 0, opacity: 0, transform: "scale(0.8)" }]);
    expect(attached[1].options).toEqual({ duration: 200, easing: readToken("--ease-pop"), direction: "normal", delay: 604, fill: "backwards" });
    expect(readToken("--ease-pop")).toContain("cubic-bezier");
    expect(calls).toHaveLength(8);
  });

  it("walks the same path backwards on reverse", async () => {
    act(() => setUnwrapped(true));
    calls = [];

    await act(() => motion.run(() => setUnwrapped(false), { ...SCOPES, reverse: true }));

    // 붙였던 것이 먼저 사라진다 - 같은 움직임을 거꾸로 튼다
    const detached = listMarks("enter");
    expect(detached.map((call) => [call.target.dataset.testid ?? "scope", call.wasUnwrapped])).toEqual([
      ["scope", true],
      ["story-back", true],
    ]);
    expect(detached[1].options).toEqual({ duration: 200, easing: readToken("--ease-pop"), direction: "reverse", fill: "forwards" });
    // 아래 줄이 먼저 떠난다
    expect(listMoves()).toEqual([
      ["a", "translate(20px, 0px)", 84],
      ["b", "translate(-180px, 40px)", 56],
      ["c", "translate(20px, 50px)", 28],
      ["after", "translate(0px, 60px)", 0],
    ]);
    // 걷었던 것이 마지막에 돌아온다
    const restored = listMarks("leave");
    expect(restored.map((call) => call.target.dataset.testid ?? "scope")).toEqual(["scope", "story-mark"]);
    expect(restored[1].options).toEqual({ duration: 160, easing: readToken("--ease-exit"), direction: "reverse", delay: 604, fill: "backwards" });
    expect(restored[1].wasUnwrapped).toBe(false);
  });

  it("changes at once and flashes the changed place under reduced motion", async () => {
    window.matchMedia = (() => ({ matches: true })) as unknown as typeof window.matchMedia;

    await act(() => motion.run(() => setUnwrapped(true), SCOPES));

    expect(calls).toHaveLength(0);
    expect(host.querySelector("[data-testid='story-back']")).not.toBeNull();
    expect([...host.querySelectorAll("[data-flash]")].map((element) => element.getAttribute("data-unwrap-scope"))).toEqual(["t1"]);
  });

  it("applies a change still waiting behind the clear phase before the next run", async () => {
    const applied: string[] = [];
    holdAnimations = true;
    let first: Promise<void> = Promise.resolve();
    await act(async () => {
      first = motion.run(() => {
        applied.push("unwrap");
        setUnwrapped(true);
      }, SCOPES);
    });
    expect(applied).toEqual([]);
    holdAnimations = false;

    await act(async () => {
      await motion.run(() => {
        applied.push("wrap");
        setUnwrapped(false);
      }, { ...SCOPES, reverse: true });
      await first;
    });

    expect(applied).toEqual(["unwrap", "wrap"]);
    expect(host.querySelector("[data-testid='story-mark']")).not.toBeNull();
  });

  it("applies a waiting change when the screen goes away", async () => {
    const change = vi.fn();
    holdAnimations = true;
    await act(async () => {
      void motion.run(change, SCOPES);
    });
    expect(change).not.toHaveBeenCalled();

    act(() => root.render(null));

    expect(change).toHaveBeenCalledTimes(1);
  });
});
