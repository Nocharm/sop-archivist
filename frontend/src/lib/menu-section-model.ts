// 표 칸 우클릭 메뉴의 구역(11-23 명세 C2) - 칸이면 "이 칸" 위 · "이 표" 아래, 벗긴 표의 줄이면 "이 칸"(배정 · 고치기) 아래 "이 표"(다시 표로 · AI 순서), 표 머리면 "이 표" 하나.
// 표 밖 문장 · 캡션 · 그림은 지금 두 묶음(배정 · 문장 고치기) 그대로. 항목의 가능/불가는 buildAssignMenu가 이미 정했고, 여기는 그것을 구역으로 나눠 이름에 범위를 붙인다.
import type { ViewBlock, ViewTable, ViewUnit } from "./api-sop";
import type { AssignMenuGroups, AssignMenuItem } from "./assign-context-menu-model";
import { getTableNumber } from "./unwrap-model";

/** 우클릭한 자리 - table은 표 번호(1부터, 꼬리표 · 확인창과 같은 번호), row · col은 칸 블록의 값 + 1(모르면 null) */
export type MenuPlace = { kind: "text" } | { kind: "table" | "cell" | "unwrapped"; table: number; row: number | null; col: number | null };

export interface MenuSection {
  id: "assign" | "edit" | "cell" | "table";
  headKey: string;
  headVars: Record<string, number>;
  items: AssignMenuItem[];
}

/**
 * 우클릭한 단위가 놓인 자리 - table은 그 단위가 든 표 단위(표를 직접 눌렀으면 그 단위), unwrappedTable은 벗긴 표의 칸 줄이 든 벗긴 표.
 * 캡션 · 그림은 표 단위에 딸려 있어도 text다(지금 모양 그대로).
 */
export function readMenuPlace(
  target: ViewUnit,
  table: ViewUnit | null,
  unwrappedTable: ViewTable | null,
  blocks: ReadonlyMap<number, ViewBlock>,
  tables: ReadonlyMap<number, ViewTable>,
): MenuPlace {
  const block = blocks.get(target.block_id);
  const row = block && block.row_index !== null ? block.row_index + 1 : null;
  const col = block && block.col_index !== null ? block.col_index + 1 : null;
  if (table !== null && table.table_id !== null && (target.kind === "table" || target.kind === "cell_sentence")) {
    const holder = tables.get(table.table_id);
    if (holder) return target.kind === "table" ? { kind: "table", table: getTableNumber(holder), row: null, col: null } : { kind: "cell", table: getTableNumber(holder), row, col };
  }
  if (unwrappedTable !== null && target.kind === "cell_sentence" && target.group_unit_id === null) return { kind: "unwrapped", table: getTableNumber(unwrappedTable), row, col };
  return { kind: "text" };
}

/** 표 단위 항목의 이름에 범위를 넣는다(C2-R2) - 표 전체 삭제 · 표 배정 취소 · 표 삭제 취소 */
function scopeToTable(item: AssignMenuItem): AssignMenuItem {
  if (item.action === "delete") return { ...item, labelKey: "assign.ctx.table.delete" };
  if (item.action === "clear") return { ...item, labelKey: item.labelKey === "assign.ctx.undoDelete" ? "assign.ctx.table.undoDelete" : "assign.ctx.table.clear" };
  return item;
}

function makeCellSection(place: Exclude<MenuPlace, { kind: "text" }>, items: AssignMenuItem[]): MenuSection {
  const hasPos = place.row !== null && place.col !== null;
  return { id: "cell", headKey: hasPos ? "assign.ctx.section.cell" : "assign.ctx.section.cellBare", headVars: hasPos ? { r: place.row ?? 0, c: place.col ?? 0 } : {}, items };
}

function makeTableSection(place: Exclude<MenuPlace, { kind: "text" }>, items: AssignMenuItem[]): MenuSection {
  return { id: "table", headKey: "assign.ctx.section.table", headVars: { n: place.table }, items };
}

/**
 * 메뉴 항목을 구역으로 - 빈 구역은 빼고, 위에서 아래로 이 칸 → 이 표.
 * doc은 그 단위가 든 문서 - New 문서는 보낼 곳이 없어 배정 항목이 없다. 그린 용지(양 단의 오른쪽 · 한 단)와 상관없이 같은 구역이다
 */
export function buildMenuSections(menu: AssignMenuGroups, place: MenuPlace, tableItems: readonly AssignMenuItem[], doc: "old" | "new"): MenuSection[] {
  const groups = doc === "new" ? { ...menu, assign: [] } : menu;
  const sections: MenuSection[] = [];
  if (place.kind === "text") {
    if (groups.assign.length > 0) sections.push({ id: "assign", headKey: "assign.ctx.assignGroup", headVars: {}, items: groups.assign });
    if (groups.edit.length > 0) sections.push({ id: "edit", headKey: "assign.ctx.editGroup", headVars: {}, items: groups.edit });
    return sections;
  }
  if (place.kind === "table") {
    // 표 머리는 배정 취소 · 표 벗기기 · 삭제가 모두 표 하나의 일이다 - 삭제는 맨 끝
    const items = [...groups.assign.filter((item) => item.action !== "delete"), ...groups.edit, ...groups.assign.filter((item) => item.action === "delete")];
    return [makeTableSection(place, items.map(scopeToTable))];
  }
  if (place.kind === "unwrapped") {
    sections.push(makeCellSection(place, [...groups.assign, ...groups.edit]));
    if (tableItems.length > 0) sections.push(makeTableSection(place, [...tableItems]));
    return sections;
  }
  const cellItems = groups.edit.filter((item) => item.action !== "table_layout");
  if (cellItems.length > 0) sections.push(makeCellSection(place, cellItems));
  const tableOwn = [
    ...groups.assign.filter((item) => item.action === "clear"),
    ...groups.edit.filter((item) => item.action === "table_layout"),
    ...groups.assign.filter((item) => item.action === "delete"),
  ];
  sections.push(makeTableSection(place, tableOwn.map(scopeToTable)));
  return sections;
}
