// 번호 도착 전환이 누른 순간 시작해 응답까지 이어지는지(A2-R6) - 값은 number-arrival-model, 여기서는 보기가 바뀌는 차례만.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ViewNumber, ViewUnit } from "@/lib/api-sop";
import { useNumberArrival, type ExpectedNumbers } from "@/lib/use-number-arrival";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const buildUnits = (value: string | null): ReadonlyMap<number, ViewUnit> => {
  const number: ViewNumber = { value, read: value, source: "typed", is_set: false, content_start: 0, from_text: true, note: null };
  return new Map([[1, { id: 1, spans: [[10, 0, 9]], number } as unknown as ViewUnit]]);
};

describe("useNumberArrival", () => {
  let root: Root;
  let seen: ReturnType<typeof useNumberArrival>;
  function Cell({ units, expected }: { units: ReadonlyMap<number, ViewUnit>; expected?: ExpectedNumbers }) {
    seen = useNumberArrival(units, expected);
    return null;
  }
  const render = (units: ReadonlyMap<number, ViewUnit>, expected?: ExpectedNumbers) => act(() => root.render(createElement(Cell, { units, expected })));

  beforeEach(() => {
    root = createRoot(document.createElement("div"));
  });
  afterEach(() => act(() => root.unmount()));

  it("shows the number and starts at the press, and does not break off when the answer agrees", () => {
    const before = buildUnits(null);
    render(before);
    render(before, new Map([[1, "2.1"]]));
    expect(seen.shown.get(1)?.number?.value).toBe("2.1");
    expect([...seen.arrived]).toEqual([1]);

    const answer = buildUnits("2.1");
    render(answer);
    expect(seen.shown).toBe(answer);
    expect([...seen.arrived]).toEqual([1]);

    // 그다음 보기에는 지난 일이다
    render(buildUnits("2.1"));
    expect(seen.arrived.size).toBe(0);
  });

  it("goes back to the old number when the save fails", () => {
    const before = buildUnits(null);
    render(before);
    render(before, new Map([[1, "2.1"]]));
    render(before);
    expect(seen.shown.get(1)?.number?.value).toBeNull();
    expect(seen.arrived.size).toBe(0);
  });
});
