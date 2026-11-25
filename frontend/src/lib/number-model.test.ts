import { describe, expect, it } from "vitest";

import type { ViewUnit } from "./api-sop";
import { getContent, getHiddenEnds, getNumberSaveBlock, listFollowPreview, planFollow } from "./number-model";

function unit(id: number, value: string | null, extra: Partial<ViewUnit> = {}): ViewUnit {
  return {
    id,
    lang: "ko",
    table_id: null,
    number: { value, read: value, source: value === null ? null : "auto", is_set: false, content_start: 0, from_text: false },
    ...extra,
  } as ViewUnit;
}

describe("planFollow", () => {
  // 서버 tests/test_sop_numbers.py test_plan_follow와 같은 사례다 - 한쪽을 고치면 다른 쪽도 고친다
  const cases: Array<[Array<string | null>, number, string, Record<number, string>]> = [
    [["6.1", "6.2", "6.3", "6.3.1", "6.4", "7"], 1, "6.1.1", { 2: "6.2", 3: "6.2.1", 4: "6.3" }],
    [["6.1", "6.2", "6.1.1", "6.3"], 1, "6.1.1", { 2: "6.1.2", 3: "6.2" }],
    [["1.", "2.", "2.", "3.", "1."], 2, "3.", { 3: "4." }],
    [["6.1", "6.2", "6.2.1", "6.3"], 1, "6.5", { 2: "6.5.1", 3: "6.6" }],
    [["A", "B", "C", "A-1"], 0, "B", { 1: "C", 2: "D" }],
    [[null, "6.1", null, "6.2", "7"], 0, "6.1", { 1: "6.2", 3: "6.3" }],
    [["가.", "나."], 0, "다.", {}],
  ];
  it.each(cases)("%j at %i -> %s", (numbers, index, next, expected) => {
    expect(Object.fromEntries(planFollow(numbers, index, next))).toEqual(expected);
  });
});

describe("listFollowPreview", () => {
  it("follows only lines of the same language outside tables", () => {
    const units = [unit(1, "6.1"), unit(2, "6.2"), unit(3, "6.2", { lang: "en" }), unit(4, "6.3"), unit(5, "6.3", { table_id: 9 }), unit(6, null), unit(7, "6.4")];

    expect(listFollowPreview(units, 2, "6.1.1")).toEqual([
      { unitId: 4, from: "6.3", to: "6.2" },
      { unitId: 7, from: "6.4", to: "6.3" },
    ]);
  });

  it("treats band heading lines as lines outside tables", () => {
    // 띠 표 제목 줄은 장마다 자기 원문 표를 가리킨다 - 서버 _plan_set_number와 같이 표 밖 목록에 든다
    const units = [
      unit(1, "7", { kind: "heading", table_id: 11 }),
      unit(2, "7.1", { kind: "heading" }),
      unit(3, "8", { kind: "heading", table_id: 12 }),
      unit(4, "8.1", { kind: "heading" }),
      unit(5, "1", { kind: "cell_sentence", table_id: 13 }),
    ];

    expect(listFollowPreview(units, 1, "6")).toEqual([
      { unitId: 2, from: "7.1", to: "6.1" },
      { unitId: 3, from: "8", to: "7" },
      { unitId: 4, from: "8.1", to: "7.1" },
    ]);
  });

  it("previews nothing for an empty number or an unknown unit", () => {
    const units = [unit(1, "6.1"), unit(2, "6.2")];

    expect(listFollowPreview(units, 1, " ")).toEqual([]);
    expect(listFollowPreview(units, 99, "6.5")).toEqual([]);
  });
});

describe("getHiddenEnds", () => {
  it("hides the number at the head of the first span", () => {
    expect([...getHiddenEnds([[7, 0, 12]], 4)]).toEqual([[7, 4]]);
    expect([...getHiddenEnds([[7, 10, 30]], 4)]).toEqual([[7, 14]]);
  });

  it("hides a whole number cell block and nothing of the content block", () => {
    // "7" + "\n" + 내용 - 내용은 둘째 범위의 처음부터다
    expect([...getHiddenEnds([[1, 0, 1], [3, 0, 7]], 2)]).toEqual([[1, 1]]);
  });

  it("hides nothing when the number is still text", () => {
    expect(getHiddenEnds([[7, 0, 12]], 0).size).toBe(0);
  });
});

describe("getContent", () => {
  it("drops the number range and keeps text without one", () => {
    expect(getContent({ text: "6.2 합성 문장", content_start: 4 })).toBe("합성 문장");
    expect(getContent({ text: "합성 문장" })).toBe("합성 문장");
  });
});

describe("getNumberSaveBlock", () => {
  it("blocks saving an empty number with a reason", () => {
    expect(getNumberSaveBlock({ kind: "continuous", text: "" })).toBe("assign.number.typeFirst");
    expect(getNumberSaveBlock({ kind: "custom", text: "   " })).toBe("assign.number.typeFirst");
    expect(getNumberSaveBlock({ kind: "continuous", text: "5.1" })).toBeNull();
  });
  it("does not block kinds that save at once", () => {
    expect(getNumberSaveBlock({ kind: "bullet", text: "" })).toBeNull();
    expect(getNumberSaveBlock({ kind: "none", text: "" })).toBeNull();
  });
});
