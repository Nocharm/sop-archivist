import { describe, expect, it } from "vitest";

import type { ViewUnit } from "./api-sop";
import { getPairMergeReason, hasBothScripts, pickEnglishSide, planJoin, planPairLanguages } from "./split-menu-model";

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
    is_edited: false, can_unmerge: false,
    split_suggestion_id: null, ref: null, caption_refs: [],
    ...over,
  };
}

describe("planJoin", () => {
  it("merges adjacent units of one language", () =>
    expect(planJoin([makeUnit(1), makeUnit(2)], true)).toEqual({ kind: "merge" }));
  it("pairs units of different languages, adjacent or not", () => {
    expect(planJoin([makeUnit(1), makeUnit(2, { lang: "en" })], true)).toEqual({ kind: "pair" });
    expect(planJoin([makeUnit(1), makeUnit(9, { lang: "en" })], false)).toEqual({ kind: "pair" });
  });
  it("does not merge far-apart units of one language", () =>
    expect(planJoin([makeUnit(1), makeUnit(9)], false)).toEqual({ kind: null, reasonKey: "split.menu.why.notAdjacent" }));
  it("does not join a unit that is already in another pair", () =>
    expect(planJoin([makeUnit(1, { pair_id: 7 }), makeUnit(2, { lang: "en" })], true)).toEqual({ kind: null, reasonKey: "split.menu.why.alreadyPaired" }));
  it("pairs one KO with two EN", () =>
    expect(planJoin([makeUnit(1), makeUnit(2, { lang: "en" }), makeUnit(3, { lang: "en" })], true)).toEqual({ kind: "pair" }));
  it("refuses non-text units, a neutral unit beside a KO one, and the merge rules", () => {
    expect(planJoin([makeUnit(1), makeUnit(2, { kind: "table", lang: "neutral" })], true)).toEqual({ kind: null, reasonKey: "split.menu.why.notText" });
    expect(planJoin([makeUnit(1), makeUnit(2, { lang: "neutral" })], true)).toEqual({ kind: null, reasonKey: "split.menu.why.noLanguage" });
    const cells = [makeUnit(1, { kind: "cell_sentence", group_unit_id: 5 }), makeUnit(2, { kind: "cell_sentence", group_unit_id: 6 })];
    expect(planJoin(cells, true)).toEqual({ kind: null, reasonKey: "split.noMergeCell" });
  });
});
describe("getPairMergeReason", () => {
  const order = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  it("lets a pair whose members are neighbours become one sentence", () => {
    expect(getPairMergeReason([makeUnit(3, { pair_id: 7 }), makeUnit(2, { lang: "en", pair_id: 7 })], order)).toBeNull();
    expect(getPairMergeReason([makeUnit(4, { pair_id: 7 }), makeUnit(5, { lang: "en", pair_id: 7 }), makeUnit(6, { lang: "en", pair_id: 7 })], order)).toBeNull();
  });
  it("does not merge a pair whose members are far apart", () => {
    expect(getPairMergeReason([makeUnit(1, { pair_id: 7 }), makeUnit(9, { lang: "en", pair_id: 7 })], order)).toBe("split.menu.why.notAdjacent");
    expect(getPairMergeReason([makeUnit(1, { pair_id: 7 }), makeUnit(2, { lang: "en", pair_id: 7 }), makeUnit(4, { lang: "en", pair_id: 7 })], order)).toBe("split.menu.why.notAdjacent");
  });
  it("gives the merge rule's reason for neighbours that cannot merge", () => {
    const cells = [makeUnit(1, { kind: "cell_sentence", group_unit_id: 5, pair_id: 7 }), makeUnit(2, { kind: "cell_sentence", lang: "en", group_unit_id: 6, pair_id: 7 })];
    expect(getPairMergeReason(cells, order)).toBe("split.noMergeCell");
  });
});
describe("pickEnglishSide", () => {
  it("picks the unit with the most Latin letters", () =>
    expect(pickEnglishSide([{ id: 1, text: "로터를 닦는다" }, { id: 2, text: "Wipe the rotor 로터" }])).toBe(2));
  it("returns null when no unit has Latin letters", () =>
    expect(pickEnglishSide([{ id: 1, text: "가" }, { id: 2, text: "나" }])).toBeNull());
});
describe("planPairLanguages (languages to fix before pairing what an unmerge restored)", () => {
  it("changes nothing when the two already read as KO and EN", () =>
    expect(planPairLanguages([makeUnit(1, { lang: "ko" }), makeUnit(2, { lang: "en" })])).toEqual([]));
  it("makes the most Latin side EN and the rest KO when both were read as one language", () => {
    const units = [makeUnit(1, { lang: "ko", text: "로터를 닦는다" }), makeUnit(2, { lang: "ko", text: "Wipe the rotor" })];
    expect(planPairLanguages(units)).toEqual([{ lang: "en", unitIds: [2] }]);
    const neutral = [makeUnit(1, { lang: "neutral", text: "로터를 닦는다" }), makeUnit(2, { lang: "neutral", text: "Wipe the rotor" })];
    expect(planPairLanguages(neutral)).toEqual([{ lang: "en", unitIds: [2] }, { lang: "ko", unitIds: [1] }]);
  });
  it("cannot decide without any Latin letters", () =>
    expect(planPairLanguages([makeUnit(1, { text: "가" }), makeUnit(2, { text: "나" })])).toBeNull());
});
it("hasBothScripts", () => {
  expect(hasBothScripts("로터 rotor")).toBe(true);
  expect(hasBothScripts("rotor 70%")).toBe(false);
});
