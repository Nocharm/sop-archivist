// 짝 카드 안 순서(units.pair_seq, 편집 reorder_pair) - 용지 카드 그리기 · 결정 칸 Shape 줄 · 손잡이 끌기가 같은 순서를 쓴다.
// orderPairCard는 서버 backend/app/sop/pair_order.py order_pair_card의 사본이다(문단 Excel이 같은 순서를 쓴다) - 규칙을 바꾸면 함께 고친다.
// 설계: docs/superpowers/specs/2026-11-20-assign-mockup1-design.md D8

/**
 * 원문 순서의 카드 구성원 → 카드 안 순서. 모두가 pair_seq를 갖고 겹치지 않을 때만 그 순서이고, 아니면(바꾼 적 없음 · 새 구성원이 들었음 ·
 * 낡은 값이 겹침) 원문 순서 그대로다 - 짝이 바뀌어 남은 값이 순서를 흩뜨리지 않는다
 */
export function orderPairCard<T extends { pair_seq?: number | null }>(members: readonly T[]): T[] {
  const seqs = members.map((member) => member.pair_seq ?? null);
  if (seqs.some((seq) => seq === null) || new Set(seqs).size !== seqs.length) return [...members];
  return members.map((member, index) => ({ member, seq: seqs[index] as number })).sort((a, b) => a.seq - b.seq).map((entry) => entry.member);
}

/** 원문 순서의 줄에서 같은 짝이 끊김 없이 이어진 묶음(용지의 한 카드)만 카드 안 순서로 - 떨어진 구성원 · 짝 없는 줄은 제자리 */
export function orderPairRuns<R>(rows: readonly R[], unitOf: (row: R) => { pair_id: number | null; pair_seq?: number | null } | undefined): R[] {
  const result: R[] = [];
  let start = 0;
  while (start < rows.length) {
    const pairId = unitOf(rows[start])?.pair_id ?? null;
    let end = start + 1;
    while (pairId !== null && end < rows.length && unitOf(rows[end])?.pair_id === pairId) end += 1;
    const run = rows.slice(start, end).map((row) => ({ row, pair_seq: unitOf(row)?.pair_seq }));
    result.push(...(run.length > 1 ? orderPairCard(run) : run).map((entry) => entry.row));
    start = end;
  }
  return result;
}

/** 손잡이로 끄는 박스를 놓을 자리 - 끄는 박스를 뺀 나머지 상자들(카드 안 순서)의 가운데 y 가운데 포인터보다 위에 있는 수(0 = 맨 위) */
export function readPairSlot(mids: readonly number[], y: number): number {
  return mids.filter((mid) => mid < y).length;
}

/** 끄는 박스를 자리 slot(끄는 박스를 뺀 나머지 사이)에 놓은 새 카드 순서 */
export function movePairMember(order: readonly number[], unitId: number, slot: number): number[] {
  const others = order.filter((id) => id !== unitId);
  const at = Math.max(0, Math.min(slot, others.length));
  return [...others.slice(0, at), unitId, ...others.slice(at)];
}

export function isSameOrder(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}
