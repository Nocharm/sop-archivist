import { describe, expect, it } from "vitest";
import { MAP } from "./map-fixture";
import { getEntryFocus, getMapKeyAction, type MapFocus } from "./map-keys";
import { layoutMap, type MapLayout } from "./map-layout";
import { buildMapView, DEFAULT_FILTERS } from "./map-model";

const VIEW = buildMapView(MAP, DEFAULT_FILTERS);
const LAYOUT = layoutMap(VIEW, new Set());
const FOLDED = layoutMap(VIEW, new Set(["18"]));

function press(key: string, focus: MapFocus, layout: MapLayout = LAYOUT) {
  return getMapKeyAction(key, focus, layout);
}

/** 화살표·Home·End만으로 entry에서 닿는 자리 모두 */
function listReachable(layout: MapLayout, entry: MapFocus): Set<MapFocus> {
  const seen = new Set<MapFocus>([entry]);
  const queue = [entry];
  while (queue.length) {
    const focus = queue.shift()!;
    for (const key of ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"]) {
      const action = getMapKeyAction(key, focus, layout);
      if (action?.kind === "focus" && !seen.has(action.id)) {
        seen.add(action.id);
        queue.push(action.id);
      }
    }
  }
  return seen;
}

describe("map-keys", () => {
  it("moves up and down inside a lane, up to its head", () => {
    expect(press("ArrowDown", "old:101")).toEqual({ kind: "focus", id: "old:102" });
    expect(press("ArrowUp", "old:101")).toEqual({ kind: "focus", id: "lane:12" });
    expect(press("ArrowUp", "old:102")).toEqual({ kind: "focus", id: "old:101" });
    expect(press("ArrowDown", "old:199")).toBeNull();
    expect(press("ArrowDown", "lane:12")).toEqual({ kind: "focus", id: "old:101" });
    expect(press("ArrowUp", "lane:12")).toBeNull();
  });

  it("moves across to the nearest document of the next lane, the last one when that lane is shorter", () => {
    expect(press("ArrowRight", "old:102")).toEqual({ kind: "focus", id: "target:77" });
    expect(press("ArrowLeft", "old:160")).toEqual({ kind: "focus", id: "old:101" });
    expect(press("ArrowRight", "old:110")).toEqual({ kind: "focus", id: "target:77" });
    expect(press("ArrowRight", "old:140")).toEqual({ kind: "focus", id: "num:SOP-ZZ-404" });
    expect(press("ArrowRight", "lane:12")).toEqual({ kind: "focus", id: "lane:18" });
    expect(press("ArrowLeft", "lane:15")).toEqual({ kind: "focus", id: "lane:18" });
  });

  it("goes to the head of a collapsed lane", () => {
    expect(press("ArrowRight", "old:102", FOLDED)).toEqual({ kind: "focus", id: "lane:18" });
    expect(press("ArrowDown", "lane:18", FOLDED)).toBeNull();
    expect(press("ArrowRight", "lane:18", FOLDED)).toEqual({ kind: "focus", id: "lane:15" });
    expect(press("Home", "lane:18", FOLDED)).toBeNull();
  });

  it("stops at the edges of the map without throwing", () => {
    expect(press("ArrowLeft", "old:101")).toBeNull();
    expect(press("ArrowLeft", "lane:12")).toBeNull();
    expect(press("ArrowRight", "num:SOP-ZZ-404")).toBeNull();
    expect(press("ArrowRight", "lane:none")).toBeNull();
    for (const key of ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End", "Enter", " "]) {
      expect(press(key, "old:999")).toBeNull();
      expect(press(key, "lane:99")).toBeNull();
    }
  });

  it("jumps to the first and last document of the lane", () => {
    expect(press("Home", "old:110")).toEqual({ kind: "focus", id: "old:101" });
    expect(press("End", "old:110")).toEqual({ kind: "focus", id: "old:199" });
    expect(press("End", "lane:12")).toEqual({ kind: "focus", id: "old:199" });
  });

  it("selects a document, toggles a lane and maps the other keys", () => {
    expect(press("Enter", "old:101")).toEqual({ kind: "select" });
    expect(press(" ", "target:77")).toEqual({ kind: "select" });
    expect(press("Enter", "lane:18")).toEqual({ kind: "toggle", laneKey: "18" });
    expect(press(" ", "lane:none")).toEqual({ kind: "toggle", laneKey: "none" });
    expect(press("Escape", "old:101")).toEqual({ kind: "clear" });
    expect(press("+", "old:101")).toEqual({ kind: "zoom", dir: 1 });
    expect(press("=", "old:101")).toEqual({ kind: "zoom", dir: 1 });
    expect(press("-", "old:101")).toEqual({ kind: "zoom", dir: -1 });
    expect(press("0", "old:101")).toEqual({ kind: "fit" });
    expect(press("a", "old:101")).toBeNull();
  });

  it("reaches every document and every lane head from the entry focus", () => {
    for (const layout of [LAYOUT, FOLDED]) {
      const reached = listReachable(layout, getEntryFocus(layout, null)!);
      for (const id of layout.nodes.keys()) expect(reached.has(id)).toBe(true);
      for (const lane of layout.lanes) expect(reached.has(`lane:${lane.key}`)).toBe(true);
    }
  });

  it("enters on the selected document, else the first of this bundle, else the first lane head", () => {
    expect(getEntryFocus(LAYOUT, "old:140")).toBe("old:140");
    expect(getEntryFocus(LAYOUT, null)).toBe("old:101");
    expect(getEntryFocus(FOLDED, "old:160")).toBe("old:101");
    expect(getEntryFocus(layoutMap(VIEW, new Set(["12"])), null)).toBe("lane:12");
    const noSelfDocs = layoutMap(buildMapView({ ...MAP, nodes: MAP.nodes.filter((n) => n.bundle_id !== 12), edges: [] }, DEFAULT_FILTERS), new Set());
    expect(getEntryFocus(noSelfDocs, null)).toBe("lane:12");
    expect(getEntryFocus(layoutMap(buildMapView({ ...MAP, bundles: [], nodes: [], edges: [] }, DEFAULT_FILTERS), new Set()), null)).toBeNull();
  });
});
