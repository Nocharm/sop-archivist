// 분류(입구 1) 모델 - 목록 한 줄은 한/영 짝 하나, 짝 없는 단위는 혼자 한 줄(디자인 문서 16절). 보낼 곳 목록과 저장 요청을 만드는 순수 함수.

import type {
  ChangeType,
  ChangeTypeInput,
  CoverStatus,
  Decision,
  DocumentView,
  Group,
  GroupSaveInput,
  GroupTarget,
  NaSlot,
  TargetDoc,
  TargetInput,
  ToBe,
  UnitRow,
  ViewUnit,
  WiPart,
  WiStep,
} from "./api-sop";
import { SLOT_KEYS } from "./api-sop";

export interface ClassifyRow {
  key: string;
  documentId: number;
  /** 원문 순서 - 한국어가 앞 */
  unitIds: number[];
  status: CoverStatus;
  pairStatus: "suggested" | "confirmed" | null;
  /** 줄이 한/영 짝이면 그 짝 - 한 언어만 이으면 화면이 이 짝을 푼다 */
  pairId: number | null;
}

// 덜 끝난 쪽이 줄 상태다 - 앞일수록 덜 끝났다
const STATUS_RANK: Record<CoverStatus, number> = { unassigned: 0, ai_suggested: 1, on_hold: 2, confirmed: 3 };

export function pickRowStatus(statuses: CoverStatus[]): CoverStatus {
  return statuses.reduce<CoverStatus>((worst, status) => (STATUS_RANK[status] < STATUS_RANK[worst] ? status : worst), "confirmed");
}

/** 판단을 받는 단위 - 데이터 표에 묶인 칸 문장은 표·행 단위를 따르므로 따로 줄이 없다(레이아웃 표의 칸 문장은 묶이지 않아 줄이 있다) */
export function isCoverUnit(unit: Pick<ViewUnit, "group_unit_id">): boolean {
  return unit.group_unit_id === null;
}

/** 문서 보기들(짝·원문 순서)과 단위 목록(상태)으로 줄을 만든다. 문서 순서 → 원문 순서 */
export function buildRows(views: DocumentView[], unitRows: Map<number, UnitRow>): ClassifyRow[] {
  const rows: ClassifyRow[] = [];
  for (const view of views) {
    const order = [...view.units]
      .filter(isCoverUnit)
      .sort((a, b) => a.pos_seq - b.pos_seq || (a.spans[0]?.[1] ?? 0) - (b.spans[0]?.[1] ?? 0));
    const pairOf = new Map<number, (typeof view.pairs)[number]>();
    for (const pair of view.pairs) for (const id of pair.unit_ids) pairOf.set(id, pair);
    const seen = new Set<number>();
    for (const unit of order) {
      if (seen.has(unit.id) || !unitRows.has(unit.id)) continue;
      const pair = pairOf.get(unit.id);
      const ids = (pair ? pair.unit_ids : [unit.id]).filter((id) => unitRows.has(id) && !seen.has(id));
      for (const id of ids) seen.add(id);
      rows.push({
        key: `u${ids[0]}`,
        documentId: view.document.id,
        unitIds: ids,
        status: pickRowStatus(ids.map((id) => unitRows.get(id)?.status ?? "unassigned")),
        pairStatus: pair?.status ?? null,
        pairId: pair?.id ?? null,
      });
    }
  }
  return rows;
}

/** 짝을 풀면 줄 하나가 단위마다 한 줄이 된다 - 그 줄들의 키(buildRows가 단위 하나짜리 줄에 붙이는 키와 같다) */
export function listUnpairedKeys(row: ClassifyRow): string[] {
  return row.unitIds.map((id) => `u${id}`);
}

/**
 * 옛 문서 보기들을 불러오는 키 - 문서 목록을 받기 전(null)과 받은 뒤(빈 목록 포함)가 달라야 불러오기가 돈다.
 * 같으면 준비된 옛 문서가 없는 묶음이 스켈레톤에 머문다.
 */
export function buildViewsKey(oldDocIds: number[] | null): string {
  return oldDocIds === null ? "" : `docs:${oldDocIds.join(",")}`;
}

// --- 보낼 곳 ---

export type Destination =
  | { kind: "slot"; docId: number; slotKey: string }
  /** 옛 제목을 새 SOP 칸의 칸 제목으로 - 글은 칸 이름이라 고르지 않는다 */
  | { kind: "slot_heading"; docId: number; slotKey: string }
  /** step이 null이면 단계 없는 자리(단계를 선언하지 않은 WI) */
  | { kind: "step"; docId: number; step: number | null; part: WiPart }
  /** 이미 쓴 문서(입구 2)의 문장에 출처로 잇기 - 여럿이면 나눔 */
  | { kind: "link"; targetIds: number[] }
  | { kind: "delete" }
  | { kind: "move" };

export interface DestinationOption {
  id: string;
  destination: Destination;
  docCode: string;
  label: string;
  /** N/A 칸 - 보이지만 고를 수 없다 */
  disabled: boolean;
  depth: 0 | 1;
}

export function getDestinationId(destination: Destination): string {
  switch (destination.kind) {
    case "slot":
      return `slot:${destination.docId}:${destination.slotKey}`;
    case "slot_heading":
      return `heading:${destination.docId}:${destination.slotKey}`;
    case "step":
      return `step:${destination.docId}:${destination.step ?? "none"}:${destination.part}`;
    case "link":
      return `link:${[...destination.targetIds].sort((a, b) => a - b).join(",")}`;
    default:
      return destination.kind;
  }
}

/** To-Be 목록 → 메뉴 항목. SOP는 칸, WI는 단계마다 Instruction·Why(단계가 없으면 단계 없는 Instruction·Why). 입구 2 문서는 이 화면의 보낼 곳이 아니다 */
export function buildDestinationOptions(tobe: ToBe, slotLabels: Record<string, string>): DestinationOption[] {
  const options: DestinationOption[] = [];
  const isNa = (doc: TargetDoc, slotKey: string) =>
    tobe.na_slots.some((slot: NaSlot) => slot.code === doc.code && (slot.slot_key === slotKey || slotKey.startsWith(`${slot.slot_key}.`)));
  for (const doc of [...tobe.docs].sort((a, b) => a.order_index - b.order_index || a.id - b.id)) {
    if (doc.entrance !== "assign") continue;
    if (doc.doc_type === "sop") {
      for (const slotKey of SLOT_KEYS) {
        // N/A가 아닌 칸마다 칸 줄 바로 앞에 칸 제목 자리를 둔다
        if (!isNa(doc, slotKey)) {
          const heading: Destination = { kind: "slot_heading", docId: doc.id, slotKey };
          options.push({ id: getDestinationId(heading), destination: heading, docCode: doc.code, label: slotLabels[slotKey] ?? slotKey, disabled: false, depth: slotKey.includes(".") ? 1 : 0 });
        }
        const destination: Destination = { kind: "slot", docId: doc.id, slotKey };
        options.push({
          id: getDestinationId(destination),
          destination,
          docCode: doc.code,
          label: slotLabels[slotKey] ?? slotKey,
          disabled: isNa(doc, slotKey),
          depth: slotKey.includes(".") ? 1 : 0,
        });
      }
    } else {
      const steps = tobe.wi_steps.filter((step: WiStep) => step.code === doc.code).sort((a, b) => a.step_no - b.step_no);
      // 단계를 아직 적지 않은 WI도 보낼 곳이다 - 서버·AI 후보가 단계 없는 자리를 받는다(결과물 C의 unstepped)
      const places = steps.length > 0 ? steps.map((step) => ({ step: step.step_no, prefix: `${step.step_no} ${step.title} · ` })) : [{ step: null, prefix: "" }];
      for (const { step, prefix } of places) {
        for (const part of ["instruction", "why"] as const) {
          const destination: Destination = { kind: "step", docId: doc.id, step, part };
          options.push({
            id: getDestinationId(destination),
            destination,
            docCode: doc.code,
            label: `${prefix}${part === "instruction" ? "Instruction" : "Why"}`,
            disabled: false,
            depth: 0,
          });
        }
      }
    }
  }
  return options;
}

/** 세는 보낼 곳인가 - 칸 제목 항목은 칸 줄에 딸린 것이라 개수에 넣지 않는다 */
export function isPlaceOption(option: Pick<DestinationOption, "destination">): boolean {
  return option.destination.kind !== "slot_heading";
}

/** 저장된 판단·새 문장에서 지금 보낼 곳을 읽는다. 여러 곳이면 첫 새 문장 기준 */
export function readDestination(group: Group | null, unitIds: number[]): Destination | null {
  if (!group) return null;
  const units = group.units.filter((unit) => unitIds.includes(unit.unit_id));
  if (units.some((unit) => unit.decision.disposition === "delete")) return { kind: "delete" };
  if (units.some((unit) => unit.decision.disposition === "move_external")) return { kind: "move" };
  // 이미 쓴 문서의 문장에 이어져 있으면 그것이 보낼 곳이다(칸 새 문장이 함께 남아 있어도)
  const linked = group.targets.filter((item) => item.origin === "new_doc" && item.parent_target_id === null && item.source_unit_ids.some((id) => unitIds.includes(id)));
  if (linked.length > 0) return { kind: "link", targetIds: linked.map((item) => item.id) };
  const heading = group.targets.find((item) => item.kind === "slot_heading" && item.slot_key !== null && item.source_unit_ids.some((id) => unitIds.includes(id)));
  if (heading && heading.slot_key !== null) return { kind: "slot_heading", docId: heading.target_doc_id, slotKey: heading.slot_key };
  const target = group.targets.find((item) => item.parent_target_id === null && item.origin === "units" && item.source_unit_ids.some((id) => unitIds.includes(id)));
  if (!target) return null;
  if (target.wi_part !== null) return { kind: "step", docId: target.target_doc_id, step: target.wi_step, part: target.wi_part };
  if (target.slot_key !== null) return { kind: "slot", docId: target.target_doc_id, slotKey: target.slot_key };
  return null;
}

// --- 저장 요청 ---

/** 표 새 문장이 되는 단위 - 쪼개기의 "행으로 나누기"가 만든 행 단위도 한 행짜리 표다 */
const TABLE_KINDS: readonly string[] = ["table", "table_row"];
const SYSTEM_PREFIX = "system:";

export interface RowDraft {
  destination: Destination | null;
  /** 새 문장 칸(SentenceSlot.key)별로 사람이 고친 글자 - 고치지 않은 칸은 없다. 비우면 원문 그대로 */
  texts: Record<string, string>;
  changeTypes: Record<string, "tone" | "rewritten">;
  /** 이은 문장(target id)별 변경 종류 - null은 AI 제안 그대로 받기, 없으면 지금 사람 값 또는 고쳐 씀 */
  linkChangeTypes?: Record<number, ChangeTypeInput | null>;
  /** 사람이 직접 쓰는 다른 언어 문장 칸 - 한 언어만 있는 줄에서 연다(buildSentenceSlots의 extra) */
  otherLang?: OtherLangSlot | null;
  reason: string;
  moveCode: string;
}

/** 손으로 쓰는 다른 언어 문장 - 그 언어와 출처로 삼을 줄 단위 */
export interface OtherLangSlot {
  lang: "ko" | "en";
  unitId: number;
}

/** 저장 전 변경이 있는 초안인가 - 고른 곳·고친 글·변경 종류·사유·이동 코드 중 하나라도 손댔으면 참(편집 칸만 열어 둔 것은 변경이 아니다) */
export function hasDraftChange(draft: Pick<RowDraft, "destination" | "texts" | "changeTypes" | "linkChangeTypes"> & { reason: string | null; moveCode: string | null }): boolean {
  if (draft.destination !== null || draft.reason !== null || draft.moveCode !== null) return true;
  return [draft.texts, draft.changeTypes, draft.linkChangeTypes ?? {}].some((map) => Object.keys(map).length > 0);
}

interface SourceUnit {
  id: number;
  kind: string;
  lang: ViewUnit["lang"];
  text: string;
  revision: number;
}

export interface CellSource {
  id: number;
  lang: ViewUnit["lang"];
  text: string;
  row: number;
  col: number;
}

export interface SaveContext {
  units: SourceUnit[];
  group: Group | null;
  /** 표 단위 id → 칸 문장과 표 크기 */
  tables: Map<number, { rows: number; cols: number; cells: CellSource[] }>;
}

/**
 * 잇기에서 이번 저장의 줄 단위 - 이은 문장의 언어인 단위. 그런 단위가 없으면(한 언어 줄을 다른 언어 문장에만 이음) 줄의 단위 모두가
 * 출처라 번역이 된다(설계 §5.2). 나머지는 이은 문장이 없는 언어의 짝 단위다.
 */
export function pickLinkUnits<T extends { lang: ViewUnit["lang"] }>(units: T[], pickedLangs: ReadonlySet<string>): T[] {
  const same = units.filter((unit) => pickedLangs.has(unit.lang));
  return same.length > 0 ? same : units;
}

/**
 * 이미 쓴 문장을 한 언어만 이을 때 줄에 남는 단위 - 이은 문장이 없는 언어이고 아직 판단이 없는(처분 unassigned) 줄 단위.
 * 확정 저장은 판단 없는 단위를 받지 않아(서버 hold_required) 요청에서 빼고 release_unit_ids로 실어 서버가 같은 저장 안에서 짝을 푼다(설계 §5.2).
 */
export function listLinkLeftovers(destination: Destination | null, context: Pick<SaveContext, "units" | "group">): number[] {
  if (destination?.kind !== "link") return [];
  const picked = new Set(destination.targetIds);
  const pickedLangs = new Set((context.group?.targets ?? []).filter((target) => picked.has(target.id)).map((target) => target.lang));
  // 고른 문장의 묶음이 아직 오지 않았으면 어느 언어가 남는지 모른다
  if (pickedLangs.size === 0) return [];
  const linked = new Set(pickLinkUnits(context.units, pickedLangs).map((unit) => unit.id));
  const undecided = new Set((context.group?.units ?? []).filter((unit) => unit.decision.disposition === "unassigned").map((unit) => unit.unit_id));
  return context.units.filter((unit) => !linked.has(unit.id) && undecided.has(unit.id)).map((unit) => unit.id);
}

/** 글자 비교로 사람이 고르는 변경 종류인가 - 나눔·합침·번역은 서버가 구조에서 정한다 */
export function isTextChangeType(value: ChangeType | null | undefined): value is "tone" | "rewritten" {
  return value === "tone" || value === "rewritten";
}

function findOwnTarget(group: Group | null, unitId: number, kind: GroupTarget["kind"]): GroupTarget | undefined {
  return group?.targets.find((target) => target.parent_target_id === null && target.kind === kind && target.source_unit_ids.includes(unitId));
}

/** 새 문장 칸 하나 - 기존 새 문장 하나(AI 나눔이면 단위 하나에 여럿, 합침이면 단위 여럿에 하나) 또는 새 문장이 없는 단위 하나 */
export interface SentenceSlot {
  /** 기존 새 문장은 `t<id>`, 새로 만들 칸은 `u<단위 id>` */
  key: string;
  target: GroupTarget | null;
  lang: ViewUnit["lang"];
  sourceIds: number[];
  /** 지금 글 - 확정 글, 없으면 AI 제안 글, 새 칸이면 원문 */
  text: string;
  /** 출처가 하나면 그 원문 - 그대로인지 비교한다 */
  sourceText: string | null;
  /** 사람이 아직 확정하지 않은 AI 제안 - 그대로 받으면 글·종류를 비워 보낸다 */
  isAiPending: boolean;
  /** 칸 언어가 출처 단위들의 언어와 모두 다르다 - 변경 종류는 서버가 번역으로 정한다(사람이 고르지 않는다) */
  isTranslated: boolean;
}

/** 새 문장 언어가 단위들의 언어와 모두 다른가 - 중립은 번역이 될 수 없다(서버 _decide_change_type과 같다) */
export function isTranslationOf(lang: ViewUnit["lang"], unitLangs: readonly ViewUnit["lang"][]): boolean {
  return lang !== "neutral" && unitLangs.length > 0 && unitLangs.every((source) => source !== "neutral" && source !== lang);
}

/** 칸 언어가 출처 단위들의 언어와 모두 다른가 - 출처 언어를 모르면 번역으로 보지 않는다 */
function isTranslatedFrom(lang: ViewUnit["lang"], sourceIds: number[], langOf: Map<number, ViewUnit["lang"]>): boolean {
  const langs = sourceIds.flatMap((id) => {
    const source = langOf.get(id);
    return source === undefined ? [] : [source];
  });
  return langs.length === sourceIds.length && isTranslationOf(lang, langs);
}

/** 칸 제목의 출처가 될 수 있는 단위인가 - 제목·문장만 */
export function isHeadingSourceUnit(kind: string): boolean {
  return kind === "heading" || kind === "sentence";
}

/** 새 문장 칸이 되는 단위인가 - 표·행·그림이 아닌 글 단위(문장·제목·표에 묶이지 않은 칸 문장) */
export function isSentenceUnit(kind: string): boolean {
  return !TABLE_KINDS.includes(kind) && kind !== "figure";
}

/**
 * 줄에 그 언어 새 문장이 이미 있는가 - 칸(사람이 쓴 것·쓰는 중인 빈 칸)이나 줄 단위의 번역 행(AI 제안 포함).
 * 있으면 "만들기"·"쓰기"를 보이지 않는다 - 또 만들면 같은 언어 문장이 겹친다.
 */
export function hasRowLanguage(lang: ViewUnit["lang"], slots: SentenceSlot[], group: Group | null, unitIds: readonly number[]): boolean {
  return slots.some((slot) => slot.lang === lang)
    || (group?.targets ?? []).some((target) => target.origin === "translation" && target.lang === lang && target.translation_source_unit_id !== null && unitIds.includes(target.translation_source_unit_id));
}

/**
 * 줄의 문장 단위 → 새 문장 칸들. 단위 순서, 같은 단위 안에서는 새 문장 순서.
 * extra가 있으면 끝에 사람이 직접 쓸 다른 언어의 빈 칸을 하나 더한다(출처는 그 단위 - 저장하면 번역).
 */
export function buildSentenceSlots(group: Group | null, units: SourceUnit[], extra: OtherLangSlot | null = null): SentenceSlot[] {
  const sentenceUnits = units.filter((unit) => isSentenceUnit(unit.kind));
  const unitIds = new Set(sentenceUnits.map((unit) => unit.id));
  const langOf = new Map(sentenceUnits.map((unit) => [unit.id, unit.lang]));
  const position = new Map(sentenceUnits.map((unit, index) => [unit.id, index]));
  const firstPosition = (target: GroupTarget) => Math.min(...target.source_unit_ids.map((id) => position.get(id) ?? Infinity));
  const owned = (group?.targets ?? [])
    .filter((target) => target.parent_target_id === null && target.kind === "sentence" && target.origin === "units" && target.source_unit_ids.some((id) => unitIds.has(id)))
    .sort((a, b) => firstPosition(a) - firstPosition(b) || a.order_index - b.order_index || a.id - b.id);
  const textOf = new Map(sentenceUnits.map((unit) => [unit.id, unit.text]));
  const slots: SentenceSlot[] = [];
  for (const unit of sentenceUnits) {
    const mine = owned.filter((target) => firstPosition(target) === position.get(unit.id));
    for (const target of mine) {
      slots.push({
        key: `t${target.id}`,
        target,
        lang: target.lang,
        sourceIds: target.source_unit_ids,
        text: target.confirmed_text || target.ai_text,
        sourceText: target.source_unit_ids.length === 1 ? (textOf.get(target.source_unit_ids[0]) ?? null) : null,
        isAiPending: !target.confirmed_text && Boolean(target.ai_text),
        isTranslated: isTranslatedFrom(target.lang, target.source_unit_ids, langOf),
      });
    }
    if (!owned.some((target) => target.source_unit_ids.includes(unit.id))) {
      slots.push({ key: `u${unit.id}`, target: null, lang: unit.lang, sourceIds: [unit.id], text: unit.text, sourceText: unit.text, isAiPending: false, isTranslated: false });
    }
  }
  if (extra) slots.push({ key: `x${extra.unitId}`, target: null, lang: extra.lang, sourceIds: [extra.unitId], text: "", sourceText: null, isAiPending: false, isTranslated: true });
  return slots;
}

/**
 * 칸의 구조 종류 - 서버 순서(합침 → 언어가 다름(번역) → 나눔)와 같다. null이면 사람이 글자 비교 종류를 고른다.
 * 나눔은 한 단위가 자기와 같은 언어의 칸을 둘 이상 낼 때만이다 - 다른 언어 칸은 번역이라 세지 않는다(설계 §5.2).
 */
export function readSlotKind(slot: SentenceSlot, slots: SentenceSlot[]): "merged" | "translated" | "split" | null {
  if (slot.target?.change_type === "merged" || slot.sourceIds.length > 1) return "merged";
  if (slot.isTranslated) return "translated";
  const siblings = slots.filter((other) => other.lang === slot.lang && other.sourceIds.includes(slot.sourceIds[0]));
  return slot.target?.change_type === "split" || siblings.length > 1 ? "split" : null;
}

/** 칸의 저장할 글 - 고쳤으면 고친 글(비웠으면 원문), 아니면 null(지금 글 그대로) */
function readEditedText(slot: SentenceSlot, draft: RowDraft): string | null {
  const edited = draft.texts[slot.key];
  if (edited === undefined) return null;
  const text = edited.trim();
  if (!text) return slot.target ? null : (slot.sourceText ?? "").trim();
  return slot.target && text === slot.text.trim() ? null : text;
}

function buildSentenceTarget(slot: SentenceSlot, draft: RowDraft, place: ReturnType<typeof placeTarget>): TargetInput {
  // 기존 새 문장의 글자 비교 종류(AI 제안이면 제안의 종류) - 고쳐도 사람이 따로 고르지 않으면 이것을 둔다
  const keptType = isTextChangeType(slot.target?.change_type) ? slot.target.change_type : null;
  const base = { key: slot.key, ...(slot.target ? { id: slot.target.id, revision: slot.target.revision } : {}), ...place, kind: "sentence" as const, source_unit_ids: slot.sourceIds };
  const edited = readEditedText(slot, draft);
  if (slot.target && edited === null) {
    // 손대지 않은 기존 새 문장: 글은 서버가 지금 글(AI 제안이면 제안 글)을 두고, 종류는 사람 것이면 그대로, AI 제안이면 제안 것을 받는다
    return keptType && !slot.isAiPending ? { ...base, change_type: keptType } : base;
  }
  const text = edited ?? slot.text.trim();
  // 언어가 다른 칸의 종류는 서버가 번역으로 정한다 - 보내지 않는다
  if (slot.isTranslated) return { ...base, lang: slot.lang, text };
  const isAsIs = slot.sourceText !== null && text === slot.sourceText.trim();
  return { ...base, lang: slot.lang, text, change_type: isAsIs ? "as_is" : (draft.changeTypes[slot.key] ?? keptType ?? "rewritten") };
}

/** 저장된 사유 중 사람이 쓴 것 - `system:` 코드는 사람 사유가 아니다 */
export function readHumanReason(decision: Decision | undefined): string {
  if (!decision) return "";
  return [decision.reason, decision.hold_reason].find((reason) => reason && !reason.startsWith(SYSTEM_PREFIX)) ?? "";
}

/** 시스템이 건 보류의 코드(`system:` 뒤) - 화면은 사람 말로 보여 준다 */
export function findSystemHold(decision: Decision | undefined): string | null {
  const code = decision?.hold_reason ?? "";
  return code.startsWith(SYSTEM_PREFIX) ? code.slice(SYSTEM_PREFIX.length) : null;
}

function placeTarget(destination: Destination): Pick<TargetInput, "target_doc_id" | "slot_key" | "wi_step" | "wi_part"> {
  if (destination.kind === "slot") return { target_doc_id: destination.docId, slot_key: destination.slotKey, wi_step: null, wi_part: null };
  if (destination.kind === "step") return { target_doc_id: destination.docId, slot_key: null, wi_step: destination.step, wi_part: destination.part };
  throw new Error("not a placement");
}

/** 사람이 고르지 않은 연결의 변경 종류 - 같은 언어 원문과 글이 같으면 그대로, 사람이 고른 적 있으면 그 값, 아니면 고쳐 씀 */
export function readLinkDefault(target: Pick<GroupTarget, "lang" | "confirmed_text" | "change_type" | "status">, units: Array<Pick<SourceUnit, "lang" | "text">>): ChangeTypeInput {
  const same = units.find((unit) => unit.lang === target.lang);
  if (same && same.text.trim() === target.confirmed_text.trim()) return "as_is";
  return isTextChangeType(target.change_type) && target.status !== "ai_suggested" ? target.change_type : "rewritten";
}

/**
 * 손대지 않는 새 문장을 되보낸다. 줄 단위로 만든 문장(origin units)은 서버가 보낸 자리를 그대로 읽으므로 지금 자리를 같이 싣고,
 * 입구 2·번역 문장은 자리가 잠겨 있어 id·출처만 보낸다.
 */
function echoTarget(target: GroupTarget, sources: number[] = target.source_unit_ids): TargetInput {
  const base: TargetInput = { key: `t${target.id}`, id: target.id, revision: target.revision, kind: target.kind, source_unit_ids: sources };
  if (target.origin !== "units") return base;
  const cell = target.parent_target_id !== null ? { parent_key: `t${target.parent_target_id}`, cell_row: target.cell_row, cell_col: target.cell_col } : {};
  return { ...base, target_doc_id: target.target_doc_id, slot_key: target.slot_key, wi_step: target.wi_step, wi_part: target.wi_part, ...cell };
}

/**
 * 줄 하나의 묶음 저장 요청. 짝이면 두 단위를 함께 저장한다. 서버는 닫힌 관계 묶음 전체를 받아야 저장하므로 묶음의 다른 단위·문장도
 * 지금 값 그대로 싣는다(확정 한 번이 그것들도 확정한다 - 화면이 "함께 확정되는 것"으로 보인다).
 * 보낼 곳은 바꾸기다: 줄의 칸 새 문장(과 번역)은 새 자리로 바뀌거나 지우고, 이미 쓴 문서(입구 2) 문장에서는 줄 단위를 출처에서 뺀다
 * (줄만 출처였던 문장은 removed로 보내 서버가 미배정으로 돌린다). 보낼 곳이 link면 고른 문장에 같은 언어 줄 단위를, 없으면 줄 단위
 * 모두를 출처로 더한다(언어가 다른 연결은 서버가 번역으로 정해 종류를 보내지 않는다). 확정에서 남는 짝 단위는 release_unit_ids로 싣는다.
 */
export function buildGroupSave(draft: RowDraft, context: SaveContext, action: "confirm" | "hold", holdReason = ""): GroupSaveInput {
  const { destination } = draft;
  if (!destination && action !== "hold") throw new Error("destination required");
  const existing = context.group?.targets ?? [];
  const picked = new Set(destination?.kind === "link" ? destination.targetIds : []);
  // 이은 문장이 없는 언어의 줄 단위는 이번 저장의 줄이 아니다(설계 §5) - 판단이 있으면 묶음의 다른 단위처럼 지금 그대로 싣고, 없으면 뺀다(아래)
  const pickedLangs = new Set(existing.filter((target) => picked.has(target.id)).map((target) => target.lang));
  const active = destination?.kind === "link" ? pickLinkUnits(context.units, pickedLangs) : context.units;
  const rowIds = new Set(active.map((unit) => unit.id));
  const units: GroupSaveInput["units"] = active.map((unit) => ({
    unit_id: unit.id,
    revision: unit.revision,
    disposition: !destination ? ("unassigned" as const) : destination.kind === "delete" ? ("delete" as const) : destination.kind === "move" ? ("move_external" as const) : ("assigned" as const),
    move_target_code: destination?.kind === "move" ? draft.moveCode.trim() : "",
    // 보낼 곳 없는 보류의 사유는 hold_reason이 맡는다
    reason: destination ? draft.reason.trim() : "",
  }));
  const targets: TargetInput[] = [];
  const kept = new Set<number>();
  const isPlace = destination?.kind === "slot" || destination?.kind === "step";
  if (destination?.kind === "slot_heading") {
    // 줄의 제목·문장 단위마다 칸 제목 하나 - 글은 서버가 칸 이름으로 채운다. 출처는 이 줄의 단위만 싣는다(다른 문서의 출처는 서버가 지킨다)
    for (const unit of active) {
      if (!isHeadingSourceUnit(unit.kind)) continue;
      const own = existing.find((target) => target.kind === "slot_heading" && target.source_unit_ids.includes(unit.id));
      if (own) kept.add(own.id);
      targets.push({ key: `h${unit.id}`, ...(own ? { id: own.id, revision: own.revision } : {}), kind: "slot_heading", target_doc_id: destination.docId, slot_key: destination.slotKey, source_unit_ids: [unit.id] });
    }
  }
  if (isPlace) {
    const place = placeTarget(destination);
    for (const unit of active) {
      const key = `u${unit.id}`;
      if (TABLE_KINDS.includes(unit.kind)) {
        const own = findOwnTarget(context.group, unit.id, "table");
        const ref = own ? { id: own.id, revision: own.revision } : {};
        if (own) kept.add(own.id);
        const table = context.tables.get(unit.id);
        targets.push({ key, ...ref, ...place, kind: "table", lang: "neutral", change_type: "as_is", source_unit_ids: [unit.id], grid: table ? { rows: table.rows, cols: table.cols } : null });
        for (const cell of table?.cells ?? []) {
          const cellOwn = existing.find((target) => target.parent_target_id !== null && target.source_unit_ids.includes(cell.id));
          if (cellOwn) kept.add(cellOwn.id);
          targets.push({
            key: `c${cell.id}`,
            ...(cellOwn ? { id: cellOwn.id, revision: cellOwn.revision } : {}),
            ...place,
            kind: "sentence",
            lang: cell.lang,
            text: cell.text,
            change_type: "as_is",
            source_unit_ids: [cell.id],
            parent_key: key,
            cell_row: cell.row,
            cell_col: cell.col,
          });
        }
        continue;
      }
      if (unit.kind === "figure") {
        const own = findOwnTarget(context.group, unit.id, "figure");
        if (own) kept.add(own.id);
        targets.push({ key, ...(own ? { id: own.id, revision: own.revision } : {}), ...place, kind: "figure", lang: "neutral", change_type: "as_is", source_unit_ids: [unit.id] });
      }
    }
    for (const slot of buildSentenceSlots(context.group, active, draft.otherLang ?? null)) {
      if (slot.target) kept.add(slot.target.id);
      // 손으로 쓰는 다른 언어 칸은 글이 있을 때만 새 문장이 된다
      else if (slot.isTranslated && !(draft.texts[slot.key] ?? "").trim()) continue;
      targets.push(buildSentenceTarget(slot, draft, place));
    }
  }
  // 칸 새 문장의 칸 문장(표)은 표와 함께 다뤄진다 - 표가 지워지면 따라 지워진다
  const cellOf = new Set(existing.filter((target) => target.parent_target_id !== null).map((target) => target.id));
  const removed: number[] = [];
  for (const target of existing) {
    if (kept.has(target.id)) continue;
    const touchesRow = target.source_unit_ids.some((id) => rowIds.has(id)) || (target.translation_source_unit_id !== null && rowIds.has(target.translation_source_unit_id));
    if (target.origin === "new_doc") {
      const others = target.source_unit_ids.filter((id) => !rowIds.has(id));
      const sameLang = active.filter((unit) => unit.lang === target.lang);
      // 같은 언어 단위가 없으면 줄 전체가 출처다. 종류를 서버가 번역으로 정하는 것은 중립 단위가 끼지 않을 때뿐이라 그때만 종류를 빼고 보낸다
      const isTranslation = isTranslationOf(target.lang, active.map((unit) => unit.lang));
      const added = picked.has(target.id) ? (sameLang.length === 0 ? active : sameLang).map((unit) => unit.id) : [];
      const sources = [...others, ...added];
      if (sources.length === 0) {
        // 줄만 출처였던 문장은 서버가 미배정으로 되돌린다. 원래 출처가 없던 문장은 묶음에 따라온 것이라 그대로 되보낸다
        if (touchesRow) removed.push(target.id);
        else targets.push(echoTarget(target, []));
        continue;
      }
      if (!picked.has(target.id)) {
        targets.push(echoTarget(target, sources));
        continue;
      }
      const chosen = draft.linkChangeTypes?.[target.id];
      const base = echoTarget(target, sources);
      targets.push(chosen === null || isTranslation ? base : { ...base, change_type: chosen ?? readLinkDefault(target, active) });
      continue;
    }
    // 번역은 출처 새 문장을 따른다 - 칸이 그대로면 함께 되보내고, 줄이 다른 곳으로 가면 줄의 번역은 지운다
    if (target.origin === "translation" && isPlace) {
      targets.push(echoTarget(target));
      continue;
    }
    if (touchesRow) {
      removed.push(target.id);
      continue;
    }
    // 줄과 관계없는 문장(다른 단위의 칸 새 문장 등) - 지운 표의 칸 문장이 아니면 지금 자리 그대로 되보낸다
    if (cellOf.has(target.id) && removed.includes(target.parent_target_id ?? -1)) continue;
    targets.push(echoTarget(target));
  }
  // 묶음의 다른 단위(합쳐진 다른 출처, 이번에 잇지 않는 언어의 짝 단위 등)도 지금 판단 그대로 실어야 닫힌다. 표의 칸 단위는 표를 따른다
  const cellUnits = new Set((context.group?.units ?? []).flatMap((unit) => unit.cell_unit_ids));
  // 판단 없이 남는 짝 단위는 다른 것과 이어진 데가 없어 빼도 닫혀 있다. 보류 저장은 판단 없는 단위도 받으므로 그대로 싣는다
  const leftovers = new Set(action === "confirm" ? listLinkLeftovers(destination, context) : []);
  const others = (context.group?.units ?? [])
    .filter((unit) => !rowIds.has(unit.unit_id) && !cellUnits.has(unit.unit_id) && !leftovers.has(unit.unit_id))
    .map((unit) => ({ unit_id: unit.unit_id, revision: unit.decision.revision, disposition: unit.decision.disposition, move_target_code: unit.decision.move_target_code, reason: unit.decision.reason }));
  return { action, hold_reason: holdReason, units: [...units, ...others], targets, removed_target_ids: removed, release_unit_ids: [...leftovers] };
}

/** 확정하면 다음 미확정 줄로 - 지금 줄 뒤에서 먼저 찾고 없으면 앞에서 */
export function findNextOpen(keys: string[], rows: Map<string, ClassifyRow>, current: string): string | null {
  const index = keys.indexOf(current);
  const ordered = [...keys.slice(index + 1), ...keys.slice(0, Math.max(index, 0))];
  return ordered.find((key) => rows.get(key)?.status !== "confirmed") ?? null;
}

// --- 목록 필터와 검사 문구 ---

export type ClassifyFilter = "unassigned" | "ai_suggested" | "on_hold" | "confirmed" | "all";

/** 다음·이전 줄 - 목록(필터 스냅숏)만 밟고 끝에서 멈춘다. 목록 밖 줄(엿보기)에서는 문서 순서로 그 자리 다음(이전)의 목록 줄로 */
export function stepInList(allKeys: readonly string[], listKeys: readonly string[], activeKey: string | null, step: 1 | -1): string | null {
  if (listKeys.length === 0) return null;
  const clamp = (index: number): string => listKeys[Math.min(Math.max(index, 0), listKeys.length - 1)];
  const index = activeKey === null ? -1 : listKeys.indexOf(activeKey);
  if (index >= 0) return clamp(index + step);
  const position = activeKey === null ? -1 : allKeys.indexOf(activeKey);
  if (position < 0) return listKeys[0];
  const order = new Map(allKeys.map((key, at) => [key, at]));
  const after = listKeys.findIndex((key) => (order.get(key) ?? -1) > position);
  // after는 그 자리 뒤 첫 목록 줄 - 앞으로 가면 그 줄, 뒤로 가면 바로 앞 줄(없으면 끝에서 멈춘다)
  if (step === 1) return after < 0 ? listKeys[listKeys.length - 1] : listKeys[after];
  return clamp((after < 0 ? listKeys.length : after) - 1);
}

// 화면 문구가 있는 검사 - 문장 검사(backend checks.py)와 AI 응답 검사(ai/classify.py·split.py의 build_warning)
const CHECK_KINDS = new Set([
  "number_mismatch",
  "unit_mismatch",
  "negation_mismatch",
  "unknown_rule_id",
  "evidence_not_found",
  "missing_rewrite",
  "too_many_sentences",
  "invalid_format",
  "unknown_candidate",
  "parts_mismatch",
]);

/** 새 문장 경고의 문구 키 - 모르는 종류는 "확인 필요" */
export function readCheckKey(warning: Record<string, string>): string {
  const kind = warning.code ?? warning.kind ?? "";
  return CHECK_KINDS.has(kind) ? `check.${kind}` : "check.other";
}

/** 목록 이동 키 - J·↓는 다음 줄, K·↑는 앞 줄(Split 화면과 같은 키) */
export function getRowStep(key: string): 1 | -1 | null {
  const lower = key.toLowerCase();
  if (lower === "j" || lower === "arrowdown") return 1;
  if (lower === "k" || lower === "arrowup") return -1;
  return null;
}
