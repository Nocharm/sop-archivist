// 그림 자리 - 위치 판이 그 그림의 본문 앞뒤 3줄(그림 줄은 건너뛴다)과 문장 속 글자 자리를 고르는지 본다(시안 2 D3).
import { describe, expect, it } from "vitest";

import type { DocumentView, ViewBlock, ViewUnit } from "./api-sop";
import { findFigureSpot, findUnitSpot } from "./figure-spot-model";
import { buildPaperModel } from "./paper-model";

function makeBlock(id: number, seq: number, text: string, extra: Partial<ViewBlock> = {}): ViewBlock {
  return {
    id, seq, text, part: "body", kind: "paragraph", page: 1, page_basis: "estimated", section_label: "", heading_level: null,
    table_id: null, row_index: null, col_index: null, grid_span: 1, row_span: 1, flags: [], has_image: false, part_group: "body", ...extra,
  };
}

function makeUnit(id: number, spans: Array<[number, number, number]>, extra: Partial<ViewUnit> = {}): ViewUnit {
  return {
    id, display_id: `D-${id}`, kind: "sentence", spans, text: "", lang: "en", number: null, table_id: null, row_index: null, group_unit_id: null,
    status: "unassigned", pair_id: null, pos_seq: spans[0]?.[0] ?? 0, block_id: spans[0]?.[0] ?? 0, is_edited: false, can_unmerge: false, split_suggestion_id: null, ref: null, caption_refs: [], ...extra,
  };
}

function makeView(blocks: ViewBlock[], units: ViewUnit[]): DocumentView {
  return { document: {} as DocumentView["document"], extraction: null, has_number_ranges: false, tables: [], blocks, units, pairs: [], part_groups: [], edits: { can_undo: false, can_redo: false } };
}

/** 문단 n개(블록 id 1..n, 단위 id 100+) 사이 seq 자리에 그림(블록 id 900+i, 단위 id 90+i)을 끼운다 */
function makeDoc(paragraphs: number, figuresAfter: number[], anchors: Array<{ block_id: number; at: number } | null> = []): DocumentView {
  const blocks: ViewBlock[] = [];
  const units: ViewUnit[] = [];
  let seq = 0;
  const addFigure = (index: number) => {
    const id = 900 + index;
    blocks.push(makeBlock(id, seq, "", { kind: "figure", anchor: anchors[index] ?? null }));
    units.push(makeUnit(90 + index, [], { kind: "figure", block_id: id, pos_seq: seq }));
    seq += 1;
  };
  figuresAfter.forEach((after, index) => after === 0 && addFigure(index));
  for (let n = 1; n <= paragraphs; n += 1) {
    const text = `Line ${n}. Tail ${n}.`;
    blocks.push(makeBlock(n, seq, text));
    units.push(makeUnit(100 + n, [[n, 0, text.length]], { pos_seq: seq }));
    seq += 1;
    figuresAfter.forEach((after, index) => after === n && addFigure(index));
  }
  return makeView(blocks, units);
}

const keyOf = (unitId: number, blockId: number) => `u${unitId}-${blockId}-0`;

describe("findFigureSpot", () => {
  it("takes three body rows before and after a figure-only paragraph and draws the line after the row right before it", () => {
    const model = buildPaperModel(makeDoc(8, [4]));
    expect(findFigureSpot(model, 90)).toEqual({
      before: [keyOf(102, 2), keyOf(103, 3), keyOf(104, 4)],
      after: [keyOf(105, 5), keyOf(106, 6), keyOf(107, 7)],
      host: null,
    });
  });

  it("stops at the ends of the document", () => {
    const model = buildPaperModel(makeDoc(2, [0, 2]));
    expect(findFigureSpot(model, 90)).toEqual({ before: [], after: [keyOf(101, 1), keyOf(102, 2)], host: null });
    expect(findFigureSpot(model, 91)).toEqual({ before: [keyOf(101, 1), keyOf(102, 2)], after: [], host: null });
  });

  it("skips other figures next to it - they are not body rows", () => {
    const model = buildPaperModel(makeDoc(4, [2, 2, 2]));
    expect(findFigureSpot(model, 91)).toEqual({ before: [keyOf(101, 1), keyOf(102, 2)], after: [keyOf(103, 3), keyOf(104, 4)], host: null });
  });

  it("puts a figure inside a sentence at that sentence - its row ends the rows before, with the caret at the unit offset", () => {
    // 블록 3의 둘째 문장(Tail 3.) 안 글자 자리 11 - 그 문단은 문장 둘로 나뉘어 있다
    const view = makeDoc(5, [3], [{ block_id: 3, at: 11 }]);
    view.units = view.units.map((unit) => (unit.id === 103 ? { ...unit, spans: [[3, 0, 7]] } : unit));
    view.units.push(makeUnit(200, [[3, 8, 15]], { pos_seq: 3 }));
    const model = buildPaperModel(view);
    expect(findFigureSpot(model, 90)).toEqual({
      before: [keyOf(102, 2), keyOf(103, 3), "u200-3-8"],
      after: [keyOf(104, 4), keyOf(105, 5)],
      host: { unitId: 200, at: 3 },
    });
  });

  it("falls back to the line after the row before the figure when the anchor covers no unit", () => {
    const model = buildPaperModel(makeDoc(3, [1], [{ block_id: 77, at: 2 }]));
    expect(findFigureSpot(model, 90)).toEqual({ before: [keyOf(101, 1)], after: [keyOf(102, 2), keyOf(103, 3)], host: null });
  });

  it("is null for a unit that is not a body figure", () => {
    expect(findFigureSpot(buildPaperModel(makeDoc(2, [1])), 101)).toBeNull();
  });
});

describe("findUnitSpot", () => {
  it("takes the pair row and three body rows on each side, skipping figure rows", () => {
    const model = buildPaperModel(makeDoc(9, [4]));
    expect(findUnitSpot(model, 105)).toEqual({
      before: [keyOf(102, 2), keyOf(103, 3), keyOf(104, 4)],
      row: keyOf(105, 5),
      after: [keyOf(106, 6), keyOf(107, 7), keyOf(108, 8)],
    });
  });

  it("stops at the ends of the document", () => {
    const model = buildPaperModel(makeDoc(3, []));
    expect(findUnitSpot(model, 101)).toEqual({ before: [], row: keyOf(101, 1), after: [keyOf(102, 2), keyOf(103, 3)] });
  });

  it("is null for a figure or a unit that is not in the body", () => {
    const model = buildPaperModel(makeDoc(2, [1]));
    expect(findUnitSpot(model, 90)).toBeNull();
    expect(findUnitSpot(model, 999)).toBeNull();
  });
});
