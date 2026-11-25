import { describe, expect, it } from "vitest";

import { buildRows } from "./classify-model";
import type { DocumentView, UnitRow, ViewUnit } from "./api-sop";
import type { ViewTable } from "./api-sop";
import { buildNavKeys, buildNoiseBlock, describeNoiseUnit, describeTocParts, findNoiseBlock, listNoiseBlocks, readNoiseReason, readTocNavKey, readUnitNavKey, shouldJoinNoiseCard, toTocNavKey, toggleTocOpen, toUnitNavKey, type NoiseKind } from "./toc-block-model";

const line = (id: number, lang: ViewUnit["lang"], over: Partial<ViewUnit> = {}) => ({ id, lang, text: `line ${id}`, kind: "sentence" as ViewUnit["kind"], group_unit_id: null as number | null, noise_kind: "toc" as NoiseKind, noise_reason: "", table_id: null as number | null, ...over });
const build = (units: ReturnType<typeof line>[]) => buildNoiseBlock(units, (unit) => unit.text);
const t = (key: string, vars?: Record<string, string | number>) => (vars ? `${key} ${Object.values(vars).join(" ")}` : key);

describe("buildNoiseBlock", () => {
  it("counts lines per language and puts one break between the Korean and English contents", () => {
    const block = build([line(1, "ko"), line(2, "ko"), line(3, "en"), line(4, "en"), line(5, "ko")]);

    expect(block?.key).toBe(1);
    expect(block?.counts).toEqual({ total: 5, ko: 3, en: 2 });
    expect(block?.lines.map((item) => item.breakBefore)).toEqual([false, false, true, false, true]);
  });

  it("does not break on neutral or reference lines", () => {
    const block = build([line(1, "ko"), line(2, "neutral"), line(3, "ko"), line(4, "ref")]);

    expect(block?.lines.every((item) => !item.breakBefore)).toBe(true);
  });

  it("is null for no lines", () => {
    expect(build([])).toBeNull();
  });

  it("counts a table or figure as one line and hides its cells", () => {
    const tables = new Map([[9, { id: 9, table_index: 0, n_rows: 2, n_cols: 3 } as ViewTable]]);
    const units = [
      line(1, "ko", { noise_kind: "front" }),
      line(2, "neutral", { noise_kind: "front", kind: "table", text: "", table_id: 9 }),
      line(3, "ko", { noise_kind: "front", kind: "cell_sentence", table_id: 9, group_unit_id: 2 }),
      line(4, "neutral", { noise_kind: "front", kind: "figure", text: "" }),
      line(5, "ko", { noise_kind: "front", kind: "caption", group_unit_id: 4 }),
    ];
    const block = buildNoiseBlock(units, (unit) => describeNoiseUnit(unit, tables, t));

    expect(block?.kind).toBe("front");
    expect(block?.unitIds).toEqual([1, 2, 4]);
    expect(block?.counts.total).toBe(3);
    expect(block?.lines.map((item) => item.text)).toEqual(["line 1", "assign.noise.table 1 2 3", "[Figure]"]);
  });

  it("shows the written reason, or the set phrase", () => {
    const written = build([line(1, "ko", { noise_reason: "cover" }), line(2, "ko", { noise_reason: "cover" })]);
    const plain = build([line(1, "ko", { noise_kind: "history" })]);

    expect(written?.reason).toEqual({ text: "cover", isWritten: true, isMixed: false });
    expect(written && readNoiseReason(written, t)).toBe("cover");
    expect(plain?.reason).toEqual({ text: "", isWritten: false, isMixed: false });
    expect(plain && readNoiseReason(plain, t)).toBe("assign.noise.reason.history");
  });

  it("says mixed when lines have different reasons", () => {
    const block = build([line(1, "ko", { noise_reason: "cover" }), line(2, "ko")]);

    expect(block?.reason).toEqual({ text: "", isWritten: false, isMixed: true });
    expect(block && readNoiseReason(block, t)).toBe("assign.noise.mixed");
    expect(block?.lines.map((item) => item.reason)).toEqual(["cover", ""]);
  });
});

describe("shouldJoinNoiseCard / toggleTocOpen", () => {
  it("joins only consecutive lines of one kind", () => {
    expect(shouldJoinNoiseCard("toc", "toc")).toBe(true);
    expect(shouldJoinNoiseCard(null, "toc")).toBe(false);
    expect(shouldJoinNoiseCard("toc", null)).toBe(false);
    expect(shouldJoinNoiseCard("front", "toc")).toBe(false);
    expect(shouldJoinNoiseCard(null, null)).toBe(false);
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

describe("listNoiseBlocks / buildNavKeys", () => {
  const unit = (id: number, pos: number, noise: NoiseKind | null, kind: ViewUnit["kind"] = "sentence", group: number | null = null) => ({ id, kind, spans: [[pos, 0, 1]] as ViewUnit["spans"], pos_seq: pos, noise_kind: noise, group_unit_id: group });

  it("groups contents lines that follow each other in paper order, keyed by the first line", () => {
    const blocks = listNoiseBlocks([unit(5, 3, "toc"), unit(4, 2, "toc"), unit(6, 4, null), unit(7, 5, "toc"), unit(8, 6, "toc", "cell_sentence")]);

    expect(blocks).toEqual([
      { key: 4, kind: "toc", unitIds: [4, 5] },
      { key: 7, kind: "toc", unitIds: [7, 8] },
    ]);
  });

  it("breaks the block where the kind changes", () => {
    const kinds: NoiseKind[] = ["toc", "toc", "toc", "front", "front", "toc"];
    const blocks = listNoiseBlocks(kinds.map((kind, at) => unit(at + 1, at, kind)));

    expect(blocks).toEqual([
      { key: 1, kind: "toc", unitIds: [1, 2, 3] },
      { key: 4, kind: "front", unitIds: [4, 5] },
      { key: 6, kind: "toc", unitIds: [6] },
    ]);
  });

  it("does not let a table's cells and captions break or join a block", () => {
    const blocks = listNoiseBlocks([unit(1, 0, "front"), unit(2, 1, "front", "table"), unit(3, 1, "front", "cell_sentence", 2), unit(4, 2, "front")]);

    expect(blocks).toEqual([{ key: 1, kind: "front", unitIds: [1, 2, 4] }]);
  });

  it("finds the block of the picked line even when the first line left it", () => {
    const blocks = listNoiseBlocks([unit(2, 1, "front"), unit(3, 2, "front"), unit(9, 8, "history")]);

    expect(findNoiseBlock(blocks, { key: 1, unitId: 3 })?.key).toBe(2);
    expect(findNoiseBlock(blocks, { key: 9, unitId: null })?.key).toBe(9);
    expect(findNoiseBlock(blocks, { key: 1, unitId: null })).toBeUndefined();
  });

  it("puts a block between the rows around it and reads its key back", () => {
    const position = new Map<number, readonly [number, number, number]>([
      [1, [0, 0, 0]],
      [4, [0, 2, 0]],
      [6, [0, 4, 0]],
      [9, [1, 0, 0]],
    ]);

    const keys = buildNavKeys([{ key: "u1", unitIds: [1] }, { key: "u6", unitIds: [6] }, { key: "u9", unitIds: [9] }], [{ key: 4 }], position, { byUnit: false });

    expect(keys).toEqual(["u1", toTocNavKey(4), "u6", "u9"]);
    expect(readTocNavKey(keys[1])).toBe(4);
    expect(readTocNavKey("u1")).toBeNull();
  });

  it("walks box by box - a far pair keeps each box in its own place (J/K one box at a time)", () => {
    // 1 ↔ 4, 2 ↔ 5가 떨어진 짝, 3은 외톨이 - 줄은 셋이지만 박스는 다섯 자리
    const position = new Map<number, readonly [number, number, number]>([1, 2, 3, 4, 5].map((id) => [id, [0, id, 0]] as const));
    const rows = [{ key: "p1", unitIds: [1, 4] }, { key: "p2", unitIds: [2, 5] }, { key: "u3", unitIds: [3] }];

    const keys = buildNavKeys(rows, [], position, { byUnit: true });

    expect(keys.map(readUnitNavKey)).toEqual([1, 2, 3, 4, 5]);
    expect(keys[0]).toBe(toUnitNavKey(1));
    expect(readUnitNavKey(toTocNavKey(1))).toBeNull();
    // Pair view(줄 단위)는 줄 키 하나씩, 줄의 첫 박스 자리에
    expect(buildNavKeys(rows, [], position, { byUnit: false })).toEqual(["p1", "p2", "u3"]);
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
