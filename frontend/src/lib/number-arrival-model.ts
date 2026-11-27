// 번호가 새로 생긴 박스 고르기 - 합치기 · 표 벗기기 같은 편집 응답 뒤, 글 앞 번호가 번호 칸으로 빠지는 짧은 전환(항목 6-b)을 걸 박스.
// 편집은 단위를 은퇴시키고 새로 만들어 id가 바뀌므로, 같은 id 또는 같은 첫 자리(블록 · 시작)의 앞 단위에 번호가 없었는지로 본다.
// 번호 고치기는 응답을 기다리지 않고 기대 글을 먼저 보인다(A2-R6) - 전환도 누른 순간 시작하고, 응답 값이 이긴다.
import type { EditOp, ViewUnit } from "@/lib/api-sop";

const EMPTY: ReadonlySet<number> = new Set();

function getPlaceKey(unit: Pick<ViewUnit, "spans">): string | null {
  const first = unit.spans[0];
  return first ? `${first[0]}:${first[1]}` : null;
}

function hasNumber(unit: Pick<ViewUnit, "number">): boolean {
  return (unit.number?.value ?? null) !== null;
}

/** 앞 보기 → 다음 보기에서 번호 칸 값이 없다가 생긴 단위 id - 앞 보기가 없거나(처음 그림) 겹치는 자리가 없으면(다른 문서) 빈 집합 */
export function findArrivedNumbers(
  prev: ReadonlyMap<number, Pick<ViewUnit, "id" | "spans" | "number">> | null,
  next: ReadonlyMap<number, Pick<ViewUnit, "id" | "spans" | "number">>,
): ReadonlySet<number> {
  if (prev === null || prev === next) return EMPTY;
  const hadNumberAt = new Map<string, boolean>();
  for (const unit of prev.values()) {
    const key = getPlaceKey(unit);
    if (key !== null) hadNumberAt.set(key, hasNumber(unit));
  }
  const arrived = new Set<number>();
  for (const unit of next.values()) {
    if (!hasNumber(unit)) continue;
    const before = prev.get(unit.id);
    const key = getPlaceKey(unit);
    const hadNumber = before !== undefined ? hasNumber(before) : key === null ? undefined : hadNumberAt.get(key);
    if (hadNumber === false) arrived.add(unit.id);
  }
  return arrived.size === 0 ? EMPTY : arrived;
}

/** 누른 편집이 줄 번호 - 번호 고치기가 아니면 null. 따라 바뀌는 뒤 번호는 응답이 준다 */
export function readExpectedNumber(op: EditOp): { unitId: number; value: string | null } | null {
  return op.type === "set_number" ? { unitId: op.unit_id, value: op.number } : null;
}

/** 응답은 왔고 그 편집이 든 보기를 아직 못 받은 번호 - revision은 응답의 문서 revision */
export interface SentNumber {
  docId: number;
  revision: number;
  unitId: number;
  value: string | null;
}

/**
 * 번호 칸에 먼저 보일 기대 글 [단위, 번호] - 아직 응답이 오지 않은 편집(ops, 나간 차례)과, 응답 뒤 그 revision의 보기가 닿지 않은 것(sent).
 * 같은 단위면 나중에 누른 것. 보기가 닿으면 빠진다 - 응답 값이 이긴다
 */
export function listExpectedNumbers(ops: readonly EditOp[], sent: readonly SentNumber[], views: ReadonlyArray<{ document: { id: number; revision: number } }>): Array<[number, string | null]> {
  const expected = new Map<number, string | null>();
  for (const item of sent) {
    if (views.some(({ document }) => document.id === item.docId && document.revision < item.revision)) expected.set(item.unitId, item.value);
  }
  for (const op of ops) {
    const number = readExpectedNumber(op);
    if (number !== null) expected.set(number.unitId, number.value);
  }
  return [...expected];
}

/** 누른 편집이 줄 들여쓰기 차이 [단위, 차이] - 저장은 정한 값이라 나중에 누른 것이 이긴다 */
export function readOpShifts(op: EditOp): Array<[number, number]> {
  if (op.type === "set_indents") return op.units.map((item) => [item.unit_id, item.indent_shift]);
  return op.type === "set_number" && op.indent_shift !== undefined ? [[op.unit_id, op.indent_shift]] : [];
}

/** 응답은 왔고 그 편집이 든 보기를 아직 못 받은 들여쓰기 */
export interface SentShifts {
  docId: number;
  revision: number;
  shifts: ReadonlyArray<[number, number]>;
}

/** 아직 보기에 없는 들여쓰기 차이(listExpectedNumbers와 같은 규칙) - 저장이 느린 동안 Tab을 이어 눌러도 누른 만큼 들어가게 */
export function listExpectedShifts(ops: readonly EditOp[], sent: readonly SentShifts[], views: ReadonlyArray<{ document: { id: number; revision: number } }>): Map<number, number> {
  const waiting = sent.filter((item) => views.some(({ document }) => document.id === item.docId && document.revision < item.revision));
  return new Map([...waiting.flatMap((item) => item.shifts), ...ops.flatMap(readOpShifts)]);
}

/** 단위 보기에 기대 글을 얹는다 - 얹을 것이 없으면 같은 것을 돌려준다(용지를 다시 그리지 않게) */
export function applyExpectedNumbers<U extends Pick<ViewUnit, "number">>(units: ReadonlyMap<number, U>, expected: ReadonlyMap<number, string | null>): ReadonlyMap<number, U> {
  let shown: Map<number, U> | null = null;
  for (const [unitId, value] of expected) {
    const unit = units.get(unitId);
    if (!unit?.number || unit.number.value === value) continue;
    shown ??= new Map(units);
    shown.set(unitId, { ...unit, number: { ...unit.number, value, is_set: true } });
  }
  return shown ?? units;
}
