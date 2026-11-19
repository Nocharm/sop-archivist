// Order 화면 줄 끌기의 순수 모델 - 함께 움직일 덩어리, 포인터가 놓을 수 있는 칸 위인지, 놓을 자리·깊이와 그에 맞는 place 편집을 정한다.
import type { NumberStyle, OutlineKind, OutputCItem } from "./api-sop";
import { readLocationPlace, type PlaceEdit } from "./c-edit-model";
import { canChangeDepth, listBullets, listCounted, MAX_BULLET_LEVEL, MAX_INDENT_LEVEL } from "./section-number";

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

/**
 * 끄는 동안 지금 칸의 줄에서 누를 때의 덩어리를 다시 찾는다(저장 응답·다시 받기로 칸이 바뀔 수 있다).
 * 누른 줄이 없거나 덩어리 줄이 그때와 다르면(빠짐·끼어듦·더해짐) null - 그 끌기는 놓지 않는다
 */
export function findLiveBlock(items: readonly OutputCItem[], depths: readonly number[], pressedId: number, blockIds: readonly number[], entrance: string): DragBlock | null {
  const index = items.findIndex((item) => item.target_id === pressedId);
  if (index < 0) return null;
  const block = findDragBlock(items, depths, index, entrance);
  const ids = items.slice(block.start, block.end + 1).map((item) => item.target_id);
  return ids.length === blockIds.length && ids.every((id, k) => id === blockIds[k]) ? block : null;
}

/** planDrop·planCrossDrop에 넘길 줄 - 잰 줄(화면 순서) 가운데 덩어리 줄과 그 칸에 없는 줄을 id로 뺀다. 끄는 도중 이어 그려진 덩어리 줄도 빠진다. block null = 도착 칸(덩어리 줄이 없다) */
export function listDropRows(items: readonly OutputCItem[], block: DragBlock | null, measured: readonly RowBox[]): RowBox[] {
  const blockIds = new Set(block ? items.slice(block.start, block.end + 1).map((item) => item.target_id) : []);
  const known = new Set(items.map((item) => item.target_id));
  return measured.filter((row) => known.has(row.targetId) && !blockIds.has(row.targetId));
}

export type Band = { top: number; bottom: number };

function isInBand(y: number, band: Band): boolean {
  return y >= band.top - SECTION_SLACK_TOP_PX && y <= band.bottom + SECTION_SLACK_BOTTOM_PX;
}

/**
 * 포인터 아래 칸의 인덱스 - 종이 밖이거나 어느 칸의 띠(위 10px·아래 28px 여유)도 아니면(첫 칸 위·마지막 칸 아래·칸 사이 빈틈) null.
 * 출발 칸(homeIndex)의 띠가 먼저고, 그 밖에서 여유 띠가 겹치면 아래 칸이다.
 */
export function findDropSection(point: { x: number; y: number }, sheet: { left: number; right: number; top: number; bottom: number }, bands: readonly Band[], homeIndex: number): number | null {
  if (point.x < sheet.left || point.x > sheet.right || point.y < sheet.top || point.y > sheet.bottom) return null;
  if (bands[homeIndex] && isInBand(point.y, bands[homeIndex])) return homeIndex;
  for (let i = bands.length - 1; i >= 0; i -= 1) if (i !== homeIndex && isInBand(point.y, bands[i])) return i;
  return null;
}

/**
 * findDropSection을 칸 키로 - 출발 칸은 요소가 아니라 키(homeKey)로 찾는다. 끄는 도중 출발 칸이 다시 그려져(새 요소) "다른 칸"으로 보이면
 * 덩어리 줄이 든 칸에 planCrossDrop을 부르게 된다. isHome이면 칸 안 끌기(planDrop), 아니면 다른 칸
 */
export function findDropSectionByKey(
  point: { x: number; y: number },
  sheet: { left: number; right: number; top: number; bottom: number },
  sections: readonly { key: string; band: Band }[],
  homeKey: string,
): { index: number; isHome: boolean } | null {
  const index = findDropSection(point, sheet, sections.map((section) => section.band), sections.findIndex((section) => section.key === homeKey));
  return index === null ? null : { index, isHome: sections[index].key === homeKey };
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
  const indexOf = (row: RowBox) => items.findIndex((item) => item.target_id === row.targetId);
  const keyOf = (row: RowBox) => items[indexOf(row)]?.meaning_key ?? null;
  // 이웃은 칸의 실제 순서(items)로 본다 - 끌린 덩어리가 사이에 끼어 있던 짝은 한 묶음이 아니라 그 틈이 놓을 수 있는 자리다
  const isNeighbour = (before: RowBox, after: RowBox) => keyOf(before) === keyOf(after) && indexOf(after) === indexOf(before) + 1;
  const key = keyOf(rows[k]);
  if (key === null || !isNeighbour(rows[k - 1], rows[k])) return k;
  let first = k - 1;
  let last = k;
  while (first > 0 && isNeighbour(rows[first - 1], rows[first])) first -= 1;
  while (last + 1 < rows.length && isNeighbour(rows[last], rows[last + 1])) last += 1;
  const groupMid = (rows[first].top + rows[last].bottom) / 2;
  k = pointerY < groupMid ? first : last + 1;
  return k;
}

/**
 * 넣을 자리(insertAt)에서 덩어리 줄들의 깊이 - 줄의 최종 표시(isBullet[k], 칸을 넘으면 도착 칸의 기본 표시로 바뀐 뒤)마다 규칙이 따로다.
 * 같은 갈래(글머리 기호 / 그 밖)끼리 시작 깊이(그 갈래 줄의 가장 얕은 깊이) + round(dx / 24)를 0 ~ 넣을 자리 위 가장 가까운 같은 갈래 줄 깊이 + 1로 자른다
 * (번호 줄은 번호 줄만, 글머리 기호 줄은 글머리 기호 줄만 본다. 앞 줄이 없으면 0). 갈래의 상한은 번호 MAX_INDENT_LEVEL·글머리 기호 MAX_BULLET_LEVEL을
 * 그 갈래에서 가장 깊은 줄에 건다 - 첫 줄을 그만큼 덜 들여 아래 줄들이 자기 단 차이를 지킨다. 글머리 기호 줄은 번호 줄이었다가 바뀐 줄의 깊은 단차도 있어
 * 서버·화면(getSectionDepths)처럼 앞 글머리 기호 줄 + 1로 한 줄씩 다시 누른다. skip은 옮기고 나면 그 자리에 없는 줄(같은 칸 안 끌기의 덩어리 자신).
 * 깊이가 잠긴 덩어리는 dx를 안 받고 시작 깊이 그대로다 - 다만 다른 칸(isCross)에서는 그 칸의 한계도 받는다(앞 줄이 없는 자리에 깊이 2로 놓이면 번호가 비므로).
 * countsLines는 놓는 칸의 값(절의 counts_lines) - 줄을 세지 않는 칸은 세는 줄이 없어(listCounted) 번호 갈래는 어느 자리든 0이다.
 * depth는 첫 줄 갈래의 새 시작 깊이(그은 선의 들여쓰기), depths는 덩어리 줄마다의 새 깊이
 */
function calcDropDepths(input: { countsLines: boolean; items: readonly OutputCItem[]; depths: readonly number[]; insertAt: number; skip?: (index: number) => boolean; block: DragBlock; blockDepths: readonly number[]; isBullet: readonly boolean[]; dx: number; isCross?: boolean }): { depth: number; depths: number[] } {
  const { items, depths, block, blockDepths, isBullet } = input;
  const step = input.block.isDepthLocked ? 0 : Math.round(input.dx / DEPTH_STEP_PX);
  const result = [...blockDepths];
  let depth = block.baseDepth;
  for (const isBulletKind of [isBullet[0], !isBullet[0]]) {
    const lines = blockDepths.map((_, k) => k).filter((k) => isBullet[k] === isBulletKind);
    if (lines.length === 0) continue;
    const counted = isBulletKind ? listBullets({ items }) : listCounted({ counts_lines: input.countsLines, items });
    let above = input.insertAt - 1;
    while (above >= 0 && (input.skip?.(above) || !counted[above])) above -= 1;
    const base = Math.min(...lines.map((k) => blockDepths[k]));
    const deepestOffset = Math.max(...lines.map((k) => blockDepths[k])) - base;
    const max = above < 0 ? 0 : Math.max(0, Math.min(depths[above] + 1, (isBulletKind ? MAX_BULLET_LEVEL : MAX_INDENT_LEVEL) - deepestOffset));
    const next = block.isDepthLocked ? (input.isCross ? Math.min(base, max) : base) : Math.max(0, Math.min(max, base + step));
    if (isBulletKind === isBullet[0]) depth = next;
    let previous = above < 0 ? null : depths[above];
    for (const k of lines) {
      let line = blockDepths[k] - base + next;
      if (isBulletKind) line = Math.max(0, Math.min(line, MAX_BULLET_LEVEL, previous === null ? 0 : previous + 1));
      result[k] = line;
      previous = line;
    }
  }
  return { depth, depths: result };
}

/** 포인터 위치(pointerY)와 좌우 이동(dx)에서 놓을 자리·깊이·그 선의 y·편집을 정한다 */
export function planDrop(input: {
  locationKey: string;
  /** 그 칸이 줄을 세는가(절의 counts_lines) */
  countsLines: boolean;
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

  const insertAt = beforeId === null ? items.length : items.findIndex((item) => item.target_id === beforeId);
  const blockDepths = depths.slice(block.start, block.end + 1);
  const isBullet = items.slice(block.start, block.end + 1).map((item) => item.number_style === "bullet");
  const { depth, depths: placedDepths } = calcDropDepths({ countsLines: input.countsLines, items, depths, insertAt, skip: inBlock, block, blockDepths, isBullet, dx: input.dx });

  const targetIds = items.slice(block.start, block.end + 1).map((item) => item.target_id);
  const rest = items.filter((_, index) => !inBlock(index));
  const at = beforeId === null ? rest.length : rest.findIndex((item) => item.target_id === beforeId);
  const isSameOrder = at === block.start;
  const isSameDepth = placedDepths.every((d, k) => d === blockDepths[k]);
  if (isSameOrder && isSameDepth) return { beforeId, depth, lineY, edit: null };

  // 아래 덩어리 줄은 같은 갈래끼리 같은 만큼 옮긴다 - 위 한계가 가장 깊은 줄도 그 갈래의 상한 안에 둔다
  return { beforeId, depth, lineY, edit: { kind: "place", locationKey: input.locationKey, targetIds, beforeId, depths: isSameDepth ? null : placedDepths } };
}

export type EnterRefusal = "na" | "otherDoc" | "notAssignable" | "otherPart";
export type LeaveRefusal = "written" | "translation";

/**
 * 덩어리가 도착 칸에 들어갈 수 있나 - N/A 칸, 다른 문서, 문장을 받지 않는 절(묶음 · 앱이 채우는 목록 - 서버 422 slot_not_assignable),
 * 서버가 받는 자리가 없거나(path: 칸) 종류가 다른 칸·다른 WI 부분(Instruction↔Why)이면 사유.
 * 같은 부분의 다른 step이나 단계 없는 칸은 들어간다. 검사 순서는 N/A → 다른 문서 → 문장을 받지 않는 절 → 자리
 */
export function findEnterRefusal(fromKey: string, to: { location_key: string; na_reason: string | null; kind: OutlineKind | null }, isSameDoc: boolean): EnterRefusal | null {
  if (to.na_reason !== null) return "na";
  if (!isSameDoc) return "otherDoc";
  if (to.kind === "group" || to.kind === "auto_list") return "notAssignable";
  const fromPlace = readLocationPlace(fromKey);
  const toPlace = readLocationPlace(to.location_key);
  if (!fromPlace || !toPlace || "slot_key" in fromPlace !== "slot_key" in toPlace) return "otherPart";
  if ("wi_part" in fromPlace && "wi_part" in toPlace && fromPlace.wi_part !== toPlace.wi_part) return "otherPart";
  return null;
}

/**
 * 덩어리가 지금 칸을 떠날 수 있나 - 이미 쓴 문서(entrance match)의 줄은 자리가 잠겨 written.
 * translation은 AI 번역이 있는 의미 묶음을 가르는 경우다: 서버는 번역을 원문과 같은 자리로만 옮기고(translation_locked) 원문만 옮기면 번역을 지우거나 보류한다.
 * 화면은 번역의 원문 id를 몰라 보수적으로 본다 - 번역이 든 의미 묶음은 그 묶음 줄이 칸에서 모두 덩어리 안에 있고 번역 아닌 줄도 있을 때만 떠난다.
 * 의미 키 없는 번역 줄(출처가 사라진 번역)은 서버가 출처를 옮긴 줄에서 찾지 못해 거절하므로 같이 막는다
 */
export function findLeaveRefusal(entrance: string, items: readonly OutputCItem[], block: DragBlock): LeaveRefusal | null {
  if (entrance === "match") return "written";
  const inBlock = items.slice(block.start, block.end + 1);
  if (inBlock.some((item) => item.origin === "translation" && item.meaning_key === null)) return "translation";
  const keys = new Set(inBlock.map((item) => item.meaning_key).filter((key): key is string => key !== null));
  for (const key of keys) {
    const group = items.filter((item) => item.meaning_key === key);
    if (!group.some((item) => item.origin === "translation")) continue;
    const isWhole = group.every((item) => inBlock.includes(item));
    if (!isWhole || !group.some((item) => item.origin !== "translation")) return "translation";
  }
  return null;
}

/**
 * 덩어리를 다른 칸(toKey)에 놓을 자리·깊이·그 선의 y·편집을 정한다. 들어가도 되는지(findLeaveRefusal·findEnterRefusal)는 부르는 쪽이 먼저 본다.
 * dest.items는 그 칸 전체(안 그려진 줄 포함), rows는 listDropRows(dest.items, null, 잰 줄) - 놓는 칸이 같은 칸이면 이 함수가 아니라 planDrop을 쓴다.
 * 깊이는 planDrop과 같은 도우미로 자르고, 줄이 없는 칸은 0. 편집은 늘 있고 깊이(depths)를 늘 싣는다 - 칸을 넘는 편집의 필수 값이다
 */
export function planCrossDrop(input: {
  fromKey: string;
  toKey: string;
  source: { countsLines: boolean; items: readonly OutputCItem[]; depths: readonly number[]; block: DragBlock };
  /** defaultStyle: 도착 칸(절)의 기본 번호 표시 - SOP 칸으로 간 번호·글머리 기호 줄은 이 표시가 된다(서버 restyle_moved). 없으면 표시를 바꾸지 않는다 */
  dest: { countsLines: boolean; items: readonly OutputCItem[]; depths: readonly number[]; defaultStyle?: NumberStyle };
  rows: readonly RowBox[];
  pointerY: number;
  dx: number;
  emptyTop: number; // 도착 칸에 그려진 줄이 없을 때 선을 그을 y
}): DropPlan {
  const { source, dest, rows } = input;
  const { block } = source;
  // 같은 칸이면 칸 안 끌기와 똑같이 - dest에 덩어리가 들어 있어 이 함수의 가정이 깨진다
  if (input.fromKey === input.toKey) {
    return planDrop({ locationKey: input.fromKey, countsLines: source.countsLines, items: source.items, depths: source.depths, block, rows, pointerY: input.pointerY, dx: input.dx, homeTop: input.emptyTop });
  }
  // 도착 칸에 없는 줄이 섞이면 beforeId를 믿을 수 없다 - 아무것도 저장하지 않는다(밖으로 친다)
  const destIds = new Set(dest.items.map((item) => item.target_id));
  if (rows.some((row) => !destIds.has(row.targetId))) return { beforeId: null, depth: 0, lineY: input.emptyTop, edit: null };
  const k = findInsertIndex(dest.items, rows, input.pointerY);

  // 그려진 마지막 줄 뒤에서는 아직 안 그려진 첫 줄 앞(없으면 칸 끝) - 덩어리 줄은 이 칸에 없다
  let beforeId: number | null = null;
  if (k < rows.length) beforeId = rows[k].targetId;
  else {
    const lastDrawn = rows.length > 0 ? dest.items.findIndex((item) => item.target_id === rows[rows.length - 1].targetId) : -1;
    // 그려진 창이 의미 묶음을 자르면(마지막 그려진 줄과 다음 줄이 이웃한 같은 의미) 묶음 뒤로 - 묶음 안에는 놓지 않는다
    const key = lastDrawn >= 0 ? dest.items[lastDrawn].meaning_key : null;
    let next = lastDrawn + 1;
    while (key !== null && next < dest.items.length && dest.items[next].meaning_key === key) next += 1;
    beforeId = next < dest.items.length ? dest.items[next].target_id : null;
  }
  const lineY = k < rows.length ? rows[k].top - 1 : rows.length > 0 ? rows[rows.length - 1].bottom + 1 : input.emptyTop;

  const insertAt = beforeId === null ? dest.items.length : dest.items.findIndex((item) => item.target_id === beforeId);
  const blockDepths = source.depths.slice(block.start, block.end + 1);
  // 깊이 규칙은 줄이 도착한 뒤의 표시로 고른다 - SOP 칸(slot_key)으로 간 번호·글머리 기호 줄은 그 칸의 기본 표시가 되고(c-edit-model previewCrossPlace와 같다), WI 단계로 간 줄은 그대로다
  const moved = source.items.slice(block.start, block.end + 1);
  const toPlace = readLocationPlace(input.toKey);
  const isRestyled = dest.defaultStyle !== undefined && toPlace !== null && "slot_key" in toPlace;
  const isBullet = moved.map((item) => (isRestyled && (item.number_style === "numbered" || item.number_style === "bullet") ? dest.defaultStyle : item.number_style) === "bullet");
  const { depth, depths } = calcDropDepths({ countsLines: dest.countsLines, items: dest.items, depths: dest.depths, insertAt, block, blockDepths, isBullet, dx: input.dx, isCross: true });
  const targetIds = moved.map((item) => item.target_id);
  return { beforeId, depth, lineY, edit: { kind: "place", locationKey: input.fromKey, toLocationKey: input.toKey, targetIds, beforeId, depths } };
}
