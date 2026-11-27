import { describe, expect, it } from "vitest";

import type { ViewUnit } from "./api-sop";
import { getBulletLevel, readNumberKind, stepContinuous, stepUnitContinuous, suggestContinuous, suggestUnitContinuous } from "./number-kind-model";

function unit(id: number, value: string | null, extra: Partial<ViewUnit> = {}): ViewUnit {
  return {
    id,
    lang: "ko",
    table_id: null,
    kind: "sentence",
    number: { value, read: value, source: value === null ? null : "auto", is_set: false, content_start: 0, from_text: false, note: null },
    ...extra,
  } as ViewUnit;
}

describe("readNumberKind", () => {
  it.each([
    [null, "none"],
    ["", "none"],
    ["•", "bullet"],
    ["○", "bullet"],
    ["▪", "bullet"],
    ["3", "continuous"],
    ["3.", "continuous"],
    ["6.1.1", "continuous"],
    ["6.1.1.", "continuous"],
    ["A-1", "custom"],
    ["가.", "custom"],
    ["3)", "custom"],
    ["••", "custom"],
  ] as const)("%j -> %s", (value, kind) => {
    expect(readNumberKind(value)).toBe(kind);
  });
});

describe("suggestContinuous", () => {
  it("counts on from the nearest number before the line", () => {
    expect(suggestContinuous(["1.", "2.", "3."], 2, "3.")).toBe("3.");
    expect(suggestContinuous(["2.", "3.", "3."], 2, "3.")).toBe("4.");
  });
  it("starts at 1 when no number comes before", () => {
    expect(suggestContinuous([null, "5."], 0, null)).toBe("1");
    expect(suggestContinuous(["•", "5."], 1, "5.")).toBe("1.");
  });
  it("keeps the depth of the line's read number", () => {
    expect(suggestContinuous(["3", "x"], 1, "3.2")).toBe("3.1"); // 더 깊으면 앞 번호 아래 첫째
    expect(suggestContinuous(["3.2", "x"], 1, "5")).toBe("4"); // 더 얕으면 그 깊이 마디의 다음
    expect(suggestContinuous(["6.1", "x"], 1, null)).toBe("6.2"); // 읽은 번호가 없으면 앞 번호의 깊이
  });
  it("follows the trailing dot of the number before", () => {
    expect(suggestContinuous(["2", "x"], 1, "3.")).toBe("3");
    expect(suggestContinuous(["2.", "x"], 1, "3")).toBe("3.");
  });
  it("skips bullet, custom and empty lines", () => {
    expect(suggestContinuous(["2.", "•", "A-1", null, "x"], 4, "6.")).toBe("3.");
  });
});

describe("suggestUnitContinuous", () => {
  it("counts lines of the same language across table borders", () => {
    const units = [
      unit(1, "2."),
      unit(2, "7.", { lang: "en" }),
      unit(3, "9.", { table_id: 40 }),
      unit(4, "•"),
      unit(5, "5."),
    ];
    expect(suggestUnitContinuous(units, 5)).toBe("10.");
    expect(suggestUnitContinuous(units, 2)).toBe("1.");
    expect(suggestUnitContinuous(units, 99)).toBeNull();
  });
  it("gives an unwrapped table line under heading 5 the number 5.1 (D1)", () => expect(suggestUnitContinuous([unit(1, "5", { kind: "heading" }), unit(2, "1", { table_id: 40 })], 2)).toBe("5.1"));
});

describe("stepContinuous", () => {
  it("goes one level deeper under the nearest number before", () => {
    expect(stepContinuous(["5", "6"], 1, "6", 1)).toBe("5.1");
    expect(stepContinuous(["5.1", "6"], 1, "6", 1)).toBe("5.2"); // 같은 부모 아래 하위가 있으면 그 다음
    expect(stepContinuous(["5.1.1", "6"], 1, "6", 1)).toBe("5.2");
  });
  it("goes one level up to the next number at that level", () => {
    expect(stepContinuous(["5", "5.1"], 1, "5.1", -1)).toBe("6");
    expect(stepContinuous(["5.1.3", "5.1.4"], 1, "5.1.4", -1)).toBe("5.2");
  });
  it("stops at the top level and one level past the number before", () => {
    expect(stepContinuous(["5", "6"], 1, "6", -1)).toBeNull();
    expect(stepContinuous(["5", "5.1"], 1, "5.1", 1)).toBeNull(); // 두 단계 이상 못 뜀
    expect(stepContinuous([null, "1"], 1, "1", 1)).toBeNull(); // 앞 번호가 없다
    expect(stepContinuous(["5", "A-1"], 1, "A-1", 1)).toBeNull(); // 연속 번호가 아니다
  });
  it("keeps the trailing dot of the number before", () => {
    expect(stepContinuous(["5.", "6."], 1, "6.", 1)).toBe("5.1.");
  });
});

describe("stepUnitContinuous", () => {
  it("walks the user's example: heading 5, unwrapped line 6 → 5.1 → back to 6", () => {
    const units = [unit(1, "5"), unit(2, "1", { table_id: 40 })];
    expect(stepUnitContinuous(units, 2, "6", 1)).toBe("5.1");
    expect(stepUnitContinuous(units, 2, "5.1", 1)).toBeNull();
    expect(stepUnitContinuous(units, 2, "5.1", -1)).toBe("6");
    expect(stepUnitContinuous(units, 2, "6", -1)).toBeNull();
  });
});

describe("getBulletLevel", () => {
  it("indents one step past the number before, plus the symbol's step", () => {
    expect(getBulletLevel(2, "•")).toBe(3);
    expect(getBulletLevel(2, "○")).toBe(4);
    expect(getBulletLevel(2, "▪")).toBe(5);
    expect(getBulletLevel(0, "•")).toBe(1);
  });
});
