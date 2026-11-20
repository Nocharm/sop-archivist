// 번호가 새로 생긴 박스 고르기 - 합치기 · 표 벗기기 같은 편집 응답 뒤, 글 앞 번호가 번호 칸으로 빠지는 짧은 전환(항목 6-b)을 걸 박스.
// 편집은 단위를 은퇴시키고 새로 만들어 id가 바뀌므로, 같은 id 또는 같은 첫 자리(블록 · 시작)의 앞 단위에 번호가 없었는지로 본다.
import type { ViewUnit } from "@/lib/api-sop";

const EMPTY: ReadonlySet<number> = new Set();

function getPlaceKey(unit: Pick<ViewUnit, "spans">): string | null {
  const first = unit.spans[0];
  return first ? `${first[0]}:${first[1]}` : null;
}

function hasNumber(unit: Pick<ViewUnit, "number">): boolean {
  return (unit.number?.value ?? null) !== null;
}

/** 앞 보기 → 다음 보기에서 번호 칸 값이 없다가 생긴 단위 id - 앞 보기가 없거나(처음 그림) 겹치는 자리가 없으면(다른 문서) 빈 집합 */
export function findArrivedNumbers(
  prev: ReadonlyMap<number, Pick<ViewUnit, "id" | "spans" | "number">> | null,
  next: ReadonlyMap<number, Pick<ViewUnit, "id" | "spans" | "number">>,
): ReadonlySet<number> {
  if (prev === null || prev === next) return EMPTY;
  const hadNumberAt = new Map<string, boolean>();
  for (const unit of prev.values()) {
    const key = getPlaceKey(unit);
    if (key !== null) hadNumberAt.set(key, hasNumber(unit));
  }
  const arrived = new Set<number>();
  for (const unit of next.values()) {
    if (!hasNumber(unit)) continue;
    const before = prev.get(unit.id);
    const key = getPlaceKey(unit);
    const hadNumber = before !== undefined ? hasNumber(before) : key === null ? undefined : hadNumberAt.get(key);
    if (hadNumber === false) arrived.add(unit.id);
  }
  return arrived.size === 0 ? EMPTY : arrived;
}
