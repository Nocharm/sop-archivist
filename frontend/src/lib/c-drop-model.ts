// Order 화면 줄 끌기의 순수 모델 - 함께 움직일 덩어리, 포인터가 놓을 수 있는 칸 위인지, 놓을 자리·깊이와 그에 맞는 place 편집을 정한다.
import type { OutputCItem } from "./api-sop";
import type { PlaceEdit } from "./c-edit-model";
import { canChangeDepth, isCounted, MAX_INDENT_LEVEL } from "./section-number";

/** 좌우로 이만큼 움직이면 깊이가 한 단 */
export const DEPTH_STEP_PX = 24;
/** 칸 머리 위로 이만큼, 아래로 SECTION_SLACK_BOTTOM_PX까지는 그 칸 위로 친다(시안 값) */
export const SECTION_SLACK_TOP_PX = 10;
export const SECTION_SLACK_BOTTOM_PX = 28;

/** 함께 옮기는 덩어리 - 칸 items의 인덱스 닫힌 구간. baseDepth는 같은 의미 줄들의 가장 얕은 깊이 */
export interface DragBlock {
  start: number;
  end: number;
  baseDepth: number;
  isDepthLocked: boolean;
}

/** 누른 줄과 이웃한 같은 meaning_key 줄 전부 + 그 뒤로 baseDepth보다 깊은 줄. 의미 키가 없으면 혼자, 떨어진 같은 의미 줄은 따라오지 않는다 */
export function findDragBlock(items: readonly OutputCItem[], depths: readonly number[], index: number, entrance: string): DragBlock {
  const key = items[index].meaning_key;
  let start = index;
  let end = index;
  if (key !== null) {
    while (start > 0 && items[start - 1].meaning_key === key) start -= 1;
    while (end + 1 < items.length && items[end + 1].meaning_key === key) end += 1;
  }
  const baseDepth = Math.min(...depths.slice(start, end + 1));
  while (end + 1 < items.length && depths[end + 1] > baseDepth) end += 1;
  const isDepthLocked = items.slice(start, end + 1).some((item) => !canChangeDepth(entrance, item));
  return { start, end, baseDepth, isDepthLocked };
}

export type DropZone = "home" | "other" | "outside";

/** 종이 밖이면 outside, 끌린 줄의 칸 띠(위 10px·아래 28px 여유) 안이면 home, 그 밖의 종이 위는 other(다른 칸) */
export function classifyDropZone(point: { x: number; y: number }, sheet: { left: number; right: number; top: number; bottom: number }, section: { top: number; bottom: number }): DropZone {
  if (point.x < sheet.left || point.x > sheet.right || point.y < sheet.top || point.y > sheet.bottom) return "outside";
  return point.y >= section.top - SECTION_SLACK_TOP_PX && point.y <= section.bottom + SECTION_SLACK_BOTTOM_PX ? "home" : "other";
}

/** 그려진 줄 하나(덩어리 줄은 뺀다) - 화면 순서, y는 pointerY와 같은 좌표계 */
export interface RowBox {
  targetId: number;
  top: number;
  bottom: number;
}

export interface DropPlan {
  beforeId: number | null;
  depth: number;
  lineY: number;
  /** null = 제자리(순서도 깊이도 그대로) */
  edit: PlaceEdit | null;
}

/** 포인터 위쪽에 중간선이 있는 줄 수 k. k가 한 의미 묶음 한가운데면 묶음 전체의 중간선으로 앞·뒤 가장자리에 붙인다 */
function findInsertIndex(items: readonly OutputCItem[], rows: readonly RowBox[], pointerY: number): number {
  let k = rows.filter((row) => (row.top + row.bottom) / 2 < pointerY).length;
  if (k === 0 || k >= rows.length) return k;
  const keyOf = (row: RowBox) => items.find((item) => item.target_id === row.targetId)?.meaning_key ?? null;
  const key = keyOf(rows[k]);
  if (key === null || keyOf(rows[k - 1]) !== key) return k;
  let first = k - 1;
  let last = k;
  while (first > 0 && keyOf(rows[first - 1]) === key) first -= 1;
  while (last + 1 < rows.length && keyOf(rows[last + 1]) === key) last += 1;
  const groupMid = (rows[first].top + rows[last].bottom) / 2;
  k = pointerY < groupMid ? first : last + 1;
  return k;
}

/** 포인터 위치(pointerY)와 좌우 이동(dx)에서 놓을 자리·깊이·그 선의 y·편집을 정한다 */
export function planDrop(input: {
  locationKey: string;
  items: readonly OutputCItem[];
  depths: readonly number[];
  block: DragBlock;
  rows: readonly RowBox[];
  pointerY: number;
  dx: number;
  homeTop: number; // 칸에 다른 줄이 없을 때 선을 그을 y
}): DropPlan {
  const { items, depths, block, rows } = input;
  const inBlock = (index: number) => index >= block.start && index <= block.end;
  const k = findInsertIndex(items, rows, input.pointerY);

  // 그려진 마지막 줄 뒤에서는 아직 안 그려진 줄 앞(없으면 칸 끝) - 덩어리 줄은 건너뛴다
  let beforeId: number | null = null;
  if (k < rows.length) beforeId = rows[k].targetId;
  else {
    const lastDrawn = rows.length > 0 ? items.findIndex((item) => item.target_id === rows[rows.length - 1].targetId) : -1;
    const next = items.findIndex((_, index) => index > lastDrawn && !inBlock(index));
    beforeId = next < 0 ? null : items[next].target_id;
  }
  const lineY = k < rows.length ? rows[k].top - 1 : rows.length > 0 ? rows[rows.length - 1].bottom + 1 : input.homeTop;

  // 깊이 한계 = 넣을 자리 앞의 가장 가까운 번호 줄 깊이 + 1. 덩어리 자신의 줄은 건너뛴다(옮기고 나면 그 자리에 없다)
  const insertAt = beforeId === null ? items.length : items.findIndex((item) => item.target_id === beforeId);
  let above = insertAt - 1;
  while (above >= 0 && (inBlock(above) || !isCounted(items[above]))) above -= 1;
  const max = above < 0 ? 0 : Math.min(depths[above] + 1, MAX_INDENT_LEVEL);
  const depth = block.isDepthLocked ? block.baseDepth : Math.max(0, Math.min(max, block.baseDepth + Math.round(input.dx / DEPTH_STEP_PX)));

  const targetIds = items.slice(block.start, block.end + 1).map((item) => item.target_id);
  const rest = items.filter((_, index) => !inBlock(index));
  const at = beforeId === null ? rest.length : rest.findIndex((item) => item.target_id === beforeId);
  const isSameOrder = at === block.start;
  const isSameDepth = depth === block.baseDepth;
  if (isSameOrder && isSameDepth) return { beforeId, depth, lineY, edit: null };

  // 아래 덩어리 줄은 같은 만큼 옮기되 서버 상한(MAX_INDENT_LEVEL)을 넘기지 않는다
  const shifted = isSameDepth ? null : depths.slice(block.start, block.end + 1).map((d) => Math.min(MAX_INDENT_LEVEL, d - block.baseDepth + depth));
  return { beforeId, depth, lineY, edit: { kind: "place", locationKey: input.locationKey, targetIds, beforeId, depths: shifted } };
}
