// 용지 모델 - 블록 조각이 글자를 빠짐없이 덮고, 단위·블록 위치 변환이 서버 규칙(이음 글자 한 칸)과 같은지 본다.
import { describe, expect, it } from "vitest";

import type { DocumentView, ViewBlock, ViewUnit } from "./api-sop";
import { buildContourPath, buildPaperModel, canMergeAdjacent, canSplitAt, getMarks, getTags, readWarningText, shouldRecenter, toBlockOffset, toUnitOffset } from "./paper-model";

function makeBlock(id: number, seq: number, text: string, extra: Partial<ViewBlock> = {}): ViewBlock {
  return {
    id, seq, text, part: "body", kind: "paragraph", page: 1, page_basis: "estimated", section_label: "", heading_level: null,
    table_id: null, row_index: null, col_index: null, grid_span: 1, row_span: 1, flags: [], has_image: false, ...extra,
  };
}

function makeUnit(id: number, spans: Array<[number, number, number]>, text: string, extra: Partial<ViewUnit> = {}): ViewUnit {
  return {
    id, display_id: `D-${id}`, kind: "sentence", spans, text, lang: "en", table_id: null, row_index: null, group_unit_id: null,
    boundary_confirmed: false, status: "unassigned", pair_id: null, pos_seq: spans[0]?.[0] ?? 0, block_id: spans[0]?.[0] ?? 0, is_edited: false, ...extra,
  };
}

function makeView(blocks: ViewBlock[], units: ViewUnit[]): DocumentView {
  return {
    document: {} as DocumentView["document"], extraction: null, tables: [], blocks, units, pairs: [],
    edits: { can_undo: false, can_redo: false },
  };
}

describe("buildPaperModel", () => {
  it("covers every character with unit and gap segments", () => {
    const view = makeView([makeBlock(1, 0, "One. Two.")], [makeUnit(10, [[1, 0, 4]], "One."), makeUnit(11, [[1, 5, 9]], "Two.")]);
    const model = buildPaperModel(view);
    expect(model.segments.get(1)).toEqual([
      { start: 0, end: 4, unitId: 10 },
      { start: 4, end: 5, unitId: null },
      { start: 5, end: 9, unitId: 11 },
    ]);
    expect(model.order).toEqual([10, 11]);
  });

  it("groups table cells into rows once and keeps header and footer apart", () => {
    const blocks = [
      makeBlock(1, 0, "HEAD", { part: "header" }),
      makeBlock(2, 1, "a", { kind: "table_cell", table_id: 7, row_index: 0, col_index: 1 }),
      makeBlock(3, 2, "b", { kind: "table_cell", table_id: 7, row_index: 0, col_index: 0 }),
      makeBlock(4, 3, "FOOT", { part: "footer" }),
    ];
    const view = makeView(blocks, [makeUnit(20, [], "", { kind: "table", table_id: 7, pos_seq: 1 })]);
    view.tables = [{ id: 7, table_index: 0, parent_table_id: null, part: "body", n_rows: 1, n_cols: 2, is_layout: false }];
    const model = buildPaperModel(view);
    expect(model.header).toHaveLength(1);
    expect(model.footer).toHaveLength(1);
    expect(model.body).toHaveLength(1);
    const table = model.body[0];
    expect(table.type === "table" && table.rows[0].map((cell) => cell.text)).toEqual(["b", "a"]);
    expect(table.type === "table" && table.unitId).toBe(20);
  });
});

describe("offset conversion", () => {
  // 같은 블록 두 범위 "abc"+"ef" → 단위 글자 "abc ef"
  const spans: Array<[number, number, number]> = [[1, 0, 3], [1, 4, 6], [2, 0, 2]];

  it("maps block offsets to unit offsets with one joiner between spans", () => {
    expect(toUnitOffset(spans, 1, 0)).toBe(0);
    expect(toUnitOffset(spans, 1, 4)).toBe(4);
    expect(toUnitOffset(spans, 2, 1)).toBe(8);
    expect(toUnitOffset(spans, 3, 0)).toBeNull();
  });

  it("maps unit offsets back and refuses the joiner", () => {
    expect(toBlockOffset(spans, 5)).toEqual({ blockId: 1, offset: 5 });
    expect(toBlockOffset(spans, 3)).toBeNull();
    expect(toBlockOffset(spans, 7)).toEqual({ blockId: 2, offset: 0 });
  });

  it("only splits where both pieces keep text", () => {
    const unit = makeUnit(1, [[1, 0, 9]], "One. Two.");
    expect(canSplitAt(unit, 5)).toBe(true);
    expect(canSplitAt(unit, 0)).toBe(false);
    expect(canSplitAt(unit, 9)).toBe(false);
  });
});

describe("extraction warnings", () => {
  // 누락 글 경고는 backend ingest가 detail.snippet에 담는다 - 비어 보이면 작성자가 글을 못 보고 확인해야 한다
  it("shows the missing text the extractor flagged", () => {
    expect(readWarningText({ snippet: "빠진 문장" })).toBe("빠진 문장");
    expect(readWarningText({ table_index: "2" })).toBe("");
  });
});

// ── Split 개편(2026-11-09): 선택 윤곽, 가운데 스크롤, 태그·표시, 이웃 합치기 ──

function makeSplitUnit(over: Partial<ViewUnit> = {}): ViewUnit {
  return {
    id: 1,
    display_id: "OLD-1-001",
    kind: "sentence",
    spans: [[10, 0, 5]],
    text: "Hello",
    lang: "ko",
    table_id: null,
    row_index: null,
    group_unit_id: null,
    boundary_confirmed: false,
    status: "unassigned",
    pair_id: null,
    pos_seq: 1,
    block_id: 10,
    is_edited: false,
    ...over,
  };
}

describe("buildContourPath", () => {
  it("draws one padded box for a single line", () => {
    expect(buildContourPath([{ left: 10, right: 110, top: 20, bottom: 40 }])).toBe("M6,18 H114 V42 H6 V18 Z");
  });

  it("walks down the right edges and back up the left edges across lines", () => {
    const path = buildContourPath([
      { left: 60, right: 300, top: 0, bottom: 20 },
      { left: 0, right: 180, top: 24, bottom: 44 },
    ]);
    // 줄 사이 경계는 가운데(22)로 맞춘다
    expect(path).toBe("M56,-2 H304 V22 H184 V46 H-4 V22 H56 V-2 Z");
  });

  it("merges rects that sit on the same line", () => {
    const path = buildContourPath([
      { left: 0, right: 50, top: 0, bottom: 20 },
      { left: 50, right: 120, top: 1, bottom: 20 },
    ]);
    expect(path).toBe("M-4,-2 H124 V22 H-4 V-2 Z");
  });

  it("returns an empty path without rects", () => {
    expect(buildContourPath([])).toBe("");
  });
});

describe("shouldRecenter", () => {
  it("leaves a unit alone in the middle band", () => {
    expect(shouldRecenter(300, 330, 0, 900)).toBe(false);
  });

  it("recenters near the bottom or above the top", () => {
    expect(shouldRecenter(700, 730, 0, 900)).toBe(true);
    expect(shouldRecenter(60, 90, 0, 900)).toBe(true);
  });
});

describe("getTags and getMarks", () => {
  it("shows the language and hold as letter tags", () => {
    expect(getTags(makeSplitUnit({ lang: "en", status: "on_hold" }))).toEqual({ lang: "EN", hold: true });
    expect(getTags(makeSplitUnit({ lang: "neutral" }))).toEqual({ lang: null, hold: false });
  });

  it("lists icon marks in a stable order", () => {
    const unit = makeSplitUnit({ boundary_confirmed: true, pair_id: 4, is_edited: true, status: "confirmed" });
    expect(getMarks(unit)).toEqual(["edited", "pair", "classified", "checked"]);
    expect(getMarks(makeSplitUnit({ status: "ai_suggested" }))).toEqual(["ai"]);
  });
});

describe("canMergeAdjacent", () => {
  it("merges two body sentences", () => {
    expect(canMergeAdjacent(makeSplitUnit({ id: 1 }), makeSplitUnit({ id: 2 }))).toBe(true);
  });

  it("refuses tables, figures and units in different cells", () => {
    expect(canMergeAdjacent(makeSplitUnit(), makeSplitUnit({ id: 2, kind: "figure" }))).toBe(false);
    expect(canMergeAdjacent(makeSplitUnit({ kind: "cell_sentence", table_id: 3, block_id: 10 }), makeSplitUnit({ id: 2, kind: "cell_sentence", table_id: 3, block_id: 11 }))).toBe(false);
    expect(canMergeAdjacent(makeSplitUnit(), makeSplitUnit({ id: 2, kind: "cell_sentence", table_id: 3 }))).toBe(false);
  });
});
