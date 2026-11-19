// AI 나누기 제안을 읽는 순수 함수 - 자를 위치와, 그 위치에서 자른 조각들(미리보기). 배정 화면의 제안 카드가 쓴다.

/** 제안의 자를 위치 - 응답 JSON이라 숫자만 골라 쓴다 */
export function readSplitOffsets(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((item): item is number => typeof item === "number") : [];
}

/** 원문을 제안 위치에서 자른 조각들(미리보기) - 글 밖의 위치는 버리고, 빈 조각은 뺀다.  */
export function cutSplitPieces(text: string, offsets: readonly number[]): string[] {
  const points = [...offsets].filter((at) => at > 0 && at < text.length).sort((a, b) => a - b);
  const pieces: string[] = [];
  let start = 0;
  for (const at of points) {
    pieces.push(text.slice(start, at));
    start = at;
  }
  pieces.push(text.slice(start));
  return pieces.map((piece) => piece.trim()).filter(Boolean);
}

/** AI가 나눌 수 있는 단위 종류 - 백엔드 `_SPLIT_UNIT_KINDS`와 같다(제목·그림·표는 문장이 아니다) */
const SPLIT_UNIT_KINDS: ReadonlySet<string> = new Set(["sentence", "cell_sentence"]);

export type SplitBlock = "notSentence" | "decided";

/** 판정에 쓰는 단위 모양 - suggestionKind는 그 단위를 채운 가장 새 적용 AI 제안의 종류(없으면 null) */
export interface SplitCandidate {
  kind: string;
  status: string;
  decision: { disposition: string };
  suggestionKind: string | null;
}

/**
 * 줄에 AI 나누기를 요청할 수 없는 까닭 - 줄의 단위 중 하나라도 받을 수 있으면 null(서버가 그것만 보낸다).
 * 서버(`app/sop/ai/split.py` `_find_skip_reason`)와 같은 판정: 문장이 아니면 못 나누고, 미배정이나 AI 분류 제안만 받는다(확정·보류·짝 맞추기 제안은 아니다).
 */
export function findSplitBlock(units: readonly SplitCandidate[]): SplitBlock | null {
  if (units.length === 0) return null;
  const sentences = units.filter((unit) => SPLIT_UNIT_KINDS.has(unit.kind));
  if (sentences.length === 0) return "notSentence";
  return sentences.some(isSplitOpen) ? null : "decided";
}

function isSplitOpen(unit: SplitCandidate): boolean {
  if (unit.status === "unassigned") return unit.decision.disposition === "unassigned";
  return unit.status === "ai_suggested" && unit.suggestionKind === "classify";
}
