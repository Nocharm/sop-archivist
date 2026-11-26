// 고름 두 겹(11-23 명세 C1) - 누른 조각은 진하게(data-sel), 그것이 든 짝 카드 · 표는 얇은 테(data-group)와 꼬리표 하나
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { DocumentView, ViewBlock, ViewUnit } from "@/lib/api-sop";
import type { DeletedFold } from "@/lib/deleted-fold-model";
import { LangProvider } from "@/lib/i18n";
import { buildPaperModel } from "@/lib/paper-model";
import { buildPickScope } from "@/lib/pick-scope-model";

import { Paper } from "./paper";

type PaperProps = Parameters<typeof Paper>[0];

function block(id: number, text: string, extra: Partial<ViewBlock> = {}): ViewBlock {
  return {
    id, seq: id, text, part: "body", kind: "paragraph", page: 1, page_basis: "estimated", section_label: "", heading_level: null,
    table_id: null, row_index: null, col_index: null, grid_span: 1, row_span: 1, flags: [], has_image: false, part_group: "body", ...extra,
  };
}
function u(id: number, text: string, extra: Partial<ViewUnit> = {}): ViewUnit {
  return {
    id, display_id: `D-${id}`, kind: "sentence", spans: text === "" ? [] : [[id, 0, text.length]], text, lang: "ko", number: null, table_id: null, row_index: null, group_unit_id: null,
    status: "unassigned", pair_id: null, pos_seq: id, block_id: id, is_edited: false, can_unmerge: false, split_suggestion_id: null, ref: null, caption_refs: [], ...extra,
  };
}
function view(blocks: ViewBlock[], units: ViewUnit[]): DocumentView {
  return {
    document: {} as DocumentView["document"], extraction: null, has_number_ranges: false, pairs: [], part_groups: [], edits: { can_undo: false, can_redo: false },
    tables: [{ id: 10, table_index: 1, parent_table_id: null, part: "body", n_rows: 1, n_cols: 1, is_layout: false, is_band: false, anchor: null }],
    blocks, units,
  };
}

// 표 2(표 id 10, 묶음 단위 1)의 칸 문장 2 "온도" · 이웃한 짝 5/6 · 외톨이 줄 8
const tableModel = buildPaperModel(view(
  [block(50, "Before"), block(60, "온도", { kind: "table_cell", table_id: 10, row_index: 0, col_index: 0 })],
  [u(50, "Before"), u(1, "", { kind: "table", table_id: 10, pos_seq: 60, block_id: 60, lang: "neutral" }), u(2, "온도", { kind: "cell_sentence", table_id: 10, row_index: 0, group_unit_id: 1, spans: [[60, 0, 2]], pos_seq: 60, block_id: 60 })],
));
const pairModel = buildPaperModel(view(
  [block(5, "탱크를 비운다."), block(6, "Empty the tank."), block(8, "Alone.")],
  [u(5, "탱크를 비운다.", { pair_id: 3 }), u(6, "Empty the tank.", { lang: "en", pair_id: 3 }), u(8, "Alone.", { lang: "en" })],
));
const tableFold: DeletedFold = { rowKey: "u1", remark: "", kind: "table", lang: "neutral", text: "온도" };

const cellPick: Partial<PaperProps> = { model: tableModel, selectedId: 2, highlightIds: new Set([1]), scope: buildPickScope(2, [1], tableModel.units, tableModel.tables) };
const pairPick: Partial<PaperProps> = { model: pairModel, selectedId: 5, highlightIds: new Set([5, 6]), scope: buildPickScope(5, [5, 6], pairModel.units, pairModel.tables) };
const lonePick: Partial<PaperProps> = { model: pairModel, selectedId: 8, highlightIds: new Set([8]), scope: buildPickScope(8, [8], pairModel.units, pairModel.tables) };
const deletedCellPick: Partial<PaperProps> = { ...cellPick, strips: { deleted: { folds: new Map([[1, tableFold]]) } } };

function html(over: Partial<PaperProps>): string {
  const props: PaperProps = { ...cellPick, model: tableModel, selectedId: null, onUnitClick: () => undefined, testId: "assign-paper", strips: {}, ...over };
  return renderToStaticMarkup(createElement(LangProvider, null, createElement(Paper, props)));
}

describe("a two-level pick on the paper", () => {
  it("marks the pressed cell and only thinly rings its table", () => {
    const h = html(cellPick);
    expect(h).toMatch(/class="cell-piece"[^>]*data-strip-unit="2"[^>]*data-sel=""/);
    expect(h).toMatch(/data-group="table"[^>]*data-testid="assign-paper-piece-1"/);
    expect(h).not.toMatch(/data-sel=""[^>]*data-testid="assign-paper-piece-1"/);
    expect(h).toContain("Table 2 (assigned as a whole)");
  });

  it("marks one half of a pair card and tags the card once", () => {
    const h = html(pairPick);
    expect(h.match(/data-group="pair"/g)).toHaveLength(2);
    expect(h.match(/group-tag/g)).toHaveLength(1);
    expect(h).not.toMatch(/data-testid="assign-paper-piece-6"[^>]*data-sel=""/);
  });

  it("rings a lone line with no tag", () => expect(html(lonePick)).not.toContain("group-tag"));

  it("keeps a deleted table open while its cell is picked", () => expect(html(deletedCellPick)).toContain('data-testid="assign-paper-piece-1"'));

  it("draws the same markup without a scope", () => expect(html({ scope: null })).toBe(html({ scope: undefined })));
});
