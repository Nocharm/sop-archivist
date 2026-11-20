// 번호가 새로 생긴 박스(lib/number-arrival-model) - 단위 보기가 바뀐 그 렌더에서 앞 보기와 견준다. effect · 타이머 없이
// 렌더 중 상태 맞추기로 하고, 전환 자체는 CSS 키프레임(번호 칸의 data-arrived)이 한 번 돈다.
import { useState } from "react";

import type { ViewUnit } from "@/lib/api-sop";
import { findArrivedNumbers } from "@/lib/number-arrival-model";

interface Seen {
  units: ReadonlyMap<number, ViewUnit>;
  arrived: ReadonlySet<number>;
}

/** 지난 보기와 견줘 번호 칸이 새로 생긴 단위 id - 다음 보기가 올 때까지 같은 집합을 돌려준다 */
export function useNumberArrival(units: ReadonlyMap<number, ViewUnit>): ReadonlySet<number> {
  const [seen, setSeen] = useState<Seen>(() => ({ units, arrived: new Set() }));
  if (seen.units === units) return seen.arrived;
  const arrived = findArrivedNumbers(seen.units, units);
  setSeen({ units, arrived });
  return arrived;
}
