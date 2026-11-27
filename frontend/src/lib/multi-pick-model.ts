// 여럿 고른 줄의 합치기 · 표 벗기기 · 배정 취소 · 언어 바꾸기 계획과 ⇧G 고름(쪼개기 먼저 설계 §9, 명세 G1) - 이웃 검사와 막는 까닭만 화면이 본다(합치기와 같다).
// 언어마다 합치기 · 짝 다시 맺기 · 표마다의 벗기기는 서버 편집 merge_rows · set_layout_tables가 한 편집으로 한다.
import type { UnitRow, ViewTable, ViewUnit } from "@/lib/api-sop";
import { MERGE_BLOCKER_KEYS, getMergeBlocker } from "@/lib/paper-model";

/** 고른 줄 하나 - Old는 배정 줄(짝이면 구성원 모두), New는 박스와 그 짝 */
export interface MultiRow {
  key: string;
  docId: number;
  units: readonly ViewUnit[];
}

export type MultiPlan<T> = { ok: true; value: T } | { ok: false; reasonKey: string };

const refuse = (reasonKey: string): { ok: false; reasonKey: string } => ({ ok: false, reasonKey });
const PAIR_LANGS = new Set(["ko", "en"]);

/** 한 문서의 줄인가 - 아니면 다른 문서라는 까닭 */
function checkOneDocument(rows: readonly MultiRow[]): { ok: false; reasonKey: string } | null {
  return rows.some((item) => item.docId !== rows[0].docId) ? refuse("assign.bulk.why.otherDoc") : null;
}

/** 고른 줄을 합칠 unit_ids(용지 순). 언어 무리마다 용지 순서로 이웃이어야 한다 - 둘 사이에 있는 Unit이 모두 고른 것이면 이웃이다(번갈아 놓인 한/영 짝) */
export function planMultiMerge(rows: readonly MultiRow[], order: readonly number[], hasDraft: (unit: ViewUnit) => boolean): MultiPlan<readonly number[]> {
  if (rows.length < 2) return refuse("assign.bulk.why.two");
  const otherDoc = checkOneDocument(rows);
  if (otherDoc !== null) return otherDoc;
  const units = rows.flatMap((item) => item.units);
  if (units.some(hasDraft)) return refuse("assign.ctx.why.unsaved");
  const groups = new Map<string, ViewUnit[]>();
  for (const unit of units) groups.set(unit.lang, [...(groups.get(unit.lang) ?? []), unit]);
  for (const group of groups.values()) {
    for (const unit of group) {
      const blocker = getMergeBlocker(group[0], unit);
      if (blocker !== null) return refuse(MERGE_BLOCKER_KEYS[blocker]);
    }
  }
  const hasPair = units.some((unit) => unit.pair_id !== null);
  if (groups.size > 1 && (!hasPair || [...groups.keys()].some((lang) => !PAIR_LANGS.has(lang)))) return refuse("assign.bulk.why.mixed");
  const picked = new Set(units.map((unit) => unit.id));
  const place = new Map(order.map((unitId, index) => [unitId, index]));
  if (units.some((unit) => !place.has(unit.id))) return refuse("assign.bulk.why.notAdjacent");
  for (const group of groups.values()) {
    const spots = group.map((unit) => place.get(unit.id) ?? 0).sort((a, b) => a - b);
    for (let index = spots[0]; index <= spots[spots.length - 1]; index += 1) {
      if (!picked.has(order[index])) return refuse("assign.bulk.why.notAdjacent");
    }
  }
  return { ok: true, value: order.filter((unitId) => picked.has(unitId)) };
}

/** 고른 줄이 모두 표면 벗길 table_ids(고른 차례). null = 표만 고른 것이 아니다(단추 없음) */
export function planMultiUnwrap(rows: readonly MultiRow[], tables: ReadonlyMap<number, ViewTable>): MultiPlan<readonly number[]> | null {
  const tableIds = rows.map((item) => {
    const [unit] = item.units;
    return item.units.length === 1 && unit.kind === "table" && unit.table_id !== null && tables.has(unit.table_id) ? unit.table_id : null;
  });
  if (rows.length === 0 || tableIds.includes(null)) return null;
  return checkOneDocument(rows) ?? { ok: true, value: tableIds.filter((tableId) => tableId !== null) };
}

/** New에서 여럿 고른 박스 → 줄. 짝이면 구성원까지 한 줄(용지 순), 같은 줄은 한 번 */
export function listNewRows(unitIds: readonly number[], units: ReadonlyMap<number, ViewUnit>, docId: number): MultiRow[] {
  const rows = new Map<string, MultiRow>();
  for (const unitId of unitIds) {
    const unit = units.get(unitId);
    if (unit === undefined) continue;
    const key = unit.pair_id === null ? `unit-${unit.id}` : `pair-${unit.pair_id}`;
    if (rows.has(key)) continue;
    const members = unit.pair_id === null ? [unit] : [...units.values()].filter((other) => other.pair_id === unit.pair_id);
    rows.set(key, { key, docId, units: members.sort((a, b) => a.pos_seq - b.pos_seq || a.id - b.id) });
  }
  return [...rows.values()];
}

/** 줄 키 하나를 고름에 넣거나 뺀다. 클릭은 처음 고를 때 고르고 있던 줄도 넣고(Shift+클릭의 규칙), 글쇠(⇧G)는 그 줄만 */
export function toggleChecked(checked: ReadonlySet<string>, key: string, active: string | null, via: "click" | "key"): Set<string> {
  const next = new Set(checked);
  if (!next.delete(key)) next.add(key);
  if (via === "click" && active !== null && checked.size === 0 && active !== key) next.add(active);
  return next;
}

/** 고른 줄 중 이미 배정된 것을 뺀 배정 취소 대상 - 남은 것이 없으면 까닭. 짝 줄은 구성원 모두 */
export function planBulkClear(rows: readonly MultiRow[], unitMap: ReadonlyMap<number, UnitRow>): MultiPlan<readonly { unit_id: number; revision: number }[]> {
  const decided = rows.flatMap((item) => item.units.flatMap((unit) => unitMap.get(unit.id) ?? []))
    .filter((unit) => unit.decision.disposition !== "unassigned" || unit.status !== "unassigned");
  return decided.length === 0 ? refuse("assign.bulk.why.notAssigned") : { ok: true, value: decided.map((unit) => ({ unit_id: unit.unit_id, revision: unit.decision.revision })) };
}

export interface BulkLang {
  unitIds: readonly number[];
  skipped: number;
}

const LANG_KINDS = new Set(["sentence", "heading", "cell_sentence", "caption"]);

/**
 * 고른 줄을 한 언어로 맞출 unit_ids와 건너뛴 줄 수. 건너뜀 = 이미 그 언어 · 짝 · 합친 박스(can_unmerge) · 글이 아님 · 참조 · 목차 줄 · 못 바꾸는 줄(isLocked: 배정 · 저장 전).
 * 한 문서여야 한다. 줄 하나가 Unit 하나일 때만 바꾼다(짝 줄은 구성원이 둘이라 건너뜀 - 모양을 바꾸는 언어 전환은 줄마다 따로).
 */
export function planBulkLang(rows: readonly MultiRow[], lang: "ko" | "en", isLocked: (unit: ViewUnit) => boolean): MultiPlan<BulkLang> {
  const otherDoc = checkOneDocument(rows);
  if (otherDoc !== null) return otherDoc;
  const picked = rows.flatMap((item) => {
    const [unit] = item.units;
    const isChangeable = item.units.length === 1 && unit.pair_id === null && !unit.can_unmerge && LANG_KINDS.has(unit.kind) && (unit.lang === "ko" || unit.lang === "en") && unit.lang !== lang
      && !unit.noise_kind && !isLocked(unit);
    return isChangeable ? [unit.id] : [];
  });
  return picked.length === 0 ? refuse("assign.bulk.why.noneToChange") : { ok: true, value: { unitIds: picked, skipped: rows.length - picked.length } };
}

export type BulkAction = "delete" | "unassign" | "lang_ko" | "lang_en" | "merge" | "unwrap";

/** 위쪽 바에 놓을 단추(차례대로) - Old는 삭제 · 배정 취소가 앞, New는 합치기부터. 표 벗기기는 표만 골랐을 때만, 못 하는 것은 흐리게 두고 까닭을 보인다 */
export function listBulkActions(side: "old" | "new", rows: readonly MultiRow[]): BulkAction[] {
  const isTables = rows.length > 0 && rows.every((item) => item.units.length === 1 && item.units[0].kind === "table");
  const edits: BulkAction[] = isTables ? ["merge", "unwrap"] : ["merge"];
  return side === "old" ? ["delete", "unassign", "lang_ko", "lang_en", ...edits] : [...edits, "lang_ko", "lang_en"];
}
