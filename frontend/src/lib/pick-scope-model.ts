// 고름 두 겹(11-23 명세 C1) - 누른 조각(진하게)과 그것이 든 배정 박스 · 묶음(짝 카드 · 표, 얇은 테와 꼬리표).
// 아직 표인 표의 칸을 누르면 칸이 골라지고 줄 · 배정 · 삭제는 표째다. J/K · 저장 뒤 다음 박스는 박스(줄)에서 걷는다
import type { ViewTable, ViewUnit } from "@/lib/api-sop";
import type { AssignMenuAction } from "@/lib/assign-context-menu-model";
import { getTableNumber } from "@/lib/unwrap-model";

/** 누른 조각 unitId, 그것이 든 줄의 박스 boxId, 둘레에 그릴 묶음(없으면 null) - table은 꼬리표의 표 번호(1부터) */
export interface PickScope {
  unitId: number;
  boxId: number;
  group: { kind: "pair" | "table"; unitIds: readonly number[]; table: number | null } | null;
}

/** 칸 문장 · 캡션 → 그 묶음(표 · 그림) 단위, 아니면 자기 - 끌기 · 줄 찾기가 쓰는 박스 */
export function resolveBoxUnit(unitId: number, units: ReadonlyMap<number, ViewUnit>): number {
  return units.get(unitId)?.group_unit_id ?? unitId;
}

/** 그 Unit의 줄 키 - 묶인 칸 문장 · 캡션이면 그 묶음의 줄. groupOf는 묶인 Unit → 묶음 단위 */
export function readRowKeyOf(unitId: number, rowOfUnit: ReadonlyMap<number, string>, groupOf: ReadonlyMap<number, number>): string | null {
  const own = rowOfUnit.get(unitId);
  if (own !== undefined) return own;
  const groupId = groupOf.get(unitId);
  return (groupId === undefined ? undefined : rowOfUnit.get(groupId)) ?? null;
}

/** J/K가 서 있는 박스 - 칸을 골라도 걷기는 줄(묶음) 단위다(C1-R4) */
export function readNavUnit(scope: PickScope): number {
  return scope.boxId;
}

/** 누른 조각 → 두 겹 고름. 묶인 칸 문장은 표 묶음, 같은 짝이 둘 이상인 줄은 짝 묶음, 그 밖(표 머리를 누른 표 · 벗긴 줄 · 그림 · 외톨이)은 묶음 없음 */
export function buildPickScope(unitId: number, rowUnitIds: readonly number[], units: ReadonlyMap<number, ViewUnit>, tables: ReadonlyMap<number, ViewTable>): PickScope {
  const boxId = resolveBoxUnit(unitId, units);
  if (units.get(unitId)?.kind === "cell_sentence" && boxId !== unitId) {
    const tableId = units.get(boxId)?.table_id ?? null;
    const table = tableId === null ? undefined : tables.get(tableId);
    return { unitId, boxId, group: { kind: "table", unitIds: rowUnitIds, table: table ? getTableNumber(table) : null } };
  }
  const pairId = units.get(boxId)?.pair_id ?? null;
  const mates = pairId === null ? [] : rowUnitIds.filter((id) => units.get(id)?.pair_id === pairId);
  return { unitId, boxId, group: mates.length >= 2 ? { kind: "pair", unitIds: mates, table: null } : null };
}

const NO_HIDDEN: ReadonlySet<AssignMenuAction> = new Set();
// 칸 줄에서 숨기는 표 항목 - 표 벗기기는 아래 표 줄에 있다(글쇠는 표 줄의 항목을 읽는다)
const CELL_HIDDEN: ReadonlySet<AssignMenuAction> = new Set(["table_layout"]);

/** 오른쪽 칸 다듬기 대상 - 칸을 골랐으면 그 칸이 맨 앞(C1-R3), 다음이 줄의 Unit(지금 차례에서 누른 박스가 앞). hidden은 그 줄에 두지 않는 항목 */
export function buildShapeTargets(scope: PickScope, rowUnits: readonly ViewUnit[], cell: ViewUnit | null): { unit: ViewUnit; hidden: ReadonlySet<AssignMenuAction> }[] {
  const rest = [...rowUnits].sort((a, b) => Number(b.id === scope.unitId) - Number(a.id === scope.unitId)).map((unit) => ({ unit, hidden: NO_HIDDEN }));
  return cell === null ? rest : [{ unit: cell, hidden: CELL_HIDDEN }, ...rest];
}
