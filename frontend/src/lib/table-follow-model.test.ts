import { describe, expect, it } from "vitest";

import type { DocumentView, FollowItem, TableCounterpart, ViewTable } from "@/lib/api-sop";
import { buildFollowOp, describeCounterpart, describeFollowItem, listCounterpartChoices, listFollowTableIds, pickOrderAction } from "@/lib/table-follow-model";

const ASK = { lang: "en", side: "old", isUnwrapped: true, status: "ambiguous" } as const;

function table(id: number, extra: Partial<ViewTable> = {}): ViewTable {
  return { id, table_index: id - 1, parent_table_id: null, part: "body", n_rows: 4, n_cols: 2, is_layout: true, is_band: false, anchor: null, lang: "en", ...extra };
}

function view(side: "old" | "new", tables: ViewTable[]): DocumentView {
  return { document: { side }, tables } as unknown as DocumentView;
}

const ANSWER: TableCounterpart = {
  table_no: 5,
  status: "ambiguous",
  source_table_id: null,
  decided: false,
  candidates: [
    { table_id: 3, table_no: 3, score: 0.9 },
    { table_id: 4, table_no: 4, score: 0.85 },
  ],
};

describe("describeCounterpart", () => {
  it("asks only for an unwrapped English Old table with an ambiguous answer", () => {
    expect(describeCounterpart(ASK)).toBe("ask");
    expect(describeCounterpart({ ...ASK, lang: "ko" })).toBe("none");
    expect(describeCounterpart({ ...ASK, side: "new" })).toBe("none");
    expect(describeCounterpart({ ...ASK, isUnwrapped: false })).toBe("none");
    expect(describeCounterpart({ ...ASK, status: "matched" })).toBe("matched");
  });

  it("asks when the score is below the threshold but there is a candidate (D2-R3)", () => {
    expect(describeCounterpart({ ...ASK, status: "none", candidates: 1 })).toBe("ask");
    expect(describeCounterpart({ ...ASK, status: "none", candidates: 0 })).toBe("none");
    expect(describeCounterpart({ ...ASK, status: "none" })).toBe("none");
  });

  it("keeps asking after a person chose, so the choice can change", () => {
    expect(describeCounterpart({ ...ASK, status: "matched", decided: true })).toBe("ask");
    expect(describeCounterpart({ ...ASK, status: "none", decided: true })).toBe("ask");
  });
});

describe("listFollowTableIds", () => {
  it("lists the unwrapped English body tables of an Old document", () => {
    const tables = [table(1, { lang: "ko" }), table(2), table(3, { is_layout: false }), table(4, { is_band: true }), table(5, { part: "header" }), table(6)];
    expect(listFollowTableIds(view("old", tables))).toEqual([2, 6]);
    expect(listFollowTableIds(view("new", tables))).toEqual([]);
  });
});

describe("listCounterpartChoices", () => {
  it("offers a placeholder until something is chosen, then the candidates and no counterpart", () => {
    expect(listCounterpartChoices(ANSWER)).toEqual({ value: "pick", choices: [{ value: "3", tableNo: 3 }, { value: "4", tableNo: 4 }, { value: "none", tableNo: null }] });
    expect(listCounterpartChoices({ ...ANSWER, status: "matched", source_table_id: 4, decided: true }).value).toBe("4");
    expect(listCounterpartChoices({ ...ANSWER, status: "none", decided: true }).value).toBe("none");
  });
});

// S18 - 영어 표 5의 줄 1 · 2 · 3 · 4(단위 id 같음)에 한글 표 3이 한 일
const PLAN: FollowItem[] = [
  { unit_ids: [1], order: 2, number: "5.2", indent: false, indent_shift: null, delete: false },
  { unit_ids: [2], order: 1, number: "5.1", indent: false, indent_shift: null, delete: false },
  { unit_ids: [3], order: null, number: "5.2.1", indent: true, indent_shift: null, delete: false },
  { unit_ids: [4], order: null, number: null, indent: false, indent_shift: null, delete: true },
];

describe("buildFollowOp", () => {
  it("turns a plan into an op, whole or one row", () => {
    expect(buildFollowOp(5, PLAN)).toMatchObject({ type: "follow_table", order: [2, 1, 3, 4] });
    expect(buildFollowOp(5, PLAN, [4])).toEqual({ type: "follow_table", table_id: 5, items: [{ unit_ids: [4], delete: true }], order: null });
  });

  it("sends only rows with a chip, and moves just that row when one row is applied", () => {
    expect(buildFollowOp(5, PLAN).items).toEqual([
      { unit_ids: [1], number: "5.2" },
      { unit_ids: [2], number: "5.1" },
      { unit_ids: [3], number: "5.2.1" },
      { unit_ids: [4], delete: true },
    ]);
    expect(buildFollowOp(5, PLAN, [1])).toEqual({ type: "follow_table", table_id: 5, items: [{ unit_ids: [1], number: "5.2" }], order: [2, 1, 3, 4] });
  });

  it("keeps the order null when no row moves, and the merge head stands for the merged line", () => {
    const merged: FollowItem[] = [
      { unit_ids: [11, 12], order: null, number: "5.1", indent: false, indent_shift: 1, delete: false },
      { unit_ids: [13], order: null, number: null, indent: false, indent_shift: null, delete: false },
    ];
    expect(buildFollowOp(7, merged)).toEqual({ type: "follow_table", table_id: 7, items: [{ unit_ids: [11, 12], number: "5.1", indent_shift: 1 }], order: null });
  });
});

describe("describeFollowItem", () => {
  it("writes a chip per kind", () => {
    expect(describeFollowItem(PLAN[0])).toEqual([
      { key: "assign.follow.order", values: { n: 2 } },
      { key: "assign.follow.number", values: { n: "5.2" } },
    ]);
    expect(describeFollowItem(PLAN[2])).toEqual([
      { key: "assign.follow.indent", values: {} },
      { key: "assign.follow.number", values: { n: "5.2.1" } },
    ]);
    expect(describeFollowItem({ ...PLAN[3], order: 1 })).toEqual([{ key: "assign.follow.delete", values: {} }]);
    expect(describeFollowItem({ unit_ids: [11, 12], order: null, number: null, indent: false, indent_shift: null, delete: false })).toEqual([{ key: "assign.follow.merge", values: { n: 2 } }]);
  });
});

describe("pickOrderAction", () => {
  it("⇧O asks to follow when there is a plan, else asks for the order", () => {
    expect(pickOrderAction({ follow: "rule", count: 4 })).toBe("follow");
    expect(pickOrderAction({ follow: "none", count: 0 })).toBe("order");
    expect(pickOrderAction({ follow: "rule", count: 0 })).toBe("order");
    expect(pickOrderAction({ follow: "ai", count: 0 })).toBe("order");
  });
});

describe("buildFollowOp with order-only rows", () => {
  // 한글 표를 순서만 바꿨다 - 칩이 순서뿐인 줄도 보낼 일이다(items가 비면 서버가 422)
  const ORDER_ONLY: FollowItem[] = [
    { unit_ids: [21], order: 2, number: null, indent: false, indent_shift: null, delete: false },
    { unit_ids: [22], order: 1, number: null, indent: false, indent_shift: null, delete: false },
    { unit_ids: [23], order: null, number: null, indent: false, indent_shift: null, delete: false },
  ];

  it("sends the moved rows and the order, whole or one row", () => {
    expect(buildFollowOp(5, ORDER_ONLY)).toEqual({ type: "follow_table", table_id: 5, items: [{ unit_ids: [21] }, { unit_ids: [22] }], order: [22, 21, 23] });
    expect(buildFollowOp(5, ORDER_ONLY, [21], [21, 22, 23])).toEqual({ type: "follow_table", table_id: 5, items: [{ unit_ids: [21] }], order: [22, 21, 23] });
  });

  it("keeps the unmerged tail lines of another row when one row is applied", () => {
    // 덩이 차례 31 · 32 · 33 · 34 - 31과 33을 합칠 일이 있고, 34만 맨 앞으로 옮긴다
    const plan: FollowItem[] = [
      { unit_ids: [31, 33], order: 2, number: null, indent: false, indent_shift: null, delete: false },
      { unit_ids: [32], order: 3, number: null, indent: false, indent_shift: null, delete: false },
      { unit_ids: [34], order: 1, number: null, indent: false, indent_shift: null, delete: false },
    ];
    expect(buildFollowOp(5, plan, [34], [31, 32, 33, 34])).toEqual({ type: "follow_table", table_id: 5, items: [{ unit_ids: [34] }], order: [34, 31, 32, 33] });
    expect(buildFollowOp(5, plan, [31], [31, 32, 33, 34]).order).toEqual([31, 32, 34]); // 합칠 일 자신은 꼬리(33)를 뺀다
  });
});
