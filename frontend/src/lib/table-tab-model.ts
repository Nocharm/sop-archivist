// 표 탭 · 본문 표 접기의 모델(11-23 명세 E2) - 본문의 바깥 표를 문서 차례로 모으고, 표 탭의 J/K 차례 · 용지 줄이 든 표 · 접힘을 정한다. 순수 함수라 용지와 Assign 훅이 같이 쓴다.

import type { DocumentView, ViewTable, ViewUnit } from "./api-sop";
import type { PaperModel, PaperRow } from "./paper-model";

/** 본문의 바깥 표 하나 - 띠 표(제목 줄) · 칸 안 표는 바깥 것에 든다 */
export interface TableBlock {
  tableId: number;
  /** 표 첫 블록의 절 번호 - 표 탭의 위치 머리("§5 아래"), 없으면 빈 글 */
  section: string;
  /** 원문 표의 크기 */
  rows: number;
  cols: number;
  /** 아직 표인 표의 캡션 글 - 없으면 빈 글 */
  caption: string;
  isUnwrapped: boolean;
  /** 표 탭에서 J/K가 밟는 단위 - 아직 표면 표 단위 하나, 벗긴 표면 줄마다(사람이 바꾼 순서) */
  unitIds: number[];
}

/** 표가 든 맨 바깥 표 - 안쪽 표 · 띠 표는 바깥 표를 따라 올라간다 */
function findOuterTable(tables: ReadonlyMap<number, ViewTable>, tableId: number): number {
  let id = tableId;
  for (let parent = tables.get(id)?.parent_table_id ?? null; parent !== null && tables.has(parent); parent = tables.get(id)?.parent_table_id ?? null) id = parent;
  return id;
}

/** 본문의 바깥 표(문서 차례) - 머리말 · 꼬리말의 표와 벗겨 제목 줄이 된 띠 표는 표 탭에 들지 않는다 */
export function listTableBlocks(view: Pick<DocumentView, "blocks" | "units">, model: Pick<PaperModel, "order" | "unwrapLines" | "tables" | "unwrapped">): TableBlock[] {
  const tableUnit = new Map<number, number>();
  for (const unit of view.units) if (unit.kind === "table" && unit.table_id !== null) tableUnit.set(unit.table_id, unit.id);
  const captions = new Map<number, string[]>();
  for (const unit of [...view.units].sort((a, b) => a.pos_seq - b.pos_seq)) {
    if (unit.kind !== "caption" || unit.group_unit_id === null) continue;
    const list = captions.get(unit.group_unit_id) ?? [];
    list.push(unit.text);
    captions.set(unit.group_unit_id, list);
  }
  const lines = new Map<number, number[]>();
  for (const id of model.order) {
    const lineTable = model.unwrapLines.get(id);
    if (lineTable === undefined) continue;
    const outer = findOuterTable(model.tables, lineTable);
    const list = lines.get(outer) ?? [];
    list.push(id);
    lines.set(outer, list);
  }
  const out: TableBlock[] = [];
  const seen = new Set<number>();
  for (const block of [...view.blocks].sort((a, b) => a.seq - b.seq)) {
    if (block.table_id === null) continue;
    const tableId = findOuterTable(model.tables, block.table_id);
    const table = model.tables.get(tableId);
    if (seen.has(tableId) || !table) continue;
    seen.add(tableId);
    if (table.part !== "body" || (table.is_band && table.is_layout)) continue;
    const isUnwrapped = model.unwrapped.has(tableId);
    const unitId = tableUnit.get(tableId);
    out.push({
      tableId,
      section: block.section_label,
      rows: table.n_rows,
      cols: table.n_cols,
      caption: unitId === undefined ? "" : (captions.get(unitId) ?? []).join(" "),
      isUnwrapped,
      unitIds: isUnwrapped ? (lines.get(tableId) ?? []) : unitId === undefined ? [] : [unitId],
    });
  }
  return out;
}

/** 표 탭의 J/K 차례 - 표 차례로 이은 단위 */
export function listTableTabUnitIds(blocks: readonly TableBlock[]): number[] {
  return blocks.flatMap((block) => block.unitIds);
}

// 표 목록마다 단위 → 표 - J/K가 글쇠마다 모든 줄에 묻는다(목록은 모델마다 한 벌이라 그 목록에 붙여 둔다)
const unitTables = new WeakMap<readonly TableBlock[], Map<number, number>>();

/** 단위가 든 표 탭의 표 - 칸 문장 · 캡션은 묶인 표 단위로 찾는다. 표 탭에 없으면 null */
export function findUnitTable(blocks: readonly TableBlock[], unitId: number, units: ReadonlyMap<number, Pick<ViewUnit, "group_unit_id">>): number | null {
  let map = unitTables.get(blocks);
  if (!map) {
    map = new Map(blocks.flatMap((block) => block.unitIds.map((id) => [id, block.tableId] as const)));
    unitTables.set(blocks, map);
  }
  return map.get(units.get(unitId)?.group_unit_id ?? unitId) ?? null;
}

/** 탭에서 J/K가 밟을 단위인가 - 표 탭은 표의 단위만, 다른 탭은 접힌 표의 단위를 건너뛴다(접힌 표는 용지에 없다) */
export function isTableWalkUnit(blocks: readonly TableBlock[], units: ReadonlyMap<number, Pick<ViewUnit, "group_unit_id">>, folded: ReadonlySet<number>, isTablesTab: boolean, unitId: number): boolean {
  const tableId = findUnitTable(blocks, unitId, units);
  return isTablesTab ? tableId !== null : tableId === null || !folded.has(tableId);
}

/** 용지 줄이 든 바깥 표 - 표 줄은 그 표, 글 · 그림 줄은 칸 블록의 표(벗긴 표의 줄 · 띠 표 제목 줄). 표 밖 줄이면 null */
export function findRowTable(row: PaperRow, tables: ReadonlyMap<number, ViewTable>): number | null {
  const tableId = row.type === "table" ? row.item.table.id : row.type === "figure" ? row.block.table_id : (row.parts[0]?.block.table_id ?? null);
  return tableId === null ? null : findOuterTable(tables, tableId);
}

/** 접힌 표의 줄은 첫 줄 하나만 남긴다 - 그 줄 자리에 용지가 한 줄 자리 표시를 그린다(나머지 줄은 DOM에 없다) */
export function keepFoldedHeads(rows: PaperRow[], folded: ReadonlySet<number>, tables: ReadonlyMap<number, ViewTable>): PaperRow[] {
  if (folded.size === 0) return rows;
  const seen = new Set<number>();
  return rows.filter((row) => {
    const tableId = findRowTable(row, tables);
    if (tableId === null || !folded.has(tableId)) return true;
    if (seen.has(tableId)) return false;
    seen.add(tableId);
    return true;
  });
}

/** 그릴 때의 접힘 - 고른 단위가 든 표는 펼친다(저장 뒤 고름이 접힌 표 안으로 가도 보이게) */
export function resolveFolded(folded: ReadonlySet<number>, blocks: readonly TableBlock[], openUnitIds: ReadonlySet<number>): ReadonlySet<number> {
  if (folded.size === 0 || openUnitIds.size === 0) return folded;
  const open = new Set(blocks.filter((block) => block.unitIds.some((id) => openUnitIds.has(id))).map((block) => block.tableId));
  return open.size === 0 ? folded : new Set([...folded].filter((id) => !open.has(id)));
}

export function toggleFold(folded: ReadonlySet<number>, tableId: number): ReadonlySet<number> {
  const next = new Set(folded);
  if (!next.delete(tableId)) next.add(tableId);
  return next;
}

/** 표 모두 접기 · 펼치기 - 하나라도 펼쳐 있으면 모두 접고, 모두 접혀 있으면 모두 펼친다 */
export function toggleFoldAll(folded: ReadonlySet<number>, blocks: readonly TableBlock[]): ReadonlySet<number> {
  return isAllFolded(folded, blocks) ? new Set() : new Set(blocks.map((block) => block.tableId));
}

/** 모두 접혀 있나 - 모두 접기 단추의 문구가 고른다 */
export function isAllFolded(folded: ReadonlySet<number>, blocks: readonly TableBlock[]): boolean {
  return blocks.length > 0 && blocks.every((block) => folded.has(block.tableId));
}
