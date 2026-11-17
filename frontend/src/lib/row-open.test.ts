import type { KeyboardEvent } from "react";
import { describe, expect, it, vi } from "vitest";

import { getRowOpenProps, shouldRowToggle } from "./row-open";

function pressKey(onKeyDown: (event: KeyboardEvent<HTMLElement>) => void, key: string, onRow = true) {
  const row = {};
  const event = { key, target: onRow ? row : {}, currentTarget: row, preventDefault: vi.fn() };
  onKeyDown(event as unknown as KeyboardEvent<HTMLElement>);
  return event;
}

describe("getRowOpenProps", () => {
  it("opens on Enter and Space and blocks the page scroll", () => {
    const onOpen = vi.fn();
    const props = getRowOpenProps(onOpen);

    const enter = pressKey(props.onKeyDown, "Enter");
    const space = pressKey(props.onKeyDown, " ");

    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(enter.preventDefault).toHaveBeenCalled();
    expect(space.preventDefault).toHaveBeenCalled();
    expect(props.tabIndex).toBe(0);
  });

  it("leaves other keys and keys pressed on a control inside the row alone", () => {
    const onOpen = vi.fn();
    const props = getRowOpenProps(onOpen);

    const tab = pressKey(props.onKeyDown, "Tab");
    const inner = pressKey(props.onKeyDown, "Enter", false);

    expect(onOpen).not.toHaveBeenCalled();
    expect(tab.preventDefault).not.toHaveBeenCalled();
    expect(inner.preventDefault).not.toHaveBeenCalled();
  });
});

describe("shouldRowToggle", () => {
  function makeRow(inner: string): HTMLElement {
    const row = document.createElement("div");
    row.innerHTML = inner;
    return row;
  }

  it("toggles on a press inside the row", () => {
    expect(shouldRowToggle(makeRow("<span>text</span>").querySelector("span"), false)).toBe(true);
  });

  it("does not toggle on a press inside a button, link, input, select or no-drag area", () => {
    for (const inner of [
      "<button><span>x</span></button>",
      "<a href='#'><span>x</span></a>",
      "<label><input /></label>",
      "<select><option>x</option></select>",
      "<div data-no-drag><span>x</span></div>",
    ]) {
      const row = makeRow(inner);
      const target = row.querySelector("span, input, option");
      expect(shouldRowToggle(target, false)).toBe(false);
    }
  });

  it("does not toggle after dragging over text, or without a target", () => {
    expect(shouldRowToggle(makeRow("<span>text</span>").querySelector("span"), true)).toBe(false);
    expect(shouldRowToggle(null, false)).toBe(false);
  });
});
