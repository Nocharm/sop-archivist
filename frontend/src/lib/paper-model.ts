// 원문 용지 모델 - 문서 보기(blocks·units)를 용지에 그릴 순서와 블록 안 조각으로 편다. 순수 함수라 쪼개기·분류 화면이 같이 쓰고 단위 테스트한다.

import type { DocumentView, UnitSpan, ViewBlock, ViewTable, ViewUnit } from "./api-sop";

/** 블록 안 글자 조각 - 단위에 속하면 unitId, 단위 사이 빈 글자면 null */
export interface Segment {
  start: number;
  end: number;
  unitId: number | null;
}

export type PaperItem =
  | { type: "block"; block: ViewBlock }
  | { type: "table"; table: ViewTable; rows: ViewBlock[][]; unitId: number | null };

export interface PaperModel {
  /** 용지 순서: 머리말 → 본문 → 꼬리말·각주 */
  header: PaperItem[];
  body: PaperItem[];
  footer: PaperItem[];
  segments: Map<number, Segment[]>;
  units: Map<number, ViewUnit>;
  /** J/K가 따라가는 순서 - 원문 순 */
  order: number[];
}

const TOP_PARTS = new Set(["header"]);
const BOTTOM_PARTS = new Set(["footer", "footnote", "endnote"]);
// 범위가 없는 단위(표·행)는 칸 문장이 글자를 덮는다
const SPANLESS_KINDS = new Set(["table", "table_row"]);

function buildSegments(block: ViewBlock, spans: Array<[number, number, number]>): Segment[] {
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  const segments: Segment[] = [];
  let cursor = 0;
  for (const [start, end, unitId] of sorted) {
    if (start > cursor) segments.push({ start: cursor, end: start, unitId: null });
    segments.push({ start, end, unitId });
    cursor = Math.max(cursor, end);
  }
  if (cursor < block.text.length) segments.push({ start: cursor, end: block.text.length, unitId: null });
  return segments;
}

export function buildPaperModel(view: DocumentView): PaperModel {
  const units = new Map(view.units.map((unit) => [unit.id, unit]));
  const spansByBlock = new Map<number, Array<[number, number, number]>>();
  for (const unit of view.units) {
    if (SPANLESS_KINDS.has(unit.kind)) continue;
    for (const [blockId, start, end] of unit.spans) {
      const list = spansByBlock.get(blockId) ?? [];
      list.push([start, end, unit.id]);
      spansByBlock.set(blockId, list);
    }
  }
  const segments = new Map<number, Segment[]>();
  for (const block of view.blocks) segments.set(block.id, buildSegments(block, spansByBlock.get(block.id) ?? []));

  const tables = new Map(view.tables.map((table) => [table.id, table]));
  const tableUnit = new Map<number, number>();
  for (const unit of view.units) {
    if (unit.kind === "table" && unit.table_id !== null) tableUnit.set(unit.table_id, unit.id);
  }
  const header: PaperItem[] = [];
  const body: PaperItem[] = [];
  const footer: PaperItem[] = [];
  const seenTables = new Set<number>();
  const blocks = [...view.blocks].sort((a, b) => a.seq - b.seq);
  for (const block of blocks) {
    const target = TOP_PARTS.has(block.part) ? header : BOTTOM_PARTS.has(block.part) ? footer : body;
    if (block.kind === "table_cell" && block.table_id !== null) {
      // 표는 첫 칸 자리에 통째로 - 안쪽 표는 바깥 칸 안에서 그리지 않고 바로 뒤에 둔다(1차)
      if (seenTables.has(block.table_id)) continue;
      seenTables.add(block.table_id);
      const table = tables.get(block.table_id);
      if (!table) continue;
      const cells = blocks.filter((cell) => cell.table_id === block.table_id);
      const rows: ViewBlock[][] = Array.from({ length: table.n_rows }, () => []);
      for (const cell of cells) rows[cell.row_index ?? 0]?.push(cell);
      for (const row of rows) row.sort((a, b) => (a.col_index ?? 0) - (b.col_index ?? 0));
      target.push({ type: "table", table, rows, unitId: tableUnit.get(table.id) ?? null });
      continue;
    }
    target.push({ type: "block", block });
  }

  const order = [...view.units]
    .filter((unit) => unit.kind !== "table_row" || unit.spans.length > 0)
    .sort((a, b) => a.pos_seq - b.pos_seq || (a.spans[0]?.[1] ?? 0) - (b.spans[0]?.[1] ?? 0) || a.id - b.id)
    .map((unit) => unit.id);
  return { header, body, footer, segments, units, order };
}

/**
 * 블록 안 위치 → 단위 글자 위치. 단위 글자는 범위 글자를 한 글자 이음(같은 블록 " ", 다른 블록 "\n")으로 이은 것이다
 * (backend segment.build_unit_text). 범위 밖이면 null.
 */
export function toUnitOffset(spans: UnitSpan[], blockId: number, blockOffset: number): number | null {
  let offset = 0;
  for (const [spanBlock, start, end] of spans) {
    if (spanBlock === blockId && blockOffset >= start && blockOffset <= end) return offset + blockOffset - start;
    offset += end - start + 1;
  }
  return null;
}

/** 단위 글자 위치 → (블록, 블록 안 위치). 이음 글자 위거나 글자 밖이면 null(backend spans.locate_text_offset) */
export function toBlockOffset(spans: UnitSpan[], at: number): { blockId: number; offset: number } | null {
  let offset = 0;
  for (const [blockId, start, end] of spans) {
    if (at >= offset && at < offset + end - start) return { blockId, offset: start + at - offset };
    offset += end - start + 1;
  }
  return null;
}

/** 나눌 자리로 쓸 수 있는가 - 앞뒤 조각이 모두 비지 않아야 한다 */
export function canSplitAt(unit: ViewUnit, at: number): boolean {
  if (at <= 0 || at >= unit.text.length) return false;
  if (toBlockOffset(unit.spans, at) === null) return false;
  return unit.text.slice(0, at).trim().length > 0 && unit.text.slice(at).trim().length > 0;
}

/** 추출 경고의 보일 글 - 누락 글 경고는 backend ingest가 원문 조각을 detail.snippet에 담는다. 다른 경고는 글이 없다 */
export function readWarningText(detail: Record<string, unknown>): string {
  return typeof detail.snippet === "string" ? detail.snippet : "";
}

// ── Split 개편(2026-11-09): 선택 윤곽, 가운데 스크롤, 태그·표시, 이웃 합치기 ──

export interface LineRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

// 같은 줄로 보는 위쪽 차이(px) - 한 줄 안의 글자 조각들은 top이 거의 같다
const SAME_LINE_PX = 4;

/** 고른 단위의 가장 바깥 윤곽 하나 - 줄 상자를 합치고, 오른쪽 가장자리를 따라 내려갔다 왼쪽을 따라 올라오는 SVG path */
export function buildContourPath(rects: readonly LineRect[], padX = 4, padY = 2): string {
  const lines: LineRect[] = [];
  for (const rect of [...rects].sort((a, b) => a.top - b.top || a.left - b.left)) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.top - rect.top) < SAME_LINE_PX) {
      last.left = Math.min(last.left, rect.left);
      last.right = Math.max(last.right, rect.right);
      last.bottom = Math.max(last.bottom, rect.bottom);
    } else {
      lines.push({ ...rect });
    }
  }
  if (lines.length === 0) return "";
  const padded = lines.map((line) => ({ left: line.left - padX, right: line.right + padX, top: line.top - padY, bottom: line.bottom + padY }));
  // 줄 사이 경계를 가운데로 맞춰 윤곽에 틈이 생기지 않게
  for (let i = 0; i < padded.length - 1; i += 1) {
    const mid = (padded[i].bottom + padded[i + 1].top) / 2;
    padded[i].bottom = mid;
    padded[i + 1].top = mid;
  }
  const first = padded[0];
  const last = padded[padded.length - 1];
  const parts = [`M${first.left},${first.top}`, `H${first.right}`];
  padded.forEach((line, i) => {
    parts.push(`V${line.bottom}`);
    if (i < padded.length - 1) parts.push(`H${padded[i + 1].right}`);
  });
  parts.push(`H${last.left}`);
  for (let i = padded.length - 1; i > 0; i -= 1) parts.push(`V${padded[i].top}`, `H${padded[i - 1].left}`);
  parts.push(`V${first.top}`, "Z");
  return parts.join(" ");
}

/** 고른 단위가 화면 위 1/6 위로, 또는 아래 1/3 아래로 가면 가운데로 다시 맞춘다 */
export function shouldRecenter(unitTop: number, unitBottom: number, viewTop: number, viewBottom: number): boolean {
  const height = viewBottom - viewTop;
  return unitTop < viewTop + height / 6 || unitBottom > viewBottom - height / 3;
}

/** 문단 앞 글자 태그 - 언어(중립은 없음)와 보류 */
export function getTags(unit: ViewUnit): { lang: "KO" | "EN" | null; hold: boolean } {
  const lang = unit.lang === "ko" ? "KO" : unit.lang === "en" ? "EN" : null;
  return { lang, hold: unit.status === "on_hold" };
}

export type UnitMark = "edited" | "pair" | "classified" | "ai" | "checked";

/** 종이 오른쪽 끝 아이콘 표시 - 순서가 늘 같아야 줄마다 같은 자리에 온다 */
export function getMarks(unit: ViewUnit): UnitMark[] {
  const marks: UnitMark[] = [];
  if (unit.is_edited) marks.push("edited");
  if (unit.pair_id !== null) marks.push("pair");
  if (unit.status === "confirmed") marks.push("classified");
  if (unit.status === "ai_suggested") marks.push("ai");
  if (unit.boundary_confirmed) marks.push("checked");
  return marks;
}

const MERGEABLE_KINDS = new Set(["sentence", "heading", "cell_sentence"]);

/** 종이 틈의 "위아래 합치기" - 둘 다 문장류이고 같은 자리(본문끼리, 또는 같은 표 칸)일 때만 */
export function canMergeAdjacent(a: ViewUnit, b: ViewUnit): boolean {
  if (!MERGEABLE_KINDS.has(a.kind) || !MERGEABLE_KINDS.has(b.kind)) return false;
  if (a.table_id !== b.table_id) return false;
  return a.table_id === null || a.block_id === b.block_id;
}
