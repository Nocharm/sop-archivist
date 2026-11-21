/**
 * Frontend copies of backend rules answer the same as the backend, case by case.
 * Cases and answers come from backend/scripts/dump_rule_cases.py (rule-cases.json, kept current by backend tests/test_rule_cases.py).
 */

import { describe, expect, it } from "vitest";

import type { NumberStyle } from "./api-sop";
import { buildBlockPlaces, CAPTION_REACH } from "./caption-slot-model";
import { MAX_NUMBER_CHARS, planFollow } from "./number-model";
import cases from "./rule-cases.json";
import { getRowLevels, MAX_LEVEL } from "./strip-pill-model";
import { BULLET_SYMBOLS, getSectionDepths, MAX_BULLET_LEVEL, MAX_INDENT_LEVEL, NUMBER_STYLES, numberLines } from "./section-number";
import { orderUnwrapped, orderUnwrappedLines } from "./unwrap-order-model";

const toRecord = (map: ReadonlyMap<number, unknown>) => Object.fromEntries([...map].sort(([a], [b]) => a - b).map(([k, v]) => [String(k), v]));

describe("rule cases shared with the backend", () => {
  it("uses the same constants", () => {
    expect({
      MAX_INDENT_LEVEL,
      MAX_BULLET_LEVEL,
      BULLET_SYMBOLS: [...BULLET_SYMBOLS],
      MAX_NUMBER_CHARS,
      CAPTION_REACH,
      MAX_ROW_LEVEL: MAX_LEVEL,
    }).toEqual({ ...cases.constants, NUMBER_STYLES: undefined });
    // The frontend orders styles for its buttons; the set of values must match.
    expect([...NUMBER_STYLES].sort()).toEqual([...cases.constants.NUMBER_STYLES].sort());
  });

  it.each(cases.number_lines)("numberLines($base, $depths) matches outputs.number_lines", ({ base, depths, numbers }) => {
    expect(numberLines(base, depths)).toEqual(numbers);
  });

  it.each(cases.plan_follow)("planFollow($numbers, $index, $next) matches numbering.plan_follow", ({ numbers, index, next, follow }) => {
    expect(toRecord(planFollow(numbers, index, next))).toEqual(follow);
  });

  it.each(cases.bullet_depths)("getSectionDepths bullet lines match outputs.get_bullet_depths", ({ items, depths }) => {
    const section = { counts_lines: true, number: null, items: items.map((item) => ({ ...item, number_style: item.number_style as NumberStyle, number: null })) };
    const shown = getSectionDepths(section);
    expect(depths.map((depth, i) => (depth === null ? null : shown[i]))).toEqual(depths);
  });

  it.each(cases.block_places.map((c, i) => ({ ...c, i })))("buildBlockPlaces case $i matches caption_slot.build_block_places", ({ blocks, tables, places }) => {
    // JSON widens `kind` to string; the backend wrote only real block kinds.
    expect(toRecord(buildBlockPlaces(blocks as Parameters<typeof buildBlockPlaces>[0], tables))).toEqual(places);
  });

  it.each(cases.row_levels.map((c, i) => ({ ...c, i })))("getRowLevels case $i matches numbering.build_row_levels", ({ rows, levels }) => {
    const levelRows = rows.map((row, index) => ({ key: String(index), part: "body", sectionLabel: row.label, shift: row.shift, hasCell: row.has_cell, pairTopOf: row.pair_top === null ? null : String(row.pair_top) }));
    const shown = getRowLevels(levelRows);
    expect(levelRows.map((row) => shown.get(row.key)?.level)).toEqual(levels);
  });

  it.each(cases.unwrap_order.map((c, i) => ({ ...c, i })))("orderUnwrapped case $i matches unwrap_order.order_unwrapped", ({ lines, order }) => {
    expect(orderUnwrapped(lines, (line) => line.seq, (line) => line.pos).map((line) => line.id)).toEqual(order);
  });

  it.each(cases.unwrap_lines.map((c, i) => ({ ...c, i })))("orderUnwrappedLines case $i matches unwrap_order.order_unwrapped_lines", ({ items, seqs, order }) => {
    const blocks = new Map(items.map((item) => [item.line, item.block]));
    const seqOf = (line: number) => (seqs as Record<string, number | undefined>)[String(line)];
    expect(orderUnwrappedLines(items, (item) => item.line, (line) => blocks.get(line) ?? null, seqOf).map((item) => item.id)).toEqual(order);
  });
});
