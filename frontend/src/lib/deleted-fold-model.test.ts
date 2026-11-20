import { describe, expect, it } from "vitest";

import type { CoverStatus, Disposition, UnitRow } from "./api-sop";
import { buildDeletedFolds, isDeletedLineOpen, readDeletedLine, type DeletedFoldOptions } from "./deleted-fold-model";

type FoldUnit = Pick<UnitRow, "kind" | "lang" | "text" | "content_start" | "status" | "decision">;

const unit = (over: Partial<Omit<FoldUnit, "decision">> & { disposition?: Disposition; reason?: string } = {}): FoldUnit => {
  const status: CoverStatus = over.status ?? "confirmed";
  return {
    kind: over.kind ?? "sentence",
    lang: over.lang ?? "ko",
    text: over.text ?? "글",
    content_start: over.content_start ?? 0,
    status,
    decision: { disposition: over.disposition ?? "delete", move_target_code: "", reason: over.reason ?? "", status, hold_reason: "", confirmed_by: null, confirmed_at: null, revision: 1 },
  };
};

const OPTIONS: DeletedFoldOptions = { filter: "all" };

describe("buildDeletedFolds", () => {
  it("folds a confirmed delete row and reads its line", () => {
    const folds = buildDeletedFolds([{ key: "u1", unitIds: [1] }], new Map([[1, unit({ text: "5.1  장갑을   낀다", content_start: 5, reason: "반복" })]]), OPTIONS);
    expect(readDeletedLine(folds, [1])).toEqual({ rowKey: "u1", kind: "KO", text: "장갑을 낀다", remark: "반복" });
  });

  it("folds a KO/EN pair as one line when every member is deleted", () => {
    const units = new Map([
      [1, unit({ lang: "ko", text: "장갑", reason: "" })],
      [2, unit({ lang: "en", text: "Gloves", reason: "Repeated" })],
    ]);
    const folds = buildDeletedFolds([{ key: "u1", unitIds: [1, 2] }], units, OPTIONS);
    expect(readDeletedLine(folds, [1, 2])).toEqual({ rowKey: "u1", kind: "KO/EN", text: "장갑 / Gloves", remark: "Repeated" });
  });

  it("leaves a pair open while one member is not a confirmed delete", () => {
    const units = new Map([
      [1, unit({ lang: "ko" })],
      [2, unit({ lang: "en", status: "on_hold" })],
    ]);
    const folds = buildDeletedFolds([{ key: "u1", unitIds: [1, 2] }], units, OPTIONS);
    expect(folds.size).toBe(0);
    expect(readDeletedLine(folds, [1, 2])).toBeNull();
  });

  it("folds tables and figures with their kind", () => {
    const units = new Map([
      [1, unit({ kind: "table", lang: "neutral", text: "항목 값" })],
      [2, unit({ kind: "figure", lang: "neutral", text: "" })],
    ]);
    const folds = buildDeletedFolds(
      [
        { key: "u1", unitIds: [1] },
        { key: "u2", unitIds: [2] },
      ],
      units,
      OPTIONS,
    );
    expect(readDeletedLine(folds, [1])?.kind).toBe("TABLE");
    expect(readDeletedLine(folds, [2])).toEqual({ rowKey: "u2", kind: "FIGURE", text: "", remark: "" });
  });

  it("does not fold other confirmed rows (assigned, moved) or a deleted row not yet confirmed", () => {
    const units = new Map([
      [1, unit({ disposition: "assigned" })],
      [2, unit({ disposition: "move_external" })],
      [3, unit({ status: "on_hold" })],
    ]);
    const rows = [1, 2, 3].map((id) => ({ key: `u${id}`, unitIds: [id] }));
    expect(buildDeletedFolds(rows, units, OPTIONS).size).toBe(0);
  });

  it("shows deleted rows open under the Confirmed filter and folds them under the others", () => {
    const rows = [{ key: "u1", unitIds: [1] }];
    const units = new Map([[1, unit()]]);
    expect(buildDeletedFolds(rows, units, { ...OPTIONS, filter: "confirmed" }).size).toBe(0);
    for (const filter of ["all", "unassigned", "on_hold", "ai_suggested"]) expect(buildDeletedFolds(rows, units, { ...OPTIONS, filter }).size).toBe(1);
  });
});

describe("readDeletedLine", () => {
  it("reads one card of a distant pair with that card's language only", () => {
    const units = new Map([
      [1, unit({ lang: "ko", text: "장갑" })],
      [4, unit({ lang: "en", text: "Gloves" })],
    ]);
    const folds = buildDeletedFolds([{ key: "u1", unitIds: [1, 4] }], units, OPTIONS);
    expect(readDeletedLine(folds, [4])).toEqual({ rowKey: "u1", kind: "EN", text: "Gloves", remark: "" });
  });

  it("opens a row only while a box of it is picked - any member, and the other card of a distant pair too", () => {
    const units = new Map([
      [1, unit({ lang: "ko" })],
      [4, unit({ lang: "en" })],
      [7, unit({ lang: "ko" })],
    ]);
    const folds = buildDeletedFolds(
      [
        { key: "u1", unitIds: [1, 4] },
        { key: "u7", unitIds: [7] },
      ],
      units,
      OPTIONS,
    );
    // 접힌 줄은 고름과 상관없이 읽힌다 - 펼침 · 접힘 전환에 둘 다 그린다
    expect(readDeletedLine(folds, [1])?.rowKey).toBe("u1");
    expect(isDeletedLineOpen(folds, "u1", 4)).toBe(true);
    expect(isDeletedLineOpen(folds, "u1", 1)).toBe(true);
    expect(isDeletedLineOpen(folds, "u7", 4)).toBe(false);
    // 다른 박스로 떠나거나 고름이 없으면 다시 접힌다
    expect(isDeletedLineOpen(folds, "u1", 99)).toBe(false);
    expect(isDeletedLineOpen(folds, "u1", null)).toBe(false);
  });

  it("has no kind for a line without a language and nothing for an empty card", () => {
    const folds = buildDeletedFolds([{ key: "u1", unitIds: [1] }], new Map([[1, unit({ lang: "ref", text: "표 9 참조." })]]), OPTIONS);
    expect(readDeletedLine(folds, [1])?.kind).toBeNull();
    expect(readDeletedLine(folds, [])).toBeNull();
  });

  it("caps a long text", () => {
    const folds = buildDeletedFolds([{ key: "u1", unitIds: [1] }], new Map([[1, unit({ text: "가".repeat(500) })]]), OPTIONS);
    expect(readDeletedLine(folds, [1])?.text.length).toBe(160);
  });
});
