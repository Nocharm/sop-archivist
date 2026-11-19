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
});
