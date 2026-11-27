// New 목록 줄의 SOP 칸을 상태 표로 읽는 순수 모델 - 일곱 상태·요약·쓴 사유·사유 편집기 하나. 화면은 이 결과를 그리기만 한다.
// 칸 목록·번호·이름·위계·종류는 서버가 준 그 문서의 골격(ToBe.outline_items)에서 읽는다 - 문서마다 다를 수 있고 수준이 둘로 정해져 있지 않다.
// 설계: 2026-11-17-documents-screen §8 (docs/architecture/decisions.md)
import type { SlotCount, TargetDoc, ToBe } from "./api-sop";

/** 칸 키 - 그 문서 골격 항목의 키. 문서마다 달라 고정 목록으로 좁히지 않는다 */
export type SlotKey = string;

export type SlotState =
  | { kind: "na"; reason: string } // 1 그 칸에 N/A가 저장돼 있다
  | { kind: "covered"; by: SlotKey } // 2 상위 칸(가장 가까운 조상)이 N/A다
  | { kind: "filled"; count: number } // 3 그 칸의 count > 0
  | { kind: "sub"; count: number } // 4 상위 칸, 자기 0, 하위 칸(그 아래 전부) count의 합 > 0
  | { kind: "auto" } // 5 앱이 채우는 목록(auto_list) - 문장을 받지 않는다
  | { kind: "group" } // 6 하위만 묶는 항목(group)이고 그 아래에 문장이 없다 - 상태 글이 없다
  | { kind: "empty" } // 7 그 밖(문장을 받는 칸이 비었다)
  | { kind: "removed" }; // 8 이 문서에서 뺀 표준 항목 - 번호가 없고 되살릴 수 있다(하위는 함께 빠져 줄이 없다)

export interface SlotRow {
  key: SlotKey;
  /** 이름 앞에 적는 번호 - 번호 없는 항목(범주 · 비어서 내보내지 않는 선택 항목)과 번호를 적지 않는 항목(부록 - shows_number false)은 빈 글. 이름과 이을 때는 formatSlotName을 쓴다 */
  number: string;
  /** 그 항목의 이름만(조상 이름은 붙이지 않는다 - 표가 들여쓰기로 위계를 보인다). 부록은 번호가 든 이름 "Appendix 2. 제목" */
  label: string;
  /** 최상위 0 */
  level: number;
  /** 문장을 직접 받는 칸인가 - 묶음(group)과 앱이 채우는 목록(auto_list)은 아니다. 요약의 채운 칸 · 빈 칸 · 전체는 이 칸만 센다 */
  isAssignable: boolean;
  state: SlotState;
  /** Mark N/A를 그릴 칸 - empty·group이고 칸 제목이 이어져 있지 않다(앱이 채우는 목록은 N/A로 두지 않는다) */
  canMarkNa: boolean;
  /** 문장은 없는데 그 칸이나 하위 칸의 칸 제목에 옛 제목이 이어져 있다(서버가 N/A를 막는다) */
  headingLinked: boolean;
  /** standard 표준 · declared 선언(6장 절차 · 9장 부록 · 5장 범주 - 고치기는 선언 목록이 한다) · custom 사용자 항목 */
  origin: "standard" | "declared" | "custom";
  isRequired: boolean;
  titleEn: string;
  /** 표준과 다름(서버 is_deviation) - 사유는 deviationReason */
  isDeviation: boolean;
  deviationReason: string | null;
  /** 빼기 단추를 그릴 줄 - 표준 · 사용자 항목이고 그 칸과 하위에 문장도 칸 제목도 없다(서버 409 slot_has_targets와 같은 판단) */
  canRemove: boolean;
  /** 사용자 항목을 하위로 더할 수 있는 줄 - 하위만 묶는 항목(group)이다. 일반 칸 아래에는 두지 않는다(직접 줄 번호와 하위 번호가 겹친다) */
  canAddChild: boolean;
}

export interface SlotSummary {
  /** 문장을 받는 칸 가운데 3·4번 */
  filled: number;
  /** 문장을 받는 칸 가운데 7번 */
  empty: number;
  /** 1·2번인 줄 전부 - 문장을 받지 않는 줄도 표에 N/A로 보이므로 함께 센다(표의 N/A 표시 수와 같다) */
  na: number;
  /** 문장을 받는 칸의 수 */
  total: number;
}

/** "번호 이름" - 번호 없는 항목은 이름만. 빈 번호가 글 앞에 빈칸을 남기지 않게 번호와 이름은 여기서만 잇는다 */
export function formatSlotName(row: Pick<SlotRow, "number" | "label">): string {
  return row.number === "" ? row.label : `${row.number} ${row.label}`;
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
  // 뺀 표준 항목도 제자리에 둔다(되살리기) - 서버가 그 하위와 뺀 선언 · 사용자 항목은 싣지 않는다
  const items = tobe.outline_items.filter((item) => item.code === doc.code && (!item.is_removed || item.origin === "standard"));
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
    if (item.is_removed) state = { kind: "removed" };
    else if (reasons.has(key)) state = { kind: "na", reason: reasons.get(key) ?? "" };
    else if (coveredBy !== undefined) state = { kind: "covered", by: coveredBy };
    else if (ownCount > 0) state = { kind: "filled", count: ownCount };
    else if (subCount > 0) state = { kind: "sub", count: subCount };
    else if (item.kind === "auto_list") state = { kind: "auto" };
    else if (item.kind === "group") state = { kind: "group" };
    else state = { kind: "empty" };

    const open = state.kind === "empty" || state.kind === "group";
    const headingLinked = open && headings > 0;
    // 번호를 적지 않는 항목(부록)은 번호 칸을 비우고 번호가 든 이름(label)을 적는다 - "1 Appendix 1. …"처럼 번호가 겹치지 않게
    const [number, label] = item.shows_number ? [item.number ?? "", item.title_en] : ["", item.label];
    const isEditable = doc.entrance !== "match" && !item.is_removed;
    return {
      key,
      number,
      label,
      level: item.level,
      isAssignable: item.is_assignable,
      state,
      canMarkNa: open && !headingLinked,
      headingLinked,
      origin: item.origin,
      isRequired: item.is_required,
      titleEn: item.title_en,
      isDeviation: item.is_deviation,
      deviationReason: item.deviation_reason,
      canRemove: isEditable && item.origin !== "declared" && ownCount + subCount + headings === 0,
      canAddChild: isEditable && item.kind === "group",
    };
  });
}

/**
 * 표의 두 단 - 최상위 칸 앞에서만 가른다(하위 칸은 상위 칸과 같은 단에 남는다). 최상위에 procedures가 있으면 그 앞이고(템플릿 골격의 1–5장 | 6–9장 -
 * 선언한 절차·부록이 늘어도 가르는 자리가 그대로다), 없으면 줄 수의 가운데에 가장 가까운 최상위 칸 앞이다(같은 거리면 뒤쪽 - 왼쪽 단이 길다). 가를 곳이 없으면 오른쪽 단이 빈다
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

/** 채운 칸 · 빈 칸 · 전체는 문장을 받는 칸만, N/A는 그 표시가 붙은 줄 전부 */
export function summarizeSlots(rows: readonly SlotRow[]): SlotSummary {
  const summary: SlotSummary = { filled: 0, empty: 0, na: 0, total: 0 };
  for (const { state, isAssignable } of rows) {
    if (isAssignable) summary.total += 1;
    if (state.kind === "na" || state.kind === "covered") summary.na += 1;
    else if (!isAssignable) continue;
    else if (state.kind === "filled" || state.kind === "sub") summary.filled += 1;
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

/**
 * 편집기가 하는 일 - na N/A 사유, rename 이름 바꾸기(표준 항목이면 표준과 다른 사유), remove 필수 표준 항목 빼기(사유),
 * add 사용자 항목 더하기(이름과 사유 - slotKey가 부모 키, 최상위는 ""). 없으면 na
 */
export type SlotEditMode = "na" | "rename" | "remove" | "add";

/** 열려 있는 사유 편집기 - 화면에 하나. saved는 그 칸에 저장된 사유(새로 여는 칸은 ""), title · savedTitle은 rename · add의 이름 */
export interface NaEdit {
  docKey: string;
  slotKey: SlotKey;
  text: string;
  saved: string;
  refused: boolean;
  mode?: SlotEditMode;
  title?: string;
  savedTitle?: string;
}

export function isNaEditDirty(edit: NaEdit | null): boolean {
  return edit !== null && (edit.text.trim() !== edit.saved || (edit.title ?? "").trim() !== (edit.savedTitle ?? ""));
}

/** 다른 칸(이나 같은 칸의 다른 일)의 편집기 - 적는 중이면 지금 것을 두고 refused를 켠다, 아니면 조용히 옮긴다. 같은 칸 같은 일이면 지금 것 그대로(refused는 끈다) */
export function openNaEdit(
  current: NaEdit | null,
  target: { docKey: string; slotKey: SlotKey; saved: string; mode?: SlotEditMode; savedTitle?: string },
): NaEdit {
  const isSame = current !== null && current.docKey === target.docKey && current.slotKey === target.slotKey && (current.mode ?? "na") === (target.mode ?? "na");
  if (isSame) return { ...current, refused: false };
  if (current !== null && isNaEditDirty(current)) return { ...current, refused: true };
  const titled = target.savedTitle === undefined ? {} : { title: target.savedTitle, savedTitle: target.savedTitle };
  return { ...target, ...titled, text: target.saved, refused: false };
}

/**
 * 칸 상태 표의 골격 쓰기 - rename(표준 항목이면 표준과 다른 사유) · remove(표준 항목 빼기, 필수면 사유) · restore(뺀 표준 항목 되살리기) ·
 * add(사용자 항목, parentKey ""는 최상위) · delete(사용자 항목 지우기). 선언 항목(절차 · 부록 · 범주)은 선언 목록이 고친다
 */
export type OutlineAction =
  | { kind: "rename"; key: SlotKey; titleEn: string; reason: string }
  | { kind: "remove"; key: SlotKey; reason: string }
  | { kind: "restore"; key: SlotKey }
  | { kind: "add"; parentKey: SlotKey; titleEn: string; reason: string }
  | { kind: "delete"; key: SlotKey };

/** 편집기의 저장 단추를 켤 수 있는가 - N/A · 빼기는 사유, 이름은 제목(표준 이름으로 되돌릴 때는 사유가 없어도 된다 - 서버가 가린다), 더하기는 둘 다 */
export function canSubmitSlotEdit(edit: NaEdit): boolean {
  const reason = edit.text.trim() !== "";
  const title = (edit.title ?? "").trim() !== "";
  switch (edit.mode ?? "na") {
    case "rename":
      return title;
    case "add":
      return title && reason;
    default:
      return reason;
  }
}

/** 문서 줄에 적는 표준과 다른 항목 수 - 뺀 필수 항목도 센다 */
export function countDeviations(rows: readonly SlotRow[]): number {
  return rows.filter((row) => row.isDeviation).length;
}
