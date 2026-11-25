// 저절로 삭제된 블록 - 종류마다 접힌 카드 하나, 접힌 채 보이는 두 단추, 표는 한 줄, 고른 줄만 삭제 취소가 펼친 채.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import type { DocumentView, ViewBlock, ViewUnit } from "@/lib/api-sop";
import { LangProvider } from "@/lib/i18n";
import { buildPaperModel } from "@/lib/paper-model";

import { Paper } from "./paper";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

type Noise = NonNullable<NonNullable<Parameters<typeof Paper>[0]["strips"]>["noise"]>;

function makeBlock(id: number, text: string, extra: Partial<ViewBlock> = {}): ViewBlock {
  return {
    id, seq: id, text, part: "body", kind: "paragraph", page: 1, page_basis: "estimated", section_label: "", heading_level: null,
    table_id: null, row_index: null, col_index: null, grid_span: 1, row_span: 1, flags: [], has_image: false, part_group: "body", ...extra,
  };
}

function makeUnit(id: number, blockId: number, text: string, extra: Partial<ViewUnit> = {}): ViewUnit {
  return {
    id, display_id: `D-${id}`, kind: "sentence", spans: text === "" ? [] : [[blockId, 0, text.length]], text, lang: "ko", number: null, table_id: null, row_index: null, group_unit_id: null,
    status: "unassigned", pair_id: null, pos_seq: blockId, block_id: blockId, is_edited: false, can_unmerge: false, split_suggestion_id: null, ref: null, caption_refs: [], noise_reason: "", ...extra,
  };
}

// 표지 글 · 표(1×2) | 목차 | 본문 | 개정 이력
const VIEW: DocumentView = {
  document: {} as DocumentView["document"], extraction: null, has_number_ranges: false, pairs: [], part_groups: [], edits: { can_undo: false, can_redo: false },
  tables: [{ id: 7, table_index: 0, parent_table_id: null, part: "body", n_rows: 1, n_cols: 2, is_layout: false, is_band: false, anchor: null }],
  blocks: [
    makeBlock(1, "표지"), makeBlock(2, "가", { kind: "table_cell", table_id: 7, row_index: 0, col_index: 0 }), makeBlock(3, "나", { kind: "table_cell", table_id: 7, row_index: 0, col_index: 1 }),
    makeBlock(4, "1. 목적 .... 3"), makeBlock(5, "본문이다."), makeBlock(6, "개정 이력"),
  ],
  units: [
    makeUnit(11, 1, "표지", { noise_kind: "front" }),
    makeUnit(12, 2, "", { kind: "table", lang: "neutral", table_id: 7, noise_kind: "front" }),
    makeUnit(13, 2, "가", { kind: "cell_sentence", table_id: 7, row_index: 0, group_unit_id: 12, noise_kind: "front" }),
    makeUnit(14, 3, "나", { kind: "cell_sentence", table_id: 7, row_index: 0, group_unit_id: 12, noise_kind: "front" }),
    makeUnit(15, 4, "1. 목적 .... 3", { noise_kind: "toc" }),
    makeUnit(16, 5, "본문이다."),
    makeUnit(17, 6, "개정 이력", { noise_kind: "history", noise_reason: "다른 문서에 있다" }),
  ],
};

function render(over: Partial<Noise> = {}): { host: HTMLElement; noise: Noise } {
  const noise: Noise = { canEdit: true, busy: false, onClear: vi.fn(), onReason: vi.fn(), open: new Set(), selected: null, onToggle: vi.fn(), onPick: vi.fn(), ...over };
  const host = document.createElement("div");
  document.body.appendChild(host);
  const props = { model: buildPaperModel(VIEW), selectedId: null, onUnitClick: vi.fn(), testId: "p", strips: { noise } };
  act(() => createRoot(host).render(createElement(LangProvider, null, createElement(Paper, props))));
  return { host, noise };
}

const find = (host: HTMLElement, testId: string) => host.querySelector<HTMLElement>(`[data-testid="${testId}"]`);

describe("automatically deleted blocks in the paper", () => {
  it("folds one block per kind and keeps the buttons visible while folded", () => {
    const { host, noise } = render();
    const heads = Array.from(host.querySelectorAll('[data-testid^="p-noise-head-"]')).map((el) => el.textContent);
    expect(heads).toEqual([
      "DELETEDFront matter · 2 lines · Reason: Before chapter 1",
      "DELETEDContents · 1 lines · Reason: The app builds the new contents",
      "DELETEDChange history · 1 lines · Reason: 다른 문서에 있다",
    ]);
    expect(host.querySelectorAll('[data-testid^="p-noise-line-"]')).toHaveLength(0);
    expect(find(host, "p-piece-11")).toBeNull();
    expect(find(host, "p-piece-16")).not.toBeNull();

    act(() => find(host, "p-noise-clear-11")?.click());
    expect(noise.onClear).toHaveBeenCalledWith([11, 12]);
    act(() => find(host, "p-noise-reason-11")?.click());
    expect(noise.onReason).toHaveBeenCalledWith([11, 12]);
  });

  it("shows the table as one line and keeps Restore open on the picked line only", () => {
    const { host, noise } = render({ open: new Set([11]), selected: { key: 11, unitId: 12 } });
    expect(Array.from(host.querySelectorAll('[data-testid^="p-noise-line-"]')).map((el) => el.textContent)).toEqual(["표지", "Table 1 (1×2)"]);
    expect(Array.from(host.querySelectorAll(".mbtn.reveal")).map((el) => el.getAttribute("data-testid"))).toEqual(["p-noise-unit-clear-12"]);

    act(() => find(host, "p-noise-unit-clear-11")?.click());
    expect(noise.onClear).toHaveBeenCalledWith([11]);
    act(() => find(host, "p-noise-unit-reason-12")?.click());
    expect(noise.onReason).toHaveBeenCalledWith([12]);
  });

  it("picks the block or the line a button belongs to, so Enter cannot confirm the row picked before", () => {
    const { host, noise } = render({ open: new Set([11]) });
    for (const testId of ["p-noise-reason-11", "p-noise-clear-11", "p-noise-unit-reason-12", "p-noise-unit-clear-12"]) act(() => find(host, testId)?.click());
    expect(vi.mocked(noise.onPick).mock.calls).toEqual([[11, null], [11, null], [11, 12], [11, 12]]);
  });

  it("only folds and unfolds for a reader", () => {
    const { host } = render({ canEdit: false, open: new Set([11]) });
    expect(host.querySelectorAll('[data-testid^="p-noise-clear-"], [data-testid^="p-noise-reason-"], [data-testid^="p-noise-unit-"]')).toHaveLength(0);
  });
});
