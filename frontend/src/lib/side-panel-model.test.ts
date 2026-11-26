import { describe, expect, it } from "vitest";

import { NO_PICKS, type Picks } from "./assign-focus-model";
import { readMenuKeyTarget, readPanelSide } from "./side-panel-model";

const all = { old: true, new: true };
const both = (last: "old" | "new"): Picks => ({ ...NO_PICKS, old: { kind: "unit", docId: 1, unitId: 3 }, new: { kind: "unit", docId: 7, unitIds: [70], additive: false }, last, act: "pick" });

describe("readPanelSide", () => {
  it("shows the side pressed last and offers the kept Old row", () => expect(readPanelSide(both("new"), all)).toEqual({ side: "new", keptOldId: 3 }));
  it("offers nothing when Old was pressed last", () => expect(readPanelSide(both("old"), all)).toEqual({ side: "old", keptOldId: null }));
  it("ignores a hidden side", () => {
    expect(readPanelSide(both("old"), { old: false, new: true })).toEqual({ side: "new", keptOldId: null });
    expect(readPanelSide(both("new"), { old: true, new: false })).toEqual({ side: "old", keptOldId: null });
    expect(readPanelSide(both("new"), { old: false, new: false })).toEqual({ side: null, keptOldId: null });
  });
  it("shows nothing before anything is picked", () => expect(readPanelSide(NO_PICKS, all)).toEqual({ side: null, keptOldId: null }));
  it("does not offer a deleted block as a row to decide", () => {
    const state: Picks = { ...both("new"), old: { kind: "toc", docId: 1, key: 9, unitId: null } };
    expect(readPanelSide(state, all)).toEqual({ side: "new", keptOldId: null });
  });
});

describe("readMenuKeyTarget", () => {
  const at = (over: Partial<Parameters<typeof readMenuKeyTarget>[0]>) => readMenuKeyTarget({ side: null, isSolo: false, cutId: null, oldId: null, newId: null, ...over });
  it("opens on the Old box when Old was pressed last, the cut sentence first", () => {
    expect(at({ side: "old", oldId: 3, newId: 70 })).toEqual({ pane: "old", unitId: 3 });
    expect(at({ side: "old", cutId: 4, oldId: 3 })).toEqual({ pane: "old", unitId: 4 });
  });
  it("opens on the New box when New was pressed last beside Old", () => expect(at({ side: "new", cutId: 71, oldId: 3, newId: 70 })).toEqual({ pane: "new", unitId: 70 }));
  it("opens on the picked box of a New document opened alone, the cut sentence first", () => {
    expect(at({ side: "new", isSolo: true, newId: 70 })).toEqual({ pane: "solo", unitId: 70 });
    expect(at({ side: "new", isSolo: true, cutId: 71, newId: 70 })).toEqual({ pane: "solo", unitId: 71 });
  });
  it("opens nothing when nothing is picked on the last side", () => {
    expect(at({})).toBeNull();
    expect(at({ side: "old", newId: 70 })).toBeNull();
    expect(at({ side: "new", oldId: 3 })).toBeNull();
  });
});
