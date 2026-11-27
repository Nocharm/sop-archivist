// 벗긴 표 덩이 안 줄 순서(units.unwrap_seq, 편집 reorder_unwrapped) - 용지 줄 차례 · J/K · 손잡이 끌기가 같은 순서를 쓴다.
// orderUnwrapped · orderUnwrappedLines · findLineTable은 서버 backend/app/sop/unwrap_order.py의 사본이다(문단 Excel이 같은 순서를 쓴다,
// 사례는 rule-cases.json) - 규칙을 바꾸면 함께 고친다.
// 설계: 2026-11-20-assign-mockup2 D2 (docs/architecture/decisions.md)

const NO_SEQ = -1; // 덩이 맨 앞에서 빌릴 값이 없는 줄 - 매긴 값(0부터)보다 앞

/** 덩이를 재는 데 필요한 원문 표 하나 - isUnwrapped는 벗긴 보통 표(띠 표는 제목 줄이 되어 덩이가 없다) */
export interface UnwrapTable {
  parentId: number | null;
  isUnwrapped: boolean;
}

/**
 * 묶이지 않은 단위 하나가 줄로 드는 덩이(벗긴 표 id) - 첫 블록이 벗긴 표의 칸이면 그 표, 아직 표인 표 단위 · 띠 표 제목 줄은
 * 바깥으로 올라가 처음 만나는 벗긴 표. 아니면 null
 */
export function findLineTable(kind: string, tableId: number | null, blockTableId: number | null, tables: ReadonlyMap<number, UnwrapTable>): number | null {
  if (blockTableId === null) return null;
  const table = tables.get(blockTableId);
  if (!table) return null;
  if (table.isUnwrapped) return blockTableId;
  // 서버 groups.TABLE_UNIT_KINDS · segment.is_band_heading과 같다
  if (kind !== "table" && !(kind === "heading" && tableId !== null)) return null;
  let parentId = table.parentId;
  while (parentId !== null) {
    const parent = tables.get(parentId);
    if (!parent) return null;
    if (parent.isUnwrapped) return parentId;
    parentId = parent.parentId;
  }
  return null;
}

/** 덩이의 줄 → 덩이 안 순서. 원문 자리(posOf) 순으로 놓고 값이 없는 줄은 바로 앞 줄의 값을 빌려 (값, 원문 자리)로 정렬한다 */
export function orderUnwrapped<T>(lines: readonly T[], seqOf: (line: T) => number | null | undefined, posOf: (line: T) => number): T[] {
  const ordered = [...lines].sort((a, b) => posOf(a) - posOf(b));
  let borrowed = NO_SEQ;
  const keyed = ordered.map((line, index) => {
    borrowed = seqOf(line) ?? borrowed;
    return { line, key: borrowed, index };
  });
  return keyed.sort((a, b) => a.key - b.key || a.index - b.index).map((entry) => entry.line);
}

/**
 * 보이는 순서의 항목(용지 줄 · 단위) → 벗긴 덩이 안만 덩이 순서로. lineOf는 항목이 딸린 줄(없으면 제자리), blockOf는 그 줄의 덩이.
 * 덩이마다 줄을 처음 나온 차례를 원문 자리로 삼아 정렬하고, 그 덩이 항목이 있던 자리에 차례로 다시 채운다 - 덩이 밖 항목과
 * 다른 덩이(벗긴 안쪽 표)의 항목은 제자리, 한 줄에 딸린 항목들(표와 그 칸 문장)은 서로의 차례를 지킨다
 */
export function orderUnwrappedLines<T>(
  items: readonly T[],
  lineOf: (item: T) => number | null,
  blockOf: (line: number) => number | null,
  seqOf: (line: number) => number | null | undefined,
): T[] {
  const linesOfBlock = new Map<number, number[]>();
  const itemsOfLine = new Map<number, T[]>();
  const slots = new Map<number, number[]>();
  items.forEach((item, index) => {
    const line = lineOf(item);
    const block = line === null ? null : blockOf(line);
    if (line === null || block === null) return;
    if (!itemsOfLine.has(line)) {
      itemsOfLine.set(line, []);
      linesOfBlock.set(block, [...(linesOfBlock.get(block) ?? []), line]);
    }
    itemsOfLine.get(line)!.push(item);
    slots.set(block, [...(slots.get(block) ?? []), index]);
  });
  const result = [...items];
  for (const [block, lines] of linesOfBlock) {
    // 줄은 처음 나온 차례로 모였다 - 그 차례가 원문 자리다
    const ordered = orderUnwrapped(lines.map((line, index) => ({ line, index })), (entry) => seqOf(entry.line), (entry) => entry.index);
    const refill = ordered.flatMap((entry) => itemsOfLine.get(entry.line) ?? []);
    (slots.get(block) ?? []).forEach((slot, index) => {
      result[slot] = refill[index];
    });
  }
  return result;
}

/**
 * 손잡이로 끄는 줄 묶음을 놓을 자리 - 끄는 줄을 뺀 나머지 덩이 줄(차례대로)의 가운데 y 가운데 포인터보다 위에 있는 수(0 = 맨 위).
 * 그려지지 않아 잴 수 없는 줄(null)은 화면 밖이다 - 잰 줄보다 앞이면 위, 뒤면 아래로 센다
 */
export function readUnwrapSlot(mids: readonly (number | null)[], y: number): number {
  const lastMeasured = mids.findLastIndex((mid) => mid !== null);
  for (let index = 0; index < mids.length; index += 1) {
    const mid = mids[index];
    if (mid === null ? index > lastMeasured : mid >= y) return index;
  }
  return mids.length;
}

/** 끄는 줄 묶음(짝 카드면 구성원 전부, 차례대로)을 자리 slot(끄는 줄을 뺀 나머지 사이)에 놓은 새 덩이 차례 */
export function moveUnwrapLines(order: readonly number[], moving: readonly number[], slot: number): number[] {
  const moved = new Set(moving);
  const others = order.filter((id) => !moved.has(id));
  const at = Math.max(0, Math.min(slot, others.length));
  return [...others.slice(0, at), ...order.filter((id) => moved.has(id)), ...others.slice(at)];
}
