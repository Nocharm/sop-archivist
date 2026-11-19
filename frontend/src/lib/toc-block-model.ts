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

/** 블록의 줄 나눔 - 결정 칸 다듬기 줄 "(한글 4 · 영어 3 · 그 뒤 1)". 언어가 같은 줄 덩어리 앞 둘은 그 언어로, 나머지는 "그 뒤"로 센다 */
export type TocPart = { part: "ko" | "en" | "after"; n: number };

export function describeTocParts(langs: readonly string[]): TocPart[] {
  const runs: Array<{ lang: string; n: number }> = [];
  for (const lang of langs) {
    const last = runs[runs.length - 1];
    // 중립·참조 줄은 바로 앞 덩어리에 붙는다
    if (last && (last.lang === lang || !SPLIT_LANGS.has(lang))) last.n += 1;
    else runs.push({ lang: SPLIT_LANGS.has(lang) ? lang : "ko", n: 1 });
  }
  const parts: TocPart[] = runs.slice(0, 2).map((run) => ({ part: run.lang === "en" ? "en" : "ko", n: run.n }));
  const after = runs.slice(2).reduce((sum, run) => sum + run.n, 0);
  return after > 0 ? [...parts, { part: "after", n: after }] : parts;
}

/** 문서 하나의 목차 블록 - 용지 순(pos_seq, 첫 범위 시작)으로 이어진 목차 줄 덩어리. 사이에 다른 단위(표·칸 문장 포함)가 끼면 끊긴다.
 *  키는 첫 줄 단위 id - Paper가 같은 블록에 붙이는 키와 같다 */
export function listTocBlocks(units: ReadonlyArray<Pick<ViewUnit, "id" | "kind" | "spans" | "pos_seq" | "noise_kind">>): Array<{ key: number; unitIds: number[] }> {
  const order = [...units]
    .filter((unit) => unit.kind !== "table_row" || unit.spans.length > 0)
    .sort((a, b) => a.pos_seq - b.pos_seq || (a.spans[0]?.[1] ?? 0) - (b.spans[0]?.[1] ?? 0) || a.id - b.id);
  const blocks: Array<{ key: number; unitIds: number[] }> = [];
  let current: number[] | null = null;
  for (const unit of order) {
    if (unit.noise_kind == null) {
      current = null;
      continue;
    }
    if (current === null) {
      current = [];
      blocks.push({ key: unit.id, unitIds: current });
    }
    current.push(unit.id);
  }
  return blocks;
}

const TOC_NAV_PREFIX = "toc:";

/** 줄 목록(↑↓·J/K)에 끼우는 목차 블록 자리 키 - 배정 줄 키(`u<id>`)와 겹치지 않는다. 남은 수·필터 수에는 들지 않는다 */
export function toTocNavKey(blockKey: number): string {
  return `${TOC_NAV_PREFIX}${blockKey}`;
}

export function readTocNavKey(navKey: string): number | null {
  return navKey.startsWith(TOC_NAV_PREFIX) ? Number(navKey.slice(TOC_NAV_PREFIX.length)) : null;
}

/** 줄 이동 순서 - 배정 줄과 목차 블록을 문서 순 → 원문 순으로 섞는다. position은 단위 id → [문서 순번, pos_seq, 시작] */
export function buildNavKeys(
  rows: ReadonlyArray<{ key: string; unitIds: readonly number[] }>,
  blocks: ReadonlyArray<{ key: number }>,
  position: ReadonlyMap<number, readonly [number, number, number]>,
): string[] {
  const far = [Number.MAX_SAFE_INTEGER, 0, 0] as const;
  const entries = [
    ...rows.map((row) => ({ key: row.key, at: position.get(row.unitIds[0]) ?? far })),
    ...blocks.map((block) => ({ key: toTocNavKey(block.key), at: position.get(block.key) ?? far })),
  ];
  // 같은 자리면 원래 순서(줄 먼저) - sort는 안정적이다
  entries.sort((a, b) => a.at[0] - b.at[0] || a.at[1] - b.at[1] || a.at[2] - b.at[2]);
  return entries.map((entry) => entry.key);
}

/** 펼친 블록 열고 닫기 - 같은 키를 다시 누르면 접는다 */
export function toggleTocOpen(open: ReadonlySet<number>, key: number): Set<number> {
  const next = new Set(open);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}
