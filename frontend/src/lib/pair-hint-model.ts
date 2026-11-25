// 떨어진 짝 안내 줄 - 고른 박스 바로 아래 "↑ 짝 KO · 위 §1". 짝은 위로 모아 보이지 않고 제자리에 두니, 어디에 있는지만 알린다
// (설계 2026-11-20-assign-mockup1 D3, docs/architecture/decisions.md). 화면은 모른다 - 용지(Paper)가 자리 · 카드 · 이름을 넘긴다.

/** 짝 구성원 하나 - 용지가 넘긴다 */
export interface PairHintUnit {
  id: number;
  lang: string;
  /** 용지 순서 자리 - 작을수록 위 */
  at: number;
  /** 이어 붙은 짝 카드의 첫 줄 id - 카드가 아니면 null. 같은 카드 안의 구성원은 바로 곁이라 안내하지 않는다 */
  card: number | null;
  /** 자리 이름 - 번호 칸 값(§1), 없으면 표시 ID */
  label: string;
}

export interface PairHint {
  dir: "up" | "down";
  /** 짝의 언어(KO · EN) */
  lang: string;
  where: string;
  /** 누르면 고르고 스크롤할 짝 */
  targetUnitId: number;
  /** 안내하지 못한 나머지 떨어진 구성원 수(+n) */
  more: number;
}

/** 고른 박스의 떨어진 짝 중 가장 가까운 하나 - 같은 거리면 위. 떨어진 구성원이 없으면 null */
export function getPairHint(selected: PairHintUnit, mates: readonly PairHintUnit[]): PairHint | null {
  const far = mates.filter((mate) => mate.id !== selected.id && !(selected.card !== null && mate.card === selected.card));
  if (far.length === 0) return null;
  const distance = (mate: PairHintUnit) => Math.abs(mate.at - selected.at);
  const nearest = far.reduce((best, mate) => (distance(mate) < distance(best) || (distance(mate) === distance(best) && mate.at < best.at) ? mate : best));
  return {
    dir: nearest.at < selected.at ? "up" : "down",
    lang: nearest.lang.toUpperCase(),
    where: nearest.label,
    targetUnitId: nearest.id,
    more: far.length - 1,
  };
}

/**
 * 짝으로 가기(글쇠 G)의 자리 - 떨어진 짝이 있으면 안내 줄과 같은 박스, 이어 붙은 짝뿐이면 곁의 박스. order는 용지 차례.
 * 카드는 차례가 끊김 없이 이어진 구성원으로 본다
 */
export function findPairTarget(selectedId: number, members: readonly { id: number; lang: string }[], order: readonly number[]): number | null {
  const at = new Map(order.map((id, index) => [id, index]));
  const placed = members.flatMap((unit) => (at.has(unit.id) ? [{ id: unit.id, lang: unit.lang, at: at.get(unit.id)!, card: null as number | null, label: "" }] : [])).sort((a, b) => a.at - b.at);
  placed.forEach((unit, index) => {
    const above = placed[index - 1];
    unit.card = above !== undefined && above.at === unit.at - 1 ? above.card : unit.id;
  });
  const own = placed.find((unit) => unit.id === selectedId);
  const mates = placed.filter((unit) => unit.id !== selectedId);
  if (!own || mates.length === 0) return null;
  return (getPairHint(own, mates) ?? getPairHint({ ...own, card: null }, mates))?.targetUnitId ?? null;
}
