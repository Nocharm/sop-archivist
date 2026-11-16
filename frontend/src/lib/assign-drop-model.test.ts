import { describe, expect, it } from "vitest";
import { buildOldDragCard, canDragOld, findAssignDrop, resolveDropLink } from "./assign-drop-model";

describe("canDragOld", () => {
  const open = { canEdit: true, mode: "old" as const, isPairPicking: false, isSolo: false };
  it("allows a drag only for an editor in the old mode", () => {
    expect(canDragOld(open)).toBe(true);
    expect(canDragOld({ ...open, canEdit: false })).toBe(false);
    expect(canDragOld({ ...open, mode: "unsourced" })).toBe(false);
    expect(canDragOld({ ...open, isPairPicking: true })).toBe(false);
    expect(canDragOld({ ...open, isSolo: true })).toBe(false);
  });
});

describe("buildOldDragCard", () => {
  const label = (count: number) => `${count} units`;
  it("uses the first unit and no count for a single unit", () => {
    expect(buildOldDragCard([{ display_id: "OLD-3", text: "Wear gloves." }], label)).toEqual({ id: "OLD-3", text: "Wear gloves.", count: null });
  });
  it("counts the units of a KO/EN pair row", () => {
    expect(buildOldDragCard([{ display_id: "OLD-3", text: "장갑을 낀다." }, { display_id: "OLD-4", text: "Wear gloves." }], label)).toEqual({ id: "OLD-3", text: "장갑을 낀다.", count: "2 units" });
  });
  it("collapses whitespace so a long paragraph stays one line", () => {
    expect(buildOldDragCard([{ display_id: "OLD-9", text: "a\n  b\tc" }], label).text).toBe("a b c");
  });
  it("returns an empty card for a row whose units are gone", () => {
    expect(buildOldDragCard([], label)).toEqual({ id: "", text: "", count: null });
  });
});

describe("findAssignDrop", () => {
  it("links onto a pickable sentence of a written document", () => {
    expect(findAssignDrop({ targetId: 7, isReadOnly: false, hasPickButton: true })).toEqual({ kind: "link", targetId: 7 });
  });
  it("is nowhere over a composed (read-only) document, a non-sentence block, or outside any line", () => {
    expect(findAssignDrop({ targetId: 7, isReadOnly: true, hasPickButton: false })).toEqual({ kind: "none" });
    expect(findAssignDrop({ targetId: 7, isReadOnly: false, hasPickButton: false })).toEqual({ kind: "none" });
    expect(findAssignDrop(null)).toEqual({ kind: "none" });
  });
});

describe("resolveDropLink", () => {
  const link = (ids: number[]) => ({ kind: "link" as const, targetIds: ids });
  it("picks the sentence when nothing is saved there", () => {
    expect(resolveDropLink({ draftDestination: null, savedDestination: null, targetId: 7 })).toBe("pick");
    expect(resolveDropLink({ draftDestination: null, savedDestination: link([8]), targetId: 7 })).toBe("pick");
  });
  it("only opens the menu on the sentence the row is already saved to", () => {
    expect(resolveDropLink({ draftDestination: null, savedDestination: link([7, 8]), targetId: 7 })).toBe("menu_only");
  });
  it("picks again when a draft is in progress, like a click", () => {
    expect(resolveDropLink({ draftDestination: link([9]), savedDestination: link([7]), targetId: 7 })).toBe("pick");
  });
});
