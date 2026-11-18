import { describe, expect, it } from "vitest";

import { buildRows } from "./classify-model";
import type { DocumentView, UnitRow, ViewUnit } from "./api-sop";
import { buildTocBlock, shouldJoinTocCard, toggleTocOpen } from "./toc-block-model";

const line = (id: number, lang: ViewUnit["lang"], text = `line ${id}`) => ({ id, lang, text });

describe("buildTocBlock", () => {
  it("counts lines per language and puts one break between the Korean and English contents", () => {
    const block = buildTocBlock([line(1, "ko"), line(2, "ko"), line(3, "en"), line(4, "en"), line(5, "ko")]);

    expect(block?.key).toBe(1);
    expect(block?.counts).toEqual({ total: 5, ko: 3, en: 2 });
    expect(block?.lines.map((item) => item.breakBefore)).toEqual([false, false, true, false, true]);
  });

  it("does not break on neutral or reference lines", () => {
    const block = buildTocBlock([line(1, "ko"), line(2, "neutral"), line(3, "ko"), line(4, "ref")]);

    expect(block?.lines.every((item) => !item.breakBefore)).toBe(true);
  });

  it("is null for no lines", () => {
    expect(buildTocBlock([])).toBeNull();
  });
});

describe("shouldJoinTocCard / toggleTocOpen", () => {
  it("joins only consecutive contents lines", () => {
    expect(shouldJoinTocCard(true, true)).toBe(true);
    expect(shouldJoinTocCard(false, true)).toBe(false);
    expect(shouldJoinTocCard(true, false)).toBe(false);
  });

  it("opens and closes a block by its key", () => {
    const opened = toggleTocOpen(new Set(), 7);
    expect([...opened]).toEqual([7]);
    expect([...toggleTocOpen(opened, 7)]).toEqual([]);
  });
});

describe("buildRows with contents lines", () => {
  const unit = (id: number, noise: "toc" | null): ViewUnit => ({
    id, display_id: `D-${id}`, kind: "sentence", spans: [[1, id, id + 1]], text: `t${id}`, lang: "ko", table_id: null,
    row_index: null, group_unit_id: null, status: "unassigned", pair_id: null, pos_seq: id, block_id: id, is_edited: false,
    can_unmerge: false, split_suggestion_id: null, ref: null, caption_refs: [], noise_kind: noise,
  });

  it("leaves contents lines out of the rows so they do not count as remaining", () => {
    const view = { document: { id: 1 }, units: [unit(1, "toc"), unit(2, "toc"), unit(3, null)], pairs: [] } as unknown as DocumentView;
    const unitRows = new Map([1, 2, 3].map((id) => [id, { unit_id: id, status: "unassigned" } as UnitRow]));

    expect(buildRows([view], unitRows).map((row) => row.unitIds)).toEqual([[3]]);
  });
});
