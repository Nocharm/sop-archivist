import { describe, expect, it } from "vitest";

import { planReload } from "./assign-focus-model";
import { buildReloadAsk, isDocReload, isEmptyReload, mergeReloads, NO_RELOAD_ASK, splitReload } from "./reload-ask-model";

const ai = { aiOn: true };

describe("reload asks gathered while the queue runs (A1-R6)", () => {
  it("is empty until something asks", () => {
    expect(isEmptyReload(NO_RELOAD_ASK)).toBe(true);
    expect(isEmptyReload({ ...NO_RELOAD_ASK, bundle: true })).toBe(false);
    expect(isEmptyReload({ ...NO_RELOAD_ASK, docs: [4] })).toBe(false);
    expect(isDocReload({ docs: [], units: [] })).toBe(false);
    expect(isDocReload({ docs: [], units: "all" })).toBe(true);
  });
  it("five saves in a row still ask for one read of everything", () => {
    const save = { ...NO_RELOAD_ASK, units: "all" as const, lists: true, bundle: true };
    expect([save, save, save, save, save].reduce(mergeReloads, NO_RELOAD_ASK)).toEqual(save);
  });
  it("joins document lists without repeats, and all wins", () => {
    const merged = mergeReloads({ ...NO_RELOAD_ASK, docs: [4, 5], units: [4] }, { ...NO_RELOAD_ASK, docs: [5, 6], units: "all" });
    expect(merged.docs).toEqual([4, 5, 6]);
    expect(merged.units).toBe("all");
  });
  it("turns an Old edit's plan into its view and rows plus the lists behind", () => {
    const ask = buildReloadAsk(planReload({ kind: "old_edit", docId: 4, isInPlace: false, isReleased: false }, ai), [4, 5]);
    expect(ask).toEqual({ ...NO_RELOAD_ASK, docs: [4], units: [4], identical: true, split: true, bundle: true });
    const { views, rest } = splitReload(ask);
    expect(views).toEqual({ docs: [4], units: [4], solo: false });
    expect(isDocReload(rest)).toBe(false);
    expect(mergeReloads({ ...rest, ...views }, NO_RELOAD_ASK)).toEqual(ask);
  });
  it("reads the New document's own view instead when the edited document is not an Old one", () => {
    expect(buildReloadAsk(planReload({ kind: "new_edit", docId: 9, isReleased: false }, ai), [4])).toEqual({ ...NO_RELOAD_ASK, solo: true, written: true, tobe: true });
    // 짝은 New 문서에서도 맺는다 - Unit이 바뀌니 New 문장 · To-Be도
    expect(buildReloadAsk(planReload({ kind: "pair", docId: 9 }, ai), [4])).toEqual({ ...NO_RELOAD_ASK, solo: true, written: true, tobe: true, bundle: true });
    expect(buildReloadAsk(planReload({ kind: "caption_ref", docId: 9 }, ai), [4])).toEqual({ ...NO_RELOAD_ASK, solo: true });
  });
  it("a New edit that released links reads every Old document too, with the New view (held Old rows)", () => {
    const ask = buildReloadAsk(planReload({ kind: "new_edit", docId: 9, isReleased: true }, ai), [4, 5]);
    expect(ask).toEqual({ ...NO_RELOAD_ASK, docs: "all", units: "all", solo: true, written: true, tobe: true, identical: true, bundle: true });
    expect(splitReload(ask).views).toEqual({ docs: "all", units: "all", solo: true });
  });
  it("an edit Undo reads every Old document", () => {
    expect(buildReloadAsk(planReload({ kind: "edit_undo", docId: null }, ai), [4, 5])).toMatchObject({ docs: "all", units: "all", identical: true, bundle: true, solo: false });
  });
});
