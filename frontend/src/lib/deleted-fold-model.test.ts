import { describe, expect, it } from "vitest";

import type { CoverStatus, Disposition, UnitRow } from "./api-sop";
import { buildDeletedFolds, isDeletedLineOpen, listReleasedFolds, readDeletedLine, type DeletedFoldOptions } from "./deleted-fold-model";

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

const OPTIONS: DeletedFoldOptions = { filter: "all", pendingDeletes: new Set() };

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

describe("buildDeletedFolds while the delete is still being saved", () => {
  const rows = [
    { key: "u1", unitIds: [1] },
    { key: "u2", unitIds: [2] },
  ];
  // u2는 아직 저장 전 - 보류 사유가 적힌 줄이다
  const units = new Map([
    [1, unit({ reason: "반복" })],
    [2, unit({ status: "on_hold", disposition: "unassigned", reason: "물어볼 것", text: "장갑" })],
  ]);

  it("folds the row at the press and opens it again when the delete drops out of the queue", () => {
    const folds = buildDeletedFolds(rows, units, { filter: "all", pendingDeletes: new Set(["u2"]) });
    expect(folds.get(2)).toMatchObject({ rowKey: "u2", remark: "", isPending: true });
    expect(folds.get(1)?.isPending).toBeUndefined();
    // 실패해 빠지면 펼쳐진다
    expect(buildDeletedFolds(rows, units, { filter: "all", pendingDeletes: new Set() }).has(2)).toBe(false);
    expect(buildDeletedFolds(rows, units, { filter: "confirmed", pendingDeletes: new Set(["u2"]) }).size).toBe(0);
  });

  it("is an ordinary fold once the answer is in, even before the command leaves the queue", () => {
    const saved = new Map([[2, unit({ reason: "반복" })]]);
    expect(buildDeletedFolds([rows[1]], saved, { filter: "all", pendingDeletes: new Set(["u2"]) }).get(2)).toMatchObject({ remark: "반복" });
    expect(buildDeletedFolds([rows[1]], saved, { filter: "all", pendingDeletes: new Set(["u2"]) }).get(2)?.isPending).toBeUndefined();
  });

  it("does not fold a row whose units are not loaded", () => {
    expect(buildDeletedFolds([{ key: "u9", unitIds: [9] }], units, { filter: "all", pendingDeletes: new Set(["u9"]) }).size).toBe(0);
  });

  it("releases only a fold that was waiting for its answer - so the box opens instead of jumping", () => {
    const folded = buildDeletedFolds(rows, units, { filter: "all", pendingDeletes: new Set(["u2"]) });
    const reopened = buildDeletedFolds(rows, units, OPTIONS);
    const released = listReleasedFolds(new Map(), folded, reopened);
    expect([...released.keys()]).toEqual([2]);
    expect(readDeletedLine(released, [2])?.rowKey).toBe("u2");
    // 다시 받아도 남고(펼치는 중에 끊기지 않게), 다시 접히면 빠진다
    expect([...listReleasedFolds(released, reopened, buildDeletedFolds(rows, units, OPTIONS)).keys()]).toEqual([2]);
    expect(listReleasedFolds(released, reopened, folded).size).toBe(0);
    // 저장까지 끝난 삭제가 풀리면(거르기 · 배정 취소) 감싸지 않는다
    expect(listReleasedFolds(new Map(), reopened, new Map()).size).toBe(0);
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
