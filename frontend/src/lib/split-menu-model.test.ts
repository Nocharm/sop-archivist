import { describe, expect, it } from "vitest";

import type { ViewUnit } from "./api-sop";
import { buildSplitMenu, getAiSplitReason, type SplitMenuAction, type SplitMenuContext } from "./split-menu-model";

function makeUnit(id: number, over: Partial<ViewUnit> = {}): ViewUnit {
  return {
    id,
    display_id: `U${id}`,
    kind: "sentence",
    spans: [],
    text: "text",
    lang: "ko",
    table_id: null,
    row_index: null,
    group_unit_id: null,
    boundary_confirmed: false,
    status: null,
    pair_id: null,
    pos_seq: id,
    block_id: 1,
    is_edited: false,
    split_suggestion_id: null,
    ...over,
  };
}

function ctx(over: Partial<SplitMenuContext> = {}): SplitMenuContext {
  return { selected: makeUnit(1), target: makeUnit(2, { lang: "en" }), adjacent: true, readOnly: false, aiEnabled: true, ...over };
}

function find(items: ReturnType<typeof buildSplitMenu>, action: SplitMenuAction) {
  const item = items.find((entry) => entry.action === action);
  if (!item) throw new Error(`missing ${action}`);
  return item;
}

describe("buildSplitMenu two sentences", () => {
  it("lists the four two-sentence actions", () => {
    expect(buildSplitMenu(ctx()).map((item) => item.action)).toEqual(["pair", "unpair", "merge", "check_both"]);
  });

  it("allows pairing two unpaired sentences of different languages", () => {
    expect(find(buildSplitMenu(ctx()), "pair")).toEqual({ action: "pair", enabled: true });
  });

  it("blocks pairing same-language sentences", () => {
    const item = find(buildSplitMenu(ctx({ target: makeUnit(2, { lang: "ko" }) })), "pair");
    expect(item).toMatchObject({ enabled: false, reasonKey: "split.menu.why.sameLanguage" });
  });

  it("blocks pairing when one is already paired, and enables unpair for a shared pair", () => {
    const paired = ctx({ selected: makeUnit(1, { pair_id: 9 }), target: makeUnit(2, { lang: "en", pair_id: 9 }) });
    const items = buildSplitMenu(paired);
    expect(find(items, "pair")).toMatchObject({ enabled: false, reasonKey: "split.menu.why.alreadyPaired" });
    expect(find(items, "unpair").enabled).toBe(true);
  });

  it("disables unpair when the two are not each other's pair", () => {
    expect(find(buildSplitMenu(ctx()), "unpair")).toMatchObject({ enabled: false, reasonKey: "split.menu.why.notPaired" });
    const other = ctx({ selected: makeUnit(1, { pair_id: 9 }), target: makeUnit(2, { lang: "en", pair_id: 10 }) });
    expect(find(buildSplitMenu(other), "unpair").enabled).toBe(false);
  });

  it("blocks merging non-neighbours", () => {
    expect(find(buildSplitMenu(ctx({ adjacent: false })), "merge")).toMatchObject({ enabled: false, reasonKey: "split.menu.why.notAdjacent" });
  });

  it("reuses the gap merge rules for neighbours", () => {
    expect(find(buildSplitMenu(ctx()), "merge")).toMatchObject({ enabled: false, reasonKey: "split.noMergeLanguage" });
    expect(find(buildSplitMenu(ctx({ target: makeUnit(2, { lang: "ko" }) })), "merge").enabled).toBe(true);
    expect(find(buildSplitMenu(ctx({ target: makeUnit(2, { kind: "table", lang: "neutral" }) })), "merge").reasonKey).toBe("split.noMergeKind");
    const cells = ctx({ selected: makeUnit(1, { kind: "cell_sentence", group_unit_id: 5 }), target: makeUnit(2, { kind: "cell_sentence", group_unit_id: 6 }) });
    expect(find(buildSplitMenu(cells), "merge").reasonKey).toBe("split.noMergeCell");
  });

  it("disables check_both once both are checked", () => {
    const done = ctx({ selected: makeUnit(1, { boundary_confirmed: true }), target: makeUnit(2, { boundary_confirmed: true }) });
    expect(find(buildSplitMenu(done), "check_both")).toMatchObject({ enabled: false, reasonKey: "split.menu.why.allChecked" });
    expect(find(buildSplitMenu(ctx()), "check_both").enabled).toBe(true);
  });

  it("disables every change when read-only", () => {
    for (const item of buildSplitMenu(ctx({ readOnly: true }))) expect(item).toMatchObject({ enabled: false, reasonKey: "split.menu.why.readOnly" });
  });
});

describe("buildSplitMenu single sentence", () => {
  const single = (over: Partial<SplitMenuContext> = {}) => ctx({ selected: null, target: makeUnit(2), ...over });

  it("lists the right-panel actions for the selected sentence itself or with nothing selected", () => {
    const names = ["check", "split", "ai_split", "hold", "lang_ko", "lang_en", "unpair"];
    expect(buildSplitMenu(single()).map((item) => item.action)).toEqual(names);
    expect(buildSplitMenu(ctx({ selected: makeUnit(2), target: makeUnit(2) })).map((item) => item.action)).toEqual(names);
  });

  it("needs a cut line to split", () => {
    expect(find(buildSplitMenu(single()), "split")).toMatchObject({ enabled: false, reasonKey: "split.menu.why.noCut" });
    expect(find(buildSplitMenu(single({ hasCut: true })), "split").enabled).toBe(true);
  });

  it("gates AI split on aiEnabled", () => {
    expect(find(buildSplitMenu(single({ aiEnabled: false })), "ai_split")).toMatchObject({ enabled: false, reasonKey: "split.menu.why.aiOff" });
    expect(find(buildSplitMenu(single()), "ai_split").enabled).toBe(true);
  });

  it("gives AI split the same reasons as the right-panel button", () => {
    expect(find(buildSplitMenu(single({ hasSuggestion: true })), "ai_split")).toMatchObject({ enabled: false, reasonKey: "split.menu.why.hasSuggestion" });
    expect(find(buildSplitMenu(single({ isAiWaiting: true })), "ai_split")).toMatchObject({ enabled: false, reasonKey: "split.menu.why.aiWaiting" });
    const base = { aiEnabled: true, isText: true };
    expect(getAiSplitReason(base)).toBeNull();
    expect(getAiSplitReason({ ...base, aiEnabled: false, hasSuggestion: true })).toBe("split.menu.why.aiOff");
    expect(getAiSplitReason({ ...base, isWaiting: true, hasSuggestion: true })).toBe("split.menu.why.aiWaiting");
  });

  it("only lets pair-less sentences skip unpair, and hides already-set language", () => {
    const items = buildSplitMenu(single());
    expect(find(items, "unpair")).toMatchObject({ enabled: false, reasonKey: "split.menu.why.notPaired" });
    expect(find(items, "lang_ko")).toMatchObject({ enabled: false, reasonKey: "split.menu.why.alreadyLang" });
    expect(find(items, "lang_en").enabled).toBe(true);
    expect(find(buildSplitMenu(single({ target: makeUnit(2, { pair_id: 3 }) })), "unpair").enabled).toBe(true);
  });

  it("offers AI split for sentences and cell sentences but not headings", () => {
    expect(find(buildSplitMenu(single({ target: makeUnit(2, { kind: "heading" }) })), "ai_split").reasonKey).toBe("split.menu.why.notText");
    expect(find(buildSplitMenu(single({ target: makeUnit(2, { kind: "heading" }) })), "lang_en").enabled).toBe(true);
    expect(find(buildSplitMenu(single({ target: makeUnit(2, { kind: "cell_sentence" }) })), "ai_split").enabled).toBe(true);
  });

  it("blocks language and AI for non-text units, and hold for decided ones", () => {
    const table = buildSplitMenu(single({ target: makeUnit(2, { kind: "table", lang: "neutral" }) }));
    expect(find(table, "lang_en").reasonKey).toBe("split.menu.why.notText");
    expect(find(table, "ai_split").reasonKey).toBe("split.menu.why.notText");
    expect(find(buildSplitMenu(single({ isDecided: true })), "hold")).toMatchObject({ enabled: false, reasonKey: "split.menu.why.decided" });
  });

  it("disables every change when read-only", () => {
    for (const item of buildSplitMenu(single({ readOnly: true }))) expect(item.enabled).toBe(false);
  });
});
