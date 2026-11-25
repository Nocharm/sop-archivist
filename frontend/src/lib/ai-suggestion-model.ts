// Assign의 AI 추천 - 살아 있는 제안(적용됐고 사람이 아직 받거나 버리지 않은 것)에서 줄의 추천 자리와 Use 초안을 만든다.
// AI는 판단·New 문장을 쓰지 않는다 - 사람이 Use로 받으면 이 초안이 채워지고 확정은 사람의 Confirm이다(설계 2026-11-19-ai-suggest-only D1·D2).

import type { AiSuggestion } from "./api-sop";
import { getDestinationId, type Destination, type DestinationOption, type SentenceSlot } from "./classify-model";

/** 새 문서를 만드는 쪽과 함께 숨긴 AI 종류(쪼개기 먼저 설계 §5 H4) - 이미 있는 제안도 화면 어디에도 내지 않는다. 행은 바꾸지 않는다 */
export const HIDDEN_AI_KINDS: ReadonlySet<string> = new Set(["classify", "split", "translate", "tobe_list"]);

/** 화면에 낼 제안 - 숨긴 동안 숨긴 종류를 뺀다. 켰으면 받은 목록 그대로 */
export function dropHiddenSuggestions<T extends { kind: string }>(items: readonly T[], drafting: boolean): readonly T[] {
  return drafting ? items : items.filter((item) => !HIDDEN_AI_KINDS.has(item.kind));
}

/** 더보기의 AI 요청 가운데 숨긴 종류를 부르는 것 - 문서 칸 추천, 번역 둘, 나누기 둘 */
const HIDDEN_AI_ITEMS: ReadonlySet<string> = new Set(["document", "to-en", "to-ko", "split", "split-document"]);

export function filterAiItems<T extends { key: string }>(items: readonly T[], drafting: boolean): readonly T[] {
  return drafting ? items : items.filter((item) => !HIDDEN_AI_ITEMS.has(item.key));
}

/** 사람이 아직 받거나 버리지 않은 적용된 제안 */
export function isLiveSuggestion(suggestion: AiSuggestion): boolean {
  return suggestion.result === "applied" && suggestion.adoption === null;
}

/** 단위 → 그 단위를 덮는 가장 새 살아 있는 제안(분류·묶기 섞어) */
export function indexLiveSuggestions(items: readonly AiSuggestion[]): Map<number, AiSuggestion> {
  const index = new Map<number, AiSuggestion>();
  for (const item of items) {
    if (!isLiveSuggestion(item)) continue;
    for (const unitId of item.content.unit_ids ?? []) if ((index.get(unitId)?.id ?? 0) < item.id) index.set(unitId, item);
  }
  return index;
}

/** 줄의 추천 - 줄 단위를 덮는 가장 새 살아 있는 제안. 받을 수 있는 것은 미배정 줄뿐이다 */
export function findRowSuggestion(unitIds: readonly number[], status: string, index: ReadonlyMap<number, AiSuggestion>): AiSuggestion | null {
  if (status !== "unassigned") return null;
  let found: AiSuggestion | null = null;
  for (const unitId of unitIds) {
    const item = index.get(unitId);
    if (item && (found === null || found.id < item.id)) found = item;
  }
  return found;
}

const BUNDLE_SHAPES = ["table", "figure"];

function readIds(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((id): id is number => typeof id === "number") : [];
}

/** 제안의 보낼 곳 - 분류는 처분·자리, 묶기는 이미 쓴 문장에 잇기(삭제 후보는 삭제). 받을 자리가 없으면 null */
export function readSuggestedDestination(suggestion: AiSuggestion): Destination | null {
  const content = suggestion.content;
  if (suggestion.kind === "match") {
    if (content.shape === "delete_candidate") return { kind: "delete" };
    const targetIds = readIds(content.target_ids);
    // 표·그림은 첫 새 문장이 묶음이고 칸·캡션은 그 아래라 잇는 것은 묶음 하나다(서버 adoption._list_matched_targets와 같다)
    const linked = typeof content.shape === "string" && BUNDLE_SHAPES.includes(content.shape) ? targetIds.slice(0, 1) : targetIds;
    return linked.length > 0 && readIds(content.unit_ids).length > 0 ? { kind: "link", targetIds: linked } : null;
  }
  if (content.disposition === "delete") return { kind: "delete" };
  if (content.disposition !== "assigned" || typeof content.target_doc_id !== "number") return null;
  if (typeof content.wi_part === "string") return { kind: "step", docId: content.target_doc_id, step: content.wi_step ?? null, part: content.wi_part as Extract<Destination, { kind: "step" }>["part"] };
  return typeof content.slot_key === "string" ? { kind: "slot", docId: content.target_doc_id, slotKey: content.slot_key } : null;
}

/**
 * Old 줄 아래 AI 간 곳 글의 자리 이름 - 보낼 곳 메뉴의 "문서 칸", 삭제는 "delete".
 * 잇기 제안은 null - 줄 끝 연결 배지가 AI 점선으로 이미 말한다. 이름을 못 읽어도(지운 To-Be 칸 등) null - 그 줄은 간 곳 글 없이 그린다
 */
export function readSuggestionPlace(suggestion: AiSuggestion, options: readonly Pick<DestinationOption, "id" | "docCode" | "label">[]): string | "delete" | null {
  const destination = readSuggestedDestination(suggestion);
  if (destination === null || destination.kind === "link") return null;
  if (destination.kind === "delete") return "delete";
  const option = options.find((item) => item.id === getDestinationId(destination));
  return option ? `${option.docCode} ${option.label}` : null;
}

/** 분류가 고쳐 쓴 글 - 언어마다 문장 목록 */
export function readRewrites(suggestion: AiSuggestion): Record<string, string[]> {
  const raw = suggestion.content.rewrites;
  if (!raw || typeof raw !== "object") return {};
  return Object.fromEntries(Object.entries(raw as Record<string, unknown>).map(([lang, list]) => [lang, Array.isArray(list) ? list.filter((text): text is string => typeof text === "string") : []]));
}

export interface UseDraft {
  /** 문장 칸 키 → 고쳐 쓴 글 */
  texts: Record<string, string>;
  /** 고쳐 쓴 글을 칸에 채우지 못한 언어 - AI가 나누거나 합쳐 문장 수가 칸 수와 다르다. 카드에 글을 보여 사람이 옮긴다 */
  unfilledLangs: string[];
}

/**
 * Use로 채울 초안 - 분류는 언어마다 고쳐 쓴 문장이 그 언어 칸(원문 단위마다 하나) 수와 같을 때 차례로 채운다.
 * 원문과 같은 글은 채우지 않는다(비우면 원문 그대로). 변경 종류는 서버가 글로 정한다 - 묶기(match)는 고쳐 쓴 글이 없어 채울 것이 없다.
 */
export function buildUseDraft(suggestion: AiSuggestion, slots: readonly SentenceSlot[]): UseDraft {
  const draft: UseDraft = { texts: {}, unfilledLangs: [] };
  for (const [lang, sentences] of Object.entries(readRewrites(suggestion))) {
    if (sentences.length === 0) continue;
    const langSlots = slots.filter((slot) => slot.lang === lang && slot.target === null && !slot.isTranslated);
    if (langSlots.length !== sentences.length) {
      draft.unfilledLangs.push(lang);
      continue;
    }
    langSlots.forEach((slot, index) => {
      const text = sentences[index];
      if (text === slot.sourceText) return;
      draft.texts[slot.key] = text;
    });
  }
  return draft;
}
