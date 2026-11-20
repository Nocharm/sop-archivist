import { describe, expect, it } from "vitest";

import type { ViewUnit } from "./api-sop";
import { buildAssignMenu, getPairPickBlocker, getPairSetBlocker, listShapeLineItems, planAssignJoin, planLanguageChange, planShapeMode, type AssignMenuAction, type AssignMenuContext } from "./assign-context-menu-model";
import { findNearestCut } from "./paper-model";

function makeUnit(id: number, over: Partial<ViewUnit> = {}): ViewUnit {
  return {
    id,
    number: null,
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
    split_suggestion_id: null, ref: null, caption_refs: [],
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
    expect(groups.assign.map((item) => item.action)).toEqual(["clear", "move", "delete"]);
    expect(groups.edit.map((item) => item.action)).toEqual(["split", "merge_prev", "merge_next", "pair_pick", "lang", "ref_mark", "to_heading"]);
  });

  it("enables every edit on an unassigned sentence with same-language neighbours", () => {
    const { edit } = buildAssignMenu(ctx());
    expect(edit.every((item) => item.enabled)).toBe(true);
  });

  it("cancels an assignment only when there is one", () => {
    expect(find(ctx(), "clear").reasonKey).toBe("assign.ctx.why.notAssigned");
    expect(find(ctx({ rowStatus: "ai_suggested" }), "clear").enabled).toBe(true);
    expect(find(ctx({ isDecided: () => true }), "clear").enabled).toBe(true);
  });

  it("calls Unassign 'Undo delete' on a deleted row and hides Delete - sentence, table and caption alike", () => {
    for (const target of [makeUnit(2), makeUnit(2, { kind: "table" }), makeUnit(2, { kind: "caption" })]) {
      const { assign } = buildAssignMenu(ctx({ target, rowStatus: "confirmed", isDeleted: true, isDecided: () => true }));
      expect(assign.map((item) => item.action)).toEqual(["clear", "move"]);
      expect(assign[0]).toMatchObject({ labelKey: "assign.ctx.undoDelete", enabled: true });
    }
    // 삭제가 아닌 줄은 그대로
    expect(buildAssignMenu(ctx({ rowStatus: "confirmed", isDeleted: false })).assign[0].labelKey).toBeUndefined();
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
    // 그림은 묶음 메뉴(캡션 도구)만 - 이웃한 글이 없으면 고칠 것이 없다
    expect(buildAssignMenu(ctx({ target: makeUnit(2, { kind: "figure" }), prev: null, next: null })).edit).toEqual([]);
    const readOnly = buildAssignMenu(ctx({ readOnly: true, rowStatus: "confirmed" }));
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

    expect(groups.edit.map((item) => item.action)).toEqual(["split", "merge_prev", "pair_next", "pair_pick", "lang", "ref_mark", "to_heading"]);
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
    expect(buildAssignMenu(paired).edit.map((item) => item.action)).toEqual(["split", "merge_prev", "pair_next", "unpair", "lang", "ref_mark", "to_heading"]);
    expect(find(paired, "unpair").enabled).toBe(true);
    expect(find({ ...paired, isDecided: (unit) => unit.id === 2 }, "unpair").reasonKey).toBe("assign.ctx.why.assigned");
  });
});

describe("table items from the Assign menu", () => {
  const table = makeUnit(10, { kind: "table", table_id: 4, lang: "none" as ViewUnit["lang"] });

  it("shows only table items on a table", () => {
    // 이웃한 글이 없는 표 - 캡션 붙이기 없이 표 항목만
    expect(buildAssignMenu(ctx({ target: table, table, prev: null, next: null })).edit.map((item) => item.action)).toEqual(["table_layout"]);
    expect(find(ctx({ target: table, table }), "table_layout").enabled).toBe(true);
  });

  it("adds them after the sentence items on a cell sentence", () => {
    const cell = makeUnit(12, { kind: "cell_sentence", group_unit_id: 10 });

    expect(buildAssignMenu(ctx({ target: cell, table })).edit.map((item) => item.action)).toEqual(["split", "merge_prev", "merge_next", "pair_pick", "lang", "ref_mark", "table_layout"]);
  });

  it("locks them while the table has an unsaved pick or the bundle is read-only, not because it is assigned", () => {
    expect(find(ctx({ target: table, table, isDecided: (unit) => unit.id === 10 }), "table_layout").enabled).toBe(true);
    expect(find(ctx({ target: table, table, hasDraft: (unit) => unit.id === 10 }), "table_layout").reasonKey).toBe("assign.ctx.why.unsaved");
    expect(find(ctx({ target: table, table, readOnly: true }), "table_layout").reasonKey).toBe("assign.ctx.why.readOnly");
  });
});

describe("captions from the Assign menu", () => {
  const table = makeUnit(10, { kind: "table", table_id: 4, lang: "none" as ViewUnit["lang"] });
  const figure = makeUnit(20, { kind: "figure", lang: "none" as ViewUnit["lang"] });
  const sentence = makeUnit(1);
  const caption = makeUnit(11, { kind: "caption", group_unit_id: 10 });

  it("offers to attach the sentence above as caption of a table", () => {
    const menu = buildAssignMenu(ctx({ target: table, table, prev: sentence, next: null }));
    expect(menu.edit.map((item) => item.action)).toEqual(["table_layout", "caption_attach_prev"]);
  });

  it("gives a figure the bundle menu, not the sentence menu", () => {
    const menu = buildAssignMenu(ctx({ target: figure, prev: sentence, next: makeUnit(21) }));
    expect(menu.edit.map((item) => item.action)).toEqual(["caption_attach_prev", "caption_attach_next"]);
  });

  it("offers nothing to attach when the neighbour is not free text", () => {
    const cell = makeUnit(12, { kind: "cell_sentence", group_unit_id: 30 });
    const ref = makeUnit(13, { lang: "ref", ref: { state: "confirmed", number: "SOP-A-1" } });
    expect(buildAssignMenu(ctx({ target: figure, prev: cell, next: ref })).edit).toEqual([]);
  });

  it("offers a sentence as caption of the table or figure next to it, with the right name", () => {
    const below = find(ctx({ prev: null, nextBundle: table }), "caption_attach_next");
    const above = find(ctx({ prevBundle: figure }), "caption_attach_prev");
    expect(below).toMatchObject({ enabled: true, labelKey: "assign.ctx.captionOfTableNext" });
    expect(above.labelKey).toBe("assign.ctx.captionOfFigurePrev");
    expect(buildAssignMenu(ctx()).edit.some((item) => item.action.startsWith("caption_"))).toBe(false);
  });

  it("will not take a second caption in the same language, and waits for unsaved picks", () => {
    const taken = { listCaptionLangs: () => ["ko"] as const };
    expect(find(ctx({ nextBundle: table, ...taken }), "caption_attach_next").reasonKey).toBe("assign.ctx.why.captionExists");
    expect(find(ctx({ target: table, table, prev: sentence, next: null, ...taken }), "caption_attach_prev").reasonKey).toBe("assign.ctx.why.captionExists");
    expect(find(ctx({ nextBundle: table, listCaptionLangs: () => ["en"] }), "caption_attach_next").enabled).toBe(true);
    expect(find(ctx({ target: table, table, prev: sentence, next: null, hasDraft: (unit) => unit.id === 1 }), "caption_attach_prev").reasonKey).toBe("assign.ctx.why.neighborUnsaved");
    expect(find(ctx({ nextBundle: table, hasDraft: (unit) => unit.id === 2 }), "caption_attach_next").reasonKey).toBe("assign.ctx.why.unsaved");
    expect(find(ctx({ nextBundle: table, hasDraft: (unit) => unit.id === 10 }), "caption_attach_next").reasonKey).toBe("assign.ctx.why.bundleUnsaved");
  });

  it("asks before attaching to an assigned bundle instead of refusing (the server asks once)", () => {
    expect(find(ctx({ target: table, table, prev: sentence, next: null, isDecided: (unit) => unit.id === 10 }), "caption_attach_prev").enabled).toBe(true);
  });

  it("offers detach on a caption and blocks it while a draft is open", () => {
    expect(find(ctx({ target: caption }), "caption_detach").enabled).toBe(true);
    expect(find(ctx({ target: caption, hasDraft: () => true }), "caption_detach").reasonKey).toBe("assign.ctx.why.unsaved");
    expect(find(ctx({ target: caption, readOnly: true }), "caption_detach").reasonKey).toBe("assign.ctx.why.readOnly");
  });

  it("will not detach a caption that sits inside an old figure block: dimmed in the menu, hidden in Shape", () => {
    const fixed = ctx({ target: caption, isFixedCaption: (unit) => unit.id === 11 });
    expect(find(fixed, "caption_detach").reasonKey).toBe("assign.ctx.why.captionInFigure");
    expect(listShapeLineItems(caption, buildAssignMenu(fixed).edit, false).map((item) => item.action)).toEqual(["split"]);
  });

  it("will not change a caption to a language another caption of its bundle already has, nor make it a reference", () => {
    const withEn = ctx({ target: caption, captionBundle: table, listCaptionLangs: () => ["ko", "en"] });
    expect(find(withEn, "lang").langReasons).toEqual({ en: "assign.ctx.why.captionExists", ref: "assign.ctx.why.captionNoRef" });
    expect(find(withEn, "lang").enabled).toBe(true);
    expect(find(ctx({ target: caption, captionBundle: table, listCaptionLangs: () => ["ko"] }), "lang").langReasons).toEqual({ ref: "assign.ctx.why.captionNoRef" });
  });

  it("splits a caption only between its Korean and English text, and only when no other caption has either language", () => {
    const bilingual = { ...caption, text: "표 1. 운전 조건 Table 1. Run conditions" };
    expect(find(ctx({ target: bilingual, captionBundle: table, listCaptionLangs: () => ["ko"] }), "split").enabled).toBe(true);
    // 한 언어뿐인 캡션은 나누면 같은 언어 캡션 둘이 된다 - 꺼 두고(다듬기에도 흐리게 보인다) 까닭을 단다
    const oneLang = ctx({ target: { ...caption, text: "표 1. 운전 조건" }, captionBundle: table, listCaptionLangs: () => ["ko"] });
    expect(find(oneLang, "split").reasonKey).toBe("assign.ctx.why.captionSplitOneLang");
    expect(listShapeLineItems(caption, buildAssignMenu(oneLang).edit, false).map((item) => item.action)).toContain("split");
    // 묶음에 영어 캡션이 따로 있으면 한/영 캡션을 나눈 영어 조각이 겹친다
    expect(find(ctx({ target: bilingual, captionBundle: table, listCaptionLangs: () => ["ko", "en"] }), "split").reasonKey).toBe("assign.ctx.why.captionSplitOneLang");
    // 목록에 이 캡션의 언어가 없어도 다른 캡션의 언어를 지우지 않는다
    expect(find(ctx({ target: bilingual, captionBundle: table, listCaptionLangs: () => ["en"] }), "split").reasonKey).toBe("assign.ctx.why.captionSplitOneLang");
  });

  it("keeps the sentence tools on a caption but no joins, pairing or reference", () => {
    expect(buildAssignMenu(ctx({ target: caption })).edit.map((item) => item.action)).toEqual(["split", "lang", "caption_detach"]);
  });

  it("does not merge a sentence into a caption or pick a caption as KO/EN partner", () => {
    expect(find(ctx({ next: caption }), "merge_next").reasonKey).toBe("assign.ctx.why.neighborNotText");
    expect(getPairPickBlocker(caption, { isDecided: () => false, hasDraft: () => false })).toBe("assign.ctx.why.notText");
  });

  it("shows the caption tools as Shape buttons - a table's caption attach moves to its caption slot (F12)", () => {
    expect(listShapeLineItems(caption, buildAssignMenu(ctx({ target: caption })).edit, false).map((item) => item.action)).toEqual(["split", "caption_detach"]);
    expect(listShapeLineItems(table, buildAssignMenu(ctx({ target: table, table, prev: sentence, next: null })).edit, false).map((item) => item.action)).toEqual(["table_layout"]);
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

describe("pairing sentences that are apart", () => {
  const free = { isDecided: () => false, hasDraft: () => false };

  it("takes any free Korean or English sentence into the pick", () => {
    expect(getPairPickBlocker(makeUnit(1), free)).toBeNull();
    expect(getPairPickBlocker(makeUnit(1, { lang: "en" }), free)).toBeNull();
  });

  it("says why a sentence cannot join the pick", () => {
    expect(getPairPickBlocker(makeUnit(1, { kind: "table" }), free)).toBe("assign.ctx.why.notText");
    expect(getPairPickBlocker(makeUnit(1, { lang: "neutral" }), free)).toBe("split.menu.why.noLanguage");
    expect(getPairPickBlocker(makeUnit(1, { pair_id: 3 }), free)).toBe("split.menu.why.alreadyPaired");
    expect(getPairPickBlocker(makeUnit(1), { ...free, isDecided: () => true })).toBe("assign.ctx.why.neighborAssigned");
    expect(getPairPickBlocker(makeUnit(1), { ...free, hasDraft: () => true })).toBe("assign.ctx.why.neighborUnsaved");
  });

  it("pairs two or more sentences once both languages are among them", () => {
    expect(getPairSetBlocker([makeUnit(1), makeUnit(5, { lang: "en" })])).toBeNull();
    expect(getPairSetBlocker([makeUnit(1), makeUnit(2), makeUnit(9, { lang: "en" })])).toBeNull();
  });

  it("asks for the other language when every picked sentence is in one", () => {
    expect(getPairSetBlocker([makeUnit(1), makeUnit(7)])).toBe("assign.pairPickSameLang");
  });
});

describe("planShapeMode (One sentence | KO/EN pair in the Shape step)", () => {
  const noDraft = () => false;

  it("offers nothing for a plain sentence or a table", () => {
    expect(planShapeMode([makeUnit(1)], [1], noDraft)).toBeNull();
    expect(planShapeMode([makeUnit(1, { kind: "table", can_unmerge: false })], [1], noDraft)).toBeNull();
    expect(planShapeMode([], [], noDraft)).toBeNull();
  });

  it("lets a neighbouring KO/EN pair become one sentence", () => {
    const pair = [makeUnit(1, { pair_id: 7 }), makeUnit(2, { lang: "en", pair_id: 7 })];
    expect(planShapeMode(pair, [1, 2], noDraft)).toEqual({ current: "pair", reasonKey: null });
  });

  it("will not merge a pair whose sentences are apart", () => {
    const pair = [makeUnit(1, { pair_id: 7 }), makeUnit(3, { lang: "en", pair_id: 7 })];
    expect(planShapeMode(pair, [1, 2, 3], noDraft)).toEqual({ current: "pair", reasonKey: "split.menu.why.notAdjacent" });
  });

  it("lets a merged sentence with both scripts go back to a pair", () => {
    expect(planShapeMode([makeUnit(1, { can_unmerge: true, text: "로터를 닦는다 Wipe the rotor" })], [1], noDraft)).toEqual({ current: "one", reasonKey: null });
    expect(planShapeMode([makeUnit(1, { can_unmerge: true, text: "로터를 닦는다" })], [1], noDraft)).toEqual({ current: "one", reasonKey: "split.menu.why.oneLanguage" });
  });

  it("waits for an unsaved choice on the line", () => {
    const pair = [makeUnit(1, { pair_id: 7 }), makeUnit(2, { lang: "en", pair_id: 7 })];
    expect(planShapeMode(pair, [1, 2], (unit) => unit.id === 2)).toEqual({ current: "pair", reasonKey: "assign.ctx.why.unsaved" });
  });
});

describe("listShapeLineItems (buttons on a Shape line)", () => {
  const actions = (unit: ViewUnit, context: AssignMenuContext, isPairRow = false) => listShapeLineItems(unit, buildAssignMenu(context).edit, isPairRow).map((item) => item.action);

  it("keeps only what can be done there, not joins with no neighbour or with its own partner", () => {
    const ko = makeUnit(2, { pair_id: 7 });
    const en = makeUnit(3, { lang: "en", pair_id: 7 });

    expect(actions(ko, ctx({ target: ko, prev: null, next: en }), true)).toEqual(["split"]);
    expect(actions(en, ctx({ target: en, prev: ko, next: makeUnit(4, { lang: "en" }) }), true)).toEqual(["split", "merge_next"]);
  });

  it("hides pairing with its own partner on an assigned pair row too", () => {
    const ko = makeUnit(2, { pair_id: 7 });
    const en = makeUnit(3, { lang: "en", pair_id: 7 });
    const assigned = { isDecided: () => true, rowStatus: "confirmed" as const };

    expect(find(ctx({ target: ko, prev: null, next: en, ...assigned }), "pair_next").reasonKey).toBe("split.menu.why.alreadyPaired");
    expect(actions(ko, ctx({ target: ko, prev: null, next: en, ...assigned }), true)).toEqual(["split"]);
  });

  it("shows Separate on the line only when the row is not a KO/EN pair row", () => {
    const ko = makeUnit(2, { pair_id: 7 });

    expect(actions(ko, ctx({ target: ko, prev: null, next: null }))).toContain("unpair");
    expect(actions(ko, ctx({ target: ko, prev: null, next: null }), true)).not.toContain("unpair");
  });

  it("keeps a button greyed out when something must be done first", () => {
    const items = listShapeLineItems(makeUnit(2), buildAssignMenu(ctx({ hasDraft: (unit) => unit.id === 3 })).edit, false);

    expect(items.find((item) => item.action === "merge_next")).toMatchObject({ enabled: false, reasonKey: "assign.ctx.why.neighborUnsaved" });
  });

  it("has no buttons on a reference line", () => {
    const ref = makeUnit(2, { lang: "ref", ref: { state: "confirmed", number: "SOP-A-1" } });

    expect(actions(ref, ctx({ target: ref, prev: makeUnit(1, { lang: "ref" }) }))).toEqual([]);
  });
});

describe("heading ↔ sentence (F8b)", () => {
  it("offers Turn into sentences on a heading and keeps it on the shape line", () => {
    const heading = makeUnit(2, { kind: "heading" });
    const item = find(ctx({ target: heading }), "to_sentence");

    expect(item.enabled).toBe(true);
    expect(listShapeLineItems(heading, buildAssignMenu(ctx({ target: heading })).edit, false).map((entry) => entry.action)).toContain("to_sentence");
  });

  it("names the way back Back to heading on a shifted sentence, and keeps it off the shape line", () => {
    const shifted = makeUnit(2, { from_heading: true });
    const item = find(ctx({ target: shifted }), "to_heading");

    expect(item.labelKey).toBe("assign.headingShift.back");
    expect(find(ctx(), "to_heading").labelKey).toBe("assign.ctx.toHeading");
    expect(listShapeLineItems(shifted, buildAssignMenu(ctx({ target: shifted })).edit, false).map((entry) => entry.action)).not.toContain("to_heading");
  });

  it("asks to save first and leaves contents, references and bound cells alone", () => {
    expect(find(ctx({ hasDraft: () => true }), "to_heading").reasonKey).toBe("assign.ctx.why.unsaved");
    for (const target of [makeUnit(2, { noise_kind: "toc" }), makeUnit(2, { kind: "cell_sentence", group_unit_id: 9 })]) {
      const { edit } = buildAssignMenu(ctx({ target }));
      expect(edit.some((entry) => entry.action === "to_heading" || entry.action === "to_sentence")).toBe(false);
    }
  });
});

describe("band heading line (F4)", () => {
  it("does not turn a band heading into sentences - its way back is Back to band table", () => {
    const band = makeUnit(2, { kind: "heading", table_id: 7 });
    const { edit } = buildAssignMenu(ctx({ target: band }));

    expect(edit.some((entry) => entry.action === "to_sentence" || entry.action === "to_heading")).toBe(false);
  });
});

describe("contents (TOC) lines", () => {
  // 사용자 결정(2026-11-19) - 목차 줄은 나누거나 합치지 않는다, 먼저 목차 아님(서버 422 toc_line_locked)
  const toc = makeUnit(2, { noise_kind: "toc" });

  it("greys out Split and merging on a contents line in the menu", () => {
    expect(find(ctx({ target: toc }), "split")).toMatchObject({ enabled: false, reasonKey: "assign.ctx.why.tocLine" });
    expect(find(ctx({ target: toc }), "merge_prev")).toMatchObject({ enabled: false, reasonKey: "assign.ctx.why.tocLine" });
  });

  it("will not merge a sentence into a contents line next to it", () => {
    expect(find(ctx({ next: makeUnit(3, { noise_kind: "toc" }) }), "merge_next")).toMatchObject({ enabled: false, reasonKey: "split.noMergeToc" });
  });

  it("shows no split or merge buttons on a contents line in Shape", () => {
    const actions = listShapeLineItems(toc, buildAssignMenu(ctx({ target: toc })).edit, false).map((item) => item.action);

    expect(actions.some((action) => action === "split" || action.startsWith("merge_"))).toBe(false);
  });
});


describe("planLanguageChange - a language change that changes the shape (B6)", () => {
  const ko = makeUnit(1, { lang: "ko", pair_id: 9 });
  const en = makeUnit(2, { lang: "en", pair_id: 9 });
  const en2 = makeUnit(3, { lang: "en", pair_id: 9 });

  it("merges a neighbour pair made one language, and only separates a far one", () => {
    expect(planLanguageChange(en, "ko", [ko, en], [1, 2])).toEqual({ kind: "switch", mergePair: true });
    expect(planLanguageChange(en, "ko", [ko, en], [1, 5, 2])).toEqual({ kind: "switch", mergePair: false });
  });
  it("does not merge a neighbour pair the merge rule blocks (a contents line)", () => {
    expect(planLanguageChange(en, "ko", [ko, { ...en, noise_kind: "toc" }], [1, 2])).toEqual({ kind: "switch", mergePair: false });
  });
  it("is a plain change when the pair keeps both languages, the unit has no pair, or the language is the same", () => {
    expect(planLanguageChange(en, "ko", [ko, en, en2], [1, 2, 3])).toEqual({ kind: "plain" });
    expect(planLanguageChange(makeUnit(4, { lang: "en" }), "ko", [], [4])).toEqual({ kind: "plain" });
    expect(planLanguageChange(ko, "ko", [ko, en], [1, 2])).toEqual({ kind: "plain" });
  });
});

describe("buildAssignMenu - language of an assigned pair member and each piece of a merged box (B6)", () => {
  const ko = makeUnit(1, { lang: "ko", pair_id: 9 });
  const en = makeUnit(2, { lang: "en", pair_id: 9 });
  const langOf = (menu: ReturnType<typeof buildAssignMenu>) => menu.edit.find((item) => item.action === "lang");
  const piecesOf = (menu: ReturnType<typeof buildAssignMenu>) => menu.edit.filter((item) => item.action === "piece_lang");

  it("keeps the shaping language open on an assigned pair member and the other one off", () => {
    const item = langOf(buildAssignMenu(ctx({ target: en, pairMembers: [ko, en], isDecided: () => true })));
    expect(item?.enabled).toBe(true);
    expect(item?.langReasons).toEqual({ en: "assign.ctx.why.assigned" });
  });
  it("keeps the whole row off on an assigned unit with no pair", () => {
    const item = langOf(buildAssignMenu(ctx({ target: makeUnit(2, { lang: "en" }), isDecided: () => true })));
    expect([item?.enabled, item?.reasonKey]).toEqual([false, "assign.ctx.why.assigned"]);
  });
  it("lists every piece of a merged box, the middle one off", () => {
    const merged = makeUnit(2, { lang: "ko", can_unmerge: true, merge_pieces: ["first", "middle", "last"] });
    const items = piecesOf(buildAssignMenu(ctx({ target: merged, isDecided: () => true })));
    expect(items.map((item) => [item.piece?.index, item.piece?.text, item.enabled, item.reasonKey ?? null, item.lang])).toEqual([
      [0, "first", true, null, "ko"], [1, "middle", false, "assign.ctx.why.middlePiece", "ko"], [2, "last", true, null, "ko"],
    ]);
  });
  it("has no piece rows for a box that was not merged, or whose pieces are gone", () => {
    expect(piecesOf(buildAssignMenu(ctx({ target: makeUnit(2, { merge_pieces: ["a", "b"] }) })))).toEqual([]);
    expect(piecesOf(buildAssignMenu(ctx({ target: makeUnit(2, { can_unmerge: true, merge_pieces: [] }) })))).toEqual([]);
  });
});
