// 떨어진 짝 괄호선(11-23 명세 E1) - 고른 박스와 그 떨어진 짝이 모두 칸 화면 안이면 앞머리(.strip-lead) 왼쪽에 세로선 하나, 끝마다 짧은 가로 눈금.
// 하나라도 화면 밖이면 그리지 않고 안내 줄이 그대로 남는다(E1-R2). 화면은 모른다 - 괄호선 층(pair-bracket.tsx)이 잰 상자를 넘긴다.

/** 짝 구성원 하나의 앞머리 상자(client 좌표) - 첫 글줄 y는 top + min(height / 2, 13)(pair-lines와 같은 값) */
export interface BracketEnd {
  unitId: number;
  top: number;
  left: number;
  height: number;
}

// 첫 글줄 가운데쯤(px) - pair-lines.tsx FIRST_LINE_Y와 같다
const FIRST_LINE_Y = 13;
// 세로선이 앞머리에서 떨어지는 거리 · 칸 왼쪽 끝에서 띄우는 거리 · 눈금 길이(px)
const GAP_LEFT = 10;
const PANE_INSET = 2;
const TICK = 6;

/**
 * 괄호선 경로(틀 base 좌표)와 이은 구성원(고른 박스 먼저). mates에 null(화면 밖 · 그려지지 않음)이 하나라도 있거나,
 * 끝의 첫 글줄이 칸(frame) 밖이거나, 짝이 없으면 null
 */
export function resolvePairBracket(
  picked: BracketEnd | null,
  mates: readonly (BracketEnd | null)[],
  frame: { top: number; bottom: number; left: number },
  base: { left: number; top: number },
): { d: string; unitIds: number[] } | null {
  if (picked === null || mates.length === 0 || mates.some((mate) => mate === null)) return null;
  const ends = [picked, ...(mates as readonly BracketEnd[])];
  const lines = ends.map((item) => item.top + Math.min(item.height / 2, FIRST_LINE_Y));
  if (lines.some((y) => y < frame.top || y > frame.bottom)) return null;
  const x = Math.round(Math.max(Math.min(...ends.map((item) => item.left)) - GAP_LEFT, frame.left + PANE_INSET) - base.left);
  const ys = lines.map((y) => Math.round(y - base.top)).sort((a, b) => a - b);
  const first = ys[0];
  const last = ys[ys.length - 1];
  const middles = ys.slice(1, -1).map((y) => `M${x} ${y}H${x + TICK}`);
  return { d: [`M${x + TICK} ${first}H${x}V${last}H${x + TICK}`, ...middles].join(""), unitIds: ends.map((item) => item.unitId) };
}

/** 고른 박스의 짝 구성원(자신 빼고, 원문 순서) - 짝이 없으면 빈 목록. 같은 카드 안 구성원을 빼는 것은 괄호선 층이 화면에서 한다 */
export function listPairMates(units: ReadonlyMap<number, { id: number; pair_id: number | null; pos_seq: number }>, unitId: number | null): number[] {
  const pairId = unitId === null ? null : (units.get(unitId)?.pair_id ?? null);
  if (pairId === null) return [];
  return [...units.values()].filter((unit) => unit.pair_id === pairId && unit.id !== unitId).sort((a, b) => a.pos_seq - b.pos_seq).map((unit) => unit.id);
}
