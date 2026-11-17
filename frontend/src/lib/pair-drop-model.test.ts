import { describe, expect, it } from "vitest";
import type { ViewUnit } from "./api-sop";
import { getPairPickBlocker } from "./assign-context-menu-model";
import { MESSAGES } from "./i18n-messages";
import {
  PAIR_REFUSAL_KEYS,
  buildPairColumns,
  canUndoPair,
  listPairLinks,
  resolvePairDrop,
  type PairColumnItem,
  type PairDrop,
  type PairDropContext,
  type PairInfo,
  type PairPiece,
  type PairRefusal,
  type PairUnit,
} from "./pair-drop-model";

const piece = (id: number, lang: PairPiece["lang"], kind: PairPiece["kind"] = "sentence", group_unit_id: number | null = null): PairPiece => ({ id, kind, lang, group_unit_id });
const KO1 = piece(1, "ko"), KO2 = piece(2, "ko"), EN1 = piece(11, "en"), EN2 = piece(12, "en"), EN3 = piece(13, "en");
const REF = piece(20, "ref"), BARE = piece(21, "neutral"), TABLE = piece(30, "neutral", "table"), CELL = piece(31, "en", "cell_sentence", 30);
const SUGGESTED: PairInfo = { id: 7, status: "suggested", unit_ids: [2, 12] };
const CONFIRMED: PairInfo = { id: 8, status: "confirmed", unit_ids: [2, 12] };
const WIDE: PairInfo = { id: 9, status: "suggested", unit_ids: [2, 12, 13] };   // 1:2 제안
const ctx = (pair?: PairInfo, over: Partial<PairDropContext> = {}): PairDropContext => ({
  pairOf: (id) => (pair?.unit_ids.includes(id) ? pair : undefined), isDecided: () => false, hasDraft: () => false, ...over,
});
const refused = (reason: PairRefusal) => ({ kind: "refused", reason });

describe("resolvePairDrop", () => {
  it("pairs two free pieces of opposite languages, in either direction", () => {
    expect(resolvePairDrop([KO1], EN1, ctx())).toEqual({ kind: "pair", unitIds: [1, 11] });
    expect(resolvePairDrop([EN1], KO1, ctx())).toEqual({ kind: "pair", unitIds: [11, 1] });
  });
  it("confirms a suggestion when one member is dropped on a member in the other language", () => {
    expect(resolvePairDrop([KO2], EN2, ctx(SUGGESTED))).toEqual({ kind: "confirm", pairId: 7 });
    expect(resolvePairDrop([EN2], KO2, ctx(SUGGESTED))).toEqual({ kind: "confirm", pairId: 7 });
    expect(resolvePairDrop([KO2], EN3, ctx(WIDE))).toEqual({ kind: "confirm", pairId: 9 });
    expect(resolvePairDrop([EN2], EN3, ctx(WIDE))).toEqual(refused("same_lang"));
  });
  it("is nowhere over itself, a table, a figure, a bound cell sentence or nothing", () => {
    expect(resolvePairDrop([KO1], KO1, ctx())).toEqual({ kind: "none" });
    expect(resolvePairDrop([KO1], TABLE, ctx())).toEqual({ kind: "none" });
    expect(resolvePairDrop([KO1], piece(40, "neutral", "figure"), ctx())).toEqual({ kind: "none" });
    expect(resolvePairDrop([KO1], CELL, ctx())).toEqual({ kind: "none" });
    expect(resolvePairDrop([KO1], undefined, ctx())).toEqual({ kind: "none" });
    expect(resolvePairDrop([TABLE], EN1, ctx())).toEqual({ kind: "none" });       // 표 줄을 끌면 Old 조각 어디서도 조용하다
  });
  it("refuses a pair row dragged in the Old pane, and is nowhere over its own pieces", () => {
    expect(resolvePairDrop([KO2, EN2], EN1, ctx(CONFIRMED))).toEqual(refused("paired"));
    expect(resolvePairDrop([KO2, EN2], EN1, ctx(SUGGESTED))).toEqual(refused("suggested_pair"));
    expect(resolvePairDrop([KO2, EN2], EN2, ctx(SUGGESTED))).toEqual({ kind: "none" });
  });
  it("never pairs a row of several units by one of them - a row holding a pair member is refused, any other is nowhere", () => {
    // 첫 Unit은 짝이 없고 둘째가 짝에 들었다 - 첫 Unit만으로 맺지 않는다
    expect(resolvePairDrop([KO1, EN2], EN1, ctx(CONFIRMED))).toEqual(refused("paired"));
    expect(resolvePairDrop([KO1, EN2], EN1, ctx(SUGGESTED))).toEqual(refused("suggested_pair"));
    // 구성원이 서로 다른 짝에 들었다 - 확정이 앞
    const split: PairDropContext = { ...ctx(), pairOf: (id) => (id === 1 ? { id: 5, status: "suggested", unit_ids: [1, 99] } : id === 12 ? CONFIRMED : undefined) };
    expect(resolvePairDrop([KO1, EN2], EN1, split)).toEqual(refused("paired"));
    // 아무 짝도 아닌 여러 Unit의 줄 - 놓을 자리 밖(짝 카드가 아니다)
    expect(resolvePairDrop([KO1, EN2], EN1, ctx())).toEqual({ kind: "none" });
    expect(resolvePairDrop([KO1, KO2], EN1, ctx())).toEqual({ kind: "none" });
  });
  it("refuses a piece with no language - a reference line with its own reason", () => {
    expect(resolvePairDrop([KO1], REF, ctx())).toEqual(refused("ref_line"));
    expect(resolvePairDrop([REF], EN1, ctx())).toEqual(refused("ref_line"));
    expect(resolvePairDrop([KO1], BARE, ctx())).toEqual(refused("no_language"));
  });
  it("refuses the same language before anything else about pairs or assignments", () => {
    expect(resolvePairDrop([KO1], KO2, ctx())).toEqual(refused("same_lang"));
    expect(resolvePairDrop([KO1], KO2, ctx(CONFIRMED, { isDecided: () => true }))).toEqual(refused("same_lang"));
  });
  it("refuses a confirmed pair on either end, even its own partner", () => {
    expect(resolvePairDrop([KO1], EN2, ctx(CONFIRMED))).toEqual(refused("paired"));
    expect(resolvePairDrop([KO2], EN1, ctx(CONFIRMED))).toEqual(refused("paired"));
    expect(resolvePairDrop([KO2], EN2, ctx(CONFIRMED))).toEqual(refused("paired"));
  });
  it("refuses a suggestion that points at another partner, on either end", () => {
    expect(resolvePairDrop([KO1], EN2, ctx(SUGGESTED))).toEqual(refused("suggested_pair"));
    expect(resolvePairDrop([KO2], EN1, ctx(SUGGESTED))).toEqual(refused("suggested_pair"));
  });
  it("refuses a decided unit, then an unsaved pick - the dragged end first", () => {
    const decided = (...ids: number[]) => ({ isDecided: (unit: PairPiece) => ids.includes(unit.id) });
    const drafted = (...ids: number[]) => ({ hasDraft: (unit: PairPiece) => ids.includes(unit.id) });
    expect(resolvePairDrop([KO1], EN1, ctx(undefined, decided(1, 11)))).toEqual(refused("assigned"));
    expect(resolvePairDrop([KO1], EN1, ctx(undefined, decided(11)))).toEqual(refused("other_assigned"));
    expect(resolvePairDrop([KO1], EN1, ctx(undefined, { ...decided(11), ...drafted(1) }))).toEqual(refused("other_assigned"));
    expect(resolvePairDrop([KO1], EN1, ctx(undefined, drafted(1, 11)))).toEqual(refused("unsaved"));
    expect(resolvePairDrop([KO1], EN1, ctx(undefined, drafted(11)))).toEqual(refused("other_unsaved"));
    expect(resolvePairDrop([KO2], EN2, ctx(SUGGESTED, decided(12)))).toEqual(refused("other_assigned"));   // 제안 확정도 같은 규칙
    expect(resolvePairDrop([KO1], EN2, ctx(CONFIRMED, decided(1)))).toEqual(refused("paired"));             // 짝이 배정보다 앞
  });
  it("names an existing message for every reason, in both languages", () => {
    expect(PAIR_REFUSAL_KEYS).toEqual({
      ref_line: "assign.ctx.why.refLang", no_language: "split.menu.why.noLanguage", same_lang: "assign.pairPickSameLang",
      paired: "rule.unit_already_paired", suggested_pair: "split.menu.why.alreadyPaired",
      assigned: "assign.ctx.why.assigned", other_assigned: "assign.ctx.why.neighborAssigned",
      unsaved: "assign.ctx.why.unsaved", other_unsaved: "assign.ctx.why.neighborUnsaved",
    });
    for (const key of Object.values(PAIR_REFUSAL_KEYS)) expect([typeof MESSAGES.en[key], typeof MESSAGES.ko[key]]).toEqual(["string", "string"]);
  });
});

const makeUnit = (id: number, lang: PairUnit["lang"], over: Partial<PairUnit> = {}): PairUnit => ({
  id, display_id: `OLD-3-${String(id).padStart(3, "0")}`, kind: "sentence", lang, text: `t${id}`, group_unit_id: null, pos_seq: id, spans: [[id, 0, 5]], status: "unassigned", ref: null, ...over,
});
const ids = (items: PairColumnItem[]) => items.map((item) => item.unit.id);

describe("buildPairColumns", () => {
  const view = {
    units: [
      makeUnit(6, "ko"), makeUnit(1, "ko"), makeUnit(2, "ref"), makeUnit(3, "neutral", { kind: "table", text: "" }),
      makeUnit(7, "en", { kind: "cell_sentence", group_unit_id: 3, pos_seq: 3 }), makeUnit(4, "en"), makeUnit(5, "neutral", { kind: "figure" }),
    ],
    pairs: [{ id: 9, status: "suggested" as const, unit_ids: [1, 4] }],
  };
  it("splits a document by language in source order, and keeps units with no language in the flow they sit in", () => {
    const columns = buildPairColumns(view);
    expect([ids(columns.ko), ids(columns.en)]).toEqual([[1, 2, 3, 6], [4, 5]]);
    expect(columns.ko.map((item) => item.isPiece)).toEqual([true, false, false, true]);
    expect(columns.en.map((item) => item.isPiece)).toEqual([true, false]);
  });
  it("carries each unit's pair and its mates", () => {
    const columns = buildPairColumns(view);
    expect(columns.ko[0].pair).toEqual({ id: 9, status: "suggested", mateIds: [4] });
    expect(columns.en[0].pair).toEqual({ id: 9, status: "suggested", mateIds: [1] });
    expect(columns.ko[3].pair).toBeNull();
  });
  it("orders two units of one paragraph by where they start", () => {
    const columns = buildPairColumns({ units: [makeUnit(2, "ko", { pos_seq: 1, spans: [[1, 10, 20]] }), makeUnit(1, "ko", { pos_seq: 1, spans: [[1, 0, 9]] })], pairs: [] });
    expect(ids(columns.ko)).toEqual([1, 2]);
  });
  it("puts a leading unit with no language with the unit after it, and in KO when the document has no language at all", () => {
    const leading = buildPairColumns({ units: [makeUnit(1, "neutral", { kind: "figure" }), makeUnit(2, "en"), makeUnit(3, "ko")], pairs: [] });
    expect([ids(leading.ko), ids(leading.en)]).toEqual([[3], [1, 2]]);
    const bare = buildPairColumns({ units: [makeUnit(1, "neutral", { kind: "figure" })], pairs: [] });
    expect([ids(bare.ko), ids(bare.en)]).toEqual([[1], []]);
    expect(buildPairColumns({ units: [makeUnit(1, "ko")], pairs: [] }).en).toEqual([]);   // 한 언어뿐인 문서 - 빈 칸
  });
});

describe("listPairLinks", () => {
  it("draws one link per KO and EN member of a pair", () => {
    const columns = buildPairColumns({ units: [makeUnit(1, "ko"), makeUnit(4, "en"), makeUnit(8, "en")], pairs: [{ id: 5, status: "confirmed", unit_ids: [1, 4, 8] }] });
    expect(listPairLinks(columns)).toEqual([{ pairId: 5, koId: 1, enId: 4, status: "confirmed" }, { pairId: 5, koId: 1, enId: 8, status: "confirmed" }]);
    expect(listPairLinks(buildPairColumns({ units: [makeUnit(1, "ko")], pairs: [] }))).toEqual([]);
  });
});

describe("canUndoPair", () => {
  const paired = (status: PairUnit["status"] = "unassigned", pair: PairInfo = { id: 9, status: "confirmed", unit_ids: [1, 4] }) => ({ units: [makeUnit(1, "ko", { status }), makeUnit(4, "en")], pairs: [pair] });
  it("undoes a pair that is still the same confirmed pair of undecided units", () => {
    expect(canUndoPair(paired(), 9, [1, 4])).toBe(true);
    expect(canUndoPair(paired(), 9, [4, 1])).toBe(true);
    expect(canUndoPair(paired(null), 9, [1, 4])).toBe(true);
  });
  it("does not when the pair is gone, changed or one of its units was decided meanwhile", () => {
    expect(canUndoPair(paired(), 10, [1, 4])).toBe(false);
    expect(canUndoPair(paired("unassigned", { id: 9, status: "confirmed", unit_ids: [1, 4, 8] }), 9, [1, 4])).toBe(false);
    expect(canUndoPair(paired("unassigned", { id: 9, status: "suggested", unit_ids: [1, 4] }), 9, [1, 4])).toBe(false);
    expect(canUndoPair(paired("confirmed"), 9, [1, 4])).toBe(false);
    expect(canUndoPair(paired("ai_suggested"), 9, [1, 4])).toBe(false);
  });
  it("does not when a member is missing from the view it reads", () => {
    expect(canUndoPair({ units: [makeUnit(1, "ko")], pairs: [{ id: 9, status: "confirmed", unit_ids: [1, 4] }] }, 9, [1, 4])).toBe(false);
  });
});

describe("resolvePairDrop never pairs what the pair menu blocks (getPairPickBlocker)", () => {
  const viewUnit = (id: number, over: Partial<ViewUnit> = {}): ViewUnit => ({
    id, display_id: `OLD-1-${String(id).padStart(3, "0")}`, kind: "sentence", spans: [[id, 0, 5]], text: `t${id}`, lang: "ko", table_id: null, row_index: null,
    group_unit_id: null, status: "unassigned", pair_id: null, pos_seq: id, block_id: id, is_edited: false, can_unmerge: false, split_suggestion_id: null, ref: null, caption_refs: [], ...over,
  });
  const only = (id: number) => (unit: PairPiece) => unit.id === id;
  // [메뉴가 막는 까닭, 막힌 Unit, 상태, 끌기의 판단(끄는 쪽, 놓는 쪽)]
  const cases: [string, ViewUnit, Partial<PairDropContext>, PairDrop, PairDrop][] = [
    ["no language", viewUnit(1, { lang: "neutral" }), {}, refused("no_language") as PairDrop, refused("no_language") as PairDrop],
    ["a reference line", viewUnit(1, { lang: "ref" }), {}, refused("ref_line") as PairDrop, refused("ref_line") as PairDrop],
    ["not text - a table", viewUnit(1, { kind: "table", lang: "neutral" }), {}, { kind: "none" }, { kind: "none" }],
    ["not text - a figure", viewUnit(1, { kind: "figure", lang: "neutral" }), {}, { kind: "none" }, { kind: "none" }],
    ["decided", viewUnit(1), { isDecided: only(1) }, refused("assigned") as PairDrop, refused("other_assigned") as PairDrop],
    ["an unsaved pick", viewUnit(1), { hasDraft: only(1) }, refused("unsaved") as PairDrop, refused("other_unsaved") as PairDrop],
  ];
  it.each(cases)("%s: the menu blocks it and a drop refuses it from either end", (_, blocked, over, asSource, asTarget) => {
    const state = { isDecided: () => false, hasDraft: () => false, ...over };
    const partner = viewUnit(11, { lang: "en" });
    expect(getPairPickBlocker(blocked, state)).not.toBeNull();
    expect([resolvePairDrop([blocked], partner, ctx(undefined, over)), resolvePairDrop([partner], blocked, ctx(undefined, over))]).toEqual([asSource, asTarget]);
  });
  it("a unit the menu takes pairs by a drop", () => {
    const free = viewUnit(1);
    expect(getPairPickBlocker(free, { isDecided: () => false, hasDraft: () => false })).toBeNull();
    expect(resolvePairDrop([free], viewUnit(11, { lang: "en" }), ctx())).toEqual({ kind: "pair", unitIds: [1, 11] });
  });
  // 손으로 고른 표만으로는 메뉴에 나중에 더한 막음을 못 본다 - 종류 × 언어 × 배정 × 저장 전 고름을 모두 돌며 "메뉴가 막으면 끌기도 맺거나 확정하지 않는다"
  it("over every kind, language, decided and unsaved pick: whatever the menu blocks never pairs or confirms by a drop", () => {
    const kinds: ViewUnit["kind"][] = ["sentence", "heading", "figure", "table", "table_row", "cell_sentence"];
    const langs: ViewUnit["lang"][] = ["ko", "en", "ref", "neutral"];
    let blockedCount = 0;
    for (const kind of kinds) for (const lang of langs) for (const decided of [false, true]) for (const draft of [false, true]) {
      const unit = viewUnit(1, { kind, lang });
      const state = { isDecided: only(1), hasDraft: only(1) };
      const over: Partial<PairDropContext> = { isDecided: decided ? state.isDecided : () => false, hasDraft: draft ? state.hasDraft : () => false };
      if (getPairPickBlocker(unit, { isDecided: () => false, hasDraft: () => false, ...over }) === null) continue;
      blockedCount += 1;
      const partner = viewUnit(11, { lang: lang === "en" ? "ko" : "en" });
      for (const drop of [resolvePairDrop([unit], partner, ctx(undefined, over)), resolvePairDrop([partner], unit, ctx(undefined, over))]) {
        expect(["pair", "confirm"], `${kind}/${lang}/decided=${decided}/draft=${draft} -> ${JSON.stringify(drop)}`).not.toContain(drop.kind);
      }
    }
    // 96칸 중 메뉴가 받는 것은 글 종류 셋 × 한/영 둘 × 배정·고름 없음 하나뿐
    expect(blockedCount).toBe(96 - 6);
  });
});
