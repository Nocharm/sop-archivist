import { describe, expect, it } from "vitest";

import type { ViewUnit } from "./api-sop";
import { buildAssignMenu, type AssignMenuAction, type AssignMenuContext } from "./assign-context-menu-model";
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
    boundary_confirmed: false,
    status: null,
    pair_id: null,
    pos_seq: id,
    block_id: 1,
    is_edited: false,
    can_unmerge: false,
    split_suggestion_id: null,
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
    expect(groups.edit.map((item) => item.action)).toEqual(["split", "merge_prev", "merge_next", "lang"]);
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

  it("blocks edits on an assigned sentence and asks to cancel the assignment first", () => {
    const context = ctx({ rowStatus: "confirmed", isDecided: (unit) => unit.id === 2 });
    for (const action of ["split", "merge_prev", "merge_next", "lang"] as const) expect(find(context, action).reasonKey).toBe("assign.ctx.why.assigned");
  });

  it("blocks edits while the row has an unsaved choice", () => {
    expect(find(ctx({ hasDraft: (unit) => unit.id === 2 }), "split").reasonKey).toBe("assign.ctx.why.unsaved");
  });

  it("explains a blocked merge by the neighbour", () => {
    expect(find(ctx({ prev: null }), "merge_prev").reasonKey).toBe("assign.ctx.why.noNeighbor");
    expect(find(ctx({ isDecided: (unit) => unit.id === 3 }), "merge_next").reasonKey).toBe("assign.ctx.why.neighborAssigned");
    expect(find(ctx({ hasDraft: (unit) => unit.id === 1 }), "merge_prev").reasonKey).toBe("assign.ctx.why.neighborUnsaved");
    expect(find(ctx({ next: makeUnit(3, { kind: "table" }) }), "merge_next").reasonKey).toBe("assign.ctx.why.neighborNotText");
    // 언어가 다르면 합치기가 아니라 짝이다 - 짝은 Split에서 맺는다
    expect(find(ctx({ next: makeUnit(3, { lang: "en" }) }), "merge_next").reasonKey).toBe("assign.ctx.why.otherLanguage");
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
