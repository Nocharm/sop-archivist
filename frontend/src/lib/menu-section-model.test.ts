import { describe, expect, it } from "vitest";

import type { ViewBlock, ViewTable, ViewUnit } from "./api-sop";
import { buildAssignMenu, type AssignMenuAction, type AssignMenuContext, type AssignMenuGroups, type AssignMenuItem } from "./assign-context-menu-model";
import { buildMenuSections, readMenuPlace, type MenuPlace, type MenuSection } from "./menu-section-model";

function item(action: AssignMenuAction, over: Partial<AssignMenuItem> = {}): AssignMenuItem {
  return { action, enabled: true, ...over };
}
const editActions: AssignMenuAction[] = ["split", "merge_prev", "lang"];
function menu(withTable: boolean, isDeleted = false): AssignMenuGroups {
  return {
    assign: isDeleted ? [item("clear", { labelKey: "assign.ctx.undoDelete" })] : [item("clear"), item("delete")],
    edit: [...editActions.map((action) => item(action)), ...(withTable ? [item("table_layout")] : [])],
  };
}
const at = (kind: "table" | "cell" | "unwrapped"): MenuPlace => ({ kind, table: 2, row: 2, col: 2 });
const actions = (section: MenuSection) => section.items.map((entry) => entry.action);
const ids = (sections: MenuSection[]) => sections.map((section) => section.id);

describe("buildMenuSections", () => {
  it("splits a table cell into this cell and this table", () => {
    const s = buildMenuSections(menu(true), at("cell"), [], "old");
    expect(ids(s)).toEqual(["cell", "table"]);
    expect(actions(s[0])).toEqual(editActions);
    expect(actions(s[1])).toEqual(["clear", "table_layout", "delete"]);
    expect(s[1].items.at(-1)?.labelKey).toBe("assign.ctx.table.delete");
    expect(s[1].items[0].labelKey).toBe("assign.ctx.table.clear");
    expect(s[0].headVars).toEqual({ r: 2, c: 2 });
    expect(s[1].headVars).toEqual({ n: 2 });
  });

  it("keeps the row's own decisions with an unwrapped line and puts back-to-table below", () => {
    const s = buildMenuSections(menu(false), at("unwrapped"), [item("table_rewrap"), item("table_ai_order")], "old");
    expect(ids(s)).toEqual(["cell", "table"]);
    expect(actions(s[0])).toEqual(["clear", "delete", ...editActions]);
    expect(actions(s[1])).toEqual(["table_rewrap", "table_ai_order"]);
    expect(s[0].items[0].labelKey).toBeUndefined();
  });

  it("leaves a plain sentence as it was", () => {
    const s = buildMenuSections(menu(false), { kind: "text" }, [], "old");
    expect(s.map((x) => [x.id, x.headKey, actions(x)])).toEqual([["assign", "assign.ctx.assignGroup", ["clear", "delete"]], ["edit", "assign.ctx.editGroup", editActions]]);
  });

  it("has only the table section's shape items on a New document", () => {
    const s = buildMenuSections(menu(true), at("cell"), [], "new");
    expect(actions(s[1])).toEqual(["table_layout"]);
  });

  it("drops an empty assign section on a New sentence", () => {
    expect(ids(buildMenuSections(menu(false), { kind: "text" }, [], "new"))).toEqual(["edit"]);
  });

  it("names undo delete for a deleted table", () => {
    const s = buildMenuSections(menu(true, true), at("cell"), [], "old");
    expect(s[1].items[0].labelKey).toBe("assign.ctx.table.undoDelete");
    expect(actions(s[1])).toEqual(["clear", "table_layout"]);
  });

  it("puts a table head's items in one table section with delete last", () => {
    const s = buildMenuSections({ assign: [item("clear"), item("delete")], edit: [item("table_layout"), item("caption_attach_prev")] }, at("table"), [], "old");
    expect(ids(s)).toEqual(["table"]);
    expect(actions(s[0])).toEqual(["clear", "table_layout", "caption_attach_prev", "delete"]);
  });

  it("names a cell without row and column plainly", () => {
    const s = buildMenuSections(menu(true), { kind: "cell", table: 1, row: null, col: null }, [], "old");
    expect(s[0].headKey).toBe("assign.ctx.section.cellBare");
  });
});

function unit(id: number, over: Partial<ViewUnit>): ViewUnit {
  return { id, kind: "sentence", block_id: id, table_id: null, group_unit_id: null, ...over } as ViewUnit;
}
const tables = new Map<number, ViewTable>([[7, { id: 7, table_index: 1 } as ViewTable]]);
const blocks = new Map<number, ViewBlock>([[2, { id: 2, row_index: 1, col_index: 1 } as ViewBlock]]);

describe("readMenuPlace", () => {
  const tableUnit = unit(10, { kind: "table", table_id: 7 });
  const cell = unit(2, { kind: "cell_sentence", group_unit_id: 10, table_id: 7 });

  it("reads row and column from the cell block, and the table number", () => {
    expect(readMenuPlace(cell, tableUnit, null, blocks, tables)).toEqual({ kind: "cell", table: 2, row: 2, col: 2 });
  });

  it("reads a table head as the table", () => {
    expect(readMenuPlace(tableUnit, tableUnit, null, blocks, tables)).toEqual({ kind: "table", table: 2, row: null, col: null });
  });

  it("reads an unwrapped cell line", () => {
    const line = unit(2, { kind: "cell_sentence", table_id: 7 });
    expect(readMenuPlace(line, null, tables.get(7) ?? null, blocks, tables)).toEqual({ kind: "unwrapped", table: 2, row: 2, col: 2 });
  });

  it("keeps a caption of a table as plain text", () => {
    expect(readMenuPlace(unit(3, { kind: "caption", group_unit_id: 10 }), tableUnit, null, blocks, tables)).toEqual({ kind: "text" });
  });

  it("keeps a sentence outside tables as plain text", () => {
    expect(readMenuPlace(unit(4, {}), null, null, blocks, tables)).toEqual({ kind: "text" });
  });
});

// 양 단의 New 용지도 한 단으로 연 New와 같은 길(buildAssignMenu → readMenuPlace → buildMenuSections)이다 - 그린 용지는 입력이 아니다
describe("New table menus (two-pane and one-pane alike)", () => {
  const full = (id: number, over: Partial<ViewUnit>): ViewUnit => ({
    id, number: null, display_id: `U${id}`, kind: "sentence", spans: [], text: "text", lang: "ko", table_id: null, row_index: null, group_unit_id: null, status: null,
    pair_id: null, pos_seq: id, block_id: 1, is_edited: false, can_unmerge: false, split_suggestion_id: null, ref: null, caption_refs: [], ...over,
  });
  const table = full(10, { kind: "table", table_id: 7, lang: "none" as ViewUnit["lang"] });
  const cell = full(2, { kind: "cell_sentence", group_unit_id: 10, table_id: 7, block_id: 2 });
  // Old 줄이 확정이어도 New 메뉴에는 배정 항목이 없다
  const menuOf = (target: ViewUnit, over: Partial<AssignMenuContext> = {}) =>
    buildAssignMenu({ target, prev: target === cell ? full(1, { kind: "cell_sentence", group_unit_id: 10, table_id: 7 }) : null, next: null, readOnly: false, rowStatus: "confirmed", isDecided: () => true, hasDraft: () => false, canSplit: true, table, ...over });
  const sectionsOf = (target: ViewUnit, over: Partial<AssignMenuContext> = {}) => buildMenuSections(menuOf(target, over), readMenuPlace(target, table, null, blocks, tables), [], "new");
  const all = (sections: MenuSection[]) => sections.flatMap(actions);

  it("gives a New cell this cell then this table, without assignment items", () => {
    const s = sectionsOf(cell);
    expect(ids(s)).toEqual(["cell", "table"]);
    expect(actions(s[1])).toEqual(["table_layout"]);
    expect(all(s)).not.toContain("clear");
    expect(all(s)).not.toContain("delete");
    expect(s[0].headVars).toEqual({ r: 2, c: 2 });
  });

  it("gives a New table head this table only", () => {
    const s = sectionsOf(table);
    expect(ids(s)).toEqual(["table"]);
    expect(actions(s[0])).toEqual(["table_layout"]);
  });

  it("keeps the same disabled reasons on New", () => {
    const s = sectionsOf(cell, { readOnly: true });
    expect(s.flatMap((section) => section.items).every((entry) => !entry.enabled && entry.reasonKey === "assign.ctx.why.readOnly")).toBe(true);
  });
});
