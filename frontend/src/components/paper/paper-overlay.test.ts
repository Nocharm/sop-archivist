// 용지 박스 위에 화면이 얹는 표시 - 박스 · 칸 조각의 속성과 칩, 접힌 카드의 띠, 먼 덩어리는 제 박스가 바뀔 때만.
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { DocumentView, ViewBlock, ViewUnit } from "@/lib/api-sop";
import { LangProvider } from "@/lib/i18n";
import { buildPaperModel } from "@/lib/paper-model";

import { isChunkFrozen, Paper, type PaperOverlay } from "./paper";

const TABLE = 8;

function makeBlock(id: number, text: string, extra: Partial<ViewBlock> = {}): ViewBlock {
  return {
    id, seq: id, text, part: "body", kind: "paragraph", page: 1, page_basis: "estimated", section_label: "", heading_level: null,
    table_id: null, row_index: null, col_index: null, grid_span: 1, row_span: 1, flags: [], has_image: false, part_group: "body", ...extra,
  };
}
function makeUnit(id: number, text: string, extra: Partial<ViewUnit> = {}): ViewUnit {
  return {
    id, display_id: `D-${id}`, kind: "sentence", spans: text === "" ? [] : [[id, 0, text.length]], text, lang: "en", number: null, table_id: null, row_index: null, group_unit_id: null,
    status: "unassigned", pair_id: null, pos_seq: id, block_id: id, is_edited: false, can_unmerge: false, split_suggestion_id: null, ref: null, caption_refs: [], ...extra,
  };
}
const view: DocumentView = {
  document: {} as DocumentView["document"], extraction: null, has_number_ranges: false, pairs: [], part_groups: [], edits: { can_undo: false, can_redo: false },
  tables: [{ id: TABLE, table_index: 0, parent_table_id: null, part: "body", n_rows: 1, n_cols: 1, is_layout: false, is_band: false, anchor: null }],
  blocks: [makeBlock(50, "First"), makeBlock(51, "Second"), makeBlock(52, "Third"), makeBlock(60, "Cell", { kind: "table_cell", table_id: TABLE, row_index: 0, col_index: 0 })],
  units: [makeUnit(50, "First"), makeUnit(51, "Second"), makeUnit(52, "Third"), makeUnit(90, "", { kind: "table", table_id: TABLE, pos_seq: 60, block_id: 60 }), makeUnit(60, "Cell", { kind: "cell_sentence", table_id: TABLE, row_index: 0, group_unit_id: 90 })],
};
const model = buildPaperModel(view);

const make = (over: Partial<PaperOverlay> = {}): PaperOverlay => ({ isFolded: () => false, keyOf: () => "", boxProps: () => null, renderTop: () => null, ...over });
function html(strips: Parameters<typeof Paper>[0]["strips"], pageClassName?: string): string {
  const paper = createElement(Paper, { model, selectedId: null, onUnitClick: () => undefined, testId: "p", pageClassName, strips });
  return renderToStaticMarkup(createElement(LangProvider, null, paper));
}

const overlay = make({
  boxProps: (id) => (id === 50 ? { className: "new-line", attrs: { "data-target": 5, "data-state": "unsourced" }, testId: "assign-new-5" } : null),
  renderTop: (id): ReactNode => (id === 50 ? createElement("span", { className: "new-srcs" }, "chip") : null),
  renderFoot: (id): ReactNode => (id === 50 ? createElement("i", null, "foot") : null),
  textProps: (id) => (id === 50 ? { className: "new-text", "data-testid": "assign-new-pick-5" } : undefined),
  rowAttrs: (id) => (id === 51 ? { "data-ai-view": "dim" } : undefined),
  readWhy: (id) => (id === 51 ? "Why not" : null),
});

describe("an overlay on the paper", () => {
  it("draws the same markup with no overlay", () => {
    expect(html({ overlay: undefined })).toBe(html({}));
    expect(html({ overlay: make() })).toBe(html({}));
  });

  it("puts the target, the state and the class on the strip box", () => {
    const markup = html({ overlay });
    expect(markup).toMatch(/class="strip new-line"[^>]*data-target="5"[^>]*data-state="unsourced"/);
    expect(markup).toMatch(/data-testid="assign-new-5"[^>]*><span class="new-srcs">chip<\/span><div class="new-text" data-testid="assign-new-pick-5"><p/);
    expect(markup).toContain("<i>foot</i>");
    expect(markup).toMatch(/class="strip-row"[^>]*data-ai-view="dim"/);
    expect(markup).toMatch(/data-testid="p-piece-51"[^>]*data-tip="Why not"|data-tip="Why not"[^>]*data-testid="p-piece-51"/);
    expect(markup).toContain('data-testid="p-piece-52"');
  });

  it("puts the cell target on the cell piece with its chips first", () => {
    const cells = make({
      boxProps: (id) => (id === 60 ? { className: "new-cell", attrs: { "data-cell-target": 7 } } : null),
      renderTop: (id) => (id === 60 ? createElement("span", { className: "new-srcs" }) : null),
    });
    expect(html({ overlay: cells })).toMatch(/class="cell-piece new-cell"[^>]*data-cell-target="7"[^>]*>\s*<span class="new-srcs"/);
  });

  it("tells why a table cannot be linked on its head, not over its cells", () => {
    const markup = html({ overlay: make({ readWhy: (id) => (id === 90 ? "Link the cells" : null) }) });
    expect(markup).toMatch(/<div data-unwrap-leave="" data-tip="Link the cells">/);
    expect(markup.match(/Link the cells/g)).toHaveLength(1);
  });

  it("draws one band for folded cards and nothing for the next one", () => {
    const folded = make({ isFolded: (id) => id === 51 || id === 52, renderFolded: (ids) => (ids.includes(51) ? createElement("button", { className: "new-ai-band" }) : null) });
    const markup = html({ overlay: folded });
    expect(markup.match(/new-ai-band/g)).toHaveLength(1);
    expect(markup).not.toContain("p-piece-51");
    expect(markup).not.toContain("p-piece-52");
    // 접힌 카드의 앞 틈도 없다 - 남은 카드 둘 사이 하나
    expect(markup.match(/class="strip-gap"/g)).toHaveLength(1);
  });

  it("adds a class to the page", () => expect(html({}, "new-sheet")).toContain('class="pg new-sheet"'));
});

describe("a far chunk", () => {
  const chunk = (over: Partial<Parameters<typeof isChunkFrozen>[0]>) => ({ live: false, deps: [], isFold: false, render: () => null, ...over });

  it("keeps a far chunk whose own key did not change", () => expect(isChunkFrozen(chunk({ deps: ["m", "a"] }), chunk({ deps: ["m", "a"] }))).toBe(true));
  it("redraws a far chunk whose own box changed", () => expect(isChunkFrozen(chunk({ deps: ["m", "a"] }), chunk({ deps: ["m", "b"] }))).toBe(false));
  it("redraws a chunk on screen", () => expect(isChunkFrozen(chunk({ live: true }), chunk({}))).toBe(false));
});
