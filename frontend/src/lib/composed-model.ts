// Assign New 칸의 아직 쓰지 않은 문서 - 서버가 결과물 C 규칙으로 엮은 문서(ComposedDoc)를 New 칸 줄로 펴고,
// 저장 응답으로 서버 다시 읽기 전에 미리 고친다(칸 끝에 넣기·지우기). 순서·번호는 다시 읽은 서버 값이 정한다.
// 줄 앞머리에는 결과물 C와 같은 그 줄 자기 번호("5.1.1", 생략·주석은 없음)를 두고, 칸 번호는 칸 머리 제목 박스의 번호 칸에 남긴다(buildComposedStrips, 시안 2 D6).
// 순서 · 칸 · 번호 표시 편집은 결과물 C 모양(toOutputCDoc)으로 c-edit-model에 맡기고, 그 결과를 엮은 문서 위에 얹는다(applyCOrder).
import type { AutoItem, ComposedDoc, ComposedItem, ComposedSection, GroupTarget, NumberStyle, OutputCDoc, OutputCItem, RenumberChange, WrittenSentence } from "@/lib/api-sop";
import type { CEdit, PlaceEdit } from "@/lib/c-edit-model";
import { getBulletLevel } from "@/lib/number-kind-model";
import { getSectionDepths, readBulletSymbol } from "@/lib/section-number";
import { getLevelWidths, getPillWidth, getSectionLevel } from "@/lib/strip-pill-model";

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

/** 칸 머리 제목 박스(시안 2 D6) - 번호 칸에 칸 번호(머리에 번호를 적지 않는 부록 · 번호 없는 범주는 빈 칸), 박스 글은 칸 이름 */
export interface ComposedHead {
  sectionKey: string;
  number: string | null;
  label: string;
  /** 칸 번호의 깊이 폭 */
  width: number;
  /** 그 칸 첫 깊이(칸 번호 한 마디 아래)의 폭 - 빈 칸 자리 · 앱이 채우는 목록 박스의 앞머리 */
  openWidth: number;
}

/** 엮은 문서 줄 하나의 용지 모양 */
export interface ComposedLine {
  sectionKey: string;
  /** 번호 칸 글 - 번호 줄은 결과물 C 번호, 글머리 기호 줄은 그 깊이의 기호(• ○ ▪), 생략 · 주석 · 저장 직후 줄은 null */
  mark: string | null;
  width: number;
  /** 짝 카드 - 같은 칸에서 이웃한 같은 의미 묶음(meaning_key) 문장이 둘 이상이면 그 첫 줄 target id, 아니면 null */
  pairGroup: number | null;
  style: NumberStyle;
  /** 번호 · 글머리 기호의 눌러 읽은 깊이(getSectionDepths) */
  depth: number;
  /** 그 칸이 줄을 세는가 - 세지 않는 칸에서는 번호 표시를 고를 수 없다(서버 number_style_not_allowed) */
  canNumber: boolean;
  /** 깊이를 바꿀 수 있는가 - AI 번역은 출처 깊이를 따른다(서버 translation_locked) */
  canDepth: boolean;
}

export interface ComposedStrips {
  /** 칸 머리 글(section_path - 줄의 section_path와 같은 열쇠) → 제목 박스 */
  heads: Map<string, ComposedHead>;
  /** target id → 줄 모양 */
  lines: Map<number, ComposedLine>;
}

/** 엮은 문서의 번역 줄인가 - 엮은 문서에는 기원(origin)이 없어 변경 종류로 읽는다 */
function isTranslationItem(item: Pick<ComposedItem, "change_type">): boolean {
  return item.change_type === "translated";
}

/**
 * 엮은 문서를 용지 줄 모양으로(시안 2 D6) - 칸 머리는 번호 칸에 칸 번호가 든 제목 박스, 줄 번호 칸 폭은 깊이별(getLevelWidths - 칸 번호와 줄 번호를
 * 함께 재 같은 깊이는 같은 폭), 글머리 기호 줄은 앞의 가장 가까운 번호 줄(없으면 칸 번호) 깊이에서 기호만큼 더(getBulletLevel), 번호 없는 줄은 같은 칸 앞 줄의 폭
 * (칸의 첫 줄이면 칸 첫 깊이 폭, 번호 없는 칸이면 1단 폭). 짝 카드는 같은 칸에서 이웃한 같은 의미 묶음 문장
 */
export function buildComposedStrips(doc: ComposedDoc): ComposedStrips {
  const labels = doc.sections.flatMap((section) => [section.number ?? "", ...section.items.map((item) => item.number ?? "")]);
  const getLevelWidth = getLevelWidths(labels);
  const heads = new Map<string, ComposedHead>();
  const lines = new Map<number, ComposedLine>();
  for (const section of doc.sections) {
    // 칸 번호는 머리 글이 아니라 칸이 실은 값에서 - 머리에 번호를 적지 않는 부록도 줄 번호는 그 번호 아래다
    const slotLevel = getSectionLevel(section.number ?? "");
    const openWidth = slotLevel > 0 ? getLevelWidth(slotLevel + 1) : getPillWidth(1);
    heads.set(readSectionHead(section), {
      sectionKey: section.location_key,
      number: section.shows_number ? section.number : null,
      label: section.label,
      width: slotLevel > 0 ? getLevelWidth(slotLevel) : getPillWidth(1),
      openWidth,
    });
    const depths = getSectionDepths(section);
    let previous: number | null = null;
    let previousLevel = slotLevel;
    section.items.forEach((item, index) => {
      const level = item.number === null ? 0 : getSectionLevel(item.number);
      let mark: string | null = item.number;
      let width = level > 0 ? getLevelWidth(level) : (previous ?? openWidth);
      if (level > 0) previousLevel = level;
      if (item.number === null && item.number_style === "bullet") {
        mark = readBulletSymbol(depths[index]);
        width = getLevelWidth(getBulletLevel(previousLevel, mark));
      }
      const key = item.kind === "sentence" ? item.meaning_key : null;
      const isPairWith = (other: ComposedItem | undefined) => key !== null && other?.kind === "sentence" && other.meaning_key === key;
      let first = index;
      while (isPairWith(section.items[first - 1])) first -= 1;
      const pairGroup = isPairWith(section.items[first + 1]) || first !== index ? section.items[first].target_id : null;
      lines.set(item.target_id, { sectionKey: section.location_key, mark, width, pairGroup, style: item.number_style, depth: depths[index], canNumber: section.counts_lines, canDepth: !isTranslationItem(item) });
      previous = width;
    });
  }
  return { heads, lines };
}

/** 엮은 문서 → 결과물 C 문서 모양 - 순서 · 깊이 · 표시 편집(c-edit-model)과 끌기 규칙(c-drop-model)이 C 모양을 읽는다. 엮은 문서에 없는 칸은 빈 값 */
export function toOutputCDoc(doc: ComposedDoc): OutputCDoc {
  return {
    target_doc_id: doc.target_doc_id,
    code: doc.code,
    title: doc.title,
    doc_type: doc.doc_type,
    parent_code: null,
    entrance: doc.entrance,
    sections: doc.sections.map(({ items, ...section }) => ({
      ...section,
      items: items.map(
        (item): OutputCItem => ({
          target_id: item.target_id,
          kind: item.kind,
          lang: item.lang,
          text: item.text,
          ai_text: "",
          change_type: item.change_type,
          status: item.status,
          source_note: "",
          source_count: item.source_unit_ids.length,
          origin: isTranslationItem(item) ? "translation" : "units",
          meaning_key: item.meaning_key,
          number: item.number,
          indent_level: item.indent_level,
          number_style: item.number_style,
          cell_row: null,
          cell_col: null,
          children: [],
          caption: item.caption ?? null,
          renumber: item.renumber ?? null,
        }),
      ),
    })),
  };
}

/**
 * 엮은 문서에 C 모양(shape)의 칸 · 순서 · 번호 · 깊이 · 표시를 얹는다 - 저장 전 편집과 저장 응답(C 모양)을 엮은 문서 위에 보이는 길.
 * 글 · 출처 · 표 · 그림은 엮은 문서 것. shape에 없는 줄(그새 들어온 줄)은 제 칸 끝에 남고, 엮은 문서에 없는 줄은 뺀다
 */
export function applyCOrder(doc: ComposedDoc, shape: OutputCDoc): ComposedDoc {
  const items = new Map(doc.sections.flatMap((section) => section.items.map((item) => [item.target_id, item] as const)));
  const shaped = new Set(shape.sections.flatMap((section) => section.items.map((item) => item.target_id)));
  const shapeOf = new Map(shape.sections.map((section) => [section.location_key, section.items]));
  return {
    ...doc,
    sections: doc.sections.map((section) => {
      const placed = (shapeOf.get(section.location_key) ?? []).flatMap((line) => {
        const item = items.get(line.target_id);
        return item ? [{ ...item, number: line.number, indent_level: line.indent_level, number_style: line.number_style }] : [];
      });
      return { ...section, items: [...placed, ...section.items.filter((item) => !shaped.has(item.target_id))] };
    }),
  };
}

/** 두 C 문서의 칸 · 순서 · 깊이 · 표시가 같은가 - 두 문서에 함께 있는 줄만 본다(그새 들어온 · 빠진 줄은 모양 바뀜이 아니다) */
export function isSameCOrder(a: OutputCDoc, b: OutputCDoc): boolean {
  const idsOf = (doc: OutputCDoc) => new Set(doc.sections.flatMap((section) => section.items.map((item) => item.target_id)));
  const inB = idsOf(b);
  const shared = new Set([...idsOf(a)].filter((id) => inB.has(id)));
  const read = (doc: OutputCDoc) =>
    doc.sections
      .map((section) => `${section.location_key}:${section.items.filter((item) => shared.has(item.target_id)).map((item) => `${item.target_id}/${item.indent_level}/${item.number_style}`).join(",")}`)
      .join("|");
  return read(a) === read(b);
}

/**
 * 끌어 옮긴 place 편집을 되돌리는 편집 - before는 옮기기 전 문서, after는 옮긴 뒤 문서. 덩어리를 원래 칸의 원래 다음 줄 앞(없으면 칸 끝)에 원래 깊이로 돌리고,
 * 칸을 넘으며 바뀐 표시(도착 칸의 기본 표시)는 원래 표시로 다시 고른다. 원래 칸이 없으면 빈 목록
 */
export function buildPlaceUndo(before: OutputCDoc, after: OutputCDoc, edit: PlaceEdit): CEdit[] {
  const section = before.sections.find((candidate) => candidate.location_key === edit.locationKey);
  const picked = new Set(edit.targetIds);
  const first = section ? section.items.findIndex((item) => picked.has(item.target_id)) : -1;
  if (!section || first < 0) return [];
  const next = section.items.slice(first).find((item) => !picked.has(item.target_id));
  const was = new Map(section.items.map((item) => [item.target_id, item]));
  const depths = edit.targetIds.map((id) => was.get(id)?.indent_level ?? 0);
  const toKey = edit.toLocationKey ?? edit.locationKey;
  const back: PlaceEdit =
    toKey === edit.locationKey
      ? { kind: "place", locationKey: edit.locationKey, targetIds: edit.targetIds, beforeId: next?.target_id ?? null, depths }
      : { kind: "place", locationKey: toKey, toLocationKey: edit.locationKey, targetIds: edit.targetIds, beforeId: next?.target_id ?? null, depths };
  const now = new Map(after.sections.flatMap((candidate) => candidate.items.map((item) => [item.target_id, item.number_style] as const)));
  const styles: CEdit[] = edit.targetIds.flatMap((id) => {
    const style = was.get(id)?.number_style;
    return style !== undefined && style !== now.get(id) ? [{ kind: "style", targetId: id, style }] : [];
  });
  return [back, ...styles];
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
      // 번호는 칸 안 자리·깊이·표시로 서버가 센다 - 짐작한 번호가 C와 어긋나 보이지 않게 다시 읽기 전까지 비워 둔다(남은 줄은 서버 번호 그대로).
      // 표시도 다시 읽기 전까지는 표시 없음(생략)으로 둔다. 짝 묶음 키는 같은 저장의 관계 묶음으로 잠시 대신한다 - 템플릿 보기에서 막 놓인 짝이 "번역 없음"으로 번쩍이지 않게
      number: null,
      number_style: "omitted",
      indent_level: target.indent_level,
      meaning_key: target.group_id === null ? null : `group:${target.group_id}`,
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
