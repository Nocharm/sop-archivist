import { describe, expect, it } from "vitest";

import type { ViewUnit } from "./api-sop";
import { buildAssignMenu, planAssignJoin, type AssignMenuAction, type AssignMenuContext } from "./assign-context-menu-model";
import { findNearestCut } from "./paper-model";

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
    status: null,
    pair_id: null,
    pos_seq: id,
    block_id: 1,
    is_edited: false,
    can_unmerge: false,
    split_suggestion_id: null, ref: null,
    ...over,
  };
}

function ctx(over: Partial<AssignMenuContext> = {}): AssignMenuContext {
  return {
    target: makeUnit(2),
    prev: makeUnit(1),
    next: makeUnit(3),
    readOnly: false,
    rowStatus: "unassigned",
    hasDestination: false,
    isConfirmedAsIs: false,
    isDecided: () => false,
    hasDraft: () => false,
    canSplit: true,
    table: null,
    ...over,
  };
}

function find(context: AssignMenuContext, action: AssignMenuAction) {
  const { assign, edit } = buildAssignMenu(context);
  const item = [...assign, ...edit].find((entry) => entry.action === action);
  if (!item) throw new Error(`missing ${action}`);
  return item;
}

describe("buildAssignMenu", () => {
  it("groups assign actions before edit actions", () => {
    const groups = buildAssignMenu(ctx());
    expect(groups.assign.map((item) => item.action)).toEqual(["confirm", "clear"]);
    expect(groups.edit.map((item) => item.action)).toEqual(["split", "merge_prev", "merge_next", "pair_pick", "lang", "ref_mark"]);
  });

  it("enables every edit on an unassigned sentence with same-language neighbours", () => {
    const { edit } = buildAssignMenu(ctx());
    expect(edit.every((item) => item.enabled)).toBe(true);
  });

  it("needs a destination to confirm, and nothing new to confirm on a confirmed row", () => {
    expect(find(ctx(), "confirm").reasonKey).toBe("assign.ctx.why.noDestination");
    expect(find(ctx({ hasDestination: true }), "confirm").enabled).toBe(true);
    expect(find(ctx({ hasDestination: true, isConfirmedAsIs: true }), "confirm").reasonKey).toBe("assign.ctx.why.alreadyConfirmed");
  });

  it("cancels an assignment only when there is one", () => {
    expect(find(ctx(), "clear").reasonKey).toBe("assign.ctx.why.notAssigned");
    expect(find(ctx({ rowStatus: "ai_suggested" }), "clear").enabled).toBe(true);
    expect(find(ctx({ isDecided: () => true }), "clear").enabled).toBe(true);
  });

  it("lets an assigned sentence be cut or merged (the screen asks before clearing the assignment) but not change language", () => {
    const context = ctx({ rowStatus: "confirmed", isDecided: (unit) => unit.id === 2 });
    // 자르기·합치기는 그 문장을 새 문장으로 바꾼다 - 서버가 한 번 묻고 배정을 풀어 준다
    for (const action of ["split", "merge_prev", "merge_next"] as const) expect(find(context, action).enabled).toBe(true);
    // 언어는 제자리에서 바뀌어 사람의 판단과 어긋난다 - 서버가 묻지 않고 거절한다
    expect(find(context, "lang").reasonKey).toBe("assign.ctx.why.assigned");
  });

  it("blocks edits while the row has an unsaved choice", () => {
    expect(find(ctx({ hasDraft: (unit) => unit.id === 2 }), "split").reasonKey).toBe("assign.ctx.why.unsaved");
  });

  it("explains a blocked merge by the neighbour", () => {
    expect(find(ctx({ prev: null }), "merge_prev").reasonKey).toBe("assign.ctx.why.noNeighbor");
    // 배정된 이웃과도 합친다(묻고 배정을 푼다) - 저장하지 않은 고름이 있는 이웃은 그대로 막는다
    expect(find(ctx({ isDecided: (unit) => unit.id === 3 }), "merge_next").enabled).toBe(true);
    expect(find(ctx({ hasDraft: (unit) => unit.id === 1 }), "merge_prev").reasonKey).toBe("assign.ctx.why.neighborUnsaved");
    expect(find(ctx({ next: makeUnit(3, { kind: "table" }) }), "merge_next").reasonKey).toBe("assign.ctx.why.neighborNotText");
    // 언어가 다르면 합치기가 아니라 짝이다 - 짝은 Split에서 맺는다
    expect(find(ctx({ next: makeUnit(3, { lang: "en" }) }), "merge_prev").enabled).toBe(true);
  });

  it("does not edit tables or figures, and read-only blocks everything", () => {
    expect(find(ctx({ target: makeUnit(2, { kind: "figure" }) }), "lang").reasonKey).toBe("assign.ctx.why.notText");
    const readOnly = buildAssignMenu(ctx({ readOnly: true, hasDestination: true, rowStatus: "confirmed" }));
    expect([...readOnly.assign, ...readOnly.edit].every((item) => item.reasonKey === "assign.ctx.why.readOnly")).toBe(true);
  });

  it("explains a sentence too short to split and carries the current language", () => {
    expect(find(ctx({ canSplit: false }), "split").reasonKey).toBe("assign.ctx.why.nothingToSplit");
    expect(find(ctx({ target: makeUnit(2, { lang: "en" }) }), "lang").lang).toBe("en");
  });
});

describe("findNearestCut", () => {
  const unit = makeUnit(1, { text: "ab cd", spans: [[1, 0, 5]] });

  it("keeps a valid point and snaps an invalid one to the nearest valid point", () => {
    expect(findNearestCut(unit, 2)).toBe(2);
    expect(findNearestCut(unit, 0)).toBe(1);
    expect(findNearestCut(unit, 9)).toBe(4);
  });

  it("returns null when the text cannot be split", () => {
    expect(findNearestCut(makeUnit(2, { text: "a", spans: [[1, 0, 1]] }), 0)).toBeNull();
  });
});

describe("KO/EN pairing from the Assign menu", () => {
  it("offers pairing instead of merging when the neighbour is the other language", () => {
    const groups = buildAssignMenu(ctx({ next: makeUnit(3, { lang: "en" }) }));

    expect(groups.edit.map((item) => item.action)).toEqual(["split", "merge_prev", "pair_next", "pair_pick", "lang", "ref_mark"]);
    expect(find(ctx({ next: makeUnit(3, { lang: "en" }) }), "pair_next").enabled).toBe(true);
    expect(find(ctx({ target: makeUnit(2, { lang: "en" }), prev: makeUnit(1) }), "pair_prev").enabled).toBe(true);
  });

  it("says why a pair cannot be made", () => {
    const paired = ctx({ next: makeUnit(3, { lang: "en", pair_id: 7 }) });
    const assigned = ctx({ next: makeUnit(3, { lang: "en" }), isDecided: (unit) => unit.id === 3 });
    const locked = ctx({ next: makeUnit(3, { lang: "en" }), readOnly: true });

    expect(find(paired, "pair_next").reasonKey).toBe("split.menu.why.alreadyPaired");
    expect(find(assigned, "pair_next").reasonKey).toBe("assign.ctx.why.neighborAssigned");
    expect(find(locked, "pair_next").reasonKey).toBe("assign.ctx.why.readOnly");
  });

  it("offers picking a far-away partner only on an unpaired KO or EN sentence", () => {
    expect(find(ctx(), "pair_pick").enabled).toBe(true);
    expect(find(ctx({ isDecided: (unit) => unit.id === 2 }), "pair_pick").reasonKey).toBe("assign.ctx.why.assigned");
    expect(buildAssignMenu(ctx({ target: makeUnit(2, { pair_id: 7 }) })).edit.some((item) => item.action === "pair_pick")).toBe(false);
    expect(buildAssignMenu(ctx({ target: makeUnit(2, { lang: "none" as ViewUnit["lang"] }) })).edit.some((item) => item.action === "pair_pick")).toBe(false);
  });

  it("offers Separate only on a paired sentence, with the same edit rules", () => {
    const paired = ctx({ target: makeUnit(2, { pair_id: 7 }), next: makeUnit(3, { lang: "en", pair_id: 7 }) });

    expect(buildAssignMenu(ctx()).edit.some((item) => item.action === "unpair")).toBe(false);
    expect(buildAssignMenu(paired).edit.map((item) => item.action)).toEqual(["split", "merge_prev", "pair_next", "unpair", "lang", "ref_mark"]);
    expect(find(paired, "unpair").enabled).toBe(true);
    expect(find({ ...paired, isDecided: (unit) => unit.id === 2 }, "unpair").reasonKey).toBe("assign.ctx.why.assigned");
  });
});

describe("table rows from the Assign menu", () => {
  const table = makeUnit(10, { kind: "table", table_id: 4, lang: "none" as ViewUnit["lang"] });
  const row = makeUnit(11, { kind: "table_row", table_id: 4, row_index: 0, lang: "none" as ViewUnit["lang"] });

  it("shows only table items on a table or a row", () => {
    expect(buildAssignMenu(ctx({ target: table, table })).edit.map((item) => item.action)).toEqual(["table_rows", "table_layout"]);
    expect(buildAssignMenu(ctx({ target: row, table: row })).edit.map((item) => item.action)).toEqual(["table_merge"]);
    expect(find(ctx({ target: table, table }), "table_rows").enabled).toBe(true);
  });

  it("adds them after the sentence items on a cell sentence", () => {
    const cell = makeUnit(12, { kind: "cell_sentence", group_unit_id: 10 });

    expect(buildAssignMenu(ctx({ target: cell, table })).edit.map((item) => item.action)).toEqual(["split", "merge_prev", "merge_next", "pair_pick", "lang", "ref_mark", "table_rows", "table_layout"]);
  });

  it("locks them while the table has an unsaved pick or the bundle is read-only, not because it is assigned", () => {
    expect(find(ctx({ target: table, table, isDecided: (unit) => unit.id === 10 }), "table_rows").enabled).toBe(true);
    expect(find(ctx({ target: row, table: row, hasDraft: (unit) => unit.id === 11 }), "table_merge").reasonKey).toBe("assign.ctx.why.unsaved");
    expect(find(ctx({ target: table, table, readOnly: true }), "table_layout").reasonKey).toBe("assign.ctx.why.readOnly");
  });

  it("will not merge rows back while another row of the table is assigned or has an unsaved pick", () => {
    const other = makeUnit(13, { kind: "table_row", table_id: 4, row_index: 1, lang: "none" as ViewUnit["lang"] });
    const base = { target: row, table: row, tableRows: [row, other] };

    expect(find(ctx(base), "table_merge").enabled).toBe(true);
    expect(find(ctx({ ...base, isDecided: (unit) => unit.id === 13 }), "table_merge").reasonKey).toBe("assign.ctx.why.rowAssigned");
    expect(find(ctx({ ...base, hasDraft: (unit) => unit.id === 13 }), "table_merge").reasonKey).toBe("assign.ctx.why.rowUnsaved");
  });
});

describe("reference lines from the Assign menu", () => {
  const proposed = makeUnit(2, { lang: "en", ref: { state: "proposed", number: "SOP-A-1" } });
  const confirmed = makeUnit(2, { lang: "ref", ref: { state: "confirmed", number: "SOP-A-1" } });

  it("offers marking on plain text and Not a reference on a proposal or a reference", () => {
    expect(find(ctx(), "ref_mark").enabled).toBe(true);
    expect(find(ctx({ target: proposed }), "ref_clear").enabled).toBe(true);
    expect(find(ctx({ target: confirmed }), "ref_clear").enabled).toBe(true);
    expect(buildAssignMenu(ctx({ target: confirmed })).edit.some((item) => item.action === "ref_mark")).toBe(false);
  });

  it("lets a proposal be dismissed on an assigned line, but not a reference be changed", () => {
    const assigned = { isDecided: () => true, rowStatus: "confirmed" as const };

    expect(find(ctx({ target: proposed, ...assigned }), "ref_clear").enabled).toBe(true);
    expect(find(ctx({ target: confirmed, ...assigned }), "ref_clear")).toMatchObject({ enabled: false, reasonKey: "assign.ctx.why.assigned" });
    expect(find(ctx({ ...assigned }), "ref_mark")).toMatchObject({ enabled: false, reasonKey: "assign.ctx.why.assigned" });
    expect(find(ctx({ target: proposed, readOnly: true }), "ref_clear")).toMatchObject({ enabled: false, reasonKey: "assign.ctx.why.readOnly" });
  });

  it("has no language to pick and no far pairing on a reference", () => {
    expect(find(ctx({ target: confirmed }), "lang")).toMatchObject({ enabled: false, reasonKey: "assign.ctx.why.refLang", lang: "ref" });
    expect(buildAssignMenu(ctx({ target: confirmed })).edit.some((item) => item.action === "pair_pick")).toBe(false);
  });
});

describe("planAssignJoin (the button between two pieces)", () => {
  const free = { isDecided: () => false, hasDraft: () => false };
  const ko = makeUnit(1, { lang: "ko" });
  const koNext = makeUnit(2, { lang: "ko" });
  const en = makeUnit(3, { lang: "en" });

  it("merges same-language neighbours and pairs a KO/EN couple, as Edit original does", () => {
    expect(planAssignJoin(ko, koNext, free).kind).toBe("merge");
    expect(planAssignJoin(ko, en, free).kind).toBe("pair");
    expect(planAssignJoin(ko, undefined, free).kind).toBeNull();
  });

  it("merges an assigned sentence (the screen asks first) but will not pair one", () => {
    const decided = { isDecided: (unit: ViewUnit) => unit.id === 1, hasDraft: () => false };
    expect(planAssignJoin(ko, koNext, decided).kind).toBe("merge");
    expect(planAssignJoin(ko, en, decided)).toEqual({ kind: null, reasonKey: "assign.ctx.why.assigned" });
  });

  it("waits for an unsaved choice on either sentence", () => {
    const pending = { isDecided: () => false, hasDraft: (unit: ViewUnit) => unit.id === 2 };
    expect(planAssignJoin(ko, koNext, pending)).toEqual({ kind: null, reasonKey: "assign.ctx.why.unsaved" });
  });
});
