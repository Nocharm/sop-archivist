import type { KeyboardEvent } from "react";
import { describe, expect, it, vi } from "vitest";

import { getRowOpenProps } from "./row-open";

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
