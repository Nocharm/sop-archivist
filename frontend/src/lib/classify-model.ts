// 분류(입구 1) 모델 - 목록 한 줄은 한/영 짝 하나, 짝 없는 단위는 혼자 한 줄(디자인 문서 16절). 보낼 곳 목록과 저장 요청을 만드는 순수 함수.

import type {
  CoverStatus,
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

// --- 보낼 곳 ---

export type Destination =
  | { kind: "slot"; docId: number; slotKey: string }
  | { kind: "step"; docId: number; step: number; part: WiPart }
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
      return `step:${destination.docId}:${destination.step}:${destination.part}`;
    default:
      return destination.kind;
  }
}

/** To-Be 목록 → 메뉴 항목. SOP는 칸, WI는 단계마다 Instruction·Why. 입구 2 문서는 이 화면의 보낼 곳이 아니다 */
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
      for (const step of steps) {
        for (const part of ["instruction", "why"] as const) {
          const destination: Destination = { kind: "step", docId: doc.id, step: step.step_no, part };
          options.push({
            id: getDestinationId(destination),
            destination,
            docCode: doc.code,
            label: `${step.step_no} ${step.title} · ${part === "instruction" ? "Instruction" : "Why"}`,
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
  const target = group.targets.find((item) => item.parent_target_id === null && item.source_unit_ids.some((id) => unitIds.includes(id)));
  if (!target) return null;
  if (target.wi_step !== null && target.wi_part !== null) return { kind: "step", docId: target.target_doc_id, step: target.wi_step, part: target.wi_part };
  if (target.slot_key !== null) return { kind: "slot", docId: target.target_doc_id, slotKey: target.slot_key };
  return null;
}

// --- 저장 요청 ---

export interface RowDraft {
  destination: Destination | null;
  /** 단위별 새 문장 글자 - 비어 있으면 원문 그대로 */
  texts: Record<number, string>;
  changeTypes: Record<number, "tone" | "rewritten">;
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

function findOwnTarget(group: Group | null, unitId: number): GroupTarget | undefined {
  return group?.targets.find((target) => target.parent_target_id === null && target.source_unit_ids.includes(unitId));
}

function placeTarget(destination: Destination): Pick<TargetInput, "target_doc_id" | "slot_key" | "wi_step" | "wi_part"> {
  if (destination.kind === "slot") return { target_doc_id: destination.docId, slot_key: destination.slotKey, wi_step: null, wi_part: null };
  if (destination.kind === "step") return { target_doc_id: destination.docId, slot_key: null, wi_step: destination.step, wi_part: destination.part };
  throw new Error("not a placement");
}

/** 줄 하나의 묶음 저장 요청. 짝이면 두 단위를 함께 저장한다. 기존 새 문장은 id로 고치고 남는 것은 지운다 */
export function buildGroupSave(draft: RowDraft, context: SaveContext, action: "confirm" | "hold", holdReason = ""): GroupSaveInput {
  const { destination } = draft;
  if (!destination) throw new Error("destination required");
  const existing = context.group?.targets ?? [];
  const disposed = destination.kind === "delete" || destination.kind === "move";
  const units = context.units.map((unit) => ({
    unit_id: unit.id,
    revision: unit.revision,
    disposition: destination.kind === "delete" ? ("delete" as const) : destination.kind === "move" ? ("move_external" as const) : ("assigned" as const),
    move_target_code: destination.kind === "move" ? draft.moveCode.trim() : "",
    reason: draft.reason.trim(),
  }));
  if (disposed) {
    return { action, hold_reason: holdReason, units, targets: [], removed_target_ids: existing.map((target) => target.id) };
  }
  const place = placeTarget(destination);
  const targets: TargetInput[] = [];
  const kept = new Set<number>();
  for (const unit of context.units) {
    const own = findOwnTarget(context.group, unit.id);
    const ref = own ? { id: own.id, revision: own.revision } : {};
    if (own) kept.add(own.id);
    const key = `u${unit.id}`;
    if (unit.kind === "table") {
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
      targets.push({ key, ...ref, ...place, kind: "figure", lang: "neutral", change_type: "as_is", source_unit_ids: [unit.id] });
      continue;
    }
    const text = (draft.texts[unit.id] ?? unit.text).trim();
    const changed = text !== unit.text.trim();
    targets.push({
      key,
      ...ref,
      ...place,
      kind: "sentence",
      lang: unit.lang,
      text,
      change_type: changed ? (draft.changeTypes[unit.id] ?? "rewritten") : "as_is",
      source_unit_ids: [unit.id],
    });
  }
  return {
    action,
    hold_reason: holdReason,
    units,
    targets,
    removed_target_ids: existing.filter((target) => !kept.has(target.id)).map((target) => target.id),
  };
}

/** 확정하면 다음 미확정 줄로 - 지금 줄 뒤에서 먼저 찾고 없으면 앞에서 */
export function findNextOpen(keys: string[], rows: Map<string, ClassifyRow>, current: string): string | null {
  const index = keys.indexOf(current);
  const ordered = [...keys.slice(index + 1), ...keys.slice(0, Math.max(index, 0))];
  return ordered.find((key) => rows.get(key)?.status !== "confirmed") ?? null;
}
