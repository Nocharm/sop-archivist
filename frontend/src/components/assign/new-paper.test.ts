// 이미 쓴 New 문서의 용지 - 연결선이 찾는 표시, Old와 같은 탭, 이을 수 없는 박스의 까닭, 칸의 칩과 끊기.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { DocumentView, ViewBlock, ViewUnit, WrittenSentence } from "@/lib/api-sop";
import { LangProvider } from "@/lib/i18n";
import { buildNewAiFilter } from "@/lib/new-ai-filter-model";
import { buildNewOverlay, type NewOverlayInput } from "@/lib/new-overlay-model";
import { buildPaperModel, buildPaperTabs } from "@/lib/paper-model";

import { NewPaper, type NewPaperProps } from "./new-paper";

const TABLE = 8;
const NONE: ReadonlySet<number> = new Set();

function makeBlock(id: number, text: string, extra: Partial<ViewBlock> = {}): ViewBlock {
  return {
    id, seq: id, text, part: "body", kind: "paragraph", page: 1, page_basis: "estimated", section_label: "", heading_level: null,
    table_id: null, row_index: null, col_index: null, grid_span: 1, row_span: 1, flags: [], has_image: false, part_group: "body", ...extra,
  };
}
function makeUnit(id: number, text: string, extra: Partial<ViewUnit> = {}): ViewUnit {
  return {
    id, display_id: `N-${id}`, kind: "sentence", spans: text === "" ? [] : [[id, 0, text.length]], text, lang: "en", number: null, table_id: null, row_index: null, group_unit_id: null,
    status: null, pair_id: null, pos_seq: id, block_id: id, is_edited: false, can_unmerge: false, split_suggestion_id: null, ref: null, caption_refs: [], ...extra,
  };
}
const row = (targetId: number, unitId: number, over: Partial<WrittenSentence> = {}): WrittenSentence => ({
  target_id: targetId, target_doc_id: 1, doc_code: "SOP-1", section_path: "1. Scope", order_index: targetId, lang: "en", kind: "sentence", text: `Line ${unitId}`, status: "unassigned",
  change_type: null, source_unit_ids: [], partner_target_id: null, remark: "", revision: 1, new_unit_id: unitId, ...over,
});
const ROWS: WrittenSentence[] = [
  row(5, 50, { source_unit_ids: [9], status: "confirmed" }),
  row(6, 52),
  row(90, 900, { kind: "table", table: { rows: 1, cols: 1, cells: [{ target_id: 7, row: 0, col: 0, lang: "en", text: "Cell", status: "confirmed", source_unit_ids: [9], revision: 1, new_unit_id: 60, change_type: null }] } }),
];

interface Options extends Partial<NewPaperProps> {
  header?: boolean;
  heading?: boolean;
  over?: Partial<NewOverlayInput>;
  units?: (id: number) => Partial<ViewUnit>;
}

function html({ header = false, heading = false, over, units, ...props }: Options = {}): string {
  const view: DocumentView = {
    document: { id: 3 } as DocumentView["document"], extraction: null, has_number_ranges: false, pairs: [], part_groups: [], edits: { can_undo: false, can_redo: false },
    tables: [{ id: TABLE, table_index: 0, parent_table_id: null, part: "body", n_rows: 1, n_cols: 1, is_layout: false, is_band: false, anchor: null }],
    blocks: [
      ...(header ? [makeBlock(40, "Head", { part: "header", part_group: "header" })] : []),
      makeBlock(50, "First"),
      ...(heading ? [makeBlock(51, "1. Scope", { heading_level: 1 })] : []),
      makeBlock(52, "Second"),
      makeBlock(60, "Cell", { kind: "table_cell", table_id: TABLE, row_index: 0, col_index: 0 }),
    ],
    units: [
      ...(header ? [makeUnit(40, "Head")] : []),
      makeUnit(50, "First", units?.(50)),
      ...(heading ? [makeUnit(51, "1. Scope", { kind: "heading" })] : []),
      makeUnit(52, "Second", units?.(52)),
      makeUnit(900, "", { kind: "table", table_id: TABLE, pos_seq: 60, block_id: 60 }),
      makeUnit(60, "Cell", { kind: "cell_sentence", table_id: TABLE, row_index: 0, group_unit_id: 900 }),
    ],
  };
  const model = buildPaperModel(view);
  const overlay = buildNewOverlay({ rows: ROWS, candidateIds: NONE, pickedIds: NONE, focusId: null, shapeUnitId: null, aiFilter: null, openAiSections: new Set(), ...over });
  const full: NewPaperProps = {
    bundleId: 1, docOptions: [{ value: "1", label: "SOP-1" }], docId: "1", fileId: 3, onDocChange: () => undefined, tag: "New", linesOn: true, onToggleLines: () => undefined,
    zoom: 1, onZoom: () => undefined, view, model, tabs: buildPaperTabs(view, model), overlay, onOpenAiSection: () => undefined, cellPickable: false, cellDroppable: false,
    onUnlink: () => undefined, sourceLabel: (id) => `1-${id}`, onJumpSource: () => undefined, selectedUnitId: null, pickedUnitIds: NONE, onPick: () => undefined, ...props,
  };
  return renderToStaticMarkup(createElement(LangProvider, null, createElement(NewPaper, full)));
}

describe("NewPaper", () => {
  it("keeps the marks the link lines look for", () => {
    const h = html();
    expect(h).toContain('data-pane="new"');
    expect(h).toContain('data-doc="1"');
    expect(h).toMatch(/class="strip new-line"[^>]*data-target="5"/);
    expect(h).toContain('data-src-unit="9"');
    expect(h).toMatch(/data-testid="assign-new-5"/);
    expect(h).toMatch(/class="new-text" data-testid="assign-new-pick-5"/);
    expect(h).toMatch(/data-target="6"[^>]*data-state="unsourced"/);
    expect(h).toMatch(/data-target="5"[^>]*data-linkable=""/);
  });

  it("draws the cells as boxes of their own and gives a table no target", () => {
    const h = html({ cellPickable: true, cellDroppable: true });
    expect(h).toMatch(/class="cell-piece new-cell"[^>]*data-cell-target="7"[^>]*data-pickable=""[^>]*data-drop="cell"[^>]*data-testid="assign-new-cell-7"[^>]*>\s*<span class="new-srcs"/);
    expect(h).toContain('data-testid="assign-new-cell-pick-7"');
    expect(h).toMatch(/data-testid="assign-new-90"/);
    expect(h).not.toContain('data-target="90"');
    expect(html()).not.toMatch(/data-pickable|data-drop=/);
  });

  it("shows header and footer tabs like the Old paper", () => {
    expect(html({ header: true })).toContain('data-testid="assign-new-tab-header"');
    expect(html()).not.toContain("assign-new-tab");
  });

  it("draws a heading with no target and tells why", () => {
    const h = html({ heading: true });
    expect(h).toMatch(/<div class="strip" [^>]*data-testid="assign-new-paper-piece-51"/);
    const box = /<div class="strip" [^>]*data-testid="assign-new-paper-piece-51"[^>]*>/.exec(h)?.[0] ?? "";
    expect(box).not.toMatch(/data-target/);
    expect(box).toContain("data-tip=");
  });

  it("offers nothing to unlink without a handler", () => {
    expect(html({ onUnlink: undefined })).not.toContain("new-src-x");
    expect(html()).toContain("new-src-x");
  });

  it("shows no Caption needed on a written table", () => expect(html()).not.toContain("caption-missing"));

  it("folds other lines' AI suggestions into a band", () => {
    const rows = [row(5, 50, { source_unit_ids: [1] }), row(6, 52, { source_unit_ids: [2], status: "ai_suggested" })];
    const h = html({ over: { rows, aiFilter: buildNewAiFilter(true, [1], rows) } });
    expect(h).toContain('data-testid="assign-new-ai-hidden-1"');
    expect(h).not.toContain('data-target="6"');
    expect(h).toMatch(/class="strip-row"[^>]*data-ai-view="mine"/);
    expect(h).toContain('data-testid="assign-new-ai-tag-5"');
  });

  it("opens the menu inside the pressed box", () => {
    const h = html({ foot: { unitId: 50, node: createElement("i", null, "menu") } });
    expect(h).toMatch(/new-line-acts[^>]*>.*<i>menu<\/i>/);
  });

  it("names a pair of boxes by one group", () => {
    const h = html({ units: () => ({ pair_id: 4 }) });
    expect(h.match(/data-pair-group="4"/g)).toHaveLength(2);
  });

  it("waits with a skeleton until the document arrives", () => {
    const h = html({ view: null, model: null, tabs: null });
    expect(h).toContain("sk ");
    expect(h).not.toContain("new-sheet");
  });
});
