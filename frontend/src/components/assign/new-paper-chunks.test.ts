// 긴 New 문서의 먼 덩어리 - 얹어 그리는 값 하나가 바뀌면 화면 밖이어도 그 모습이 맞는다(연결선 · 끌어 놓기가 먼 박스의 칩과 표시를 읽는다).
import { act, createElement, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DocumentView, ViewBlock, ViewUnit, WrittenSentence } from "@/lib/api-sop";
import { LangProvider } from "@/lib/i18n";
import { buildNewAiFilter } from "@/lib/new-ai-filter-model";
import { buildNewOverlay, type NewOverlayInput } from "@/lib/new-overlay-model";
import { buildPaperModel, buildPaperTabs } from "@/lib/paper-model";

import { NewPaper, type NewPaperProps } from "./new-paper";

const IDS = Array.from({ length: 200 }, (_, at) => at + 1);
const TABLE = 8;
/** 먼 덩어리(121~160)의 문장 · 표 · 칸 */
const FAR = 150;
const CELL = 155;
const TABLE_UNIT = 900;
const NONE: ReadonlySet<number> = new Set();

const blocks = IDS.map((id): ViewBlock => ({
  id, seq: id, text: `Line ${id}`, part: "body", kind: id === CELL ? "table_cell" : "paragraph", page: 1, page_basis: "estimated", section_label: "", heading_level: null,
  table_id: id === CELL ? TABLE : null, row_index: id === CELL ? 0 : null, col_index: id === CELL ? 0 : null, grid_span: 1, row_span: 1, flags: [], has_image: false, part_group: "body",
}));
const makeUnit = (id: number, over: Partial<ViewUnit> = {}): ViewUnit => ({
  id, display_id: `N-${id}`, kind: "sentence", spans: [[id, 0, `Line ${id}`.length]], text: `Line ${id}`, lang: "en", number: null, table_id: null, row_index: null, group_unit_id: null,
  status: null, pair_id: null, pos_seq: id, block_id: id, is_edited: false, can_unmerge: false, split_suggestion_id: null, ref: null, caption_refs: [], ...over,
});
const view: DocumentView = {
  document: { id: 3 } as DocumentView["document"], extraction: null, has_number_ranges: false, pairs: [], part_groups: [], edits: { can_undo: false, can_redo: false },
  tables: [{ id: TABLE, table_index: 0, parent_table_id: null, part: "body", n_rows: 1, n_cols: 1, is_layout: false, is_band: false, anchor: null }],
  blocks,
  units: [...IDS.map((id) => makeUnit(id, id === CELL ? { kind: "cell_sentence", table_id: TABLE, row_index: 0, group_unit_id: TABLE_UNIT } : {})), makeUnit(TABLE_UNIT, { kind: "table", spans: [], text: "", table_id: TABLE, pos_seq: CELL, block_id: CELL })],
};
const model = buildPaperModel(view);
const tabs = buildPaperTabs(view, model);

const row = (unitId: number, over: Partial<WrittenSentence> = {}): WrittenSentence => ({
  target_id: unitId + 1000, target_doc_id: 1, doc_code: "SOP-1", section_path: "1. Scope", order_index: unitId, lang: "en", kind: "sentence", text: `Line ${unitId}`, status: "confirmed",
  change_type: null, source_unit_ids: [9], partner_target_id: null, remark: "", revision: 1, new_unit_id: unitId, ...over,
});
function listRows(far: Partial<WrittenSentence> = {}, cellSources: number[] = [9]): WrittenSentence[] {
  const table = row(TABLE_UNIT, { kind: "table", source_unit_ids: [], table: { rows: 1, cols: 1, cells: [{ target_id: 77, row: 0, col: 0, lang: "en", text: "Line", status: "confirmed", source_unit_ids: cellSources, revision: 1, new_unit_id: CELL, change_type: null }] } });
  return [...IDS.filter((id) => id !== CELL).map((id) => row(id, id === FAR ? far : {})), table];
}

type Shown = Partial<NewPaperProps> & { input?: Partial<NewOverlayInput> };

let host: HTMLDivElement;
let root: Root;
const frames: FrameRequestCallback[] = [];
let current: Shown | null = null;
let notify = () => undefined as void;
const subscribe = (listener: () => void) => {
  notify = listener;
  return () => undefined;
};
const getLabel = (id: number) => `1-${id}`;
const noop = () => undefined;

function Screen() {
  const shown = useSyncExternalStore(subscribe, () => current);
  if (shown === null) return null;
  const { input, ...props } = shown;
  const overlay = buildNewOverlay({ rows: listRows(), candidateIds: NONE, pickedIds: NONE, focusId: null, shapeUnitId: null, aiFilter: null, openAiSections: new Set(), ...input });
  return createElement(NewPaper, {
    bundleId: 1, docOptions: [{ value: "1", label: "SOP-1" }], docId: "1", fileId: 3, onDocChange: noop, tag: "New", linesOn: true, onToggleLines: noop, zoom: 1, onZoom: noop,
    view, model, tabs, placeholder: null, overlay, onOpenAiSection: noop, cellPickable: false, cellDroppable: false, sourceLabel: getLabel, onJumpSource: noop, selectedUnitId: null,
    pickedUnitIds: NONE, onPick: noop, ...props,
  });
}

async function render(shown: Shown) {
  await act(async () => {
    current = shown;
    notify();
  });
  await act(async () => {
    for (const run of frames.splice(0)) run(0);
  });
}

beforeEach(() => {
  current = null;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  frames.length = 0;
  vi.stubGlobal("requestAnimationFrame", (run: FrameRequestCallback) => frames.push(run));
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  // 덩어리마다 1,000px씩 - 보이는 칸과 그 위아래 한 화면에는 0 · 1번 덩어리만 걸친다
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const at = [...document.querySelectorAll(".strip-chunk")].indexOf(this);
    return { top: at * 1000, bottom: at * 1000 + 999, left: 0, right: 0, width: 0, height: 999, x: 0, y: at * 1000, toJSON: () => null } as DOMRect;
  });
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  act(() => root.render(createElement(LangProvider, null, createElement(Screen))));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const box = () => host.querySelector(`[data-testid="assign-new-${FAR + 1000}"]`);
const cell = () => host.querySelector('[data-testid="assign-new-cell-77"]');

describe("a far chunk of a long New paper", () => {
  const changes: Array<[string, Shown, () => unknown, unknown, unknown]> = [
    ["a source", { input: { rows: listRows({ source_unit_ids: [9, 12] }) } }, () => box()?.querySelectorAll("[data-src-unit]").length, 1, 2],
    ["the label of a source", { sourceLabel: (id) => `2-${id}` }, () => box()?.querySelector("[data-src-unit]")?.textContent, "1-9", "2-9"],
    ["an AI link", { input: { rows: listRows({ status: "ai_suggested" }) } }, () => box()?.querySelector("[data-ai]") !== null, false, true],
    ["marked new", { input: { rows: listRows({ change_type: "new" }) } }, () => box()?.querySelector(".is-new") !== null, false, true],
    ["a reference mark", { input: { rows: listRows({ ref: { number: "SOP-9", equis: null }, ref_issue: "number" }) } }, () => box()?.querySelector(".is-warn") !== null, false, true],
    ["a candidate", { input: { candidateIds: new Set([FAR + 1000]) } }, () => box()?.getAttribute("data-state"), null, "candidate"],
    ["a pick", { input: { pickedIds: new Set([FAR + 1000]) } }, () => box()?.getAttribute("data-state"), null, "picked"],
    ["the focus", { input: { focusId: FAR + 1000 } }, () => box()?.getAttribute("data-state"), null, "focus"],
    ["shaping", { input: { shapeUnitId: FAR } }, () => box()?.getAttribute("data-state"), null, "shape"],
    ["the menu in the box", { foot: { unitId: FAR, node: createElement("i") } }, () => box()?.querySelector("i") !== null, false, true],
    ["the AI filter", { input: { aiFilter: buildNewAiFilter(true, [9], listRows({ source_unit_ids: [12] })), rows: listRows({ source_unit_ids: [12] }) } }, () => box()?.closest(".strip-row")?.getAttribute("data-ai-view"), null, "dim"],
    ["a pickable cell", { cellPickable: true }, () => cell()?.hasAttribute("data-pickable"), false, true],
    ["a droppable cell", { cellDroppable: true }, () => cell()?.getAttribute("data-drop"), null, "cell"],
    ["unlinking a cell", { onUnlink: noop }, () => cell()?.querySelector(".new-src-x") !== null, false, true],
    ["a cell's source", { input: { rows: listRows({}, [9, 12]) } }, () => cell()?.querySelectorAll("[data-src-unit]").length, 1, 2],
    ["an unsourced cell", { input: { rows: listRows({}, []) } }, () => cell()?.getAttribute("data-state"), null, "unsourced"],
  ];

  it.each(changes)("shows %s and takes it back", async (_, shown, read, before, after) => {
    await render({});
    expect(host.querySelectorAll(".strip-chunk").length).toBeGreaterThan(3);
    expect(read()).toEqual(before);
    await render(shown);
    expect(read()).toEqual(after);
    await render({});
    expect(read()).toEqual(before);
  });

  it("folds and opens the AI suggestions of other lines", async () => {
    const rows = listRows({ source_unit_ids: [12], status: "ai_suggested" });
    const aiFilter = buildNewAiFilter(true, [9], rows);
    const band = () => host.querySelector('[data-testid="assign-new-ai-hidden-1"]');
    await render({ input: { rows } });
    expect(box()).not.toBeNull();
    await render({ input: { rows, aiFilter } });
    expect([box() === null, band() !== null]).toEqual([true, true]);
    await render({ input: { rows, aiFilter, openAiSections: new Set(["1"]) } });
    expect([box() === null, band() !== null]).toEqual([false, false]);
  });

  it("opens the hidden chips of a far box", async () => {
    const shown: Shown = { input: { rows: listRows({ source_unit_ids: [9, 12, 13, 14] }) } };
    await render(shown);
    expect(box()?.querySelectorAll("[data-src-unit]").length).toBe(2);
    await act(async () => host.querySelector<HTMLButtonElement>(`[data-testid="assign-new-src-more-${FAR + 1000}"]`)?.click());
    expect(box()?.querySelectorAll("[data-src-unit]").length).toBe(4);
  });

  it("changes a far pair group with the document", async () => {
    await render({});
    expect(box()?.getAttribute("data-pair-group")).toBeNull();
    const paired = buildPaperModel({ ...view, units: view.units.map((unit) => (unit.id === FAR || unit.id === FAR + 2 ? { ...unit, pair_id: 4 } : unit)) });
    await render({ model: paired });
    expect(box()?.getAttribute("data-pair-group")).toBe("4");
  });
});
