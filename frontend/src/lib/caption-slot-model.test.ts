// 캡션 자리(F7) - 블록 자리 거리(서버 caption_slot.py와 같은 사례), 캡션 꼴 · 문장 같음, 한/영 나눌 자리, 후보 · 칩, 끌어 놓기 판단.
import { describe, expect, it } from "vitest";

import type { ViewBlock, ViewUnit } from "./api-sop";
import {
  buildBlockPlaces,
  buildCaptionSlot,
  findLangCut,
  getCaptionMotion,
  listCaptionHolders,
  isCaptionShaped,
  isSentenceLike,
  resolveCaptionDetach,
  resolveCaptionDrop,
  type CaptionSlotInput,
} from "./caption-slot-model";

function makeUnit(id: number, extra: Partial<ViewUnit> = {}): ViewUnit {
  return {
    id, display_id: `D-${id}`, kind: "sentence", spans: [], text: "", lang: "ko", number: null, table_id: null, row_index: null, group_unit_id: null, status: "unassigned",
    pair_id: null, pos_seq: id, block_id: id, is_edited: false, can_unmerge: false, split_suggestion_id: null, ref: null, caption_refs: [], ...extra,
  };
}

function block(id: number, seq: number, kind: ViewBlock["kind"], text: string, tableId: number | null = null): Pick<ViewBlock, "id" | "seq" | "kind" | "text" | "table_id"> {
  return { id, seq, kind, text, table_id: tableId };
}

/** 글 단위 - 블록 하나를 통째로 덮는다 */
function textUnit(id: number, blockId: number, text: string, extra: Partial<ViewUnit> = {}): ViewUnit {
  return makeUnit(id, { spans: [[blockId, 0, text.length]], text, block_id: blockId, pos_seq: blockId, ...extra });
}

// 캡션 꼴 문단 · 빈 문단 · 참고 문단 · 표(2행) · 뒤 문단
const FAR = "표 3. 소모품 목록";
const BLOCKS = [
  block(1, 0, "paragraph", FAR), block(2, 1, "paragraph", " "), block(3, 2, "paragraph", "이 표는 참고용이다."),
  block(4, 3, "table_cell", "부품", 10), block(5, 4, "table_cell", "합성 칸이다.", 10), block(6, 5, "paragraph", "합성 표 뒤 문장이다."),
];
const TABLE = makeUnit(20, { kind: "table", table_id: 10, block_id: 4, pos_seq: 4, lang: "neutral" });

function makeInput(extra: ViewUnit[] = [], overrides: Partial<CaptionSlotInput> = {}): CaptionSlotInput {
  const all = [
    textUnit(11, 1, FAR), textUnit(13, 3, "이 표는 참고용이다."), TABLE,
    textUnit(21, 4, "부품", { kind: "cell_sentence", group_unit_id: 20, table_id: 10, row_index: 0 }),
    textUnit(22, 5, "합성 칸이다.", { kind: "cell_sentence", group_unit_id: 20, table_id: 10, row_index: 1 }),
    textUnit(16, 6, "합성 표 뒤 문장이다."), ...extra,
  ];
  return {
    bundle: TABLE, units: new Map(all.map((unit) => [unit.id, unit])), places: buildBlockPlaces(BLOCKS, [{ id: 10, parent_table_id: null }]),
    cellTables: new Map(BLOCKS.filter((item) => item.kind === "table_cell").map((item) => [item.id, item.table_id])), written: [], ...overrides,
  };
}

describe("buildBlockPlaces", () => {
  it("counts a table (with its inner tables) once and skips empty paragraphs - same case as the backend", () => {
    const blocks = [
      block(1, 0, "paragraph", FAR), block(2, 1, "paragraph", "  "), block(3, 2, "paragraph", "참고"),
      block(4, 3, "table_cell", "a", 10), block(5, 4, "table_cell", "b", 11), block(6, 5, "table_cell", "c", 10),
      block(7, 6, "figure", ""), block(8, 7, "table_cell", "d", 12),
    ];
    const places = buildBlockPlaces(blocks, [{ id: 10, parent_table_id: null }, { id: 11, parent_table_id: 10 }, { id: 12, parent_table_id: null }]);
    expect(Object.fromEntries(places)).toEqual({ 1: 0, 3: 1, 4: 2, 5: 2, 6: 2, 7: 3, 8: 4 });
  });
});

describe("caption shape", () => {
  it("reads caption heads of the bundle's own kind only", () => {
    expect(isCaptionShaped("표 3. 소모품 목록", "table")).toBe(true);
    expect(isCaptionShaped("Table 3 Consumables", "table")).toBe(true);
    expect(isCaptionShaped("그림 1. 구조", "table")).toBe(false);
    expect(isCaptionShaped("Fig 2 Layout", "figure")).toBe(true);
    expect(isCaptionShaped("표 1에 따라 정한다.", "table")).toBe(false);
  });

  it("calls a caption sentence-like when it is not caption-shaped, or ends with a period with more than 40 characters after the number", () => {
    expect(isSentenceLike("표 2. 경보 목록", "table")).toBe(false);
    expect(isSentenceLike("경보 목록", "table")).toBe(true);
    expect(isSentenceLike("표 4. 이 표는 설비마다 점검 주기를 정한 것으로 모든 설비를 매월 한 번씩 확인하고 결과를 남겨야 한다.", "table")).toBe(true);
    expect(isSentenceLike("표 4. 이 표는 설비마다 점검 주기를 정한 것으로 모든 설비를 매월 한 번씩 확인하고 결과를 남겨야 한다", "table")).toBe(false);
  });
});

describe("findLangCut", () => {
  it("cuts before the second caption head of the other script, or before the other script", () => {
    expect(findLangCut("표 2. 경보 목록 Table 2. Alarm list")).toBe("표 2. 경보 목록 ".length);
    expect(findLangCut("그림 1. 로터 구조 (Figure 1. Rotor layout)")).toBe("그림 1. 로터 구조 ".length);
    expect(findLangCut("경보 목록 Alarm list")).toBe("경보 목록 ".length);
    expect(findLangCut("표 2. 경보 목록")).toBeNull();
  });
});

describe("buildCaptionSlot", () => {
  it("offers the nearest line each way and caption-shaped lines at any distance, nearest first, then the first row and writing in", () => {
    // B10 8-b - 거리 제한이 없다: 9칸 아래 캡션 꼴 줄(17)도 후보, 캡션 꼴이 아닌 먼 줄(18)은 아니다
    const input = makeInput([textUnit(17, 9, "표 7. 먼 캡션"), textUnit(18, 10, "먼 문장이다.")]);
    const slot = buildCaptionSlot({ ...input, places: new Map(input.places).set(9, 12).set(10, 13) });
    expect(slot.state).toBe("empty");
    expect(slot.candidates.map((candidate) => (candidate.kind === "near" ? `${candidate.side}${candidate.distance}:${candidate.unitId}` : candidate.kind))).toEqual([
      "above1:13", "below1:16", "above2:11", "below10:17", "first_row", "write",
    ]);
    const best = slot.candidates.filter((candidate) => candidate.kind !== "write" && candidate.isBest);
    expect(best).toMatchObject([{ kind: "near", unitId: 11, isShaped: true, number: "3" }]);
    expect(slot.candidates.find((candidate) => candidate.kind === "first_row")).toMatchObject({ text: "부품", isShaped: false, reasonKey: null });
  });

  it("turns off the first row when it is the only row", () => {
    const input = makeInput();
    const units = new Map([...input.units].filter(([id]) => id !== 22));
    const slot = buildCaptionSlot({ ...input, units });
    expect(slot.candidates.find((candidate) => candidate.kind === "first_row")).toMatchObject({ reasonKey: "assign.captionSlot.why.oneRow" });
  });

  it("shows a bound KO/EN one-line caption as a chip that can be split - not when the other language already has a caption", () => {
    const pair = "표 3. 소모품 목록 Table 3. Consumables";
    const slot = buildCaptionSlot(makeInput([textUnit(30, 1, pair, { kind: "caption", group_unit_id: 20 })]));
    expect(slot).toMatchObject({ state: "filled", hasFirstRow: false, candidates: [] });
    expect(slot.chips).toMatchObject([{ unitId: 30, origin: "unit", isOdd: false, splitAt: "표 3. 소모품 목록 ".length }]);

    const input = makeInput([textUnit(30, 1, pair, { kind: "caption", group_unit_id: 20 }), textUnit(31, 3, "Table 3", { kind: "caption", group_unit_id: 20, lang: "en" })]);
    expect(buildCaptionSlot(input).chips[0].splitAt).toBeNull();
  });

  it("marks a caption lifted from the first row and a sentence-like one", () => {
    const input = makeInput();
    const units = new Map(input.units);
    units.set(21, { ...units.get(21) as ViewUnit, kind: "caption" });
    const slot = buildCaptionSlot({ ...input, units });
    expect(slot.hasFirstRow).toBe(true);
    expect(slot.chips).toMatchObject([{ unitId: 21, origin: "first_row", isOdd: true }]);
  });

  it("offers a free line inside the same outer table first (distance 0) and refuses lines still in a table", () => {
    // 벗긴 바깥 표(표 30)의 줄(블록 7)은 안쪽 표와 같은 자리 - 가장 가깝다. 아직 표인 칸 줄(묶음 있음)은 후보가 아니다
    const input = makeInput([
      textUnit(23, 7, "필요한 가스켓을 설치한다.", { kind: "cell_sentence", table_id: 30, pos_seq: 3 }),
      textUnit(24, 8, "다른 표 칸이다.", { kind: "cell_sentence", table_id: 31, group_unit_id: 99 }),
    ]);
    const slot = buildCaptionSlot({ ...input, places: new Map(input.places).set(7, 2).set(8, 2) });
    const near = slot.candidates.filter((candidate) => candidate.kind === "near").map((candidate) => (candidate.kind === "near" ? `${candidate.side}${candidate.distance}:${candidate.unitId}` : ""));
    expect(near[0]).toBe("above0:23");
    expect(near).not.toContain("below0:24");
  });

  it("does not take a caption line in an outer table's cell for a lifted first row", () => {
    // 바깥 칸 안 "표 1." 줄(블록 7, 표 30의 칸)이 안쪽 표 20의 캡션 - 첫 행이 아니라 보통 캡션이다(떼면 바깥 칸 줄로 돌아간다)
    const input = makeInput([textUnit(23, 7, "표 1. 조제 탱크", { kind: "caption", group_unit_id: 20 })]);
    const slot = buildCaptionSlot({ ...input, cellTables: new Map([...input.cellTables, [7, 30]]) });
    expect(slot.hasFirstRow).toBe(false);
    expect(slot.chips).toMatchObject([{ unitId: 23, origin: "unit" }]);
  });

  it("shows written-in captions as their own chips", () => {
    const slot = buildCaptionSlot(makeInput([], { written: [{ lang: "en", text: "Table 4. Check interval" }, { lang: "ko", text: " " }] }));
    expect(slot.state).toBe("written");
    expect(slot.chips).toMatchObject([{ unitId: null, origin: "written", text: "Table 4. Check interval" }]);
  });

  it("lets a figure share a neighbouring figure's caption, and shows the shared caption on the grouped figure", () => {
    const blocks = [block(1, 0, "figure", ""), block(2, 1, "figure", ""), block(3, 2, "paragraph", "그림 1. 펌프 구조")];
    const places = buildBlockPlaces(blocks, []);
    const first = makeUnit(40, { kind: "figure", block_id: 1, pos_seq: 0, lang: "neutral" });
    const second = makeUnit(41, { kind: "figure", block_id: 2, pos_seq: 1, lang: "neutral" });
    const caption = textUnit(42, 3, "그림 1. 펌프 구조", { kind: "caption", group_unit_id: 41 });
    const units = new Map([first, second, caption].map((unit) => [unit.id, unit]));
    const slot = buildCaptionSlot({ bundle: first, units, places, cellTables: new Map(), written: [] });
    expect(slot.candidates).toContainEqual({ kind: "figure", figureId: 41, side: "below", text: "그림 1. 펌프 구조", isBest: true });

    const grouped = new Map(units);
    grouped.set(41, { ...second, caption_figure_id: 40 });
    grouped.set(42, { ...caption, group_unit_id: 40 });
    const shared = buildCaptionSlot({ bundle: grouped.get(41) as ViewUnit, units: grouped, places, cellTables: new Map(), written: [] });
    expect(shared).toMatchObject({ state: "shared", groupHeadId: 40, chips: [{ unitId: 42, origin: "shared" }] });
    expect(buildCaptionSlot({ bundle: first, units: grouped, places, cellTables: new Map(), written: [] }).groupHeadId).toBe(40);
  });
});

describe("resolveCaptionDrop", () => {
  const { units } = makeInput([
    textUnit(17, 7, "먼 문장이다."),
    textUnit(18, 8, "벗긴 표 줄이다.", { kind: "cell_sentence", table_id: 30 }),
    textUnit(19, 9, "아직 표인 칸이다.", { kind: "cell_sentence", table_id: 31, group_unit_id: 99 }),
    textUnit(25, 10, "1. 목적 ........ 3", { noise_kind: "toc" }),
    textUnit(26, 11, "SOP-001", { lang: "ref" }),
  ]);
  const get = (id: number) => units.get(id) as ViewUnit;

  it("attaches one free sentence at any distance, and a free line of an unwrapped table", () => {
    expect(resolveCaptionDrop([get(11)], TABLE, units)).toEqual({ kind: "attach", unitId: 11, bundleId: 20 });
    expect(resolveCaptionDrop([get(17)], TABLE, units)).toEqual({ kind: "attach", unitId: 17, bundleId: 20 });
    expect(resolveCaptionDrop([get(18)], TABLE, units)).toEqual({ kind: "attach", unitId: 18, bundleId: 20 });
  });

  it("refuses with a caption reason per kind, a pair, a shared figure and a language that already has a caption", () => {
    expect(resolveCaptionDrop([get(19)], TABLE, units)).toEqual({ kind: "refused", reasonKey: "assign.captionSlot.why.inTable" });
    expect(resolveCaptionDrop([get(25)], TABLE, units)).toEqual({ kind: "refused", reasonKey: "assign.captionSlot.why.tocLine" });
    expect(resolveCaptionDrop([get(26)], TABLE, units)).toEqual({ kind: "refused", reasonKey: "assign.captionSlot.why.refLine" });
    expect(resolveCaptionDrop([get(11), get(13)], TABLE, units)).toEqual({ kind: "refused", reasonKey: "assign.captionSlot.why.oneLine" });
    expect(resolveCaptionDrop([get(11)], { ...TABLE, caption_figure_id: 5 }, units)).toEqual({ kind: "refused", reasonKey: "assign.captionSlot.why.shared" });
    const withCaption = new Map(units).set(30, textUnit(30, 3, "표 9", { kind: "caption", group_unit_id: 20 }));
    expect(resolveCaptionDrop([get(11)], TABLE, withCaption)).toEqual({ kind: "refused", reasonKey: "assign.ctx.why.captionExists" });
    expect(resolveCaptionDrop([withCaption.get(30) as ViewUnit], { ...TABLE, id: 50 }, withCaption)).toEqual({ kind: "refused", reasonKey: "assign.captionSlot.why.alreadyCaption" });
  });

  it("tells a dragged whole table apart from a line", () => {
    expect(resolveCaptionDrop([makeUnit(60, { kind: "table", table_id: 40 })], TABLE, units)).toEqual({ kind: "refused", reasonKey: "assign.captionSlot.why.wholeTable" });
  });

  it("is not a drop when the table itself or its own cell is dragged", () => {
    expect(resolveCaptionDrop([get(21)], TABLE, units)).toEqual({ kind: "none" });
    expect(resolveCaptionDrop([TABLE], TABLE, units)).toEqual({ kind: "none" });
  });
});

describe("resolveCaptionDetach", () => {
  it("detaches outside its own slot on the Old paper, and refuses a legacy figure-block caption", () => {
    expect(resolveCaptionDetach({ captionBundleId: 20, slotBundleId: null, isOverOld: true, isFixed: false })).toEqual({ kind: "detach" });
    expect(resolveCaptionDetach({ captionBundleId: 20, slotBundleId: 20, isOverOld: true, isFixed: false })).toEqual({ kind: "none" });
    expect(resolveCaptionDetach({ captionBundleId: 20, slotBundleId: null, isOverOld: false, isFixed: false })).toEqual({ kind: "none" });
    expect(resolveCaptionDetach({ captionBundleId: 20, slotBundleId: null, isOverOld: true, isFixed: true })).toEqual({ kind: "refused", reasonKey: "assign.ctx.why.captionInFigure" });
  });
});

describe("getCaptionMotion", () => {
  it("slides into the slot on attach and back out on detach", () => {
    expect(getCaptionMotion({ type: "attach_caption", unit_id: 1, bundle_unit_id: 20 }, null)).toEqual({ scopes: ["c20"], reverse: false });
    expect(getCaptionMotion({ type: "set_first_row_caption", table_unit_id: 20, caption: false }, null)).toEqual({ scopes: ["c20"], reverse: true });
    expect(getCaptionMotion({ type: "detach_caption", unit_id: 30 }, 20)).toEqual({ scopes: ["c20"], reverse: true });
    expect(getCaptionMotion({ type: "group_figures", unit_ids: [40, 41] }, 40)).toEqual({ scopes: ["c40", "c41"], reverse: false });
    expect(getCaptionMotion({ type: "split", unit_id: 1, at: 2 }, 20)).toBeNull();
  });
});

describe("listCaptionHolders", () => {
  it("lists tables and figures nearest first from the line's side, at most five", () => {
    // 줄 13(자리 1) - 표 20(자리 2)이 바로 아래, 그림 41(자리 0)이 바로 위 · 같은 거리면 원문 자리가 가까운 표가 먼저, 먼 표들은 뒤
    const input = makeInput([
      makeUnit(41, { kind: "figure", block_id: 1, pos_seq: 0, lang: "neutral" }),
      ...[50, 51, 52, 53, 54].map((id, index) => makeUnit(id, { kind: "table", table_id: 70 + index, block_id: 90 + index, pos_seq: 90 + index, lang: "neutral" })),
    ]);
    const places = new Map(input.places);
    [90, 91, 92, 93, 94].forEach((blockId, index) => places.set(blockId, 10 + index));
    const holders = listCaptionHolders(input.units.get(13) as ViewUnit, input.units, places);
    expect(holders.map((holder) => `${holder.side}${holder.distance}:${holder.bundle.id}`)).toEqual(["below1:20", "above1:41", "below9:50", "below10:51", "below11:52"]);
  });
});
