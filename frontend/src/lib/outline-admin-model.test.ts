// SOP 표준 골격 관리 화면 규칙의 단위 테스트 - 번호, 더하기·빼기·옮기기(하위는 부모를 따른다), 저장 전 검사 사유, 바뀜 판정.
import { describe, expect, it } from "vitest";

import type { OutlineStandardItem } from "./api-manage";
import {
  addRow,
  buildItems,
  buildRows,
  canAddChild,
  canMoveRow,
  findProblem,
  getParentKey,
  hasChildren,
  isChanged,
  moveRow,
  numberRows,
  parseSuggestions,
  removeRow,
  type OutlineRow,
} from "./outline-admin-model";

function item(key: string, overrides: Partial<OutlineStandardItem> = {}): OutlineStandardItem {
  return { key, title_en: `Title ${key}`, title_ko: "", kind: "general", is_required: true, default_style: "numbered", child_prefix: "", suggestions: [], ...overrides };
}

// 합성 골격: a, b(하위 b.x · b.y, b.x 아래 b.x.deep), c
const ITEMS: OutlineStandardItem[] = [
  item("a"),
  item("b", { kind: "named_children" }),
  item("b.x", { kind: "group" }),
  item("b.x.deep"),
  item("b.y"),
  item("c"),
];

function keys(rows: readonly OutlineRow[]): string[] {
  return rows.map((row) => row.key);
}

function patch(rows: readonly OutlineRow[], rowId: string, change: Partial<OutlineRow>): OutlineRow[] {
  return rows.map((row) => (row.rowId === rowId ? { ...row, ...change } : row));
}

describe("getParentKey", () => {
  it("cuts at the last dot", () => {
    expect(getParentKey("a")).toBeNull();
    expect(getParentKey("a.b.c")).toBe("a.b");
  });

  it("keeps a half-typed child key under its parent", () => {
    expect(getParentKey("a.")).toBe("a");
    expect(getParentKey(".a")).toBeNull();
    expect(getParentKey("")).toBeNull();
  });
});

describe("numberRows", () => {
  it("numbers top-level rows 1..n and children by their place among siblings", () => {
    expect(numberRows(buildRows(ITEMS))).toEqual(["1", "2", "2.1", "2.1.1", "2.2", "3"]);
  });

  it("counts siblings even when another branch sits between them", () => {
    const rows = buildRows([item("a", { kind: "group" }), item("b", { kind: "group" }), item("a.one"), item("b.one"), item("a.two")]);

    expect(numberRows(rows)).toEqual(["1", "2", "1.1", "2.1", "1.2"]);
  });

  it("gives no number to a row with a bad key or a parent that is not above it", () => {
    const rows = buildRows([item("b.x"), item("b", { kind: "group" }), item("Bad Key"), item(""), item("c")]);

    expect(numberRows(rows)).toEqual([null, "1", null, null, "2"]);
  });
});

describe("addRow", () => {
  it("appends a blank top-level row that can still be renamed", () => {
    const rows = addRow(buildRows(ITEMS), "new-1", null);

    expect(keys(rows)).toEqual(["a", "b", "b.x", "b.x.deep", "b.y", "c", ""]);
    expect(rows[6]).toEqual({ rowId: "new-1", isNew: true, key: "", title_en: "", title_ko: "", kind: "general", is_required: true, default_style: "numbered", child_prefix: "", suggestions: "" });
    expect(rows.slice(0, 6).every((row) => !row.isNew)).toBe(true);
  });

  it("puts a child after the parent's last descendant with the parent key filled in", () => {
    const rows = addRow(buildRows(ITEMS), "new-1", "b");

    expect(keys(rows)).toEqual(["a", "b", "b.x", "b.x.deep", "b.y", "b.", "c"]);
    expect(rows[5].isNew).toBe(true);
  });

  it("puts the first child right under a parent without children", () => {
    const rows = addRow(buildRows([item("a", { kind: "group" }), item("c")]), "new-1", "a");

    expect(keys(rows)).toEqual(["a", "a.", "c"]);
  });
});

describe("removeRow", () => {
  it("removes a row together with everything under it", () => {
    expect(keys(removeRow(buildRows(ITEMS), "b"))).toEqual(["a", "c"]);
    expect(keys(removeRow(buildRows(ITEMS), "b.x"))).toEqual(["a", "b", "b.y", "c"]);
  });

  it("removes only the blank row itself", () => {
    const rows = addRow(buildRows(ITEMS), "new-1", null);

    expect(keys(removeRow(rows, "new-1"))).toEqual(keys(buildRows(ITEMS)));
  });

  it("tells whether a row has rows under it", () => {
    const rows = buildRows(ITEMS);

    expect(hasChildren(rows, "b")).toBe(true);
    expect(hasChildren(rows, "b.y")).toBe(false);
    expect(hasChildren(addRow(rows, "new-1", null), "new-1")).toBe(false);
  });
});

describe("moveRow", () => {
  it("moves a row with its children past the sibling above", () => {
    expect(keys(moveRow(buildRows(ITEMS), "b", -1))).toEqual(["b", "b.x", "b.x.deep", "b.y", "a", "c"]);
  });

  it("moves a row below the next sibling and that sibling's children", () => {
    expect(keys(moveRow(buildRows(ITEMS), "a", 1))).toEqual(["b", "b.x", "b.x.deep", "b.y", "a", "c"]);
    expect(keys(moveRow(buildRows(ITEMS), "b.x", 1))).toEqual(["a", "b", "b.y", "b.x", "b.x.deep", "c"]);
  });

  it("stays among its own siblings", () => {
    const rows = buildRows(ITEMS);

    // b.y는 b의 마지막 하위다 - 아래의 c(최상위)와 자리를 바꾸지 않는다
    expect(keys(moveRow(rows, "b.y", 1))).toEqual(keys(rows));
    expect(keys(moveRow(rows, "a", -1))).toEqual(keys(rows));
    expect(canMoveRow(rows, "b.y", 1)).toBe(false);
    expect(canMoveRow(rows, "b.y", -1)).toBe(true);
    expect(canMoveRow(rows, "a", -1)).toBe(false);
    expect(canMoveRow(rows, "b.x.deep", 1)).toBe(false);
  });

  it("renumbers after a move", () => {
    expect(numberRows(moveRow(buildRows(ITEMS), "b", -1))).toEqual(["1", "1.1", "1.1.1", "1.2", "2", "3"]);
  });
});

describe("findProblem", () => {
  it("passes the list the server sent", () => {
    expect(findProblem(buildRows(ITEMS))).toBeNull();
  });

  it("stops an empty list", () => {
    expect(findProblem([])).toEqual({ reason: "empty", rowId: null });
  });

  it.each(["", "A b", "a:b", "a.", ".a", "a..b", "1a", "a-b", "a\n", "a".repeat(101)])("stops the key %j", (key) => {
    const rows = patch(addRow(buildRows(ITEMS), "new-1", null), "new-1", { key, title_en: "New" });

    expect(findProblem(rows)).toEqual({ reason: "bad_key", rowId: "new-1" });
  });

  it.each(["step", "a_1", "z".repeat(100)])("lets the key %j through", (key) => {
    const rows = patch(addRow(buildRows(ITEMS), "new-1", null), "new-1", { key, title_en: "New" });

    expect(findProblem(rows)).toBeNull();
  });

  it("stops a key used twice", () => {
    const rows = patch(addRow(buildRows(ITEMS), "new-1", null), "new-1", { key: "a", title_en: "Again" });

    expect(findProblem(rows)).toEqual({ reason: "duplicate_key", rowId: "new-1" });
  });

  it("stops a child whose parent is absent or below it", () => {
    const absent = patch(addRow(buildRows(ITEMS), "new-1", null), "new-1", { key: "nowhere.child", title_en: "Lost" });
    const below = buildRows([item("b.x"), item("b", { kind: "group" })]);

    expect(findProblem(absent)).toEqual({ reason: "missing_parent", rowId: "new-1" });
    expect(findProblem(below)).toEqual({ reason: "missing_parent", rowId: "b.x" });
  });

  it.each(["general", "auto_list"] as const)("stops a child under a %s row", (kind) => {
    const rows = patch(buildRows(ITEMS), "b", { kind });

    expect(findProblem(rows)).toEqual({ reason: "children_under_leaf", rowId: "b.x" });
  });

  it("stops a blank English title", () => {
    expect(findProblem(patch(buildRows(ITEMS), "c", { title_en: "   " }))).toEqual({ reason: "title_required", rowId: "c" });
  });

  it("stops too many or too long suggested names", () => {
    const many = Array.from({ length: 51 }, (_, index) => `name ${index}`).join(", ");

    expect(findProblem(patch(buildRows(ITEMS), "b", { suggestions: many }))).toEqual({ reason: "bad_suggestions", rowId: "b" });
    expect(findProblem(patch(buildRows(ITEMS), "b", { suggestions: "x".repeat(201) }))).toEqual({ reason: "bad_suggestions", rowId: "b" });
    expect(findProblem(patch(buildRows(ITEMS), "b", { suggestions: `${"x".repeat(200)}, ok` }))).toBeNull();
  });

  it("reports the first problem in row order", () => {
    const rows = patch(patch(buildRows(ITEMS), "a", { title_en: "" }), "c", { title_en: "" });

    expect(findProblem(rows)).toEqual({ reason: "title_required", rowId: "a" });
  });
});

describe("canAddChild", () => {
  it("allows children only under kinds that hold them, on a valid key", () => {
    const rows = buildRows([item("a"), item("b", { kind: "named_children" }), item("c", { kind: "category_table" }), item("d", { kind: "group" }), item("e", { kind: "auto_list" })]);
    const halfTyped = patch(addRow(rows, "new-1", "d"), "new-1", { kind: "group" });

    expect(rows.map(canAddChild)).toEqual([false, true, true, true, false]);
    expect(canAddChild(halfTyped[4])).toBe(false);
  });
});

describe("suggestions and change detection", () => {
  it("splits suggested names on commas and drops blanks", () => {
    expect(parseSuggestions(" Safety, Quality ,, Record ,")).toEqual(["Safety", "Quality", "Record"]);
    expect(parseSuggestions("  ")).toEqual([]);
  });

  it("round-trips the server list without a change", () => {
    const items = [item("a", { suggestions: ["Safety", "Quality"], title_ko: "가" }), item("b")];
    const rows = buildRows(items);

    expect(rows[0].suggestions).toBe("Safety, Quality");
    expect(buildItems(rows)).toEqual(items);
    expect(isChanged(rows, items)).toBe(false);
  });

  it("ignores spaces the server would strip", () => {
    const rows = patch(buildRows(ITEMS), "a", { title_en: " Title a  ", suggestions: " , " });

    expect(isChanged(rows, ITEMS)).toBe(false);
  });

  it("sees an edit, a move, an added row and a removed row", () => {
    const rows = buildRows(ITEMS);

    expect(isChanged(patch(rows, "a", { is_required: false }), ITEMS)).toBe(true);
    expect(isChanged(moveRow(rows, "a", 1), ITEMS)).toBe(true);
    expect(isChanged(addRow(rows, "new-1", null), ITEMS)).toBe(true);
    expect(isChanged(removeRow(rows, "c"), ITEMS)).toBe(true);
  });

  it("drops screen-only fields from the save request", () => {
    const rows = patch(addRow(buildRows([item("a")]), "new-1", null), "new-1", { key: "b", title_en: " B ", suggestions: "One, Two" });

    expect(buildItems(rows)[1]).toEqual({ key: "b", title_en: "B", title_ko: "", kind: "general", is_required: true, default_style: "numbered", child_prefix: "", suggestions: ["One", "Two"] });
  });
});
