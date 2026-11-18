// Assign New 칸의 아직 쓰지 않은 문서 - 서버가 결과물 C 규칙으로 엮은 문서(ComposedDoc)를 New 칸 줄로 펴고,
// 저장 응답으로 서버 다시 읽기 전에 미리 고친다(칸 끝에 넣기·지우기). 순서·번호는 다시 읽은 서버 값이 정한다.
// 줄 앞머리에는 결과물 C와 같은 그 줄 자기 번호("5.1.1", 생략·주석은 없음)를 두고, 칸 번호는 칸 머리 줄에 남긴다.
import type { AutoItem, ComposedDoc, ComposedItem, ComposedSection, GroupTarget, OutputCItem, RenumberChange, WrittenSentence } from "@/lib/api-sop";
import { getPillWidth, getSectionLevel } from "@/lib/strip-pill-model";

/** 아무것도 받지 않은 칸 - 옅은 자리 표시. key는 칸 키라 칸이 차고 비어도 같은 줄로 읽힌다 */
export interface EmptySlotRow {
  kind: "empty";
  key: string;
  section_path: string;
  /** N/A 칸 */
  na: boolean;
  /** 문장을 받지 않는 절 - "group"은 칸 머리만 있고(자리 표시가 없다) "auto"는 앱이 채운 읽기 전용 목록(autoItems). null이면 놓을 수 있는 빈 칸 */
  fixed: "group" | "auto" | null;
  /** 앱이 채운 목록의 줄(그 SOP의 자식 WI) - 그 밖의 칸은 빈 배열 */
  autoItems: readonly AutoItem[];
}

/** 엮은 문서의 줄 - number는 결과물 C의 그 줄 자기 번호(서버 number_targets), 생략·주석 줄과 저장 직후 미리 넣은 줄은 null */
export interface ComposedRow extends WrittenSentence {
  number: string | null;
  /** 그 줄이 놓인 칸의 번호 - 줄 번호의 머리. 칸 머리 글(section_path)에 번호를 적지 않는 칸(부록)에도 있다 */
  section_number: string | null;
  /** 표·그림 줄의 다시 매긴 번호(결과물 C와 같은 값) - 바뀌지 않았으면 null */
  renumber: RenumberChange | null;
}

export type NewPaneRow = WrittenSentence | ComposedRow | EmptySlotRow;

/** New 칸 줄의 키 - 문장은 target id, 빈 칸은 칸 키 */
export function getNewRowKey(row: NewPaneRow): string {
  return row.kind === "empty" ? `slot:${row.key}` : `t:${row.target_id}`;
}

export function isWrittenRow(row: NewPaneRow): row is WrittenSentence {
  return row.kind !== "empty";
}

/** 엮은 문서의 줄인가 - 이미 쓴 문서의 문장에는 자기 번호가 없다(앞머리는 절 번호) */
export function isComposedRow(row: NewPaneRow): row is ComposedRow {
  return row.kind !== "empty" && "number" in row;
}

/** 절 머리 글("5.2. Title")의 앞 번호 - 없으면 빈 글 */
export function readSectionNumber(path: string): string {
  return /^\s*(\d+(?:\.\d+)*)\.?/.exec(path)?.[1] ?? "";
}

/** 칸 머리 글 - 번호가 있으면 "5.1. 이름" */
export function formatSectionPath(number: string | null, label: string): string {
  return number ? `${number}. ${label}` : label;
}

/** 엮은 문서 절의 칸 머리 글 - 번호를 적지 않는 절(부록 - 이름 "Appendix 2. 제목"에 번호가 들어 있다)은 이름만 */
export function readSectionHead(section: Pick<ComposedSection, "number" | "label" | "shows_number">): string {
  return formatSectionPath(section.shows_number ? section.number : null, section.label);
}

/**
 * 엮은 문서를 New 칸 줄로 - 칸 순서대로 받은 새 문장(자기 번호를 싣는다), 빈 칸은 자리 표시 한 줄. 쓰지 않은 문서라 Remark·짝 카드는 없다.
 * 문장을 받지 않는 절(묶음 · 앱이 채우는 목록)도 줄 없는 칸으로 한 줄이다 - 칸 머리가 그려지고, 무엇을 보일지는 fixed가 정한다
 */
export function buildComposedRows(doc: ComposedDoc): Array<ComposedRow | EmptySlotRow> {
  const rows: Array<ComposedRow | EmptySlotRow> = [];
  for (const section of doc.sections) {
    const path = readSectionHead(section);
    if (section.items.length === 0) {
      const fixed = section.kind === "group" ? "group" : section.kind === "auto_list" ? "auto" : null;
      rows.push({ kind: "empty", key: section.location_key, section_path: path, na: section.na_reason !== null, fixed, autoItems: section.auto_items });
      continue;
    }
    section.items.forEach((item, index) => {
      rows.push({
        target_id: item.target_id,
        target_doc_id: doc.target_doc_id,
        doc_code: doc.code,
        section_path: path,
        order_index: index,
        lang: item.lang,
        kind: item.kind,
        text: item.text,
        status: item.status,
        change_type: item.change_type,
        source_unit_ids: item.source_unit_ids,
        table: item.table ?? null,
        figure: item.figure ?? null,
        caption: item.caption ?? null,
        partner_target_id: null,
        remark: "",
        revision: 0,
        number: item.number,
        section_number: section.number,
        renumber: item.renumber ?? null,
      });
    });
  }
  return rows;
}

/**
 * 표 줄을 행 → 열 → 그 자리의 칸 새 문장들로 - 칸 번역은 같은 자리에 여럿이라 한 칸 안에 줄로 쌓는다(열이 밀리지 않게).
 * 빈 자리는 빈 배열이고, 행·열 수는 서버 격자(칸 자리보다 작지 않다)를 따른다. New 칸 표(BundleTable)와 결과물 C 표(splitCTable)가 함께 쓴다
 */
export function groupTableCells<T extends { row: number; col: number }>(table: { rows: number; cols: number; cells: readonly T[] }): T[][][] {
  const grid = Array.from({ length: table.rows }, () => Array.from({ length: table.cols }, (): T[] => []));
  for (const cell of table.cells) grid[cell.row]?.[cell.col]?.push(cell);
  return grid;
}

/** 결과물 C 표 칸 하나 - 자리와 그 칸 새 문장 */
export interface CTableCell {
  row: number;
  col: number;
  item: OutputCItem;
}

/**
 * 결과물 C 표 항목의 자식을 캡션 줄(칸 좌표 없음, 서버 순서 = 한국어·영어)과 칸 격자로 - 캡션은 표 위에 따로 그리고,
 * 칸 번역은 같은 자리에 쌓는다(groupTableCells). 격자는 칸 자리만큼이다(C에는 서버 격자 크기가 없다)
 */
export function splitCTable(children: readonly OutputCItem[]): { captions: OutputCItem[]; grid: CTableCell[][][] } {
  const captions = children.filter((child) => child.cell_row === null || child.cell_col === null);
  const cells = children.flatMap((item) => (item.cell_row === null || item.cell_col === null ? [] : [{ row: item.cell_row, col: item.cell_col, item }]));
  const rows = Math.max(0, ...cells.map((cell) => cell.row + 1));
  const cols = Math.max(0, ...cells.map((cell) => cell.col + 1));
  return { captions, grid: groupTableCells({ rows, cols, cells }) };
}

// 앞머리 번호 한 글자 폭(px) - .strip-lead-num(500 11px JetBrains Mono) 실측 6.6px. 글꼴·크기를 바꾸면 함께 고친다
const LEAD_CHAR_PX = 6.6;
// 번호 칸 안 여백(px) - .strip-lead-num 오른쪽 padding 5px에 왼쪽 숨 1px
const LEAD_PAD_PX = 6;

/**
 * 엮은 문서 줄마다 앞머리 번호 칸 폭(키 = target id 글자) - 자기 번호의 깊이별 폭(getPillWidth)이되, 그 깊이의 가장 긴 번호가 잘리지 않게
 * 그 깊이 전체를 넓힌다(같은 깊이는 같은 폭이라 들여쓰기로 읽힌다). 번호 없는 줄(생략·주석·저장 직후)은 같은 칸 앞 줄의 폭,
 * 칸의 첫 줄이면 그 칸 첫 깊이(칸 번호 한 마디 아래)의 폭, 번호 없는 칸이면 1단 폭
 */
export function getComposedLeadWidths(rows: readonly NewPaneRow[]): Map<string, number> {
  const composed = rows.filter(isComposedRow);
  const byLevel = new Map<number, number>();
  for (const { number } of composed) {
    if (number === null) continue;
    const level = getSectionLevel(number);
    byLevel.set(level, Math.max(byLevel.get(level) ?? getPillWidth(level), Math.ceil(number.length * LEAD_CHAR_PX) + LEAD_PAD_PX));
  }
  const getLevelWidth = (level: number) => byLevel.get(level) ?? getPillWidth(level);
  const widths = new Map<string, number>();
  let path: string | null = null;
  let previous: number | null = null;
  for (const row of composed) {
    if (row.section_path !== path) {
      path = row.section_path;
      previous = null;
    }
    // 칸 번호는 머리 글이 아니라 줄이 실은 값에서 - 머리에 번호를 적지 않는 부록도 줄 번호는 그 번호 아래다
    const slotLevel = getSectionLevel(row.section_number ?? "");
    const opening = slotLevel > 0 ? getLevelWidth(slotLevel + 1) : getPillWidth(1);
    const width: number = row.number !== null ? getLevelWidth(getSectionLevel(row.number)) : (previous ?? opening);
    widths.set(String(row.target_id), width);
    previous = width;
  }
  return widths;
}

/** 칸 머리 줄(번호. 칸 이름) → 칸 제목 출처 - 빈 출처는 뺀다. buildComposedRows의 section_path와 같은 열쇠 */
export function listHeadingNotes(doc: ComposedDoc): Map<string, string> {
  const notes = new Map<string, string>();
  for (const section of doc.sections) {
    if (section.heading_note !== "") notes.set(readSectionHead(section), section.heading_note);
  }
  return notes;
}

/** 칸 머리의 알림 - 표준과 다른 절의 사유(없으면 null)와 비어 있는 필수 절 */
export interface SectionMark {
  deviationReason: string | null;
  isEmptyRequired: boolean;
}

/** 칸 머리 줄 → 알림 - 알릴 것이 있는 절만. buildComposedRows의 section_path와 같은 열쇠 */
export function listSectionMarks(doc: ComposedDoc): Map<string, SectionMark> {
  const marks = new Map<string, SectionMark>();
  for (const section of doc.sections) {
    if (section.deviation_reason === null && !section.is_empty_required) continue;
    marks.set(readSectionHead(section), { deviationReason: section.deviation_reason, isEmptyRequired: section.is_empty_required });
  }
  return marks;
}

/** 저장한 새 문장이 놓일 칸 키 - 서버 _plan_sections의 키와 같은 모양 */
function readSectionKey(target: GroupTarget): string | null {
  if (target.slot_key !== null) return target.slot_key;
  if (target.wi_part === null) return null;
  return target.wi_step === null ? `unstepped:${target.wi_part}` : `step:${target.wi_step}:${target.wi_part}`;
}

/** 칸 안에서 끼울 자리 - 맨 앞이면 0, after의 문장 바로 뒤. 그 칸이 아니거나 after의 문장이 없으면 -1(끝에 붙인다) */
function findInsertAt(kept: readonly ComposedItem[], sectionKey: string, at: { sectionKey: string; after: number | null } | null | undefined): number {
  if (at?.sectionKey !== sectionKey) return -1;
  if (at.after === null) return 0;
  const anchor = kept.findIndex((item) => item.target_id === at.after);
  return anchor < 0 ? -1 : anchor + 1;
}

/**
 * 저장 응답으로 미리 고친 문서 - 이 저장의 새 문장을 모든 칸에서 뺀 뒤 이 문서에 속한 최상위 문장을 제 칸 끝에 넣는다.
 * 칸이 아직 없으면(단계 없음 칸 등) 넣지 않는다 - 곧 다시 읽는 서버 값이 채운다. textOf는 고친 글이 없을 때 출처 원문.
 * at이 있고 그 칸에 after의 문장이 남아 있으면(null이면 맨 앞) 그 칸의 새 문장을 order_index 순으로 그 자리에 끼운다
 */
export function applySavedTargets(
  doc: ComposedDoc,
  targets: readonly GroupTarget[],
  textOf: (unitIds: number[]) => string,
  at?: { sectionKey: string; after: number | null } | null,
): ComposedDoc {
  const savedIds = new Set(targets.map((target) => target.id));
  const placed = new Map<string, ComposedItem[]>();
  const orderOf = new Map(targets.map((target) => [target.id, target.order_index]));
  for (const target of targets) {
    if (target.target_doc_id !== doc.target_doc_id || target.parent_target_id !== null) continue;
    // 칸 제목은 칸 항목이 아니다 - 머리 줄 출처는 곧 다시 읽는 서버 값이 채운다
    if (target.kind === "slot_heading") continue;
    const key = readSectionKey(target);
    if (key === null) continue;
    const item: ComposedItem = {
      target_id: target.id,
      kind: target.kind,
      lang: target.lang,
      text: target.confirmed_text || target.ai_text || textOf(target.source_unit_ids),
      status: target.status,
      change_type: target.change_type,
      // 번호는 칸 안 자리·깊이·표시로 서버가 센다 - 짐작한 번호가 C와 어긋나 보이지 않게 다시 읽기 전까지 비워 둔다(남은 줄은 서버 번호 그대로)
      number: null,
      source_unit_ids: target.source_unit_ids,
    };
    placed.set(key, [...(placed.get(key) ?? []), item]);
  }
  return {
    ...doc,
    sections: doc.sections.map((section) => {
      const kept = section.items.filter((item) => !savedIds.has(item.target_id));
      const added = placed.get(section.location_key) ?? [];
      const cut = findInsertAt(kept, section.location_key, at);
      if (cut < 0) return { ...section, items: [...kept, ...added] };
      added.sort((a, b) => (orderOf.get(a.target_id) ?? 0) - (orderOf.get(b.target_id) ?? 0));
      return { ...section, items: [...kept.slice(0, cut), ...added, ...kept.slice(cut)] };
    }),
  };
}

/**
 * 줄 목록이 바뀐 차이 - 새로 들어온 줄 키와, 빠진 줄을 바로 뒤에 남은 줄 키(없으면 "")에 매단 것.
 * 빠진 줄은 그 자리에서 접히며 사라지게 잠깐 더 그리고, 들어온 줄은 펼치며 나타난다(New 칸 실시간 넣기)
 */
export function diffRows<T>(previous: readonly T[], next: readonly T[], keyOf: (row: T) => string): { added: Set<string>; leaving: Map<string, T[]> } {
  const before = new Set(previous.map(keyOf));
  const after = new Set(next.map(keyOf));
  const added = new Set([...after].filter((key) => !before.has(key)));
  const leaving = new Map<string, T[]>();
  let pending: T[] = [];
  for (const row of previous) {
    const key = keyOf(row);
    if (!after.has(key)) {
      pending.push(row);
      continue;
    }
    if (pending.length > 0) leaving.set(key, pending);
    pending = [];
  }
  if (pending.length > 0) leaving.set("", pending);
  return { added, leaving };
}

/** 배정을 지운 Unit의 새 문장을 미리 뺀 문서 - 출처가 모두 지운 Unit인 문장만 */
export function removeClearedUnits(doc: ComposedDoc, unitIds: ReadonlySet<number>): ComposedDoc {
  return {
    ...doc,
    sections: doc.sections.map((section) => ({
      ...section,
      items: section.items.filter((item) => item.source_unit_ids.length === 0 || !item.source_unit_ids.every((id) => unitIds.has(id))),
    })),
  };
}
