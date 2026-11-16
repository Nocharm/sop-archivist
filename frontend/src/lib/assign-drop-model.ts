// Assign 화면에서 Old 조각을 New 문장으로 끄는 순수 모델 - 끌 수 있는 때, 표 한 장, 놓을 수 있는 곳, 놓았을 때 클릭과 같은 판단을 정한다.
// 설계: docs/superpowers/specs/2026-11-16-drag-and-drop-design.md §6
import type { DragCard } from "./box-drag";
import type { ComposedSection, WiPart } from "./api-sop";
import type { Destination, DestinationOption, SentenceSlot } from "./classify-model";

export interface OldDragGate {
  canEdit: boolean;
  mode: "old" | "unsourced";
  isPairPicking: boolean;
  isSolo: boolean;
}

/** Old 조각을 끌 수 있나 - 꺼지면 조각에 data-drag-box도 달지 않아 글자가 지금처럼 긁힌다 */
export function canDragOld(gate: OldDragGate): boolean {
  return gate.canEdit && gate.mode === "old" && !gate.isPairPicking && !gate.isSolo;
}

export interface DragUnit {
  display_id: string;
  text: string;
}

/** 표 한 장 - 줄 첫 Unit의 ID와 글, Unit이 둘 이상이면 countLabel(개수). 긴 문단이 한 줄로 남게 공백을 접는다 */
export function buildOldDragCard(units: readonly DragUnit[], countLabel: (count: number) => string): DragCard {
  if (units.length === 0) return { id: "", text: "", count: null };
  return {
    id: units[0].display_id,
    text: units[0].text.replace(/\s+/g, " ").trim(),
    count: units.length > 1 ? countLabel(units.length) : null,
  };
}

/** 포인터 밑에서 읽은 것 - isReadOnly는 New 칸의 data-read-only, hasPickButton은 줄 안에 button.new-hit이 있나 */
export interface NewHit {
  targetId: number;
  isReadOnly: boolean;
  hasPickButton: boolean;
}

export type AssignDrop = { kind: "link"; targetId: number } | { kind: "none" };

/** 이번 걸음에서 놓이는 곳은 이미 쓴 문서의 고를 수 있는 문장 줄뿐 */
export function findAssignDrop(hit: NewHit | null): AssignDrop {
  if (hit === null || hit.isReadOnly || !hit.hasPickButton) return { kind: "none" };
  return { kind: "link", targetId: hit.targetId };
}

/** pick은 그 문장을 고르고, menu_only는 고름을 두고 끊기 메뉴만 연다 */
export type DropLinkAction = "pick" | "menu_only";

/** 놓았을 때 할 일 - handleNewPick의 Old 줄 갈래(초안 없음 + 이미 그 문장에 확정해 이음)와 같은 판단 */
export function resolveDropLink(input: { draftDestination: Destination | null; savedDestination: Destination | null; targetId: number }): DropLinkAction {
  const { draftDestination, savedDestination, targetId } = input;
  if (draftDestination === null && savedDestination?.kind === "link" && savedDestination.targetIds.includes(targetId)) return "menu_only";
  return "pick";
}

/** 엮은 문서의 한 줄 - groupKey는 첫 출처 Unit이 든 Old 줄(같으면 한 의미 묶음), 출처가 없으면 null */
export interface DropItem {
  targetId: number;
  groupKey: string | null;
  sourceUnitIds: readonly number[];
}

/** 엮은 문서의 한 칸 - key는 ComposedSection.location_key */
export interface DropSection {
  key: string;
  isNa: boolean;
  items: DropItem[];
}

export function buildDropSections(sections: readonly Pick<ComposedSection, "location_key" | "na_reason" | "items">[], rowKeyOf: (unitId: number) => string | undefined): DropSection[] {
  return sections.map((section) => ({
    key: section.location_key,
    isNa: section.na_reason !== null,
    items: section.items.map((item) => ({
      targetId: item.target_id,
      groupKey: item.source_unit_ids.length > 0 ? (rowKeyOf(item.source_unit_ids[0]) ?? null) : null,
      sourceUnitIds: item.source_unit_ids,
    })),
  }));
}

export interface DropBlock {
  firstId: number;
  lastId: number;
}

/** hoverId가 든 의미 묶음 - groupKey(null 아님)가 같은 이웃 줄들. 그 칸에 없으면 null. 화면이 이 상자의 중간선을 잰다 */
export function findDropBlock(section: DropSection, hoverId: number): DropBlock | null {
  const at = section.items.findIndex((item) => item.targetId === hoverId);
  if (at < 0) return null;
  const key = section.items[at].groupKey;
  let first = at;
  let last = at;
  if (key !== null) {
    while (first > 0 && section.items[first - 1].groupKey === key) first -= 1;
    while (last < section.items.length - 1 && section.items[last + 1].groupKey === key) last += 1;
  }
  return { firstId: section.items[first].targetId, lastId: section.items[last].targetId };
}

export type SendRefusal = "na_slot" | "written_doc" | "same_slot";

/** 거절 문구 키 - na_slot·written_doc은 서버 거절과 같은 문구를 쓴다 */
export const REFUSAL_KEYS: Record<SendRefusal, string> = {
  na_slot: "rule.invalid_group.na_slot",
  written_doc: "rule.invalid_group.match_doc_new_target",
  same_slot: "assign.drag.sameSlot",
};

export type SendDrop =
  | { kind: "gap"; sectionKey: string; after: number | null; edge: { targetId: number; side: "top" | "bottom" } }
  | { kind: "slot"; sectionKey: string }
  | { kind: "refused"; reason: SendRefusal }
  | { kind: "none" };

/** 엮은 문서의 줄 위 - isUpperHalf는 그 줄이 든 묶음 상자의 위 절반인가. dragUnitIds는 끄는 줄의 Unit */
export function resolveGapDrop(section: DropSection, hoverId: number, isUpperHalf: boolean, dragUnitIds: readonly number[]): SendDrop {
  const block = findDropBlock(section, hoverId);
  if (block === null) return { kind: "none" };
  if (section.isNa) return { kind: "refused", reason: "na_slot" };
  const drag = new Set(dragUnitIds);
  if (section.items.some((item) => item.sourceUnitIds.some((id) => drag.has(id)))) return { kind: "refused", reason: "same_slot" };
  if (!isUpperHalf) return { kind: "gap", sectionKey: section.key, after: block.lastId, edge: { targetId: block.lastId, side: "bottom" } };
  const before = section.items.findIndex((item) => item.targetId === block.firstId) - 1;
  return { kind: "gap", sectionKey: section.key, after: before >= 0 ? section.items[before].targetId : null, edge: { targetId: block.firstId, side: "top" } };
}

/** 엮은 문서의 빈 칸 */
export function resolveSlotDrop(section: Pick<DropSection, "key" | "isNa">): SendDrop {
  return section.isNa ? { kind: "refused", reason: "na_slot" } : { kind: "slot", sectionKey: section.key };
}

export type TreeDrop = { kind: "place"; destination: Destination } | { kind: "refused"; reason: "na_slot" } | { kind: "none" };

/** 옆 패널 나무의 줄 - 클릭이 받는 그대로(disabled = N/A). 칸·step만 */
export function resolveTreeDrop(option: Pick<DestinationOption, "destination" | "disabled"> | undefined): TreeDrop {
  if (!option || (option.destination.kind !== "slot" && option.destination.kind !== "step")) return { kind: "none" };
  return option.disabled ? { kind: "refused", reason: "na_slot" } : { kind: "place", destination: option.destination };
}

function isWiPart(value: string): value is WiPart {
  return value === "instruction" || value === "why";
}

/** 엮은 문서의 칸 키(서버 _plan_sections의 키)가 가리키는 보낼 곳 - 모르는 모양(path:)은 null */
export function readSectionDestination(docId: number, sectionKey: string): Destination | null {
  if (!sectionKey.includes(":")) return { kind: "slot", docId, slotKey: sectionKey };
  const [head, ...rest] = sectionKey.split(":");
  if (head === "unstepped" && rest.length === 1 && isWiPart(rest[0])) return { kind: "step", docId, step: null, part: rest[0] };
  if (head === "step" && rest.length === 2 && /^\d+$/.test(rest[0]) && isWiPart(rest[1])) return { kind: "step", docId, step: Number(rest[0]), part: rest[1] };
  return null;
}

/** 보낼 곳이 가리키는 엮은 문서의 칸 키 - 칸·step이 아니면 null */
export function getSectionKey(destination: Destination | null): string | null {
  if (destination?.kind === "slot") return destination.slotKey;
  if (destination?.kind === "step") return destination.step === null ? `unstepped:${destination.part}` : `step:${destination.step}:${destination.part}`;
  return null;
}

/** 초안의 자리가 아직 그 칸에 있나 - 맨 앞(after null)은 칸이 있으면 참 */
export function isPositionLive(sections: readonly DropSection[], sectionKey: string, after: number | null): boolean {
  const section = sections.find((candidate) => candidate.key === sectionKey);
  if (!section) return false;
  return after === null || section.items.some((item) => item.targetId === after);
}

export interface DraftLine {
  key: string;
  lang: SentenceSlot["lang"];
  text: string;
}

/** 점선 초안의 줄 - 서버가 끼울 순서(영어 먼저, 번역 칸은 같은 출처 칸 바로 뒤). texts는 사람이 고친 글(칸 key별) */
export function listDraftLines(slots: readonly Pick<SentenceSlot, "key" | "lang" | "text" | "sourceIds" | "isTranslated">[], texts: Readonly<Record<string, string>>): DraftLine[] {
  const own = slots.filter((slot) => !slot.isTranslated);
  const ordered = [...own.filter((slot) => slot.lang === "en"), ...own.filter((slot) => slot.lang !== "en")];
  for (const slot of slots.filter((candidate) => candidate.isTranslated)) {
    if (!(texts[slot.key] ?? slot.text).trim()) continue;
    // 출처 없는 번역 칸은 출처 없는 다른 줄 뒤가 아니라 끝으로 간다
    const at = slot.sourceIds.length === 0 ? -1 : ordered.map((line) => line.sourceIds[0]).lastIndexOf(slot.sourceIds[0]);
    ordered.splice(at < 0 ? ordered.length : at + 1, 0, slot);
  }
  return ordered.map((slot) => ({ key: slot.key, lang: slot.lang, text: texts[slot.key] ?? slot.text }));
}
