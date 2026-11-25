// 번호가 새로 생긴 박스(lib/number-arrival-model) - 단위 보기가 바뀐 그 렌더에서 앞 보기와 견준다. effect · 타이머 없이
// 렌더 중 상태 맞추기로 하고, 전환 자체는 CSS 키프레임(번호 칸의 data-arrived)이 한 번 돈다.
// 저장 중인 번호는 기대 글을 얹은 보기를 견주어 누른 순간 전환이 시작한다(A2-R6) - 응답이 같은 값이면 다시 시작하지도, 중간에 끊지도 않는다.
import { useMemo, useState } from "react";

import type { ViewUnit } from "@/lib/api-sop";
import { applyExpectedNumbers, findArrivedNumbers } from "@/lib/number-arrival-model";

/** 저장을 기다리는 번호 - 단위 id → 기대 글. 얹을 것이 없으면 늘 같은 빈 값 */
export type ExpectedNumbers = ReadonlyMap<number, string | null>;

const NO_EXPECTED: ExpectedNumbers = new Map();

interface Seen {
  units: ReadonlyMap<number, ViewUnit>;
  expected: ExpectedNumbers;
  arrived: ReadonlySet<number>;
}

/** 번호 칸에 보일 단위 보기(기대 글을 얹은 것)와, 지난 보기와 견줘 번호 칸이 새로 생긴 단위 id - 다음 보기가 올 때까지 같은 집합을 돌려준다 */
export function useNumberArrival(units: ReadonlyMap<number, ViewUnit>, expected: ExpectedNumbers = NO_EXPECTED): { shown: ReadonlyMap<number, ViewUnit>; arrived: ReadonlySet<number> } {
  const shown = useMemo(() => applyExpectedNumbers(units, expected), [units, expected]);
  const [seen, setSeen] = useState<Seen>(() => ({ units: shown, expected, arrived: new Set() }));
  if (seen.units === shown) return { shown, arrived: seen.arrived };
  // 기대 글로 시작한 전환은 그 글이 남아 있는 동안(응답의 보기로 바뀐 때까지) 이어 간다
  const kept = [...seen.arrived].filter((id) => seen.expected.has(id) && (shown.get(id)?.number?.value ?? null) !== null);
  const arrived = new Set([...findArrivedNumbers(seen.units, shown), ...kept]);
  setSeen({ units: shown, expected, arrived });
  return { shown, arrived };
}
