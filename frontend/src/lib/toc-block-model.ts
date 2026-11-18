// 목차 블록 모델 - 잡음 표시(noise_kind "toc")가 붙은 줄이 연달아 오면 Assign 용지에서 흐린 블록 하나로 접는다(MD 1 F6).
// 목차 줄은 배정 줄이 아니다(classify-model isNoiseUnit) - 블록은 줄 수와 언어별 수, 한/영 사이 점선 자리만 계산한다.

import type { ViewUnit } from "./api-sop";

export interface TocLine {
  unitId: number;
  text: string;
  /** 바로 앞 줄과 언어가 갈려(한글 목차 → 영어 목차) 그 사이에 점선을 둔다 */
  breakBefore: boolean;
}

export interface TocBlock {
  /** 블록을 가리키는 값 - 첫 줄의 단위 id(펼침 상태·testid) */
  key: number;
  unitIds: number[];
  lines: TocLine[];
  counts: { total: number; ko: number; en: number };
}

/** 한/영 사이에만 점선 - 중립·참조 줄은 언어가 바뀐 것으로 치지 않는다 */
const SPLIT_LANGS = new Set(["ko", "en"]);

/** 연달아 오는 목차 줄(원문 순) → 블록 하나. 빈 목록은 null */
export function buildTocBlock(units: ReadonlyArray<Pick<ViewUnit, "id" | "lang" | "text">>): TocBlock | null {
  if (units.length === 0) return null;
  let previousLang: string | null = null;
  const lines = units.map((unit) => {
    const isSplit = SPLIT_LANGS.has(unit.lang);
    const breakBefore = isSplit && previousLang !== null && previousLang !== unit.lang;
    if (isSplit) previousLang = unit.lang;
    return { unitId: unit.id, text: unit.text, breakBefore };
  });
  return {
    key: units[0].id,
    unitIds: units.map((unit) => unit.id),
    lines,
    counts: {
      total: units.length,
      ko: units.filter((unit) => unit.lang === "ko").length,
      en: units.filter((unit) => unit.lang === "en").length,
    },
  };
}

/** 줄 묶기 - 목차 줄이 바로 앞 칸도 목차 줄이면 같은 블록에 잇는다(짝 카드와 같은 자리에서 판단) */
export function shouldJoinTocCard(previousIsToc: boolean, isToc: boolean): boolean {
  return previousIsToc && isToc;
}

/** 펼친 블록 열고 닫기 - 같은 키를 다시 누르면 접는다 */
export function toggleTocOpen(open: ReadonlySet<number>, key: number): Set<number> {
  const next = new Set(open);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}
