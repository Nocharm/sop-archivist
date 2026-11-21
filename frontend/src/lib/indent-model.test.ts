import { describe, expect, it } from "vitest";

import { findBulletShift, getIndentBounds, planIndent, type IndentRow } from "./indent-model";
import { getRowLevels } from "./strip-pill-model";

/** 본문 줄 - [번호 칸 값, 차이] 차례로 key r0, r1 …, unitId 100 + 차례 */
function build(lines: readonly (readonly [string, number?])[], extra: Record<number, Partial<IndentRow>> = {}): IndentRow[] {
  return lines.map(([label, shift = 0], index) => ({ key: `r${index}`, unitId: 100 + index, part: "body", sectionLabel: label, shift, ...extra[index] }));
}

function levelsOf(rows: readonly IndentRow[]): number[] {
  const levels = getRowLevels(rows);
  return rows.map((row) => levels.get(row.key)!.level);
}

describe("getRowLevels", () => {
  it("adds the saved shift to the computed level of bullet and plain lines, never to numbers", () => {
    expect(levelsOf(build([["5"], ["•", 1], [""], ["", -1], ["5.1", 3]]))).toEqual([1, 3, 3, 2, 2]);
  });
  it("lets plain lines lean on the nearest number or bullet line, not on each other", () => {
    // 첫 번호 없는 줄을 내어써도 둘째는 기호 줄 단계 그대로 - 한 줄씩 되돌릴 수 있다
    expect(levelsOf(build([["5"], ["•"], ["", -1], [""]]))).toEqual([1, 2, 1, 2]);
  });
  it("moves the lines written under a bullet with it", () => {
    expect(levelsOf(build([["5"], ["•", 1], [""]]))).toEqual([1, 3, 3]);
  });
  it("keeps tables and figures on the line before and clamps to the level range", () => {
    expect(levelsOf(build([["5"], ["•", 1], ["", 0]], { 2: { hasCell: false } }))).toEqual([1, 3, 3]);
    expect(levelsOf(build([["", -4], ["•", 20]]))).toEqual([1, 8]);
  });
});

describe("getIndentBounds", () => {
  it("stops outdent at level 1 and indent one level past the line above", () => {
    const rows = build([["5"], ["•"], [""], ["", -1]]);
    const levels = getRowLevels(rows);
    expect(getIndentBounds(rows, levels, "r2")).toEqual({ canOutdent: true, canIndent: true });
    expect(getIndentBounds(rows, levels, "r3")).toEqual({ canOutdent: false, canIndent: true });
    expect(getIndentBounds(rows, getRowLevels(build([["5"], ["•", 1]])), "r1")).toEqual({ canOutdent: true, canIndent: false });
  });
  it("has no shift buttons on number lines and the second row of a pair", () => {
    const rows = build([["5"], ["•"], ["", 0]], { 2: { pairTopOf: "r1" } });
    const levels = getRowLevels(rows);
    expect(getIndentBounds(rows, levels, "r0")).toEqual({ canOutdent: false, canIndent: false });
    expect(getIndentBounds(rows, levels, "r2")).toEqual({ canOutdent: false, canIndent: false });
  });
});

describe("planIndent", () => {
  it("moves the following plain lines of the same level with the clicked one (user example)", () => {
    const rows = build([["5"], ["•"], [""], [""], ["6"]]);
    expect(planIndent(rows, getRowLevels(rows), "r2", -1)).toEqual({ clicked: { unitId: 102, indentShift: -1 }, batch: [{ unitId: 103, indentShift: -1 }] });
  });
  it("carries deeper lines in between and stops at a shallower line or another shape", () => {
    const rows = build([["5"], ["•"], ["•"], ["○"], ["•"], [""], ["•"]]);
    // r1 • ▶: r2 • 같은 꼴, r3 ○ 하위, r4 •, r5 번호 없는 줄은 r4에 기대 저절로 따라가고, r6 •도 같은 단계라 함께
    const plan = planIndent(rows, getRowLevels(rows), "r2", 1);
    expect(plan?.clicked).toEqual({ unitId: 102, indentShift: 1 });
    expect(plan?.batch.map((change) => change.unitId)).toEqual([103, 104, 106]);
    const stopped = build([["5"], ["•"], [""], ["A-1"], [""]]);
    expect(planIndent(stopped, getRowLevels(stopped), "r2", 1)?.batch).toEqual([]); // 같은 단계의 다른 꼴(직접 번호)에서 멈춤
    const sub = build([["5"], [""], ["•"], [""]]);
    // 번호 없는 1단계 줄 아래 기호(2단계)는 하위라 함께, 그 기호에 기댄 줄은 저절로
    expect(planIndent(sub, getRowLevels(sub), "r1", 1)?.batch).toEqual([{ unitId: 102, indentShift: 1 }]);
  });
  it("stops at a number line and skips tables", () => {
    const rows = build([["5"], ["•"], [""], [""], ["5.1"], [""]], { 3: { hasCell: false } });
    expect(planIndent(rows, getRowLevels(rows), "r2", -1)?.batch).toEqual([]);
    const across = build([["5"], ["•"], [""], [""], [""]], { 3: { hasCell: false } });
    expect(planIndent(across, getRowLevels(across), "r2", -1)?.batch).toEqual([{ unitId: 104, indentShift: -1 }]);
  });
  it("returns null past the ends", () => {
    const rows = build([["5"], ["•"], ["", -1]]);
    expect(planIndent(rows, getRowLevels(rows), "r2", -1)).toBeNull();
  });
});

describe("findBulletShift", () => {
  it("takes the shift of the nearest bullet above within the same section", () => {
    expect(findBulletShift(build([["5"], ["•", 1], [""], [""]]), "r3")).toBe(1);
    expect(findBulletShift(build([["5"], ["•", 1], ["6"], [""]]), "r3")).toBeNull();
    expect(findBulletShift(build([["5"], [""]]), "r1")).toBeNull();
  });
});
