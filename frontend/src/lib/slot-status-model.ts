// New 목록 줄의 SOP 칸을 상태 표로 읽는 순수 모델 - 여섯 상태·요약·쓴 사유·사유 편집기 하나. 화면은 이 결과를 그리기만 한다.
// 칸 목록·번호·이름·위계는 서버가 준 그 문서의 골격(ToBe.outline_items)에서 읽는다 - 문서마다 다를 수 있고 수준이 둘로 정해져 있지 않다.
// 설계: docs/superpowers/specs/2026-11-17-documents-screen-design.md
import type { SlotCount, TargetDoc, ToBe } from "./api-sop";

/** 칸 키 - 그 문서 골격 항목의 키. 문서마다 달라 고정 목록으로 좁히지 않는다 */
export type SlotKey = string;

/** backend constants.EQUIPMENT_SLOT_KEYS와 같은 값 - 장비 SOP에서 채우거나 N/A로 남겨야 하는 세 칸 */
export const EQUIPMENT_SLOT_KEYS: readonly SlotKey[] = [
  "procedures.electronic_record_control",
  "procedures.troubleshooting",
  "procedures.maintenance",
];

export type SlotState =
  | { kind: "na"; reason: string } // 1 그 칸에 N/A가 저장돼 있다
  | { kind: "covered"; by: SlotKey } // 2 상위 칸(가장 가까운 조상)이 N/A다
  | { kind: "filled"; count: number } // 3 그 칸의 count > 0
  | { kind: "sub"; count: number } // 4 상위 칸, 자기 0, 하위 칸(그 아래 전부) count의 합 > 0
  | { kind: "decide" } // 5 장비 SOP의 세 칸이고 위 넷이 아니다
  | { kind: "empty" }; // 6 그 밖

export interface SlotRow {
  key: SlotKey;
  /** 번호 없는 항목은 빈 글 */
  number: string;
  /** 그 항목의 이름만(조상 이름은 붙이지 않는다 - 표가 들여쓰기로 위계를 보인다) */
  label: string;
  /** 최상위 0 */
  level: number;
  state: SlotState;
  /** Mark N/A를 그릴 칸 - decide·empty이고 칸 제목이 이어져 있지 않다 */
  canMarkNa: boolean;
  /** 문장은 없는데 그 칸이나 하위 칸의 칸 제목에 옛 제목이 이어져 있다(서버가 N/A를 막는다) */
  headingLinked: boolean;
}

export interface SlotSummary {
  filled: number;
  empty: number;
  na: number;
  decide: number;
}

/** 그 문서의 칸별 수 - 다른 문서의 줄은 읽지 않는다(골격에 없는 키는 찾는 칸이 없어 쓰이지 않는다). 이미 쓴 문서(match)는 수를 읽지 않는다 */
function readCounts(tobe: ToBe, doc: TargetDoc): Map<string, SlotCount> {
  const counts = new Map<string, SlotCount>();
  if (doc.entrance === "match") return counts;
  for (const row of tobe.slot_counts ?? []) {
    if (row.target_doc_id === doc.id) counts.set(row.slot_key, row);
  }
  return counts;
}

/**
 * SOP 한 줄의 칸 - 그 문서의 골격 항목(뺀 항목 제외)을 서버가 준 순서대로. 이미 쓴 문서(entrance "match")는 수를 읽지 않는다(3·4번 상태와 headingLinked가 없다).
 * 상위 칸은 parent_key를 따라 끝까지 본다 - N/A는 가장 가까운 N/A 조상이 덮고, 하위 칸의 수는 그 아래 전부를 더한다
 */
export function buildSlotRows(tobe: ToBe, doc: TargetDoc): SlotRow[] {
  const items = tobe.outline_items.filter((item) => item.code === doc.code && !item.is_removed);
  const counts = readCounts(tobe, doc);
  const reasons = new Map<string, string>();
  for (const na of tobe.na_slots) if (na.code === doc.code) reasons.set(na.slot_key, na.reason);

  const parents = new Map(items.map((item) => [item.key, item.parent_key]));
  /** 조상 키 - 가까운 것부터 */
  const listAncestors = (key: string): string[] => {
    const ancestors: string[] = [];
    for (let parent = parents.get(key) ?? null; parent !== null; parent = parents.get(parent) ?? null) ancestors.push(parent);
    return ancestors;
  };

  return items.map((item) => {
    const { key } = item;
    const coveredBy = listAncestors(key).find((ancestor) => reasons.has(ancestor));
    const below = items.filter((other) => listAncestors(other.key).includes(key));
    const own = counts.get(key);
    const ownCount = own?.count ?? 0;
    const subCount = below.reduce((sum, child) => sum + (counts.get(child.key)?.count ?? 0), 0);
    const headings = (own?.heading_count ?? 0) + below.reduce((sum, child) => sum + (counts.get(child.key)?.heading_count ?? 0), 0);

    // 상태는 표의 순서대로 먼저 맞는 것
    let state: SlotState;
    if (reasons.has(key)) state = { kind: "na", reason: reasons.get(key) ?? "" };
    else if (coveredBy !== undefined) state = { kind: "covered", by: coveredBy };
    else if (ownCount > 0) state = { kind: "filled", count: ownCount };
    else if (subCount > 0) state = { kind: "sub", count: subCount };
    else if (doc.is_equipment_sop && EQUIPMENT_SLOT_KEYS.includes(key)) state = { kind: "decide" };
    else state = { kind: "empty" };

    const open = state.kind === "decide" || state.kind === "empty";
    const headingLinked = open && headings > 0;
    return { key, number: item.number ?? "", label: item.title_en, level: item.level, state, canMarkNa: open && !headingLinked, headingLinked };
  });
}

/**
 * 표의 두 단 - 최상위 칸 앞에서만 가른다(하위 칸은 상위 칸과 같은 단에 남는다). 최상위에 procedures가 있으면 그 앞이고(15칸 골격의 5.2와 6 사이 -
 * 화면이 익숙한 자리를 지킨다), 없으면 줄 수의 가운데에 가장 가까운 최상위 칸 앞이다(같은 거리면 뒤쪽 - 왼쪽 단이 길다). 가를 곳이 없으면 오른쪽 단이 빈다
 */
export function splitSlotColumns(rows: readonly SlotRow[]): [SlotRow[], SlotRow[]] {
  const pinned = rows.findIndex((row) => row.level === 0 && row.key === "procedures");
  let split = rows.length;
  if (pinned > 0) split = pinned;
  else {
    const middle = rows.length / 2;
    rows.forEach((row, index) => {
      if (row.level === 0 && index > 0 && Math.abs(index - middle) <= Math.abs(split - middle)) split = index;
    });
  }
  return [rows.slice(0, split), rows.slice(split)];
}

/** filled = 3·4번, na = 1·2번. 네 수의 합은 늘 칸 수 */
export function summarizeSlots(rows: readonly SlotRow[]): SlotSummary {
  const summary: SlotSummary = { filled: 0, empty: 0, na: 0, decide: 0 };
  for (const { state } of rows) {
    if (state.kind === "filled" || state.kind === "sub") summary.filled += 1;
    else if (state.kind === "na" || state.kind === "covered") summary.na += 1;
    else if (state.kind === "decide") summary.decide += 1;
    else summary.empty += 1;
  }
  return summary;
}

/** 이 Bundle의 N/A에 쓴 사유 - 앞뒤 공백을 걷은 글이 같으면 하나, 많이 쓴 순(같으면 먼저 나온 순), limit개 */
export function listUsedReasons(tobe: ToBe, limit = 3): string[] {
  const tally = new Map<string, number>();
  for (const na of tobe.na_slots) {
    const reason = na.reason.trim();
    if (reason !== "") tally.set(reason, (tally.get(reason) ?? 0) + 1);
  }
  // Map은 넣은 순서를 지키고 sort는 안정이라 같은 수는 먼저 나온 순이 남는다
  return [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([reason]) => reason);
}

/** Restore의 Undo - 그 줄이 아직 SOP이고 그 칸에 저장된 N/A가 없을 때만(상위 칸만 N/A인 하위 칸은 되돌린다) */
export function canUndoRestore(tobe: ToBe, docId: number, slotKey: string): boolean {
  const doc = tobe.docs.find((item) => item.id === docId);
  if (doc === undefined || doc.doc_type !== "sop") return false;
  return !tobe.na_slots.some((na) => na.code === doc.code && na.slot_key === slotKey);
}

/** 열려 있는 사유 편집기 - 화면에 하나. saved는 그 칸에 저장된 사유(새로 여는 칸은 "") */
export interface NaEdit {
  docKey: string;
  slotKey: SlotKey;
  text: string;
  saved: string;
  refused: boolean;
}

export function isNaEditDirty(edit: NaEdit | null): boolean {
  return edit !== null && edit.text.trim() !== edit.saved;
}

/** 다른 칸의 Mark N/A·Edit reason - 적는 중이면 지금 것을 두고 refused를 켠다, 아니면 조용히 옮긴다. 같은 칸이면 지금 것 그대로(refused는 끈다) */
export function openNaEdit(current: NaEdit | null, target: { docKey: string; slotKey: SlotKey; saved: string }): NaEdit {
  if (current !== null && current.docKey === target.docKey && current.slotKey === target.slotKey) return { ...current, refused: false };
  if (current !== null && isNaEditDirty(current)) return { ...current, refused: true };
  return { ...target, text: target.saved, refused: false };
}
