import { describe, expect, it } from "vitest";
import {
  buildDropSections,
  buildOldDragCard,
  canDragOld,
  findAssignDrop,
  findDropBlock,
  getSectionKey,
  isPositionLive,
  listDraftLines,
  readSectionDestination,
  resolveDropLink,
  resolveGapDrop,
  resolveSlotDrop,
  resolveTreeDrop,
  type DropSection,
} from "./assign-drop-model";

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

const PURPOSE: DropSection = { key: "purpose", isNa: false, isAssignable: true, items: [
  { targetId: 1, groupKey: "u10", sourceUnitIds: [10] },
  { targetId: 2, groupKey: "u20", sourceUnitIds: [20] },   // 짝 줄 u20의 두 문장
  { targetId: 3, groupKey: "u20", sourceUnitIds: [21] },
  { targetId: 4, groupKey: null, sourceUnitIds: [] },
] };
const SCOPE_NA: DropSection = { key: "scope", isNa: true, isAssignable: true, items: [] };
const ROLES: DropSection = { key: "roles", isNa: false, isAssignable: true, items: [] };
// 문장을 받지 않는 절 - 묶음(7 · 7.1)과 앱이 채우는 목록(7.2)
const DOCS_GROUP: DropSection = { key: "document_relationships", isNa: false, isAssignable: false, items: [] };
const WI_LIST: DropSection = { key: "document_relationships.work_instructions", isNa: false, isAssignable: false, items: [] };

describe("buildDropSections", () => {
  it("keys each line by the Old row of its first source unit", () => {
    const item = (target_id: number, source_unit_ids: number[]) => ({ target_id, kind: "sentence" as const, lang: "en" as const, text: "", status: "confirmed" as const, change_type: "as_is" as const, number: null, number_style: "bullet" as const, indent_level: 0, meaning_key: null, source_unit_ids });
    const rowKeyOf = (id: number) => ({ 10: "u10", 20: "u20", 21: "u20" } as Record<number, string>)[id];
    expect(buildDropSections([
      { location_key: "purpose", na_reason: null, kind: "general", items: [item(1, [10]), item(2, [20]), item(3, [21]), item(4, [])] },
      { location_key: "scope", na_reason: "Synthetic", kind: "general", items: [] },
    ], rowKeyOf)).toEqual([PURPOSE, SCOPE_NA]);
  });
  it("marks group and auto-list sections as taking no sentences, and every other kind as taking them", () => {
    const section = (location_key: string, kind: "general" | "category_table" | "named_children" | "group" | "auto_list" | null) => ({ location_key, na_reason: null, kind, items: [] });
    const built = buildDropSections([
      section("document_relationships", "group"),
      section("document_relationships.work_instructions", "auto_list"),
      section("general_requirements", "category_table"),
      section("procedures", "named_children"),
      section("step:1:instruction", null),
    ], () => undefined);
    expect(built.slice(0, 2)).toEqual([DOCS_GROUP, WI_LIST]);
    expect(built.slice(2).map((item) => item.isAssignable)).toEqual([true, true, true]);
  });
});

describe("findDropBlock", () => {
  it("groups neighbours from the same Old row", () => {
    expect(findDropBlock(PURPOSE, 1)).toEqual({ firstId: 1, lastId: 1 });
    expect(findDropBlock(PURPOSE, 3)).toEqual({ firstId: 2, lastId: 3 });
    expect(findDropBlock(PURPOSE, 4)).toEqual({ firstId: 4, lastId: 4 });
    expect(findDropBlock(PURPOSE, 99)).toBeNull();
  });
});

describe("resolveGapDrop", () => {
  it("drops before a block from its upper half and after it from its lower half", () => {
    expect(resolveGapDrop(PURPOSE, 1, true, [50])).toEqual({ kind: "gap", sectionKey: "purpose", after: null, edge: { targetId: 1, side: "top" } });
    expect(resolveGapDrop(PURPOSE, 1, false, [50])).toEqual({ kind: "gap", sectionKey: "purpose", after: 1, edge: { targetId: 1, side: "bottom" } });
  });
  it("never lands in the middle of another meaning group", () => {
    expect(resolveGapDrop(PURPOSE, 3, true, [50])).toEqual({ kind: "gap", sectionKey: "purpose", after: 1, edge: { targetId: 2, side: "top" } });
    expect(resolveGapDrop(PURPOSE, 2, false, [50])).toEqual({ kind: "gap", sectionKey: "purpose", after: 3, edge: { targetId: 3, side: "bottom" } });
  });
  it("refuses the slot the dragged row is already in, even for one sentence of a pair", () => {
    expect(resolveGapDrop(PURPOSE, 1, false, [21, 22])).toEqual({ kind: "refused", reason: "same_slot" });
  });
  it("refuses an N/A slot and is nowhere for a line that is not in the section", () => {
    expect(resolveGapDrop({ ...PURPOSE, isNa: true }, 1, true, [50])).toEqual({ kind: "refused", reason: "na_slot" });
    expect(resolveGapDrop(PURPOSE, 99, true, [50])).toEqual({ kind: "none" });
  });
});

describe("resolveSlotDrop", () => {
  it("takes an empty slot without a position and refuses an N/A one", () => {
    expect(resolveSlotDrop(ROLES)).toEqual({ kind: "slot", sectionKey: "roles" });
    expect(resolveSlotDrop(SCOPE_NA)).toEqual({ kind: "refused", reason: "na_slot" });
  });
  it("refuses a group and the auto list, and names N/A first when such a section is N/A", () => {
    expect(resolveSlotDrop(DOCS_GROUP)).toEqual({ kind: "refused", reason: "not_assignable" });
    expect(resolveSlotDrop(WI_LIST)).toEqual({ kind: "refused", reason: "not_assignable" });
    expect(resolveSlotDrop({ ...DOCS_GROUP, isNa: true })).toEqual({ kind: "refused", reason: "na_slot" });
  });
});

describe("resolveTreeDrop", () => {
  const slot = { kind: "slot", docId: 6, slotKey: "scope" } as const;
  const step = { kind: "step", docId: 8, step: 1, part: "why" } as const;
  it("takes what a click takes", () => {
    expect(resolveTreeDrop({ destination: slot, disabled: false })).toEqual({ kind: "place", destination: slot });
    expect(resolveTreeDrop({ destination: step, disabled: false })).toEqual({ kind: "place", destination: step });
    expect(resolveTreeDrop({ destination: slot, disabled: true })).toEqual({ kind: "refused", reason: "na_slot" });
  });
  it("is nowhere over a slot heading, a link or no row", () => {
    expect(resolveTreeDrop({ destination: { kind: "slot_heading", docId: 6, slotKey: "scope" }, disabled: false })).toEqual({ kind: "none" });
    expect(resolveTreeDrop({ destination: { kind: "link", targetIds: [7] }, disabled: false })).toEqual({ kind: "none" });
    expect(resolveTreeDrop(undefined)).toEqual({ kind: "none" });
  });
});

describe("readSectionDestination / getSectionKey", () => {
  it("maps a section key to a destination and back", () => {
    expect(readSectionDestination(6, "procedures.procedure")).toEqual({ kind: "slot", docId: 6, slotKey: "procedures.procedure" });
    expect(readSectionDestination(8, "step:2:why")).toEqual({ kind: "step", docId: 8, step: 2, part: "why" });
    expect(readSectionDestination(8, "unstepped:instruction")).toEqual({ kind: "step", docId: 8, step: null, part: "instruction" });
    expect(readSectionDestination(9, "path:1. Purpose")).toBeNull();
    expect(getSectionKey({ kind: "slot", docId: 6, slotKey: "scope" })).toBe("scope");
    expect(getSectionKey({ kind: "step", docId: 8, step: 2, part: "why" })).toBe("step:2:why");
    expect(getSectionKey({ kind: "step", docId: 8, step: null, part: "instruction" })).toBe("unstepped:instruction");
    expect(getSectionKey({ kind: "delete" })).toBeNull();
    expect(getSectionKey(null)).toBeNull();
  });
});

describe("isPositionLive", () => {
  it("is live while the anchor line is still in that section", () => {
    expect(isPositionLive([PURPOSE, ROLES], "purpose", 3)).toBe(true);
    expect(isPositionLive([PURPOSE, ROLES], "purpose", 99)).toBe(false);
    expect(isPositionLive([PURPOSE, ROLES], "roles", 1)).toBe(false);
    expect(isPositionLive([PURPOSE, ROLES], "purpose", null)).toBe(true);
    expect(isPositionLive([PURPOSE, ROLES], "nope", null)).toBe(false);
  });
});

describe("listDraftLines", () => {
  const slot = (key: string, lang: "ko" | "en", text: string, sourceIds: number[], isTranslated = false) => ({ key, lang, text, sourceIds, isTranslated });
  it("orders a KO/EN pair English first, like the server", () => {
    expect(listDraftLines([slot("u10", "ko", "장갑을 낀다.", [10]), slot("u11", "en", "Wear gloves.", [11])], {})).toEqual([
      { key: "u11", lang: "en", text: "Wear gloves." }, { key: "u10", lang: "ko", text: "장갑을 낀다." },
    ]);
  });
  it("shows the edited text and puts a hand-written translation right after its source", () => {
    expect(listDraftLines([slot("u10", "ko", "원문", [10]), slot("u12", "ko", "둘째", [12]), slot("x10", "en", "", [10], true)], { u10: "고친 글", x10: "Edited" })).toEqual([
      { key: "u10", lang: "ko", text: "고친 글" }, { key: "x10", lang: "en", text: "Edited" }, { key: "u12", lang: "ko", text: "둘째" },
    ]);
  });
  it("skips a hand-written slot that is still empty", () => {
    expect(listDraftLines([slot("u10", "ko", "원문", [10]), slot("x10", "en", "", [10], true)], {})).toEqual([{ key: "u10", lang: "ko", text: "원문" }]);
  });
  it("puts a translation without a source at the end, not after another line without a source", () => {
    expect(listDraftLines([slot("n1", "ko", "출처 없음", []), slot("u10", "ko", "원문", [10]), slot("x0", "en", "Loose", [], true)], {})).toEqual([
      { key: "n1", lang: "ko", text: "출처 없음" }, { key: "u10", lang: "ko", text: "원문" }, { key: "x0", lang: "en", text: "Loose" },
    ]);
  });
});
