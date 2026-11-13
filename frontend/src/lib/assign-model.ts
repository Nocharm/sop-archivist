// Assign 화면 모델 - Old 조각 한 줄씩 보낼 곳을 정한다(설계 docs/superpowers/specs/2026-11-09-assign-unified-design.md).
// 저장 요청은 classify-model의 buildGroupSave(보낼 곳 link 포함)가 만들고, 여기는 묶음 합치기·함께 확정·짝 자동·추천 섞기·범위 규칙이다.

import { getDestinationId, type Destination, type DestinationOption } from "./classify-model";
import type { Group, NewCandidate, UnitLang, WrittenSentence } from "./api-sop";

/** 연결 저장 전에 줄 묶음과 고른 문장들의 묶음을 하나로 - 서버는 닫힌 묶음 전체를 받아야 저장한다 */
export function mergeGroups(groups: Group[]): Group {
  const units = new Map<number, Group["units"][number]>();
  const targets = new Map<number, Group["targets"][number]>();
  for (const group of groups) {
    for (const unit of group.units) if (!units.has(unit.unit_id)) units.set(unit.unit_id, unit);
    for (const target of group.targets) if (!targets.has(target.id)) targets.set(target.id, target);
  }
  return { units: [...units.values()], targets: [...targets.values()] };
}

export interface CoConfirmed {
  kind: "unit" | "target";
  id: number;
  label: string;
}

/** 확정 한 번이 함께 확정하는 것 - 줄 밖 단위와 고르지 않은 문장 중 아직 확정되지 않은 것(사람이 보고 누르게 보여 준다) */
export function listCoConfirmed(group: Group, rowUnitIds: number[], picked: number[]): CoConfirmed[] {
  const units = group.units
    .filter((unit) => !rowUnitIds.includes(unit.unit_id) && unit.decision.status !== "confirmed")
    .map((unit): CoConfirmed => ({ kind: "unit", id: unit.unit_id, label: unit.display_id }));
  const targets = group.targets
    .filter((target) => target.parent_target_id === null && !picked.includes(target.id) && target.status !== "confirmed")
    .map((target): CoConfirmed => ({ kind: "target", id: target.id, label: target.confirmed_text || target.ai_text }));
  return [...units, ...targets];
}

/** 한 언어 문장을 고르면 그 New 짝 문장도 늘 함께 - 줄에 그 언어 Old 조각이 없으면 줄의 조각이 출처가 되어 번역이 된다(설계 §5.2) */
export function addPartnerTargets(picked: number[], written: Map<number, WrittenSentence>): number[] {
  const result = [...picked];
  for (const id of picked) {
    const partner = written.get(written.get(id)?.partner_target_id ?? -1);
    if (partner && !result.includes(partner.target_id)) result.push(partner.target_id);
  }
  return result;
}

export interface Recommendation {
  key: string;
  destination: Destination;
  why: string;
  /** ai = AI 제안, identical = 글자가 같은 문장, similar = 비슷한 문장(유사도는 확률로 보이지 않는다) */
  source: "ai" | "identical" | "similar";
}

export interface RecommendInput {
  aiLinks: Array<{ targetIds: number[]; why: string }>;
  aiPlaces: Array<{ destination: Destination; why: string }>;
  identical: number[];
  similar: NewCandidate[];
}

const MAX_RECOMMENDATIONS = 5;

function keyOf(destination: Destination): string {
  if (destination.kind === "link") return `link:${[...destination.targetIds].sort((a, b) => a - b).join(",")}`;
  if (destination.kind === "slot") return `slot:${destination.docId}:${destination.slotKey}`;
  if (destination.kind === "slot_heading") return `heading:${destination.docId}:${destination.slotKey}`;
  if (destination.kind === "step") return `step:${destination.docId}:${destination.step ?? "none"}:${destination.part}`;
  return destination.kind;
}

/**
 * ① 추천 - AI 연결 → AI 칸·삭제 → 같은 글자 → 비슷한 문장, 같은 곳은 한 번만, 최대 5.
 * expandLink는 고를 때 더해질 문장(New 짝, addPartnerTargets)을 미리 더한다 - 짝의 두 문장이 카드 둘로 갈리지 않게.
 */
export function buildRecommendations(input: RecommendInput, expandLink: (targetIds: number[]) => number[] = (ids) => ids): Recommendation[] {
  const link = (targetIds: number[]): Destination => ({ kind: "link", targetIds: expandLink(targetIds) });
  const all: Recommendation[] = [
    ...input.aiLinks.map((item): Omit<Recommendation, "key"> => ({ destination: link(item.targetIds), why: item.why, source: "ai" })),
    ...input.aiPlaces.map((item): Omit<Recommendation, "key"> => ({ destination: item.destination, why: item.why, source: "ai" })),
    ...input.identical.map((id): Omit<Recommendation, "key"> => ({ destination: link([id]), why: "", source: "identical" })),
    ...input.similar.map((item): Omit<Recommendation, "key"> => ({ destination: link([item.target_id]), why: "", source: "similar" })),
  ].map((rec) => ({ ...rec, key: keyOf(rec.destination) }));
  const seen = new Set<string>();
  return all.filter((rec) => !seen.has(rec.key) && seen.add(rec.key)).slice(0, MAX_RECOMMENDATIONS);
}

/**
 * 추천 카드가 지금 고른 곳인가 - 문장 추천은 고를 때 New 짝 문장이 더해지므로(addPartnerTargets) 짝까지 넣은 묶음과 견준다.
 * 추천의 ID만 견주면 New 짝이 있는 문장에서 고른 표시가 영영 켜지지 않는다.
 */
export function isRecommendationPicked(draft: Destination | null, rec: Destination, written: Map<number, WrittenSentence>): boolean {
  if (draft === null) return false;
  if (rec.kind !== "link" || draft.kind !== "link") return getDestinationId(draft) === getDestinationId(rec);
  const expected = new Set(addPartnerTargets(rec.targetIds, written));
  return draft.targetIds.length === expected.size && draft.targetIds.every((id) => expected.has(id));
}

/** Old 조각 하나와 New 문장 하나의 이음 - draft는 고르기만 하고 아직 저장하지 않은 것 */
export interface LinkPair {
  unitId: number;
  targetId: number;
  draft: boolean;
  /** AI가 이어 두고 아직 확정하지 않은 이음 - 선을 AI 색(보라)으로 그린다 */
  ai: boolean;
}

/**
 * 두 문서 사이에 그릴 이음 - 지금 열린 New 문서의 문장 출처 중 지금 열린 Old 문서의 조각만, 그리고 고른 줄의 아직 저장 안 한 고름.
 * 고름은 같은 언어 Old 조각과 잇고, 줄에 그 언어 조각이 없으면 줄의 조각 모두와 잇는다(저장도 그 조각들이 출처인 번역이다, 설계 §5.2).
 */
export function buildLinkPairs(
  newRows: WrittenSentence[],
  oldUnitIds: ReadonlySet<number>,
  draft: { units: Array<{ id: number; lang: UnitLang }>; targetIds: number[] } | null,
): LinkPair[] {
  const pairs: LinkPair[] = [];
  const seen = new Set<string>();
  for (const row of newRows) {
    for (const unitId of row.source_unit_ids) {
      if (!oldUnitIds.has(unitId)) continue;
      seen.add(`${unitId}:${row.target_id}`);
      pairs.push({ unitId, targetId: row.target_id, draft: false, ai: row.status === "ai_suggested" });
    }
  }
  if (!draft) return pairs;
  const langOf = new Map(newRows.map((row) => [row.target_id, row.lang]));
  for (const targetId of draft.targetIds) {
    const lang = langOf.get(targetId);
    if (lang === undefined) continue;
    const same = draft.units.filter((unit) => unit.lang === lang);
    for (const unit of same.length > 0 ? same : draft.units) {
      if (!oldUnitIds.has(unit.id) || seen.has(`${unit.id}:${targetId}`)) continue;
      pairs.push({ unitId: unit.id, targetId, draft: true, ai: false });
    }
  }
  return pairs;
}

/** 마우스를 올린 쪽의 맞은편 - Old 조각이면 이어진 New 문장들, New 문장이면 출처 Old 조각들 */
export function findLinkPartners(pairs: LinkPair[], side: "old" | "new", id: number): number[] {
  const result = pairs.filter((pair) => (side === "old" ? pair.unitId : pair.targetId) === id).map((pair) => (side === "old" ? pair.targetId : pair.unitId));
  return [...new Set(result)];
}

/** 이음이 이보다 많으면 고르거나 마우스를 올린 것만 그린다 - 선이 화면을 덮고 매 스크롤마다 잴 것이 많아진다 */
export const MAX_LINES_ALL = 40;

/** 그릴 선 - 고른 줄·고른 문장·마우스를 올린 것에 닿는 선은 진하게, 많을 때는 그것만 */
export function pickDrawnLinks(pairs: LinkPair[], focusUnits: ReadonlySet<number>, focusTargets: ReadonlySet<number>, max = MAX_LINES_ALL): Array<LinkPair & { strong: boolean }> {
  const marked = pairs.map((pair) => ({ ...pair, strong: pair.draft || focusUnits.has(pair.unitId) || focusTargets.has(pair.targetId) }));
  return marked.length > max ? marked.filter((pair) => pair.strong) : marked;
}

export type LinkMenuItem = "confirm" | "cancel" | "link" | "unlink" | "close";

/**
 * 그 자리 메뉴의 항목 - 고른 뒤(저장 전)는 확정·취소, 이미 이어진 것은 끊기(AI가 이어 둔 것은 확정도), 그 밖의 후보 문장은 잇기.
 * 고칠 수 없는 묶음이거나, 고름이 없고 가리키는 문장도 없으면(추천에서 연 메뉴가 저장된 뒤) 메뉴를 띄우지 않는다 - 누를 수 없는 Link를 보이지 않게.
 */
export function listLinkMenuItems(state: { picked: boolean; linked: boolean; confirmed: boolean; hasTarget: boolean; canEdit: boolean }): LinkMenuItem[] {
  if (!state.canEdit) return [];
  if (state.picked) return ["confirm", "cancel"];
  if (state.linked) return state.confirmed ? ["unlink", "close"] : ["confirm", "unlink", "close"];
  return state.hasTarget ? ["link", "close"] : [];
}

/** 끊은 뒤 남는 고름 - 끊는 문장과 그 한/영 짝 문장을 함께 뺀다(짝 한쪽만 남기면 다음 고름이 짝을 다시 붙인다) */
export function listUnlinkRemainder(targetIds: number[], targetId: number, written: Map<number, WrittenSentence>): number[] {
  const partner = written.get(targetId)?.partner_target_id ?? null;
  return targetIds.filter((id) => id !== targetId && id !== partner);
}

/** 출처가 없고 신규로도 표시하지 않은 New 문장 - 검토 요청을 막는다. 표·그림은 이번 화면에서 잇지 않는다(설계 §2) */
export function listUnsourced(rows: WrittenSentence[]): WrittenSentence[] {
  return rows.filter((row) => row.kind === "sentence" && row.source_unit_ids.length === 0 && row.change_type !== "new");
}

const ZOOM_MIN = 0.7;
const ZOOM_MAX = 1.6;
const SPLIT_MIN = 0.3;
const SPLIT_MAX = 0.7;

/** 문서별 확대 - 70~160%, 10% 단위 */
export function clampZoom(zoom: number): number {
  return Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom)) * 10) / 10;
}

export function stepZoom(zoom: number, dir: "+" | "-" | "0"): number {
  if (dir === "0") return 1;
  return clampZoom(zoom + (dir === "+" ? 0.1 : -0.1));
}

/** 두 문서 폭 - 왼쪽(Old) 비율 30~70% */
export function clampSplit(ratio: number): number {
  return Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, ratio));
}

/** ② 가까운 곳 - 고른 문장 앞뒤의 문장(같은 New 문서, 표·그림 제외) */
export function pickNearby(rows: WrittenSentence[], targetIds: number[], span = 1): WrittenSentence[] {
  const anchor = rows.find((row) => targetIds.includes(row.target_id));
  if (!anchor) return [];
  const doc = rows.filter((row) => row.target_doc_id === anchor.target_doc_id && row.kind === "sentence");
  const positions = doc.map((row, index) => (targetIds.includes(row.target_id) ? index : -1)).filter((index) => index >= 0);
  const from = Math.min(...positions) - span;
  const to = Math.max(...positions) + span;
  return doc.filter((row, index) => index >= from && index <= to && !targetIds.includes(row.target_id));
}

/** ② 가까운 곳 - 같은 To-Be 문서의 다른 칸·단계(N/A도 보이되 고를 수 없다) */
export function listSiblingPlaces(options: DestinationOption[], destination: Destination, limit = 4): DestinationOption[] {
  if (destination.kind !== "slot" && destination.kind !== "step") return [];
  const own = keyOf(destination);
  return options.filter((option) => (option.destination.kind === "slot" || option.destination.kind === "step") && option.destination.docId === destination.docId && keyOf(option.destination) !== own).slice(0, limit);
}

/** "영어 만들기"·"한국어 만들기" - 한 언어만 있는 줄을 아직 안 쓴 문서의 칸에 확정한 뒤, 없는 언어 */
export function canMakeOtherLanguage(rowLangs: UnitLang[], destination: Destination | null, confirmed: boolean): "ko" | "en" | null {
  if (!confirmed || !destination || (destination.kind !== "slot" && destination.kind !== "step")) return null;
  const langs = new Set(rowLangs.filter((lang) => lang !== "neutral"));
  if (langs.size !== 1) return null;
  return langs.has("ko") ? "en" : "ko";
}
