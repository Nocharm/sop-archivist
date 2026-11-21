import { describe, expect, it } from "vitest";

import type { UnitSpan, ViewNumber, ViewUnit } from "@/lib/api-sop";
import { findArrivedNumbers } from "@/lib/number-arrival-model";

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
