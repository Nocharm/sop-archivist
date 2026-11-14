// 목록 자리 바꿈(useFlip) - 움직이지 않은 줄에는 잴 때 건 인라인 스타일이 남지 않는다.
import { act, createElement, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import { useFlip } from "./motion";

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
