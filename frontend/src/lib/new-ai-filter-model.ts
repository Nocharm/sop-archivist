// Assign New 칸의 "고른 줄의 AI 제안만" 거르기 - 칩을 켜고 Old 줄을 고르면 New 칸에 그 줄의 AI 제안과 그 줄이 간 곳만 밝게 남긴다.
// 다른 줄의 AI 제안은 그 자리에서 접어 칸마다 띠 하나로 모으고, 이미 확정된 줄(출처 없는 줄 포함)은 자리를 가늠하도록 흐리게 둔다.
// 칩이 꺼져 있거나 고른 줄이 없으면 거르지 않는다(null). 결정 칸·추천 카드·저장은 이 거르기와 상관없다.
import { getNewRowKey, readSectionNumber, type NewPaneRow } from "@/lib/composed-model";

/**
 * 거르는 동안 New 줄의 표시 - mine_ai: 고른 줄의 AI 제안, mine_went: 고른 줄이 이미 간 곳(확정),
 * other_ai: 다른 줄의 AI 제안(접는다), dim: 그 밖의 줄(흐리게)
 */
export type NewAiMark = "mine_ai" | "mine_went" | "other_ai" | "dim";

/** 칸 하나의 접힌 띠 - count는 접힌 AI 제안 New 문장 수(한/영 줄은 따로 센다) */
export interface NewAiBand {
  sectionKey: string;
  count: number;
}

export interface NewAiFilter {
  /** 고른 줄의 Unit - 고른 줄이 바뀌면 펼쳐 둔 띠를 다시 접는 기준 */
  key: string;
  /** 줄 키(getNewRowKey) → 표시. 빈 칸 자리는 들어 있지 않다(그대로 둔다) */
  marks: ReadonlyMap<string, NewAiMark>;
  /** 칸에서 처음 접힌 줄의 키 → 그 칸의 띠(띠는 그 줄 자리에 그린다) */
  bands: ReadonlyMap<string, NewAiBand>;
}

/** 띠·펼침을 가르는 칸 키 - 칸 번호, 번호 없는 칸은 머리 글(칸 제목 출처 표시와 같은 기준) */
export function readNewAiSectionKey(sectionPath: string): string {
  return readSectionNumber(sectionPath) || sectionPath || "top";
}

/**
 * New 칸 줄마다의 표시와 칸마다의 접힌 띠 - 칩이 꺼져 있거나 고른 줄이 없으면 null(거르지 않는다).
 * suggested는 살아 있는 묶기 제안이 잇자고 한 새 문장 → 그 제안의 Old 단위 - AI는 새 문장을 쓰지 않으니 제안에서 읽는다(설계 2026-11-19-ai-suggest-only)
 */
export function buildNewAiFilter(isOn: boolean, pickedUnitIds: readonly number[] | null, rows: readonly NewPaneRow[], suggested: ReadonlyMap<number, readonly number[]> = new Map()): NewAiFilter | null {
  if (!isOn || pickedUnitIds === null || pickedUnitIds.length === 0) return null;
  const picked = new Set(pickedUnitIds);
  const marks = new Map<string, NewAiMark>();
  const bands = new Map<string, NewAiBand>();
  const bandOf = new Map<string, NewAiBand>();
  for (const row of rows) {
    if (row.kind === "empty") continue;
    const key = getNewRowKey(row);
    const suggestedUnits = "target_id" in row ? (suggested.get(row.target_id) ?? []) : [];
    const isAi = row.status === "ai_suggested" || suggestedUnits.length > 0;
    if ([...row.source_unit_ids, ...suggestedUnits].some((id) => picked.has(id))) {
      marks.set(key, isAi ? "mine_ai" : "mine_went");
      continue;
    }
    if (!isAi) {
      marks.set(key, "dim");
      continue;
    }
    marks.set(key, "other_ai");
    const sectionKey = readNewAiSectionKey(row.section_path);
    let band = bandOf.get(sectionKey);
    if (!band) {
      band = { sectionKey, count: 0 };
      bandOf.set(sectionKey, band);
      bands.set(key, band);
    }
    band.count += 1;
  }
  return { key: pickedUnitIds.join(","), marks, bands };
}

/** 거르는 동안 그릴 이음 - 고른 줄의 것만(저장 전 고름도 고른 줄의 것이다). 거르지 않으면 그대로 */
export function listNewAiLinks<T extends { unitId: number }>(pairs: T[], filter: NewAiFilter | null, pickedUnitIds: readonly number[]): T[] {
  if (filter === null) return pairs;
  const picked = new Set(pickedUnitIds);
  return pairs.filter((pair) => picked.has(pair.unitId));
}

/** 칸 머리 아래 알약 - open: 고른 줄의 AI 제안이 있는 다른 New 문서를 연다, back: 열기 전 문서로 돌아간다 */
export interface NewAiPill {
  kind: "open" | "back";
  docId: number;
}

/**
 * 고른 줄의 AI 제안이 다른 New 문서에 있을 때의 알약 - New 칸은 저절로 문서를 바꾸지 않는다.
 * suggestionDocId는 고른 줄의 확정 전 AI 제안이 있는 문서(없으면 null), returnDocId는 알약으로 열기 전에 보던 문서
 */
export function readNewAiPill(input: { isOn: boolean; suggestionDocId: number | null; openDocId: number | null; returnDocId: number | null }): NewAiPill | null {
  const { isOn, suggestionDocId, openDocId, returnDocId } = input;
  if (!isOn || suggestionDocId === null || openDocId === null) return null;
  if (openDocId !== suggestionDocId) return { kind: "open", docId: suggestionDocId };
  return returnDocId !== null && returnDocId !== openDocId ? { kind: "back", docId: returnDocId } : null;
}
