import { describe, expect, it } from "vitest";

import {
  applyLoaded,
  canStart,
  INITIAL_FOCUS_STATE,
  isSameFocus,
  isUnitLocked,
  listEditUnitIds,
  NO_FOCUS,
  NO_PLACE,
  planReload,
  readEditKind,
  reduceFocus,
  type Focus,
  type FocusEvent,
  type FocusState,
  type LoadedDoc,
  type Pending,
} from "./assign-focus-model";

const unit = (unitId: number, docId = 1): Focus => ({ kind: "unit", docId, unitId });
const job = (id: string, over: Partial<Pending> = {}): Pending => ({ id, kind: "join", docId: 1, unitIds: [], place: NO_PLACE, isGlobal: false, ...over });
const doc = (docId: number, revision: number, ids: number[]): LoadedDoc => ({ docId, revision, unitIds: new Set(ids) });
const loaded = (docs: LoadedDoc[], liftUnit: (id: number) => number | null = (id) => (docs.some((item) => item.unitIds.has(id)) ? id : null)): Extract<FocusEvent, { type: "loaded" }> => ({ type: "loaded", docs, liftUnit });
const run = (...events: FocusEvent[]): FocusState => events.reduce(reduceFocus, INITIAL_FOCUS_STATE);
const pick = (focus: Focus): FocusEvent => ({ type: "pick", focus });
const start = (pending: Pending): FocusEvent => ({ type: "start", pending });
const succeed = (pendingId: string, pickUnitId: number | null, over: { docId?: number | null; revision?: number | null } = {}): FocusEvent => ({ type: "succeed", pendingId, docId: 1, revision: 5, pickUnitId, ...over });

describe("pick (rule 1)", () => {
  it("holds one focus at a time - a toc block or a New document replaces the picked box", () => {
    expect(run(pick(unit(3)), pick({ kind: "toc", docId: 1, key: 9, unitId: null })).focus).toEqual({ kind: "toc", docId: 1, key: 9, unitId: null });
    expect(run(pick(unit(3)), pick({ kind: "new", docId: 7, unitId: null, inPlace: false })).focus.kind).toBe("new");
  });
  it("keeps the same state object when the same thing is picked again", () => {
    const state = run(pick(unit(3)));
    expect(reduceFocus(state, pick(unit(3)))).toBe(state);
  });
  it("compares every field of a focus", () => {
    expect(isSameFocus(unit(3, 1), unit(3, 2))).toBe(false);
    expect(isSameFocus({ kind: "new", docId: 7, unitId: 1, inPlace: true }, { kind: "new", docId: 7, unitId: 1, inPlace: false })).toBe(false);
    expect(isSameFocus(NO_FOCUS, NO_FOCUS)).toBe(true);
  });
});

describe("start keeps the focus (rule 2)", () => {
  it("does not touch the focus while an edit is pending", () => {
    const state = run(pick(unit(3)), start(job("a", { unitIds: [3, 4] })));
    expect(state.focus).toEqual(unit(3));
    expect(state.pending.map((entry) => entry.from)).toEqual([unit(3)]);
  });
  it("ignores a second start with the same id", () => {
    const state = run(start(job("a")));
    expect(reduceFocus(state, start(job("a")))).toBe(state);
  });
});

describe("follow (rule 3)", () => {
  it("picks the response's box once its document comes back at that revision", () => {
    const waiting = run(pick(unit(3)), start(job("a")), succeed("a", 10));
    expect(waiting.pending).toEqual([]);
    expect(waiting.follows.map((follow) => follow.kind)).toEqual(["join"]);
    // 낡은 판(늦게 온 앞 보기)은 기다린다
    expect(reduceFocus(waiting, loaded([doc(1, 4, [3, 4])])).focus).toEqual(unit(3));
    const after = applyLoaded(waiting, loaded([doc(1, 5, [10, 11])]));
    expect(after.state.focus).toEqual(unit(10));
    expect(after.picked?.pickUnitId).toBe(10);
    expect(after.state.follows).toEqual([]);
  });
  it("does not follow when someone picked another box before the response", () => {
    const state = run(pick(unit(3)), start(job("a")), pick(unit(8)), succeed("a", 10));
    expect(state.follows).toEqual([]);
    expect(state.focus).toEqual(unit(8));
  });
  it("drops the follow when someone picks another box after the response", () => {
    const state = run(pick(unit(3)), start(job("a")), succeed("a", 10), pick(unit(8)));
    expect(state.follows).toEqual([]);
    expect(reduceFocus(state, loaded([doc(1, 5, [8, 10])])).focus).toEqual(unit(8));
  });
  it("keeps the focus when the response names no box", () => {
    const state = run(pick(unit(3)), start(job("a")), succeed("a", null), loaded([doc(1, 5, [3])]));
    expect(state.focus).toEqual(unit(3));
  });
  it("lifts a box with no row to its group (a table cell to its table)", () => {
    const waiting = run(pick(unit(3)), start(job("a")), succeed("a", 21));
    expect(reduceFocus(waiting, loaded([doc(1, 5, [20, 21])], (id) => (id === 21 ? 20 : id))).focus).toEqual(unit(20));
  });
  it("finds the box in whichever document came back when the response named none (Undo)", () => {
    const waiting = run(pick(unit(3)), start(job("u", { kind: "undo", isGlobal: true })), succeed("u", 40, { docId: null, revision: null }));
    expect(reduceFocus(waiting, loaded([doc(1, 9, [3]), doc(2, 4, [40])])).focus).toEqual(unit(40, 2));
  });
  it("follows inside the New document it was started from, and nowhere else", () => {
    const from: Focus = { kind: "new", docId: 7, unitId: 1, inPlace: true };
    const waiting = run(pick(from), start(job("a", { docId: 7 })), succeed("a", 2, { docId: 7 }));
    expect(reduceFocus(waiting, loaded([doc(7, 5, [2])])).focus).toEqual({ ...from, unitId: 2 });
    const elsewhere = run(pick(from), start(job("b")), succeed("b", 2, { docId: 1 }));
    expect(reduceFocus(elsewhere, loaded([doc(1, 5, [2])])).focus).toEqual(from);
  });
  it("follows from no focus too (the toc block was let go before the edit)", () => {
    const state = run(pick({ kind: "toc", docId: 1, key: 5, unitId: null }), pick(NO_FOCUS), start(job("a", { kind: "toc" })), succeed("a", 5), loaded([doc(1, 5, [5])]));
    expect(state.focus).toEqual(unit(5));
  });
  it("leaves a follow for another document waiting", () => {
    const waiting = run(pick(unit(3)), start(job("a", { docId: 2 })), succeed("a", 10, { docId: 2 }));
    const state = reduceFocus(waiting, loaded([doc(1, 9, [3])]));
    expect(state.follows).toHaveLength(1);
  });
});

describe("fail (rule 4)", () => {
  it("removes only that pending and keeps the focus and the follows", () => {
    const waiting = run(pick(unit(3)), start(job("a")), succeed("a", 10), start(job("b")));
    const state = reduceFocus(waiting, { type: "fail", pendingId: "b" });
    expect(state.pending).toEqual([]);
    expect(state.follows).toHaveLength(1);
    expect(state.focus).toEqual(unit(3));
  });
  it("is a no-op after succeed (the caller always ends in finally)", () => {
    const state = run(pick(unit(3)), start(job("a")), succeed("a", 10));
    expect(reduceFocus(state, { type: "fail", pendingId: "a" })).toBe(state);
  });
});

describe("a vanished unit is never selected (rule 5)", () => {
  it("lets go of a box its document no longer has", () => {
    expect(run(pick(unit(3)), loaded([doc(1, 5, [4])])).focus).toEqual(NO_FOCUS);
  });
  it("keeps a box when another document came back", () => {
    expect(run(pick(unit(3)), loaded([doc(2, 5, [4])])).focus).toEqual(unit(3));
  });
  it("keeps the retired box while its own follow still waits, then moves to the follow", () => {
    const waiting = run(pick(unit(3)), start(job("a", { docId: 2 })), succeed("a", 10, { docId: 2 }));
    // 다른 문서(1)가 먼저 오고 고른 3이 거기 없어도, 3에서 건 따라가기가 기다리면 둔다
    expect(reduceFocus(waiting, loaded([doc(1, 5, [4])])).focus).toEqual(unit(3));
  });
  it("does not pick a follow whose box is gone, and lets go of the retired focus", () => {
    const state = run(pick(unit(3)), start(job("a")), succeed("a", 10), loaded([doc(1, 5, [11])]));
    expect(state.focus).toEqual(NO_FOCUS);
    expect(state.follows).toEqual([]);
  });
  it("keeps a toc block or a New document open but drops the line that went away", () => {
    expect(run(pick({ kind: "toc", docId: 1, key: 5, unitId: 6 }), loaded([doc(1, 5, [5])])).focus).toEqual({ kind: "toc", docId: 1, key: 5, unitId: null });
    expect(run(pick({ kind: "toc", docId: 1, key: 5, unitId: null }), loaded([doc(1, 5, [6])])).focus).toEqual(NO_FOCUS);
    expect(run(pick({ kind: "new", docId: 7, unitId: 2, inPlace: false }), loaded([doc(7, 5, [3])])).focus).toEqual({ kind: "new", docId: 7, unitId: null, inPlace: false });
  });
  it("returns the same state when nothing changed", () => {
    const state = run(pick(unit(3)));
    expect(reduceFocus(state, loaded([doc(1, 5, [3])]))).toBe(state);
  });
});

describe("locks (rule 6)", () => {
  it("locks only the units of pending work", () => {
    const state = run(start(job("a", { unitIds: [3, 4] })));
    expect(isUnitLocked(state, 3)).toBe(true);
    expect(isUnitLocked(state, 5)).toBe(false);
  });
  it("starts work on other units but not on a locked one", () => {
    const state = run(start(job("a", { unitIds: [3, 4] })));
    expect(canStart(state, job("b", { unitIds: [5] }))).toBe(true);
    expect(canStart(state, job("b", { unitIds: [4, 5] }))).toBe(false);
    expect(canStart(INITIAL_FOCUS_STATE, job("b", { isGlobal: true }))).toBe(true);
  });
  it("never runs global work beside other work", () => {
    expect(canStart(run(start(job("a", { unitIds: [3] }))), job("g", { isGlobal: true }))).toBe(false);
    expect(canStart(run(start(job("g", { isGlobal: true }))), job("b", { unitIds: [9] }))).toBe(false);
  });
  it("drops older follows when global work starts - Undo may retire the box they would pick", () => {
    const state = run(pick(unit(3)), start(job("a")), succeed("a", 10), start(job("u", { kind: "undo", isGlobal: true })));
    expect(state.follows).toEqual([]);
    expect(state.focus).toEqual(unit(3));
  });
});

describe("readEditKind · listEditUnitIds", () => {
  it("names the pending kind of each edit", () => {
    expect(readEditKind({ type: "merge", unit_ids: [1, 2] })).toBe("join");
    expect(readEditKind({ type: "split", unit_id: 1, at: 3 })).toBe("split");
    expect(readEditKind({ type: "set_layout_table", table_id: 4, is_layout: true })).toBe("unwrap");
    expect(readEditKind({ type: "set_layout_table", table_id: 4, is_layout: false })).toBe("rewrap");
    expect(readEditKind({ type: "set_number", unit_id: 1, number: null, follow: false })).toBe("ref");
    expect(readEditKind({ type: "clear_noise", unit_ids: [1] })).toBe("toc");
  });
  it("lists the units an edit points at", () => {
    expect(listEditUnitIds({ type: "merge", unit_ids: [1, 2] })).toEqual([1, 2]);
    expect(listEditUnitIds({ type: "move_boundary", left_unit_id: 1, right_unit_id: 2, at: 3 })).toEqual([1, 2]);
    expect(listEditUnitIds({ type: "attach_caption", unit_id: 5, bundle_unit_id: 6 })).toEqual([5, 6]);
    expect(listEditUnitIds({ type: "carve", block_id: 1, start: 0, end: 3 })).toEqual([]);
  });
});

describe("planReload (D2 table)", () => {
  const ai = { aiOn: true };
  const off = { aiOn: false };
  it("an Old structure edit waits for that document's view and rows only, then refreshes the bundle, same-text candidates and AI split offers behind", () => {
    expect(planReload({ kind: "old_edit", docId: 4, isInPlace: false, isReleased: false }, ai)).toEqual({
      docs: [4], units: true, newDoc: null, written: false, tobe: false, identical: true, splitSuggestions: 4, bundle: true,
    });
    expect(planReload({ kind: "old_edit", docId: 4, isInPlace: false, isReleased: false }, off).splitSuggestions).toBeNull();
  });
  it("an in-place edit (language, reference, number) refreshes only the bundle behind", () => {
    expect(planReload({ kind: "old_edit", docId: 4, isInPlace: true, isReleased: false }, ai)).toEqual({
      docs: [4], units: true, newDoc: null, written: false, tobe: false, identical: false, splitSuggestions: null, bundle: true,
    });
  });
  it("an edit that released decisions also refreshes To-Be, the New sentences and same-text candidates", () => {
    const plan = planReload({ kind: "old_edit", docId: 4, isInPlace: false, isReleased: true }, ai);
    expect(plan).toMatchObject({ docs: [4], units: true, tobe: true, written: true, identical: true, splitSuggestions: 4, bundle: true });
    expect(planReload({ kind: "old_edit", docId: 4, isInPlace: true, isReleased: true }, ai)).toMatchObject({ tobe: true, written: true, identical: true, splitSuggestions: null });
  });
  it("pairing waits for the view and rows and refreshes the bundle", () => {
    expect(planReload({ kind: "pair", docId: 4 }, ai)).toEqual({ docs: [4], units: true, newDoc: null, written: false, tobe: false, identical: false, splitSuggestions: null, bundle: true });
  });
  it("a caption reference change waits for the view only", () => {
    expect(planReload({ kind: "caption_ref", docId: 4 }, ai)).toEqual({ docs: [4], units: false, newDoc: null, written: false, tobe: false, identical: false, splitSuggestions: null, bundle: false });
  });
  it("an applied AI split is an Old structure edit, a dismissed one reloads the view and the offers", () => {
    expect(planReload({ kind: "split_suggestion", docId: 4, isApplied: true }, ai)).toEqual(planReload({ kind: "old_edit", docId: 4, isInPlace: false, isReleased: false }, ai));
    expect(planReload({ kind: "split_suggestion", docId: 4, isApplied: false }, ai)).toEqual({ docs: [4], units: false, newDoc: null, written: false, tobe: false, identical: false, splitSuggestions: 4, bundle: false });
  });
  it("a New document edit waits for that document and the New sentences, To-Be behind", () => {
    expect(planReload({ kind: "new_edit", docId: 9 }, ai)).toEqual({ docs: [], units: false, newDoc: 9, written: true, tobe: true, identical: false, splitSuggestions: null, bundle: false });
  });
  it("an edit Undo reloads every Old document when the response does not name one", () => {
    expect(planReload({ kind: "edit_undo", docId: null }, ai)).toEqual({ docs: "all", units: true, newDoc: null, written: false, tobe: false, identical: true, splitSuggestions: null, bundle: true });
    expect(planReload({ kind: "edit_undo", docId: 4 }, ai).docs).toEqual([4]);
  });
});

describe("loaded with only the edited document", () => {
  it("follows the merged box from that document's batch and leaves a focus in another document alone", () => {
    // Join in doc 1 - the batch carries doc 1's view and rows together, so the follow lands in one event
    const waiting = run(pick(unit(3)), start(job("a", { unitIds: [3, 4] })), succeed("a", 10));
    expect(run(pick(unit(3)), start(job("a", { unitIds: [3, 4] })), succeed("a", 10), loaded([doc(1, 5, [10, 5])])).focus).toEqual(unit(10));
    expect(reduceFocus(waiting, loaded([doc(2, 9, [7])])).focus).toEqual(unit(3));
    // a box in doc 2 is not dropped by a batch that did not carry doc 2
    expect(run(pick(unit(7, 2)), loaded([doc(1, 5, [10])])).focus).toEqual(unit(7, 2));
  });
});
