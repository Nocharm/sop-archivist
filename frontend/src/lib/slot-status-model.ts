// New 목록 줄의 SOP 칸 15개를 상태 표로 읽는 순수 모델 - 여섯 상태·요약·쓴 사유·사유 편집기 하나. 화면은 이 결과를 그리기만 한다.
// 설계: docs/superpowers/specs/2026-11-17-documents-screen-design.md
import { SLOT_KEYS, type SlotCount, type TargetDoc, type ToBe } from "./api-sop";
import { SLOT_LABELS } from "./slot-labels";

export type SlotKey = (typeof SLOT_KEYS)[number];

/** backend constants.EQUIPMENT_SLOT_KEYS와 같은 값 - 장비 SOP에서 채우거나 N/A로 남겨야 하는 세 칸 */
export const EQUIPMENT_SLOT_KEYS: readonly SlotKey[] = [
  "procedures.electronic_record_control",
  "procedures.troubleshooting",
  "procedures.maintenance",
];

/** 칸의 상위 칸 - 하위 칸("a.b")이 아니면 null */
export function getSlotParent(key: SlotKey): SlotKey | null {
  const dot = key.indexOf(".");
  return dot < 0 ? null : (key.slice(0, dot) as SlotKey);
}

/** 칸 번호 - SLOT_KEYS의 고정 자리(backend outputs._build_slot_numbers와 같은 규칙): 1…7, 하위 칸은 5.1 */
export const SLOT_NUMBERS: Readonly<Record<SlotKey, string>> = (() => {
  const numbers = {} as Record<SlotKey, string>;
  const childCounts = new Map<SlotKey, number>();
  let top = 0;
  for (const key of SLOT_KEYS) {
    const parent = getSlotParent(key);
    if (parent === null) {
      top += 1;
      numbers[key] = String(top);
    } else {
      const next = (childCounts.get(parent) ?? 0) + 1;
      childCounts.set(parent, next);
      numbers[key] = `${numbers[parent]}.${next}`;
    }
  }
  return numbers;
})();

/** 표의 두 단 - 경계는 5.2와 6 사이로 고정이다 */
export const SLOT_COLUMNS: readonly [readonly SlotKey[], readonly SlotKey[]] = (() => {
  const split = SLOT_KEYS.indexOf("procedures");
  return [SLOT_KEYS.slice(0, split), SLOT_KEYS.slice(split)];
})();

export type SlotState =
  | { kind: "na"; reason: string } // 1 그 칸에 N/A가 저장돼 있다
  | { kind: "covered"; by: SlotKey } // 2 상위 칸이 N/A다
  | { kind: "filled"; count: number } // 3 그 칸의 count > 0
  | { kind: "sub"; count: number } // 4 상위 칸, 자기 0, 하위 칸 count의 합 > 0
  | { kind: "decide" } // 5 장비 SOP의 세 칸이고 위 넷이 아니다
  | { kind: "empty" }; // 6 그 밖

export interface SlotRow {
  key: SlotKey;
  number: string;
  label: string;
  isChild: boolean;
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

const KNOWN_KEYS: ReadonlySet<string> = new Set(SLOT_KEYS);

/** 그 문서의 칸별 수 - 모르는 키와 다른 문서의 줄은 읽지 않는다. 이미 쓴 문서(match)는 수를 읽지 않는다 */
function readCounts(tobe: ToBe, doc: TargetDoc): Map<string, SlotCount> {
  const counts = new Map<string, SlotCount>();
  if (doc.entrance === "match") return counts;
  for (const row of tobe.slot_counts ?? []) {
    if (row.target_doc_id === doc.id && KNOWN_KEYS.has(row.slot_key)) counts.set(row.slot_key, row);
  }
  return counts;
}

/** SOP 한 줄의 칸 15개, SLOT_KEYS 순서. 이미 쓴 문서(entrance "match")는 수를 읽지 않는다(3·4번 상태와 headingLinked가 없다) */
export function buildSlotRows(tobe: ToBe, doc: TargetDoc): SlotRow[] {
  const counts = readCounts(tobe, doc);
  const reasons = new Map<string, string>();
  for (const na of tobe.na_slots) if (na.code === doc.code) reasons.set(na.slot_key, na.reason);

  return SLOT_KEYS.map((key) => {
    const parent = getSlotParent(key);
    const children = SLOT_KEYS.filter((other) => getSlotParent(other) === key);
    const own = counts.get(key);
    const ownCount = own?.count ?? 0;
    const subCount = children.reduce((sum, child) => sum + (counts.get(child)?.count ?? 0), 0);
    const headings = (own?.heading_count ?? 0) + children.reduce((sum, child) => sum + (counts.get(child)?.heading_count ?? 0), 0);

    // 상태는 표의 순서대로 먼저 맞는 것
    let state: SlotState;
    if (reasons.has(key)) state = { kind: "na", reason: reasons.get(key) ?? "" };
    else if (parent !== null && reasons.has(parent)) state = { kind: "covered", by: parent };
    else if (ownCount > 0) state = { kind: "filled", count: ownCount };
    else if (subCount > 0) state = { kind: "sub", count: subCount };
    else if (doc.is_equipment_sop && EQUIPMENT_SLOT_KEYS.includes(key)) state = { kind: "decide" };
    else state = { kind: "empty" };

    const open = state.kind === "decide" || state.kind === "empty";
    const headingLinked = open && headings > 0;
    return { key, number: SLOT_NUMBERS[key], label: SLOT_LABELS[key], isChild: parent !== null, state, canMarkNa: open && !headingLinked, headingLinked };
  });
}

/** filled = 3·4번, na = 1·2번. 네 수의 합은 늘 15 */
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
