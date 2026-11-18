import { describe, expect, it } from "vitest";

import { buildRows } from "./classify-model";
import type { DocumentView, UnitRow, ViewUnit } from "./api-sop";
import { buildNavKeys, buildTocBlock, describeTocParts, listTocBlocks, readTocNavKey, shouldJoinTocCard, toTocNavKey, toggleTocOpen } from "./toc-block-model";

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

describe("describeTocParts", () => {
  it("names the first two language runs and counts the rest as after (한글 4 · 영어 3 · 그 뒤 1)", () => {
    expect(describeTocParts(["ko", "ko", "ko", "ko", "en", "en", "en", "ko"])).toEqual([
      { part: "ko", n: 4 },
      { part: "en", n: 3 },
      { part: "after", n: 1 },
    ]);
  });

  it("keeps neutral lines in the run before them and reads one language as one part", () => {
    expect(describeTocParts(["ko", "neutral", "ko"])).toEqual([{ part: "ko", n: 3 }]);
    expect(describeTocParts(["en", "en"])).toEqual([{ part: "en", n: 2 }]);
  });
});

describe("listTocBlocks / buildNavKeys", () => {
  const unit = (id: number, pos: number, noise: "toc" | null, kind: ViewUnit["kind"] = "sentence") => ({ id, kind, spans: [[pos, 0, 1]] as ViewUnit["spans"], pos_seq: pos, noise_kind: noise });

  it("groups contents lines that follow each other in paper order, keyed by the first line", () => {
    const blocks = listTocBlocks([unit(5, 3, "toc"), unit(4, 2, "toc"), unit(6, 4, null), unit(7, 5, "toc"), unit(8, 6, "toc", "cell_sentence")]);

    expect(blocks).toEqual([
      { key: 4, unitIds: [4, 5] },
      { key: 7, unitIds: [7, 8] },
    ]);
  });

  it("puts a block between the rows around it and reads its key back", () => {
    const position = new Map<number, readonly [number, number, number]>([
      [1, [0, 0, 0]],
      [4, [0, 2, 0]],
      [6, [0, 4, 0]],
      [9, [1, 0, 0]],
    ]);

    const keys = buildNavKeys([{ key: "u1", unitIds: [1] }, { key: "u6", unitIds: [6] }, { key: "u9", unitIds: [9] }], [{ key: 4 }], position);

    expect(keys).toEqual(["u1", toTocNavKey(4), "u6", "u9"]);
    expect(readTocNavKey(keys[1])).toBe(4);
    expect(readTocNavKey("u1")).toBeNull();
  });
});

describe("buildRows with contents lines", () => {
  const unit = (id: number, noise: "toc" | null): ViewUnit => ({
    id, display_id: `D-${id}`, kind: "sentence", spans: [[1, id, id + 1]], text: `t${id}`, lang: "ko", number: null, table_id: null,
    row_index: null, group_unit_id: null, status: "unassigned", pair_id: null, pos_seq: id, block_id: id, is_edited: false,
    can_unmerge: false, split_suggestion_id: null, ref: null, caption_refs: [], noise_kind: noise,
  });

  it("leaves contents lines out of the rows so they do not count as remaining", () => {
    const view = { document: { id: 1 }, units: [unit(1, "toc"), unit(2, "toc"), unit(3, null)], pairs: [] } as unknown as DocumentView;
    const unitRows = new Map([1, 2, 3].map((id) => [id, { unit_id: id, status: "unassigned" } as UnitRow]));

    expect(buildRows([view], unitRows).map((row) => row.unitIds)).toEqual([[3]]);
  });
});
