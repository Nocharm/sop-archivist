import { describe, expect, it } from "vitest";

import type { UnitSpan, ViewNumber, ViewUnit } from "@/lib/api-sop";
import { applyExpectedNumbers, findArrivedNumbers, listExpectedNumbers, listExpectedShifts, readExpectedNumber } from "@/lib/number-arrival-model";

type Box = Pick<ViewUnit, "id" | "spans" | "number">;

function unit(id: number, span: UnitSpan, value: string | null): [number, Box] {
  const number: ViewNumber = { value, read: value, source: "typed", is_set: false, content_start: 0, from_text: true, note: null };
  return [id, { id, spans: [span], number }];
}

describe("findArrivedNumbers", () => {
  it("picks a new box whose first place had no number before - joining \"6.1.\" with the next line", () => {
    const prev = new Map([unit(1, [10, 0, 4], null), unit(2, [11, 0, 9], null)]);
    const next = new Map([unit(3, [10, 0, 4], "6.1.")]);

    expect([...findArrivedNumbers(prev, next)]).toEqual([3]);
  });

  it("skips boxes that had a number, the first paint and another document", () => {
    const prev = new Map([unit(1, [10, 0, 9], "6.1")]);

    expect(findArrivedNumbers(prev, new Map([unit(2, [10, 0, 9], "6.1")])).size).toBe(0);
    expect(findArrivedNumbers(null, new Map([unit(2, [10, 0, 9], "6.1")])).size).toBe(0);
    expect(findArrivedNumbers(prev, new Map([unit(5, [99, 0, 9], "7")])).size).toBe(0);
  });

  it("picks the same box when its number comes back - Undo of No number", () => {
    const prev = new Map([unit(1, [10, 0, 9], null)]);

    expect([...findArrivedNumbers(prev, new Map([unit(1, [10, 0, 9], "2.1")]))]).toEqual([1]);
  });
});

describe("readExpectedNumber", () => {
  it("reads the number a set_number edit will give", () => {
    expect(readExpectedNumber({ type: "set_number", unit_id: 7, number: "5.2", follow: true })).toEqual({ unitId: 7, value: "5.2" });
    expect(readExpectedNumber({ type: "set_number", unit_id: 7, number: null, follow: false })).toEqual({ unitId: 7, value: null });
  });

  it("knows no number for the other edits", () => {
    expect(readExpectedNumber({ type: "merge", unit_ids: [1, 2] })).toBeNull();
  });
});

describe("applyExpectedNumbers", () => {
  it("shows the expected number and leaves the other boxes and the map of the server alone", () => {
    const units = new Map([unit(1, [10, 0, 9], "6.1"), unit(2, [11, 0, 9], null)]);

    const shown = applyExpectedNumbers(units, new Map([[1, "5.2"]]));

    expect(shown.get(1)?.number?.value).toBe("5.2");
    expect(shown.get(1)?.number?.read).toBe("6.1");
    expect(shown.get(2)).toBe(units.get(2));
    expect(units.get(1)?.number?.value).toBe("6.1");
  });

  it("gives the same map when nothing is expected, so nothing is drawn again", () => {
    const units = new Map([unit(1, [10, 0, 9], "6.1")]);

    expect(applyExpectedNumbers(units, new Map())).toBe(units);
    expect(applyExpectedNumbers(units, new Map([[9, "1"]]))).toBe(units);
  });

  it("starts the arrival at the press and does not start it again when the answer agrees", () => {
    const before = new Map([unit(1, [10, 0, 9], null)]);
    const shown = applyExpectedNumbers(before, new Map([[1, "2.1"]]));

    expect([...findArrivedNumbers(before, shown)]).toEqual([1]);
    expect(findArrivedNumbers(shown, new Map([unit(1, [10, 0, 9], "2.1")])).size).toBe(0);
  });
});

describe("listExpectedNumbers", () => {
  const views = [{ document: { id: 3, revision: 8 } }];

  it("takes the last press over the ones before it", () => {
    expect(listExpectedNumbers([{ type: "set_number", unit_id: 7, number: "5.2", follow: true }, { type: "merge", unit_ids: [1, 2] }, { type: "set_number", unit_id: 7, number: "5.3", follow: true }], [], views)).toEqual([[7, "5.3"]]);
  });

  it("keeps an answered number until the view that carries it arrives - then the answer wins", () => {
    const sent = [{ docId: 3, revision: 9, unitId: 7, value: "5.2" }];

    expect(listExpectedNumbers([], sent, views)).toEqual([[7, "5.2"]]);
    expect(listExpectedNumbers([], sent, [{ document: { id: 3, revision: 9 } }])).toEqual([]);
    expect(listExpectedNumbers([], sent, [])).toEqual([]);
    expect(listExpectedNumbers([{ type: "set_number", unit_id: 7, number: null, follow: false }], sent, views)).toEqual([[7, null]]);
  });
});

describe("listExpectedShifts", () => {
  const views = [{ document: { id: 3, revision: 8 } }];

  it("takes the last pressed shift of each line, also from a number edit that carries one", () => {
    const ops = [
      { type: "set_indents" as const, units: [{ unit_id: 7, indent_shift: 1 }, { unit_id: 8, indent_shift: 1 }] },
      { type: "merge" as const, unit_ids: [1, 2] },
      { type: "set_indents" as const, units: [{ unit_id: 7, indent_shift: 2 }] },
      { type: "set_number" as const, unit_id: 9, number: "•", follow: false, indent_shift: -1 },
      { type: "set_number" as const, unit_id: 10, number: "5", follow: true },
    ];
    expect([...listExpectedShifts(ops, [], views)]).toEqual([[7, 2], [8, 1], [9, -1]]);
  });
  it("keeps a saved shift until the view that has it arrives", () => {
    const sent = [{ docId: 3, revision: 9, shifts: [[7, 1]] as Array<[number, number]> }];
    expect([...listExpectedShifts([], sent, views)]).toEqual([[7, 1]]);
    expect([...listExpectedShifts([], sent, [{ document: { id: 3, revision: 9 } }])]).toEqual([]);
    expect([...listExpectedShifts([], sent, [])]).toEqual([]);
  });
});
