import type { KeyboardEvent, MouseEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import { getSpotAttrs, type PlaceSpotView } from "@/components/assign/place-spot";

const base: PlaceSpotView = { key: "k", open: true, label: "after 6.1", picked: false, onPick: () => undefined };

describe("getSpotAttrs", () => {
  it("makes a refused spot a focusable disabled button named by the reason, with no activation", () => {
    const onPick = vi.fn();
    const attrs = getSpotAttrs({ ...base, open: false, label: "Not allowed here", onPick });
    expect(attrs).toMatchObject({ role: "button", tabIndex: 0, "aria-disabled": true, "aria-label": "Not allowed here", "data-place": "refused" });
    expect(attrs.onClick).toBeUndefined();
    expect(attrs.onKeyDown).toBeUndefined();
    expect(onPick).not.toHaveBeenCalled();
  });

  it("omits the name when a refused spot has no reason", () => {
    expect(getSpotAttrs({ ...base, open: false, label: "" })["aria-label"]).toBeUndefined();
  });

  it("keeps an open spot pressable without a disabled flag", () => {
    const attrs = getSpotAttrs({ ...base, picked: true });
    expect(attrs).toMatchObject({ role: "button", tabIndex: 0, "aria-pressed": true, "data-place": "open" });
    expect(attrs["aria-disabled"]).toBeUndefined();
  });

  it("takes Space but leaves Enter to the screen's confirm", () => {
    const onPick = vi.fn();
    const attrs = getSpotAttrs({ ...base, onPick });
    const press = (key: string) => {
      const preventDefault = vi.fn();
      attrs.onKeyDown?.({ key, target: null, currentTarget: null, preventDefault } as unknown as KeyboardEvent<HTMLElement>);
      return preventDefault;
    };
    expect(press("Enter")).not.toHaveBeenCalled();
    expect(onPick).not.toHaveBeenCalled();
    expect(press(" ")).toHaveBeenCalled();
    expect(onPick).toHaveBeenCalledWith(false);
  });

  it("says whether the pick came from the mouse", () => {
    const onPick = vi.fn();
    const attrs = getSpotAttrs({ ...base, onPick });
    const click = (detail: number) => attrs.onClick?.({ detail, target: null, currentTarget: null } as unknown as MouseEvent<HTMLElement>);
    click(1);
    click(0);
    expect(onPick.mock.calls).toEqual([[true], [false]]);
  });
});
