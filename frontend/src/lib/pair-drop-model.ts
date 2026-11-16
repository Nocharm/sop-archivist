/** 놓아서 짝 맺기의 판단과 Pair view의 두 칸(KO | EN) 나누기 - 화면 없는 순수 모델 */
import type { ViewPair, ViewUnit } from "./api-sop";

export type PairLang = "ko" | "en";
export type PairUnit = Pick<ViewUnit, "id" | "display_id" | "kind" | "lang" | "text" | "group_unit_id" | "pos_seq" | "spans" | "status" | "ref">;
export type PairPiece = Pick<PairUnit, "id" | "kind" | "lang" | "group_unit_id">;
export type PairInfo = Pick<ViewPair, "id" | "status" | "unit_ids">;

export interface PairDropContext {
  /** 그 Unit이 든 짝(제안·확정) - 없으면 undefined */
  pairOf: (unitId: number) => PairInfo | undefined;
  /** 지금 짝 메뉴가 쓰는 것과 같은 함수 - page.tsx의 isUnitDecided·hasUnitDraft */
  isDecided: (unit: PairPiece) => boolean;
  hasDraft: (unit: PairPiece) => boolean;
}

export type PairRefusal = "ref_line" | "no_language" | "same_lang" | "paired" | "suggested_pair" | "assigned" | "other_assigned" | "unsaved" | "other_unsaved";

/** 모두 이미 있는 문구다 - 새 문구를 만들지 않는다 */
export const PAIR_REFUSAL_KEYS: Record<PairRefusal, string> = {
  ref_line: "assign.ctx.why.refLang",
  no_language: "split.menu.why.noLanguage",
  same_lang: "assign.pairPickSameLang",
  paired: "rule.unit_already_paired",
  suggested_pair: "split.menu.why.alreadyPaired",
  assigned: "assign.ctx.why.assigned",
  other_assigned: "assign.ctx.why.neighborAssigned",
  unsaved: "assign.ctx.why.unsaved",
  other_unsaved: "assign.ctx.why.neighborUnsaved",
};

export type PairDrop =
  | { kind: "pair"; unitIds: [number, number] } // [끄는 Unit, 놓는 Unit] - POST …/pairs
  | { kind: "confirm"; pairId: number } // POST …/pairs/{id}/confirm
  | { kind: "refused"; reason: PairRefusal }
  | { kind: "none" };

const TEXT_KINDS = new Set<PairPiece["kind"]>(["sentence", "heading", "cell_sentence"]);

function isPairLang(lang: PairPiece["lang"]): lang is PairLang {
  return lang === "ko" || lang === "en";
}

function refuse(reason: PairRefusal): PairDrop {
  return { kind: "refused", reason };
}

function checkLanguage(unit: PairPiece): PairDrop | null {
  if (unit.lang === "ref") return refuse("ref_line");
  return isPairLang(unit.lang) ? null : refuse("no_language");
}

/** sources는 끄는 것의 Unit(Pair view는 하나, 가까운 줄은 그 줄 전부), target은 포인터 밑 조각의 Unit */
export function resolvePairDrop(sources: readonly PairPiece[], target: PairPiece | undefined, ctx: PairDropContext): PairDrop {
  if (!target || sources.length === 0) return { kind: "none" };
  if (sources.some((unit) => unit.id === target.id)) return { kind: "none" };
  if (!TEXT_KINDS.has(target.kind) || target.group_unit_id !== null) return { kind: "none" };
  if (sources.some((unit) => !TEXT_KINDS.has(unit.kind))) return { kind: "none" };

  const dragged = sources[0];
  const draggedPair = ctx.pairOf(dragged.id);
  if (sources.length > 1 && draggedPair) return refuse(draggedPair.status === "confirmed" ? "paired" : "suggested_pair");

  const languageRefusal = checkLanguage(dragged) ?? checkLanguage(target);
  if (languageRefusal) return languageRefusal;
  if (dragged.lang === target.lang) return refuse("same_lang");

  const targetPair = ctx.pairOf(target.id);
  if (draggedPair?.status === "confirmed" || targetPair?.status === "confirmed") return refuse("paired");
  if ((draggedPair || targetPair) && draggedPair?.id !== targetPair?.id) return refuse("suggested_pair");

  if (ctx.isDecided(dragged)) return refuse("assigned");
  if (ctx.isDecided(target)) return refuse("other_assigned");
  if (ctx.hasDraft(dragged)) return refuse("unsaved");
  if (ctx.hasDraft(target)) return refuse("other_unsaved");

  if (draggedPair && draggedPair.id === targetPair?.id) return { kind: "confirm", pairId: draggedPair.id };
  return { kind: "pair", unitIds: [dragged.id, target.id] };
}

export interface PairColumnItem {
  unit: PairUnit;
  /** 끌고 놓을 수 있는 조각(언어가 ko·en인 글 Unit) - 아니면 흐리게 남는 줄 */
  isPiece: boolean;
  /** 든 짝과 그 짝의 다른 Unit(원문 순) - 없으면 null */
  pair: { id: number; status: ViewPair["status"]; mateIds: number[] } | null;
}
export interface PairColumns {
  ko: PairColumnItem[];
  en: PairColumnItem[];
}

/** classify-model buildRows와 같은 원문 순서 */
function compareSourceOrder(a: PairUnit, b: PairUnit): number {
  return a.pos_seq - b.pos_seq || (a.spans[0]?.[1] ?? 0) - (b.spans[0]?.[1] ?? 0) || a.id - b.id;
}

/** 언어가 없는 Unit은 원문 순으로 바로 앞 ko·en Unit의 칸에 선다 - 앞이 없으면 뒤, 아무 언어도 없으면 KO */
export function buildPairColumns(view: { units: readonly PairUnit[]; pairs: readonly PairInfo[] }): PairColumns {
  const ordered = view.units.filter((unit) => unit.group_unit_id === null).sort(compareSourceOrder);
  const rank = new Map(ordered.map((unit, index) => [unit.id, index]));
  const pairByUnit = new Map<number, PairInfo>();
  for (const pair of view.pairs) for (const unitId of pair.unit_ids) pairByUnit.set(unitId, pair);

  const firstLang = ordered.find((unit) => isPairLang(unit.lang))?.lang;
  let column: PairLang = firstLang === "en" ? "en" : "ko";
  const columns: PairColumns = { ko: [], en: [] };
  for (const unit of ordered) {
    if (isPairLang(unit.lang)) column = unit.lang;
    const pair = pairByUnit.get(unit.id);
    const mateIds = pair ? pair.unit_ids.filter((id) => id !== unit.id).sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0)) : [];
    columns[column].push({
      unit,
      isPiece: TEXT_KINDS.has(unit.kind) && isPairLang(unit.lang),
      pair: pair ? { id: pair.id, status: pair.status, mateIds } : null,
    });
  }
  return columns;
}

export interface PairLink {
  pairId: number;
  koId: number;
  enId: number;
  status: ViewPair["status"];
}

/** 짝마다 KO 구성원 × EN 구성원 - koId, enId 순 */
export function listPairLinks(columns: PairColumns): PairLink[] {
  const enByPair = new Map<number, number[]>();
  for (const item of columns.en) {
    if (item.pair && item.isPiece) enByPair.set(item.pair.id, [...(enByPair.get(item.pair.id) ?? []), item.unit.id]);
  }
  const links: PairLink[] = [];
  for (const item of columns.ko) {
    if (!item.pair || !item.isPiece) continue;
    for (const enId of enByPair.get(item.pair.id) ?? []) links.push({ pairId: item.pair.id, koId: item.unit.id, enId, status: item.pair.status });
  }
  return links.sort((a, b) => a.koId - b.koId || a.enId - b.enId);
}

/** 알림의 Undo가 그 짝을 풀어도 되나 - 같은 Unit들로 확정된 채 남아 있고 구성 Unit에 판단이 없을 때만 */
export function canUndoPair(view: { units: readonly Pick<PairUnit, "id" | "status">[]; pairs: readonly PairInfo[] }, pairId: number, unitIds: readonly number[]): boolean {
  const pair = view.pairs.find((candidate) => candidate.id === pairId);
  if (!pair || pair.status !== "confirmed") return false;
  if (pair.unit_ids.length !== unitIds.length || !unitIds.every((id) => pair.unit_ids.includes(id))) return false;
  return pair.unit_ids.every((id) => {
    const status = view.units.find((unit) => unit.id === id)?.status;
    return status === null || status === undefined || status === "unassigned";
  });
}
