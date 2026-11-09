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
      });
    }
  }
  return rows;
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

/** 저장된 판단·새 문장에서 지금 보낼 곳을 읽는다. 여러 곳이면 첫 새 문장 기준 */
export function readDestination(group: Group | null, unitIds: number[]): Destination | null {
  if (!group) return null;
  const units = group.units.filter((unit) => unitIds.includes(unit.unit_id));
  if (units.some((unit) => unit.decision.disposition === "delete")) return { kind: "delete" };
  if (units.some((unit) => unit.decision.disposition === "move_external")) return { kind: "move" };
  // 이미 쓴 문서의 문장에 이어져 있으면 그것이 보낼 곳이다(칸 새 문장이 함께 남아 있어도)
  const linked = group.targets.filter((item) => item.origin === "new_doc" && item.parent_target_id === null && item.source_unit_ids.some((id) => unitIds.includes(id)));
  if (linked.length > 0) return { kind: "link", targetIds: linked.map((item) => item.id) };
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
  reason: string;
  moveCode: string;
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
}

/** 줄의 문장 단위 → 새 문장 칸들. 단위 순서, 같은 단위 안에서는 새 문장 순서 */
export function buildSentenceSlots(group: Group | null, units: SourceUnit[]): SentenceSlot[] {
  const sentenceUnits = units.filter((unit) => !TABLE_KINDS.includes(unit.kind) && unit.kind !== "figure");
  const unitIds = new Set(sentenceUnits.map((unit) => unit.id));
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
      });
    }
    if (!owned.some((target) => target.source_unit_ids.includes(unit.id))) {
      slots.push({ key: `u${unit.id}`, target: null, lang: unit.lang, sourceIds: [unit.id], text: unit.text, sourceText: unit.text, isAiPending: false });
    }
  }
  return slots;
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

/**
 * 줄 하나의 묶음 저장 요청. 짝이면 두 단위를 함께 저장한다. 기존 새 문장은 id로 고치고(나눔·합침도 그대로), 딸려 온 번역과
 * 입구 2 새 문장은 손대지 않고 되보내며, 사람이 지우지 않은 새 문장은 지우지 않는다. 보낼 곳 없이 보류하면 새 문장 없이 보류한다.
 */
export function buildGroupSave(draft: RowDraft, context: SaveContext, action: "confirm" | "hold", holdReason = ""): GroupSaveInput {
  const { destination } = draft;
  if (!destination && action !== "hold") throw new Error("destination required");
  const existing = context.group?.targets ?? [];
  const units = context.units.map((unit) => ({
    unit_id: unit.id,
    revision: unit.revision,
    disposition: !destination ? ("unassigned" as const) : destination.kind === "delete" ? ("delete" as const) : destination.kind === "move" ? ("move_external" as const) : ("assigned" as const),
    move_target_code: destination?.kind === "move" ? draft.moveCode.trim() : "",
    // 보낼 곳 없는 보류의 사유는 hold_reason이 맡는다
    reason: destination ? draft.reason.trim() : "",
  }));
  if (!destination || destination.kind === "delete" || destination.kind === "move") {
    return { action, hold_reason: holdReason, units, targets: [], removed_target_ids: existing.map((target) => target.id) };
  }
  if (destination.kind === "link") return buildLinkSave(destination.targetIds, draft, context, action, holdReason, units);
  const place = placeTarget(destination);
  const targets: TargetInput[] = [];
  const kept = new Set<number>();
  for (const unit of context.units) {
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
  for (const slot of buildSentenceSlots(context.group, context.units)) {
    if (slot.target) kept.add(slot.target.id);
    targets.push(buildSentenceTarget(slot, draft, place));
  }
  // 딸려 온 번역(출처를 따라 자리가 잠긴다)과 입구 2 새 문장(자리·글이 잠긴다)은 그대로 되보낸다
  for (const target of existing) {
    if (kept.has(target.id) || target.origin === "units") continue;
    kept.add(target.id);
    targets.push({ key: `t${target.id}`, id: target.id, revision: target.revision, kind: target.kind, source_unit_ids: target.source_unit_ids });
  }
  return {
    action,
    hold_reason: holdReason,
    units,
    targets,
    removed_target_ids: existing.filter((target) => !kept.has(target.id)).map((target) => target.id),
  };
}

/**
 * 이미 쓴 문서의 문장에 잇는 저장 - 서버는 닫힌 관계 묶음 전체를 받아야 저장하므로 묶음의 입구 2 문장을 모두 보낸다.
 * 보낼 곳은 바꾸기다: 줄의 칸 새 문장(과 그 번역)은 지우고, 줄 단위만 출처였던 문장은 미배정으로 돌린다(removed).
 * 고른 문장에는 같은 언어의 줄 단위를 출처로 더하고, 나머지는 줄 단위를 뺀 출처로 되보낸다.
 */
function buildLinkSave(
  targetIds: number[],
  draft: RowDraft,
  context: SaveContext,
  action: "confirm" | "hold",
  holdReason: string,
  units: GroupSaveInput["units"],
): GroupSaveInput {
  const rowIds = new Set(context.units.map((unit) => unit.id));
  const picked = new Set(targetIds);
  const targets: TargetInput[] = [];
  const removed: number[] = [];
  for (const target of context.group?.targets ?? []) {
    const touchesRow = target.source_unit_ids.some((id) => rowIds.has(id));
    if (target.origin !== "new_doc") {
      // 줄의 칸 새 문장과 그 번역(번역은 출처 연결 대신 옮긴 단위를 가진다)은 바꾸기로 지운다. 줄과 관계없는 것은 되보낸다
      const ownsRow = touchesRow || (target.translation_source_unit_id !== null && rowIds.has(target.translation_source_unit_id));
      if (ownsRow) removed.push(target.id);
      else targets.push({ key: `t${target.id}`, id: target.id, revision: target.revision, kind: target.kind, source_unit_ids: target.source_unit_ids });
      continue;
    }
    const others = target.source_unit_ids.filter((id) => !rowIds.has(id));
    const added = picked.has(target.id) ? context.units.filter((unit) => unit.lang === target.lang).map((unit) => unit.id) : [];
    const sources = [...others, ...added];
    if (sources.length === 0) {
      // 줄만 출처였던 문장 - 서버가 미배정으로 되돌린다. 원래 출처가 없던 문장은 묶음에 따라온 것이라 그대로 되보낸다
      if (touchesRow) removed.push(target.id);
      else targets.push({ key: `t${target.id}`, id: target.id, revision: target.revision, kind: target.kind, source_unit_ids: [] });
      continue;
    }
    const base: TargetInput = { key: `t${target.id}`, id: target.id, revision: target.revision, kind: target.kind, source_unit_ids: sources };
    if (!picked.has(target.id)) {
      targets.push(base);
      continue;
    }
    const chosen = draft.linkChangeTypes?.[target.id];
    if (chosen === null) targets.push(base);
    else targets.push({ ...base, change_type: chosen ?? (isTextChangeType(target.change_type) && target.status !== "ai_suggested" ? target.change_type : "rewritten") });
  }
  // 묶음 안 다른 단위(합쳐진 다른 출처 등)도 지금 판단 그대로 실어야 닫힌다 - 확정 한 번이 이것도 확정한다(화면이 "함께 확정되는 것"으로 보인다)
  const others = (context.group?.units ?? [])
    .filter((unit) => !rowIds.has(unit.unit_id))
    .map((unit) => ({ unit_id: unit.unit_id, revision: unit.decision.revision, disposition: unit.decision.disposition, move_target_code: unit.decision.move_target_code, reason: unit.decision.reason }));
  // 이은 문장이 없는 언어의 줄 단위는 싣지 않는다(설계 §5 - 한쪽만 있으면 있는 쪽만 저장, 남은 쪽은 미배정으로 남는다)
  const pickedLangs = new Set((context.group?.targets ?? []).filter((target) => picked.has(target.id)).map((target) => target.lang));
  const rowLang = new Map(context.units.map((unit) => [unit.id, unit.lang]));
  const linked = units.filter((unit) => pickedLangs.has(rowLang.get(unit.unit_id) ?? "neutral"));
  return { action, hold_reason: holdReason, units: [...linked, ...others], targets, removed_target_ids: removed };
}

/** 확정하면 다음 미확정 줄로 - 지금 줄 뒤에서 먼저 찾고 없으면 앞에서 */
export function findNextOpen(keys: string[], rows: Map<string, ClassifyRow>, current: string): string | null {
  const index = keys.indexOf(current);
  const ordered = [...keys.slice(index + 1), ...keys.slice(0, Math.max(index, 0))];
  return ordered.find((key) => rows.get(key)?.status !== "confirmed") ?? null;
}

// --- 목록 필터와 검사 문구 ---

export type ClassifyFilter = "unassigned" | "ai_suggested" | "on_hold" | "confirmed" | "all";

/** 처음 열 때의 필터 - AI 제안이 있으면 그것부터(명세 §12-6), 없으면 줄이 있는 첫 상태. 아무것도 없으면 미배정 */
export function pickFirstFilter(counts: Record<ClassifyFilter, number>): ClassifyFilter {
  const order: ClassifyFilter[] = ["ai_suggested", "unassigned", "on_hold", "confirmed"];
  return order.find((filter) => counts[filter] > 0) ?? "unassigned";
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
