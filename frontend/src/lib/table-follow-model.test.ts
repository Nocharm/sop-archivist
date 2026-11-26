import { describe, expect, it } from "vitest";

import type { DocumentView, TableCounterpart, ViewTable } from "@/lib/api-sop";
import { describeCounterpart, listCounterpartChoices, listFollowTableIds } from "@/lib/table-follow-model";

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
