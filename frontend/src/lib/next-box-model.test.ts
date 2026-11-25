import { describe, expect, it } from "vitest";

import { pickNextBox, type NextBoxInput, type PendingOutcome } from "./next-box-model";
import { toTocNavKey, toUnitNavKey } from "./toc-block-model";

type Row = { key: string; documentId: number; unitIds: number[]; status: "unassigned" | "ai_suggested" | "on_hold" | "confirmed" };
const row = (id: number, over: Partial<Row> = {}): Row => ({ key: `u${id}`, documentId: 1, unitIds: [id], status: "unassigned", ...over });
function build(rows: Row[], over: Partial<NextBoxInput> = {}): Omit<NextBoxInput, "from" | "mode" | "pending"> {
  return {
    order: rows.flatMap((item) => item.unitIds.map(toUnitNavKey)),
    rowMap: new Map(rows.map((item) => [item.key, item])),
    rowOfUnit: new Map(rows.flatMap((item) => item.unitIds.map((id) => [id, item.key] as const))),
    listed: new Set(rows.map((item) => item.key)),
    isByRow: false,
    readTab: () => "body",
    isDeleted: () => false,
    ...over,
  };
}
const none = new Map<string, PendingOutcome>();
const base = build([row(1), row(2), row(3)]);

describe("pickNextBox", () => {
  it("counts the saves still in flight", () => {
    expect(pickNextBox({ ...base, from: "u1", mode: "below", pending: new Map([["u2", "deleted"]]) })).toEqual({ key: "u3", unitId: 3 });
    expect(pickNextBox({ ...base, from: "u1", mode: "open", pending: new Map([["u2", "confirmed"]]) })).toEqual({ key: "u3", unitId: 3 });
    expect(pickNextBox({ ...base, from: "u1", mode: "open", pending: new Map([["u2", "deleted"]]) })).toEqual({ key: "u3", unitId: 3 });
  });
  it("does not wrap around", () => {
    expect(pickNextBox({ ...base, from: "u3", mode: "open", pending: new Map() })).toBeNull();
  });
  it("a delete at the end goes up, past the boxes being deleted", () => {
    expect(pickNextBox({ ...base, from: "u3", mode: "below", pending: none })).toEqual({ key: "u2", unitId: 2 });
    expect(pickNextBox({ ...base, from: "u3", mode: "below", pending: new Map([["u2", "deleted"]]) })).toEqual({ key: "u1", unitId: 1 });
    expect(pickNextBox({ ...base, from: "u3", mode: "below", pending: new Map([["u2", "deleted"], ["u1", "deleted"]]) })).toBeNull();
  });
  it("a delete lands on a confirmed or held box, an open move does not stop at a confirmed one", () => {
    expect(pickNextBox({ ...base, from: "u1", mode: "below", pending: new Map([["u2", "confirmed"]]) })).toEqual({ key: "u2", unitId: 2 });
    expect(pickNextBox({ ...base, from: "u1", mode: "open", pending: new Map([["u2", "held"]]) })).toEqual({ key: "u2", unitId: 2 });
    const saved = build([row(1), row(2, { status: "confirmed" }), row(3)]);
    expect(pickNextBox({ ...saved, from: "u1", mode: "open", pending: none })).toEqual({ key: "u3", unitId: 3 });
    // 확정된 줄을 지금 보류로 바꾸는 중이면 다시 열린 줄이다
    expect(pickNextBox({ ...saved, from: "u1", mode: "open", pending: new Map([["u2", "held"]]) })).toEqual({ key: "u2", unitId: 2 });
  });
  it("skips a folded deleted line, but not one being decided again", () => {
    const folded = build([row(1), row(2, { status: "confirmed" }), row(3)], { isDeleted: (key) => key === "u2" });
    expect(pickNextBox({ ...folded, from: "u1", mode: "below", pending: none })).toEqual({ key: "u3", unitId: 3 });
    expect(pickNextBox({ ...folded, from: "u1", mode: "below", pending: new Map([["u2", "held"]]) })).toEqual({ key: "u2", unitId: 2 });
  });
  it("stays in the same document, the same tab and the filter list, and steps over a contents block", () => {
    const rows = [row(1), row(2), row(3, { documentId: 2 }), row(4), row(5)];
    const scoped = build(rows, { readTab: (id) => (id === 2 ? "header" : "body"), listed: new Set(["u1", "u2", "u3", "u5"]) });
    expect(pickNextBox({ ...scoped, order: [toUnitNavKey(1), toTocNavKey(9), ...scoped.order.slice(1)], from: "u1", mode: "below", pending: none })).toEqual({ key: "u5", unitId: 5 });
  });
  it("starts from the picked box of a pair row and never picks the same row", () => {
    const pair = build([row(1, { key: "p1", unitIds: [1, 4] }), row(2), row(5)], { order: [1, 2, 4, 5].map(toUnitNavKey) });
    expect(pickNextBox({ ...pair, from: "p1", fromUnitId: 1, mode: "below", pending: none })).toEqual({ key: "u2", unitId: 2 });
    expect(pickNextBox({ ...pair, from: "p1", fromUnitId: 4, mode: "below", pending: none })).toEqual({ key: "u5", unitId: 5 });
    expect(pickNextBox({ ...pair, from: "p1", fromUnitId: 99, mode: "below", pending: none })).toEqual({ key: "u2", unitId: 2 });
  });
  it("walks rows in Pair view", () => {
    const byRow = build([row(1, { key: "p1", unitIds: [1, 4] }), row(2)], { order: ["p1", "u2"], isByRow: true });
    expect(pickNextBox({ ...byRow, from: "p1", mode: "below", pending: none })).toEqual({ key: "u2", unitId: 2 });
  });
  it("keeps the pick when the row is gone", () => {
    expect(pickNextBox({ ...base, from: "u99", mode: "below", pending: none })).toBeNull();
  });
});
