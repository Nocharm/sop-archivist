// 시트 보기의 셈 - 옮기기 범위 · 끌기와 휠 · 글쇠 · 고른 줄 가운데 · 위치 막대 · 열 비율 · 목차 줄 묶기 · 넘쳐 보이는 칸.
// 화면(components/outputs/sheet-view.tsx)과 옮기기(lib/sheet-pan.ts)가 같이 쓴다. 모양은 서버 시트 모델이 정하고 여기서는 자리만 센다(제품 명세 §7.14 시트 모델).

import type { PreviewBand, PreviewCell, PreviewRow } from "@/lib/api-sop";

/** 옮긴 거리 - 본문 표를 왼쪽 · 위로 민 px(0 이상) */
export interface SheetOffset {
  x: number;
  y: number;
}

/** 보이는 틀과 본문 표의 크기(px) */
export interface SheetExtent {
  viewWidth: number;
  viewHeight: number;
  contentWidth: number;
  contentHeight: number;
}

export const DRAG_CLICK_PX = 3; // 이보다 덜 움직이고 뗀 누르기는 클릭이다
export const KEY_STEP_PX = 45; // 화살표 한 번 = 칸 글 세 줄(줄 높이 15px)
export const PAGE_OVERLAP_PX = 30; // PageUp · PageDown에서 앞 화면의 두 줄을 남긴다
const WHEEL_LINE_PX = 15; // deltaMode가 줄 단위일 때 한 줄

/** 옮길 수 있는 끝 - 0부터 (본문 - 보이는 틀)까지, 다 보이면 0 */
export function getMoveRange(extent: SheetExtent): SheetOffset {
  return { x: Math.max(0, extent.contentWidth - extent.viewWidth), y: Math.max(0, extent.contentHeight - extent.viewHeight) };
}

export function clampOffset(offset: SheetOffset, extent: SheetExtent): SheetOffset {
  const range = getMoveRange(extent);
  return { x: Math.min(Math.max(offset.x, 0), range.x), y: Math.min(Math.max(offset.y, 0), range.y) };
}

export function isDragMove(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) >= DRAG_CLICK_PX;
}

/** 끌기 - 누른 곳에서 포인터가 간 만큼 본문이 따라간다(오른쪽으로 끌면 왼쪽 열이 나온다) */
export function applyDrag(origin: SheetOffset, start: SheetOffset, point: SheetOffset, extent: SheetExtent): SheetOffset {
  return clampOffset({ x: origin.x + (start.x - point.x), y: origin.y + (start.y - point.y) }, extent);
}

/** 휠 한 번이 옮기는 px - deltaY는 위아래, deltaX는 가로. Shift+휠을 deltaY로만 알리는 브라우저에서는 그 값을 가로로 쓴다 */
export function readWheelMove(wheel: Pick<WheelEvent, "deltaX" | "deltaY" | "deltaMode" | "shiftKey">, viewHeight: number): SheetOffset {
  const unit = wheel.deltaMode === 1 ? WHEEL_LINE_PX : wheel.deltaMode === 2 ? viewHeight : 1;
  if (wheel.shiftKey && wheel.deltaX === 0) return { x: wheel.deltaY * unit, y: 0 };
  return { x: wheel.deltaX * unit, y: wheel.deltaY * unit };
}

/** 글쇠로 옮긴 자리 - 옮기는 글쇠가 아니면 null */
export function applyKey(key: string, offset: SheetOffset, extent: SheetExtent): SheetOffset | null {
  const page = Math.max(extent.viewHeight - PAGE_OVERLAP_PX, KEY_STEP_PX);
  const moves: Record<string, SheetOffset> = {
    ArrowUp: { x: offset.x, y: offset.y - KEY_STEP_PX },
    ArrowDown: { x: offset.x, y: offset.y + KEY_STEP_PX },
    ArrowLeft: { x: offset.x - KEY_STEP_PX, y: offset.y },
    ArrowRight: { x: offset.x + KEY_STEP_PX, y: offset.y },
    PageUp: { x: offset.x, y: offset.y - page },
    PageDown: { x: offset.x, y: offset.y + page },
    Home: { x: offset.x, y: 0 },
    End: { x: offset.x, y: getMoveRange(extent).y },
  };
  return Object.hasOwn(moves, key) ? clampOffset(moves[key], extent) : null;
}

/** 줄(본문 표 안의 top · height)을 보이는 틀의 세로 가운데에 두는 y */
export function centreRow(rowTop: number, rowHeight: number, extent: SheetExtent): number {
  return clampOffset({ x: 0, y: rowTop + rowHeight / 2 - extent.viewHeight / 2 }, extent).y;
}

/** 위치 막대의 손잡이(%) - 옮길 것이 없으면 null(막대를 숨긴다) */
export function getRailThumb(offsetY: number, extent: SheetExtent): { top: number; height: number } | null {
  if (getMoveRange(extent).y === 0) return null;
  return { top: (offsetY / extent.contentHeight) * 100, height: (extent.viewHeight / extent.contentHeight) * 100 };
}

/** 위치 막대에서 고른 줄의 자리(%) - 줄의 세로 가운데 */
export function getRailMark(rowTop: number, rowHeight: number, contentHeight: number): number {
  return contentHeight > 0 ? ((rowTop + rowHeight / 2) / contentHeight) * 100 : 0;
}

/** 열 비율을 표 폭의 %로 - 합은 100 */
export function toColumnPercents(ratios: readonly number[]): number[] {
  const total = ratios.reduce((sum, ratio) => sum + ratio, 0);
  if (total <= 0) return ratios.map(() => 100 / ratios.length);
  return ratios.map((ratio) => Math.round((ratio / total) * 100_000) / 1000);
}

/** freeze "A3" = 앞 두 줄이 붙박이 */
export function getFrozenCount(freeze: string | null): number {
  if (freeze === null) return 0;
  return Math.max(0, Number(/\d+/.exec(freeze)?.[0] ?? "1") - 1);
}

/** 열마다 그 열을 덮는 띠의 색 갈래 - 띠가 없는 열은 null */
export function listBandTones(bands: readonly PreviewBand[], columnCount: number): (PreviewBand["tone"] | null)[] {
  const tones: (PreviewBand["tone"] | null)[] = [];
  for (const band of bands) for (let step = 0; step < band.span; step += 1) tones.push(band.tone);
  return Array.from({ length: columnCount }, (_, index) => tones[index] ?? null);
}

/** 그릴 칸 하나 - span은 이 칸이 덮는 열 수 */
export interface SheetCellSpan {
  cell: PreviewCell;
  column: number;
  span: number;
}

/** 줄의 칸을 그릴 칸으로 - 접지 않는 줄(wrap: false)의 글 칸은 Excel처럼 뒤따르는 빈 칸까지 넓혀 그린다(숫자 칸은 넘치지 않는다) */
export function spanCells(row: PreviewRow, columnCount: number): SheetCellSpan[] {
  const cells = row.cells.slice(0, columnCount);
  const spans: SheetCellSpan[] = [];
  for (let column = 0; column < cells.length; column += 1) {
    const cell = cells[column];
    let span = 1;
    if (!row.wrap && cell.text !== "" && !cell.numeric) {
      while (column + span < cells.length && cells[column + span].text === "") span += 1;
    }
    spans.push({ cell, column, span });
    column += span - 1;
  }
  return spans;
}

// --- 목차 줄 접기 ---

export const MIN_TOC_FOLD = 2; // 목차 줄이 이만큼 이어져야 접는다 - 한 줄은 접어도 줄지 않는다

/** 그릴 줄 - 모델 줄 하나(tocStart는 펼친 목차 무리의 첫 줄 index) 또는 접힌 목차 무리 */
export type SheetItem =
  | { type: "row"; index: number; row: PreviewRow; tocStart: number | null }
  | { type: "fold"; start: number; rows: PreviewRow[] };

/** from부터의 줄을 그릴 줄로 - 연달아 오는 목차 줄은 무리의 첫 줄 index가 openTocs에 없으면 한 줄로 접는다 */
export function listSheetItems(rows: readonly PreviewRow[], from: number, openTocs: ReadonlySet<number>, canFold: boolean): SheetItem[] {
  const items: SheetItem[] = [];
  let index = from;
  while (index < rows.length) {
    let end = index;
    while (canFold && end < rows.length && rows[end].toc) end += 1;
    if (end - index < MIN_TOC_FOLD) {
      items.push({ type: "row", index, row: rows[index], tocStart: null });
      index += 1;
    } else if (openTocs.has(index)) {
      for (let at = index; at < end; at += 1) items.push({ type: "row", index: at, row: rows[at], tocStart: index });
      index = end;
    } else {
      items.push({ type: "fold", start: index, rows: rows.slice(index, end) });
      index = end;
    }
  }
  return items;
}

/** 접힌 목차 줄의 칸 - 첫 줄의 칸에 Row 범위("1-8") · Location의 안내 글 · Unit ID의 "…" · Old text의 "외 n줄"만 바꾼다. 나머지(보낸 곳 · Remark · Status 칩)는 첫 줄 그대로 */
export function buildFoldedCells(rows: readonly PreviewRow[], columnKeys: readonly string[], texts: { label: string; more: string }): PreviewCell[] {
  const first = rows[0];
  const last = rows[rows.length - 1];
  return first.cells.map((cell, column) => {
    const key = columnKeys[column];
    const lastText = last.cells[column]?.text ?? "";
    if (key === "row") return { ...cell, text: lastText !== "" && lastText !== cell.text ? `${cell.text}-${lastText}` : cell.text };
    if (key === "location") return { ...cell, text: texts.label };
    if (key === "unit_id") return { ...cell, text: `${cell.text} …` };
    if (key === "old_text") return { ...cell, text: `${cell.text} ${texts.more}` };
    return cell;
  });
}

// --- 고른 줄 · 확정 전 값 ---

export type SheetRowMark = "picked" | "group" | null;

/** 고른 단위의 관계 묶음 - 고른 줄이 없거나 그 줄에 묶음이 없으면 null */
export function findPickedGroup(rows: readonly PreviewRow[], unitId: number | null): string | null {
  if (unitId === null) return null;
  return rows.find((row) => row.unit_id === unitId)?.group_id ?? null;
}

/** 줄의 칠 - 고른 단위의 줄은 picked, 같은 관계 묶음의 다른 줄은 group. 줄의 unit_id · group_id로만 맞춘다 */
export function getRowMark(row: PreviewRow, unitId: number | null, groupId: string | null): SheetRowMark {
  if (unitId !== null && row.unit_id === unitId) return "picked";
  if (groupId !== null && row.group_id === groupId) return "group";
  return null;
}

/** 여러 줄을 한 줄로 그릴 때(접힌 목차)의 칠 - 고른 줄이 하나라도 들었으면 picked */
export function getFoldMark(rows: readonly PreviewRow[], unitId: number | null, groupId: string | null): SheetRowMark {
  const marks = rows.map((row) => getRowMark(row, unitId, groupId));
  return marks.includes("picked") ? "picked" : marks.includes("group") ? "group" : null;
}

/** 확정 전에 고른 값을 덮어 그리는 칸 - 서버 column_keys의 이름과 같다 */
export const DRAFT_KEYS = ["destination", "new_doc", "new_doc_title", "place", "number", "new_text", "change"] as const;
export type SheetDraftKey = (typeof DRAFT_KEYS)[number];
/** 확정 전에 고른 곳 - 고른 줄의 그 칸에 덮어 그린다. 싣지 않은 칸은 모델 글 그대로 */
export type SheetDraft = Partial<Record<SheetDraftKey, string>>;

/** 확정 전 값을 덮어 그릴 줄 - 고른 단위의 첫 줄(이어진 줄 · 중복 배정의 둘째 줄에는 그리지 않는다). 없으면 -1 */
export function findDraftRow(rows: readonly PreviewRow[], unitId: number | null, draft: SheetDraft | undefined): number {
  if (unitId === null || draft === undefined) return -1;
  return rows.findIndex((row) => row.unit_id === unitId);
}

/** 그 열에 덮어 그릴 확정 전 값 - 없으면 undefined */
export function readDraftText(draft: SheetDraft | undefined, columnKey: string | undefined): string | undefined {
  if (draft === undefined) return undefined;
  const key = DRAFT_KEYS.find((item) => item === columnKey);
  return key === undefined ? undefined : draft[key];
}
