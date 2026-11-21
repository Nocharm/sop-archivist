// 번호 칸 창의 ◀ ▶ 들여쓰기(B8 항목 7)의 순수 모델 - 점 기호 · 직접 번호 · 번호 없는 줄의 단계 끝, 이어진 줄 일괄, 기호를 고를 때 위로 맞춤.
// 단계는 strip-pill-model getRowLevels(셈한 단계 + units.indent_shift)이고, 숫자 번호 줄의 ◀ ▶는 번호를 바꾼다(number-kind-model stepContinuous).

import { getBulletIndex } from "./number-kind-model";
import { getSectionLevel, MAX_LEVEL, type LevelRow, type RowLevel } from "./strip-pill-model";

/** 서버 MAX_INDENT_SHIFT와 같다 - 저장하는 차이의 절댓값 상한 */
export const MAX_INDENT_SHIFT = 9;

/** 들여쓰기를 셈하는 용지 줄 - unitId가 없는 줄(표 머리 등)은 바꾸지 못한다 */
export interface IndentRow extends LevelRow {
  unitId: number | null;
}

export interface IndentChange {
  unitId: number;
  indentShift: number;
}

/** ◀ ▶ 한 번 - 누른 줄과, 아래로 이어져 함께 바뀌는 줄들(되돌리기 두 칸으로 따로 저장한다) */
export interface IndentPlan {
  clicked: IndentChange;
  batch: IndentChange[];
}

/** 줄의 꼴 - 숫자 번호 · 점 기호(기호마다 다른 꼴) · 직접 번호 · 없음 */
function readShape(label: string): string {
  if (getSectionLevel(label) > 0) return "number";
  if (getBulletIndex(label) >= 0) return label;
  return label === "" ? "none" : "custom";
}

function clampShift(shift: number): number {
  return Math.min(Math.max(shift, -MAX_INDENT_SHIFT), MAX_INDENT_SHIFT);
}

/** 단계를 바꿀 수 있는 줄 - 번호 칸이 있고 숫자 번호가 아니며 짝 카드의 둘째 줄이 아니다(둘째 줄은 첫 줄 단계를 따른다) */
function canShift(row: IndentRow): boolean {
  return row.unitId !== null && row.hasCell !== false && row.pairTopOf == null && readShape(row.sectionLabel) !== "number";
}

/**
 * ◀ ▶을 켤지 - 화면 단계로 잰다. ◀ 끝 = 1단계, ▶ 끝 = 바로 위 줄 단계 + 1(두 단계 이상 못 뜀 - 번호 줄의 끝과 같은 뜻)이자 MAX_LEVEL.
 * 숫자 번호 줄 · 바꿀 수 없는 줄은 둘 다 꺼진다
 */
export function getIndentBounds(rows: readonly IndentRow[], levels: ReadonlyMap<string, RowLevel>, key: string): { canOutdent: boolean; canIndent: boolean } {
  const index = rows.findIndex((row) => row.key === key);
  const row = rows[index];
  const level = levels.get(key)?.level;
  if (!row || level === undefined || !canShift(row)) return { canOutdent: false, canIndent: false };
  const above = index > 0 && rows[index - 1].part === row.part ? (levels.get(rows[index - 1].key)?.level ?? 0) : 0;
  return { canOutdent: level > 1, canIndent: level < Math.min(MAX_LEVEL, above + 1) };
}

/**
 * ◀(-1) ▶(+1) 한 번에 바뀌는 줄(B8 7-a · 7-b) - 누른 줄은 화면 단계를 delta만큼, 함께 바뀌는 줄은 누른 줄 아래로 이어지는
 * 같은 단계 · 같은 꼴(같은 기호끼리, 직접 번호끼리, 번호 없는 줄끼리)의 줄과 그 사이의 더 깊은 줄(하위)이다. 더 얕은 줄 · 같은 단계의 다른 꼴 ·
 * 숫자 번호 줄을 만나면 멈춘다. 옮기는 기호 줄에 단계를 빌린 줄(anchor)은 저절로 따라가므로 적지 않는다(같은 차이를 두 번 더하지 않게).
 * 표 · 그림 줄과 짝 카드의 둘째 줄은 건너뛴다. 끝을 넘으면 null
 */
export function planIndent(rows: readonly IndentRow[], levels: ReadonlyMap<string, RowLevel>, key: string, delta: -1 | 1): IndentPlan | null {
  const bounds = getIndentBounds(rows, levels, key);
  if (!(delta < 0 ? bounds.canOutdent : bounds.canIndent)) return null;
  const index = rows.findIndex((row) => row.key === key);
  const row = rows[index];
  const own = levels.get(key)!;
  const shape = readShape(row.sectionLabel);
  const toChange = (level: RowLevel, unitId: number): IndentChange => ({ unitId, indentShift: clampShift(level.level + delta - level.base) });
  const moved = new Set([key]);
  const batch: IndentChange[] = [];
  for (const next of rows.slice(index + 1)) {
    if (next.part !== row.part) break;
    if (!canShift(next)) {
      if (readShape(next.sectionLabel) === "number" && next.pairTopOf == null && next.hasCell !== false) break;
      continue;
    }
    const level = levels.get(next.key);
    if (!level) continue;
    if (level.anchor !== null && moved.has(level.anchor)) continue;
    if (level.level < own.level) break;
    const nextShape = readShape(next.sectionLabel);
    if (level.level === own.level && nextShape !== shape) break;
    batch.push(toChange(level, next.unitId!));
    moved.add(next.key);
  }
  return { clicked: toChange(own, row.unitId!), batch };
}

/**
 * 기호를 고를 때 따를 들여쓰기 차이(B8 7-5) - 위로 가장 가까운 점 기호 줄(같은 부분, 숫자 번호 줄을 만나면 멈춤 - 같은 절 안)의 차이.
 * 같은 절이면 숫자 번호 깊이가 같아 차이가 같으면 단계도 같다(기호가 다르면 기호 순번만큼 더 깊거나 얕다). 없으면 null(지금 차이 그대로)
 */
export function findBulletShift(rows: readonly IndentRow[], key: string): number | null {
  const index = rows.findIndex((row) => row.key === key);
  if (index < 0) return null;
  for (let at = index - 1; at >= 0 && rows[at].part === rows[index].part; at -= 1) {
    const shape = readShape(rows[at].sectionLabel);
    if (shape === "number" && rows[at].pairTopOf == null) return null;
    if (getBulletIndex(shape) >= 0 && rows[at].pairTopOf == null) return rows[at].shift ?? 0;
  }
  return null;
}
