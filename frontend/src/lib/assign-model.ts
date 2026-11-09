// Assign 화면 모델 - Old 조각 한 줄씩 보낼 곳을 정한다(설계 docs/superpowers/specs/2026-11-09-assign-unified-design.md).
// 저장 요청은 classify-model의 buildGroupSave(보낼 곳 link 포함)가 만들고, 여기는 묶음 합치기·함께 확정·짝 자동·추천 섞기·범위 규칙이다.

import type { Destination, DestinationOption } from "./classify-model";
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

/** 한 언어 문장을 고르면 그 New 짝 문장도 - 줄에 그 언어 Old 조각이 있을 때만(없으면 붙일 출처가 없다) */
export function addPartnerTargets(picked: number[], rowLangs: UnitLang[], written: Map<number, WrittenSentence>): number[] {
  const result = [...picked];
  for (const id of picked) {
    const partner = written.get(written.get(id)?.partner_target_id ?? -1);
    if (partner && rowLangs.includes(partner.lang) && !result.includes(partner.target_id)) result.push(partner.target_id);
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
  if (destination.kind === "step") return `step:${destination.docId}:${destination.step ?? "none"}:${destination.part}`;
  return destination.kind;
}

/** ① 추천 - AI 연결 → AI 칸·삭제 → 같은 글자 → 비슷한 문장, 같은 곳은 한 번만, 최대 5 */
export function buildRecommendations(input: RecommendInput): Recommendation[] {
  const all: Recommendation[] = [
    ...input.aiLinks.map((item): Omit<Recommendation, "key"> => ({ destination: { kind: "link", targetIds: item.targetIds }, why: item.why, source: "ai" })),
    ...input.aiPlaces.map((item): Omit<Recommendation, "key"> => ({ destination: item.destination, why: item.why, source: "ai" })),
    ...input.identical.map((id): Omit<Recommendation, "key"> => ({ destination: { kind: "link", targetIds: [id] }, why: "", source: "identical" })),
    ...input.similar.map((item): Omit<Recommendation, "key"> => ({ destination: { kind: "link", targetIds: [item.target_id] }, why: "", source: "similar" })),
  ].map((rec) => ({ ...rec, key: keyOf(rec.destination) }));
  const seen = new Set<string>();
  return all.filter((rec) => !seen.has(rec.key) && seen.add(rec.key)).slice(0, MAX_RECOMMENDATIONS);
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
