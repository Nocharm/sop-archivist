// 원문 용지 모델 - 문서 보기(blocks·units)를 용지에 그릴 순서와 블록 안 조각으로 편다. 순수 함수라 쪼개기·분류 화면이 같이 쓰고 단위 테스트한다.

import type { DocumentView, PartRef, UnitSpan, ViewBlock, ViewTable, ViewUnit } from "./api-sop";

/** 블록 안 글자 조각 - 단위에 속하면 unitId, 단위 사이 빈 글자면 null */
export interface Segment {
  start: number;
  end: number;
  unitId: number | null;
}

export type PaperItem =
  | { type: "block"; block: ViewBlock }
  | { type: "table"; table: ViewTable; rows: ViewBlock[][]; unitId: number | null };

/** 부분 묶음 하나의 용지 내용 - key는 블록의 part_group */
export interface PaperGroup {
  key: string;
  part: string;
  items: PaperItem[];
}

export interface PaperModel {
  /** 용지 순서: 머리말 → 본문 → 꼬리말·각주 */
  header: PaperItem[];
  body: PaperItem[];
  footer: PaperItem[];
  /** 부분 묶음마다 나눈 같은 내용(처음 나온 순) - Split의 탭·쪽이 쓴다 */
  groups: PaperGroup[];
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
  const groups = new Map<string, PaperGroup>();
  const seenTables = new Set<number>();
  const blocks = [...view.blocks].sort((a, b) => a.seq - b.seq);
  for (const block of blocks) {
    const edge = TOP_PARTS.has(block.part) ? header : BOTTOM_PARTS.has(block.part) ? footer : body;
    const groupKey = block.part_group || block.part;
    const group = groups.get(groupKey) ?? { key: groupKey, part: block.part, items: [] };
    groups.set(groupKey, group);
    const target = { push: (item: PaperItem) => void (edge.push(item), group.items.push(item)) };
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
  return { header, body, footer, groups: [...groups.values()], segments, units, order };
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

export type UnitMark = "edited" | "pair" | "classified" | "ai" | "suggest" | "checked";

/** 경계 확인이 남은 단위 수 - 글자 범위가 있는 단위만 센다(표·행 묶음은 칸 문장이 대신한다). 서버 `count_unchecked_boundaries`와 같은 기준 */
export function countUnchecked(units: readonly ViewUnit[], isChecked: (unit: ViewUnit) => boolean): number {
  return units.filter((unit) => !SPANLESS_KINDS.has(unit.kind) && !isChecked(unit)).length;
}

/** 종이 오른쪽 끝 아이콘 표시 - 순서가 늘 같아야 줄마다 같은 자리에 온다. suggest는 아직 정하지 않은 AI 나누기 제안 */
export function getMarks(unit: ViewUnit): UnitMark[] {
  const marks: UnitMark[] = [];
  if (unit.is_edited) marks.push("edited");
  if (unit.pair_id !== null) marks.push("pair");
  if (unit.status === "confirmed") marks.push("classified");
  if (unit.status === "ai_suggested") marks.push("ai");
  if (unit.split_suggestion_id !== null) marks.push("suggest");
  if (unit.boundary_confirmed) marks.push("checked");
  return marks;
}

const TEXT_KINDS = new Set(["sentence", "heading", "cell_sentence"]);

/** 틈의 합치기를 쓸 수 없는 까닭 - 글이 아닌 것(표·그림), 칸 문장 규칙. 언어는 보지 않는다(다른 언어끼리는 묶기가 짝을 고른다) */
export type MergeBlocker = "not_text" | "cell";

/** 합칠 수 없는 까닭 → 문구 키 - 틈의 합치기 단추와 우클릭 메뉴가 같이 쓴다 */
export const MERGE_BLOCKER_KEYS: Record<MergeBlocker, string> = {
  not_text: "split.noMergeKind",
  cell: "split.noMergeCell",
};

/** 두 단위를 합칠 수 없는 까닭(서버 `_plan_merge`와 같은 기준) - 합칠 수 있으면 null */
export function getMergeBlocker(a: ViewUnit, b: ViewUnit): MergeBlocker | null {
  if (!TEXT_KINDS.has(a.kind) || !TEXT_KINDS.has(b.kind)) return "not_text";
  // 칸 문장은 같은 표·행 그룹(또는 모두 그룹 없음)끼리만
  if ((a.kind === "cell_sentence" || b.kind === "cell_sentence") && (a.kind !== b.kind || a.group_unit_id !== b.group_unit_id)) return "cell";
  return null;
}

// ── Split 2차 개편(2026-11-10): 단위마다 종이 한 조각, 조각 사이 합치기, 본문·머리말·꼬리말 탭, 나눌 선 끌기 ──

export interface PiecePart {
  block: ViewBlock;
  segments: Segment[];
}

/** 용지에 위에서 아래로 놓이는 것 - 단위 하나가 조각 하나다(unitId가 null이면 어느 단위에도 없는 글자) */
export type PaperRow =
  | { type: "piece"; key: string; unitId: number | null; parts: PiecePart[] }
  | { type: "table"; key: string; item: Extract<PaperItem, { type: "table" }> }
  | { type: "figure"; key: string; block: ViewBlock; unitId: number | null };

/** 용지 내용 → 조각 줄. 한 문단의 문장들·Shift+Enter 줄도 단위마다 따로 놓고, 한 단위가 이어진 문단에 걸치면 한 조각으로 둔다 */
export function buildRows(items: readonly PaperItem[], segments: ReadonlyMap<number, Segment[]>): PaperRow[] {
  const rows: PaperRow[] = [];
  let open: Extract<PaperRow, { type: "piece" }> | null = null;
  for (const item of items) {
    if (item.type === "table") {
      rows.push({ type: "table", key: `t${item.table.id}`, item });
      open = null;
      continue;
    }
    const { block } = item;
    const blockSegments = segments.get(block.id) ?? [];
    if (block.kind === "figure") {
      rows.push({ type: "figure", key: `f${block.id}`, block, unitId: blockSegments.find((segment) => segment.unitId !== null)?.unitId ?? null });
      open = null;
      continue;
    }
    // 단위 사이 빈 글자는 조각 경계가 삼킨다 - 같은 단위의 두 범위 사이에 있을 때만 남긴다
    let blank: Segment | null = null;
    for (const segment of blockSegments) {
      if (segment.unitId === null) {
        if (block.text.slice(segment.start, segment.end).trim() === "") {
          blank = segment;
          continue;
        }
        rows.push({ type: "piece", key: `x${block.id}-${segment.start}`, unitId: null, parts: [{ block, segments: [segment] }] });
        open = null;
        blank = null;
        continue;
      }
      const last: PiecePart | undefined = open?.parts[open.parts.length - 1];
      if (open && last && open.unitId === segment.unitId) {
        if (last.block.id === block.id) last.segments.push(...(blank ? [blank, segment] : [segment]));
        else open.parts.push({ block, segments: [segment] });
      } else {
        open = { type: "piece", key: `u${segment.unitId}-${block.id}-${segment.start}`, unitId: segment.unitId, parts: [{ block, segments: [segment] }] };
        rows.push(open);
      }
      blank = null;
    }
  }
  return rows;
}

export interface GapMerge {
  firstId: number;
  secondId: number;
  blocker: MergeBlocker | null;
}

function readRowUnit(row: PaperRow, units: ReadonlyMap<number, ViewUnit>): ViewUnit | "other" | null {
  if (row.type !== "piece") return "other";
  const unit = row.unitId === null ? undefined : units.get(row.unitId);
  if (!unit) return null;
  return TEXT_KINDS.has(unit.kind) ? unit : "other";
}

/**
 * 이웃한 두 줄 사이의 "위아래 합치기". 글 조각 둘이면 늘 있고(못 합치면 까닭), 한쪽이 표·그림이면 까닭과 함께 꺼 두고,
 * 둘 다 글이 아니거나 부분 묶음이 다르거나 같은 짝의 두 구성원이면 없다(null).
 */
export function getGapMerge(prev: PaperRow, next: PaperRow, units: ReadonlyMap<number, ViewUnit>): GapMerge | null {
  const first = readRowUnit(prev, units);
  const second = readRowUnit(next, units);
  if (first === null || second === null || (first === "other" && second === "other")) return null;
  if (prev.type === "piece" && next.type === "piece" && prev.parts[prev.parts.length - 1].block.part_group !== next.parts[0].block.part_group) return null;
  if (first === "other" || second === "other") {
    const unit = first === "other" ? (second as ViewUnit) : first;
    return { firstId: unit.id, secondId: unit.id, blocker: "not_text" };
  }
  if (first.id === second.id) return null;
  // 같은 짝의 두 구성원 사이(한 카드 안)에는 묶기 자리가 없다 - 한 문장으로 합치기는 옆 칸의 One sentence 전환이 맡는다
  if (first.pair_id !== null && first.pair_id === second.pair_id) return null;
  return { firstId: first.id, secondId: second.id, blocker: getMergeBlocker(first, second) };
}

export type PaperTabKey = "body" | "header" | "footer";

/** 탭 안의 쪽 하나 - 머리말·꼬리말은 부분 묶음마다 한 쪽, 본문은 한 쪽 */
export interface PaperSheet {
  key: string;
  part: string;
  /** 이 쪽이 쓰이는 구역 - 내용이 같아 숨긴 묶음의 것까지 모은다. 옛 추출은 빈 목록 */
  refs: PartRef[];
  items: PaperItem[];
}

export interface PaperTab {
  key: PaperTabKey;
  sheets: PaperSheet[];
  /** 이 탭에서 J/K가 따라가는 순서 */
  unitIds: number[];
}

export interface PaperTabs {
  /** 내용이 있는 탭만 - 본문, 머리말, 꼬리말(각주·미주 포함) 순 */
  tabs: PaperTab[];
  tabOf: Map<number, PaperTabKey>;
  /** 보이는 단위 → 숨긴 같은 내용 묶음의 같은 자리 단위. 경계 확인을 함께 보낸다 */
  mirrors: Map<number, number[]>;
  /** 탭 순서대로 이은 이동 순서 - 숨긴 단위는 없다 */
  order: number[];
}

function getTabKey(part: string): PaperTabKey {
  return TOP_PARTS.has(part) ? "header" : BOTTOM_PARTS.has(part) ? "footer" : "body";
}

/** 묶음 안 자리로 적은 단위 지문 - 내용이 같은 두 묶음이 같은 모양으로 쪼개져 있는지 견준다 */
function buildSignatures(units: readonly ViewUnit[], blockIndex: ReadonlyMap<number, number>): Map<string, number> {
  const signatures = new Map<string, number>();
  for (const unit of units) {
    const spans = unit.spans.map(([blockId, start, end]) => `${blockIndex.get(blockId)}:${start}:${end}`).join(",");
    signatures.set(`${unit.kind}|${spans}|${blockIndex.get(unit.block_id)}|${unit.row_index}`, unit.id);
  }
  return signatures;
}

/**
 * 용지를 탭과 쪽으로 나눈다. 같은 부분에서 내용이 같은 머리말·꼬리말(same_as)은 한 번만 보이되,
 * 숨기는 쪽의 단위가 보이는 쪽과 같은 모양으로 쪼개져 있을 때만 숨긴다 - 다르면 확인할 길이 없어지므로 따로 보인다.
 */
export function buildPaperTabs(view: DocumentView, model: PaperModel): PaperTabs {
  const meta = new Map(view.part_groups.map((group) => [group.key, group]));
  const groupOf = new Map(view.blocks.map((block) => [block.id, block.part_group || block.part]));
  const blockIndex = new Map<number, number>();
  const counters = new Map<string, number>();
  for (const block of [...view.blocks].sort((a, b) => a.seq - b.seq)) {
    const key = groupOf.get(block.id) ?? block.part;
    blockIndex.set(block.id, counters.get(key) ?? 0);
    counters.set(key, (counters.get(key) ?? 0) + 1);
  }
  const unitsByGroup = new Map<string, ViewUnit[]>();
  for (const unit of view.units) {
    const key = groupOf.get(unit.block_id);
    if (key === undefined) continue;
    unitsByGroup.set(key, [...(unitsByGroup.get(key) ?? []), unit]);
  }

  const mirrors = new Map<number, number[]>();
  const hidden = new Set<string>();
  const extraRefs = new Map<string, PartRef[]>();
  for (const group of model.groups) {
    const keptKey = meta.get(group.key)?.same_as;
    if (!keptKey || hidden.has(keptKey)) continue;
    const kept = buildSignatures(unitsByGroup.get(keptKey) ?? [], blockIndex);
    const copy = buildSignatures(unitsByGroup.get(group.key) ?? [], blockIndex);
    if (kept.size !== copy.size || [...copy.keys()].some((signature) => !kept.has(signature))) continue;
    hidden.add(group.key);
    extraRefs.set(keptKey, [...(extraRefs.get(keptKey) ?? []), ...(meta.get(group.key)?.refs ?? [])]);
    for (const [signature, unitId] of copy) {
      const keptId = kept.get(signature);
      if (keptId !== undefined) mirrors.set(keptId, [...(mirrors.get(keptId) ?? []), unitId]);
    }
  }

  const byTab = new Map<PaperTabKey, PaperTab>();
  const tabOf = new Map<number, PaperTabKey>();
  const shown = new Set<number>();
  for (const group of model.groups) {
    const key = getTabKey(group.part);
    for (const unit of unitsByGroup.get(group.key) ?? []) {
      tabOf.set(unit.id, key);
      if (!hidden.has(group.key)) shown.add(unit.id);
    }
    if (hidden.has(group.key)) continue;
    const tab = byTab.get(key) ?? { key, sheets: [], unitIds: [] };
    byTab.set(key, tab);
    // 본문은 묶음(본문·글상자…)이 섞여도 원문 순서 그대로 한 쪽이다
    if (key === "body") {
      if (tab.sheets.length === 0) tab.sheets.push({ key: "body", part: "body", refs: [], items: model.body });
      continue;
    }
    const refs = [...(meta.get(group.key)?.refs ?? []), ...(extraRefs.get(group.key) ?? [])].sort((a, b) => a.section - b.section);
    tab.sheets.push({ key: group.key, part: group.part, refs, items: group.items });
  }
  const tabs = (["body", "header", "footer"] as const).flatMap((key) => byTab.get(key) ?? []);
  for (const tab of tabs) tab.unitIds = model.order.filter((id) => shown.has(id) && tabOf.get(id) === tab.key);
  return { tabs, tabOf, mirrors, order: tabs.flatMap((tab) => tab.unitIds) };
}

/**
 * 나눌 선을 놓을 수 있는 가장 가까운 자리 - 앞뒤 조각이 비지 않고 이음 글자 위가 아닌 곳(canSplitAt과 같은 기준).
 * 끝을 넘겨 끌면 마지막 자리, 처음을 넘기면 첫 자리. 나눌 곳이 없는 단위는 null.
 */
export function clampSplitAt(unit: ViewUnit, at: number): number | null {
  const { text } = unit;
  const first = text.length - text.trimStart().length + 1;
  const last = text.trimEnd().length - 1;
  if (first > last) return null;
  const near = Math.min(Math.max(at, first), last);
  // 이음 글자 위면 바로 옆 자리로 - 안쪽에 자리가 남은 쪽을 먼저 본다
  for (const candidate of [near, near + 1, near - 1]) {
    if (candidate >= first && candidate <= last && toBlockOffset(unit.spans, candidate) !== null) return candidate;
  }
  return null;
}

/** 끌고 있는 자리(블록 위치, 또는 단위 밖 위·아래) → 그 단위 안에서 나눌 자리 */
export function resolveCutDrag(unit: ViewUnit, pos: { blockId: number; offset: number } | "start" | "end"): number | null {
  if (pos === "start") return clampSplitAt(unit, 0);
  if (pos === "end") return clampSplitAt(unit, unit.text.length);
  const direct = toUnitOffset(unit.spans, pos.blockId, pos.offset);
  if (direct !== null) return clampSplitAt(unit, direct);
  // 같은 블록의 범위 밖(범위 사이·앞·뒤) - 지나온 마지막 범위의 끝, 없으면 첫 범위의 처음
  let offset = 0;
  let found: number | null = null;
  for (const [blockId, start, end] of unit.spans) {
    if (blockId === pos.blockId) {
      if (pos.offset < start) return clampSplitAt(unit, found ?? offset);
      found = offset + end - start;
    }
    offset += end - start + 1;
  }
  return found === null ? null : clampSplitAt(unit, found);
}
