// New 박스 위에 얹을 것 - Unit마다 한 덩이, 같은 Unit에 새 문장이 둘이면 하나만, 덩어리 키는 제 Unit의 것만.
import { describe, expect, it } from "vitest";

import type { BundleCell, ViewUnit, WrittenSentence } from "@/lib/api-sop";
import { buildNewAiFilter } from "@/lib/new-ai-filter-model";

import { buildNewOverlay, readOverlayKey, readUnlinkableKey, type NewBox, type NewOverlayInput } from "./new-overlay-model";

const NONE: ReadonlySet<number> = new Set();

const sentence = (targetId: number, unitId: number | null, over: Partial<WrittenSentence> = {}): WrittenSentence => ({
  target_id: targetId, target_doc_id: 1, doc_code: "SOP-1", section_path: "1. Scope", order_index: targetId, lang: "ko", kind: "sentence", text: "합성 문장", status: "unassigned",
  change_type: null, source_unit_ids: [], partner_target_id: null, remark: "", revision: 1, new_unit_id: unitId, ...over,
});
const cell = (targetId: number, unitId: number | null, over: Partial<BundleCell> = {}): BundleCell => ({
  target_id: targetId, row: 0, col: 0, lang: "ko", text: "합성 칸", status: "unassigned", source_unit_ids: [], revision: 1, new_unit_id: unitId, change_type: null, ...over,
});
const table = (cells: BundleCell[], over: Partial<WrittenSentence> = {}) => sentence(90, 900, { kind: "table", table: { rows: 1, cols: cells.length, cells }, ...over });
const build = (rows: WrittenSentence[], over: Partial<NewOverlayInput> = {}) =>
  buildNewOverlay({ rows, candidateIds: NONE, pickedIds: NONE, focusId: null, shapeUnitId: null, aiFilter: null, openAiSections: new Set(), ...over });
const state = (over: Partial<NewOverlayInput>) => build([sentence(5, 50)], over).boxes.get(50)?.state;
const key = (row: Partial<WrittenSentence>, over: Partial<NewOverlayInput> = {}) => build([sentence(5, 50, row)], over).boxes.get(50)?.key;
const boxes = (keys: Record<number, string>) => new Map(Object.entries(keys).map(([id, value]) => [Number(id), { key: value } as NewBox]));
const unit = (over: Partial<ViewUnit>) => ({ id: 50, kind: "sentence", noise_kind: null, ...over }) as ViewUnit;

describe("buildNewOverlay", () => {
  it("maps sentences and table cells by new_unit_id", () => {
    const o = build([sentence(5, 50), table([cell(7, 70)])]);
    expect(o.boxes.get(50)).toMatchObject({ targetId: 5, kind: "sentence", isLinkable: true });
    expect(o.boxes.get(70)).toMatchObject({ targetId: 7, kind: "cell", isLinkable: true });
    expect(o.boxes.get(900)).toMatchObject({ targetId: 90, kind: "bundle", isLinkable: false });
    expect(o.unitOfTarget.get(7)).toBe(70);
  });

  it("keeps one sentence per unit, the sourced one first", () => {
    expect(build([sentence(5, 50), sentence(6, 50, { source_unit_ids: [9] })]).boxes.get(50)?.targetId).toBe(6);
    expect(build([sentence(6, 50, { source_unit_ids: [9] }), sentence(5, 50, { source_unit_ids: [8] })]).boxes.get(50)?.targetId).toBe(5);
    // 진 문장도 그 박스로 찾아간다
    expect(build([sentence(5, 50), sentence(6, 50, { source_unit_ids: [9] })]).unitOfTarget.get(5)).toBe(50);
  });

  it("orders the states", () => {
    expect(state({ focusId: 5, pickedIds: new Set([5]) })).toBe("focus");
    expect(state({ shapeUnitId: 50, pickedIds: new Set([5]) })).toBe("shape");
    expect(state({ pickedIds: new Set([5]), candidateIds: new Set([5]) })).toBe("picked");
    expect(state({ candidateIds: new Set([5]) })).toBe("candidate");
    expect(state({})).toBe("unsourced");
  });

  it("does not mark a cell unsourced when it is marked new", () => {
    expect(build([table([cell(7, 70)])]).boxes.get(70)?.state).toBe("unsourced");
    expect(build([table([cell(7, 70, { change_type: "new" })])]).boxes.get(70)?.state).toBeUndefined();
    expect(build([table([cell(7, 70, { source_unit_ids: [9] })])]).boxes.get(70)?.state).toBeUndefined();
  });

  it("marks no table unsourced", () => expect(build([table([])]).boxes.get(900)?.state).toBeUndefined());

  it("drops a sentence without a unit", () => expect(build([sentence(5, null), table([cell(7, null)], { new_unit_id: null })]).boxes.size).toBe(0));

  it("folds the AI suggestions of other lines into one band a section until it is opened", () => {
    const rows = [sentence(5, 50, { source_unit_ids: [1] }), sentence(6, 60, { source_unit_ids: [2], status: "ai_suggested" }), sentence(7, 70, { source_unit_ids: [3], status: "ai_suggested" })];
    const aiFilter = buildNewAiFilter(true, [1], rows);
    const folded = build(rows, { aiFilter });
    expect([50, 60, 70].map((id) => folded.boxes.get(id)?.isAiFolded)).toEqual([false, true, true]);
    expect([50, 60, 70].map((id) => folded.boxes.get(id)?.band?.count)).toEqual([undefined, 2, undefined]);
    expect(folded.boxes.get(50)?.ai).toBe("mine_went");
    const open = build(rows, { aiFilter, openAiSections: new Set(["1"]) });
    expect([60, 70].map((id) => open.boxes.get(id)?.isAiFolded)).toEqual([false, false]);
    expect(open.boxes.get(60)?.band).toBeNull();
  });

  it("keeps the band when the first folded row lost its box to another sentence of the unit", () => {
    // 5는 6에 밀려 박스가 없다 - 띠는 그 칸의 다음 접힌 박스에
    const rows = [sentence(5, 50, { status: "ai_suggested" }), sentence(6, 50, { status: "ai_suggested", source_unit_ids: [2] }), sentence(7, 70, { status: "ai_suggested", source_unit_ids: [3] })];
    expect(build(rows, { aiFilter: buildNewAiFilter(true, [1], rows) }).boxes.get(50)?.band?.count).toBe(3);
  });
});

describe("the key of a box", () => {
  it("keeps the key while only the revision changes", () => expect(key({ revision: 2 })).toBe(key({ revision: 1 })));

  it("changes the key with a source, a state and a fold", () => {
    const rows = [sentence(5, 50, { status: "ai_suggested" })];
    const aiFilter = buildNewAiFilter(true, [1], rows);
    const keys = [
      key({}),
      key({ source_unit_ids: [9] }),
      key({ status: "ai_suggested" }),
      key({ change_type: "new" }),
      key({ ref: { number: "SOP-9", equis: null }, ref_issue: "number" }),
      key({}, { pickedIds: new Set([5]) }),
      key({}, { candidateIds: new Set([5]) }),
      build(rows, { aiFilter }).boxes.get(50)?.key,
      build(rows, { aiFilter, openAiSections: new Set(["1"]) }).boxes.get(50)?.key,
      build([sentence(6, 50)]).boxes.get(50)?.key,
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("reads a chunk key from its own units only", () => {
    expect(readOverlayKey(boxes({ 50: "a", 60: "x" }), new Set([50]))).toBe(readOverlayKey(boxes({ 50: "a", 60: "y" }), new Set([50])));
    expect(readOverlayKey(boxes({ 50: "a" }), new Set([50]))).not.toBe(readOverlayKey(boxes({ 50: "b" }), new Set([50])));
    // 어느 박스의 것인지도 - 같은 값이 다른 박스로 옮겨 가면 다른 키
    expect(readOverlayKey(boxes({ 50: "a" }), new Set([50, 60]))).not.toBe(readOverlayKey(boxes({ 60: "a" }), new Set([50, 60])));
  });
});

describe("readUnlinkableKey", () => {
  it("tells why a heading cannot be linked", () => expect(readUnlinkableKey(unit({ kind: "heading" }), undefined, "body")).toBe("assign.newPaper.why.heading"));

  it("tells why the other boxes cannot be linked", () => {
    expect(readUnlinkableKey(unit({ noise_kind: "toc" }), undefined, "body")).toBe("assign.newPaper.why.noise");
    expect(readUnlinkableKey(unit({}), undefined, "header")).toBe("assign.newPaper.why.repeated");
    expect(readUnlinkableKey(unit({ kind: "caption" }), undefined, "body")).toBe("assign.newPaper.why.caption");
    expect(readUnlinkableKey(unit({ kind: "table" }), build([table([])]).boxes.get(900), "body")).toBe("assign.newPaper.why.bundle");
    expect(readUnlinkableKey(unit({}), undefined, "body")).toBe("assign.newPaper.why.noTarget");
  });

  it("gives no reason for a linkable box", () => expect(readUnlinkableKey(unit({}), build([sentence(5, 50)]).boxes.get(50), "body")).toBeNull());
});
