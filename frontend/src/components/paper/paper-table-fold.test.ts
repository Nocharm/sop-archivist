// 표 탭 · 본문 표 접기(11-23 명세 E2) - 표 탭은 표만 자리 머리와 함께 그리고 본문과 같은 표 도구를 둔다.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DocumentView, TableCounterpart, TableFollow, ViewBlock, ViewTable, ViewUnit } from "@/lib/api-sop";
import { LangProvider } from "@/lib/i18n";
import { buildPaperModel } from "@/lib/paper-model";
import type { TableFollowStrip } from "@/lib/use-table-follow";

import { Paper } from "./paper";

type Strips = NonNullable<Parameters<typeof Paper>[0]["strips"]>;

function block(id: number, text: string, extra: Partial<ViewBlock> = {}): ViewBlock {
  return {
    id, seq: id, text, part: "body", kind: "paragraph", page: 1, page_basis: "estimated", section_label: "", heading_level: null,
    table_id: null, row_index: null, col_index: null, grid_span: 1, row_span: 1, flags: [], has_image: false, part_group: "body", ...extra,
  };
}
function cell(id: number, tableId: number, row: number, col: number, section: string, text: string): ViewBlock {
  return block(id, text, { kind: "table_cell", table_id: tableId, row_index: row, col_index: col, section_label: section });
}
function unit(id: number, text: string, extra: Partial<ViewUnit> = {}): ViewUnit {
  return {
    id, display_id: `D-${id}`, kind: "sentence", spans: text === "" ? [] : [[id, 0, text.length]], text, lang: "en", number: null, table_id: null, row_index: null, group_unit_id: null,
    status: "unassigned", pair_id: null, pos_seq: id, block_id: id, is_edited: false, can_unmerge: false, split_suggestion_id: null, ref: null, caption_refs: [], ...extra,
  };
}
function table(id: number, index: number, rows: number, cols: number, extra: Partial<ViewTable> = {}): ViewTable {
  return { id, table_index: index, parent_table_id: null, part: "body", n_rows: rows, n_cols: cols, is_layout: false, is_band: false, anchor: null, ...extra };
}

// 본문 문장 · 캡션 "배양 조건" · 표 2(표 번호 2, 4×2, §5, 아직 표 - 칸 문장 21 · 22) · 다음 문장 · 영어 표 5(3×3, §6, 벗김 - 줄 31 · 32 · 33)
const view: DocumentView = {
  document: {} as DocumentView["document"], extraction: null, has_number_ranges: false, pairs: [], part_groups: [], edits: { can_undo: false, can_redo: false },
  blocks: [
    block(10, "본문 문장", { section_label: "5" }),
    block(11, "배양 조건", { section_label: "5" }),
    cell(12, 2, 0, 0, "5", "Temp"), cell(13, 2, 0, 1, "5", "37 C"),
    block(14, "다음 문장", { section_label: "6" }),
    cell(15, 5, 0, 0, "6", "line one"), cell(16, 5, 1, 0, "6", "line two"), cell(17, 5, 2, 0, "6", "line three"),
  ],
  units: [
    unit(10, "본문 문장"),
    unit(11, "배양 조건", { kind: "caption", group_unit_id: 20 }),
    unit(20, "", { kind: "table", table_id: 2, block_id: 12, pos_seq: 12 }),
    unit(21, "Temp", { kind: "cell_sentence", table_id: 2, group_unit_id: 20, spans: [[12, 0, 4]], block_id: 12, pos_seq: 12 }),
    unit(22, "37 C", { kind: "cell_sentence", table_id: 2, group_unit_id: 20, spans: [[13, 0, 4]], block_id: 13, pos_seq: 13 }),
    unit(14, "다음 문장"),
    unit(31, "line one", { kind: "cell_sentence", table_id: 5, spans: [[15, 0, 8]], block_id: 15, pos_seq: 15 }),
    unit(32, "line two", { kind: "cell_sentence", table_id: 5, spans: [[16, 0, 8]], block_id: 16, pos_seq: 16 }),
    unit(33, "line three", { kind: "cell_sentence", table_id: 5, spans: [[17, 0, 10]], block_id: 17, pos_seq: 17 }),
  ],
  tables: [table(2, 1, 4, 2), table(5, 4, 3, 3, { is_layout: true, lang: "en" })],
};
const model = buildPaperModel(view);

const noop = () => undefined;
const answer: TableCounterpart = { table_no: 5, status: "ambiguous", source_table_id: null, decided: false, candidates: [{ table_id: 9, table_no: 3, score: 0.5 }] };
const followPlan: TableFollow = { source_table_id: 9, mode: "rule", items: [{ unit_ids: [32], order: 1, number: null, indent: false, indent_shift: null, delete: false }], count: 1, lines: [31, 32, 33] };
function makeFollow(onApply: TableFollowStrip["onApply"] = noop): NonNullable<NonNullable<Strips["unwrap"]>["follow"]> {
  const plan: TableFollowStrip = { plans: new Map([[5, followPlan]]), each: new Set(), onApply, onEach: noop, onKeep: noop, reload: noop, ai: { enabled: true, asks: new Set(), busy: new Set(), onAsk: noop } };
  return { answers: new Map([[5, answer]]), onPick: noop, plan };
}

interface Options {
  tableRows?: "all" | "only";
  strips?: Strips;
  selectedId?: number | null;
}
function html({ tableRows, strips = {}, selectedId = null }: Options = {}): string {
  const paper = createElement(Paper, { model, items: model.body, selectedId, onUnitClick: noop, testId: "assign-paper", tableRows, strips });
  return renderToStaticMarkup(createElement(LangProvider, null, paper));
}

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});
async function mount(props: Options): Promise<HTMLElement> {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const paper = createElement(Paper, { model, items: model.body, selectedId: null, onUnitClick: noop, testId: "assign-paper", tableRows: props.tableRows, strips: props.strips ?? {} });
  await act(async () => root?.render(createElement(LangProvider, null, paper)));
  return host;
}

describe("tables tab", () => {
  it("draws tables only, each under its place", () => {
    const h = html({ tableRows: "only" });
    expect(h).toContain("§5");
    expect(h).toMatch(/data-testid="assign-table-place-2"[^>]*>[\s\S]*?Under §5/);
    expect(h).toMatch(/data-testid="assign-table-place-5"[^>]*>[\s\S]*?Under §6/);
    expect(h).not.toContain("본문 문장");
    expect(h).not.toContain("다음 문장");
    expect(h).toContain("assign-paper-piece-21");
    expect(h).toContain("assign-paper-piece-32");
  });

  it("puts no place on the body", () => expect(html()).not.toContain("assign-table-place-"));

  it("gives each table the same tools as the body - counterpart pick, follow plan and rewrap", () => {
    const unwrap: Strips["unwrap"] = { canRewrap: true, busy: false, onRewrap: noop, follow: makeFollow() };
    for (const h of [html({ strips: { unwrap } }), html({ tableRows: "only", strips: { unwrap } })]) {
      expect(h).toContain('data-testid="assign-follow-pick-5"');
      expect(h).toContain('data-testid="assign-follow-apply-5"');
      expect(h).toContain('data-testid="assign-paper-rewrap-5"');
      expect(h).toContain('data-testid="assign-follow-chips-32"');
    }
  });

  it("applies the follow plan from the tables tab as from the body", async () => {
    const onApply = vi.fn();
    const shown = await mount({ tableRows: "only", strips: { unwrap: { canRewrap: true, busy: false, onRewrap: noop, follow: makeFollow(onApply) } } });
    await act(async () => shown.querySelector<HTMLButtonElement>('[data-testid="assign-follow-apply-5"]')?.click());
    expect(onApply).toHaveBeenCalledWith(5);
  });

  it("never joins across two tables on the tables tab", () => {
    const join: Strips["join"] = { busy: false, plan: () => ({ kind: "merge" }), onJoin: noop };
    // 본문에서는 표 5 첫 줄 위가 문장이라 합치기가 있고, 표 탭에서는 그 위가 다른 표라 없다
    expect(html({ selectedId: 31, strips: { join } })).toContain('data-testid="assign-paper-join-14-31"');
    expect(html({ selectedId: 31, tableRows: "only", strips: { join } })).not.toMatch(/assign-paper-join-\d+-31"/);
  });
});
