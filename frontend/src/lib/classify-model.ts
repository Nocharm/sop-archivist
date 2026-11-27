// 분류(입구 1) 모델 - 목록 한 줄은 한/영 짝 하나, 짝 없는 단위는 혼자 한 줄(디자인 문서 16절). 보낼 곳 목록과 저장 요청을 만드는 순수 함수.

import type {
  ChangeType,
  CoverStatus,
  Decision,
  DocumentView,
  Group,
  GroupSaveInput,
  GroupTarget,
  OutlineItem,
  TargetInput,
  TargetPosition,
  ToBe,
  UnitRow,
  ViewUnit,
  WiPart,
  WiStep,
  WrittenSentence,
} from "./api-sop";
import { listCaptionChildren, planCaptions } from "./caption-model";
import type { CaptionUnit } from "./caption-model";
import { getContent } from "./number-model";

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

/** 판단을 받는 단위 - 데이터 표에 묶인 칸 문장은 표 단위를 따르므로 따로 줄이 없다(레이아웃 표의 칸 문장은 묶이지 않아 줄이 있다) */
export function isCoverUnit(unit: Pick<ViewUnit, "group_unit_id">): boolean {
  return unit.group_unit_id === null;
}

/** 잡음 표시(목차 줄)가 붙은 단위 - 배정 줄이 아니다(남은 수·Next에서 빠지고 결과물에는 "삭제 · 목차"로 남는다) */
export function isNoiseUnit(unit: Pick<ViewUnit, "noise_kind">): boolean {
  return unit.noise_kind != null;
}

/** 문서 보기들(짝·원문 순서)과 단위 목록(상태)으로 줄을 만든다. 문서 순서 → 원문 순서. 목차 줄은 줄이 없다(서버 진행 숫자와 같은 규칙) */
export function buildRows(views: DocumentView[], unitRows: Map<number, UnitRow>): ClassifyRow[] {
  const rows: ClassifyRow[] = [];
  for (const view of views) {
    const order = [...view.units]
      .filter((unit) => isCoverUnit(unit) && !isNoiseUnit(unit))
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

// --- 보낼 곳 ---

export type Destination =
  | { kind: "slot"; docId: number; slotKey: string }
  /** 옛 제목을 새 SOP 칸의 칸 제목으로 - 글은 칸 이름이라 고르지 않는다 */
  | { kind: "slot_heading"; docId: number; slotKey: string }
  /** step이 null이면 단계 없는 자리(단계를 선언하지 않은 WI) */
  | { kind: "step"; docId: number; step: number | null; part: WiPart }
  /** 이미 쓴 문서(입구 2)의 문장에 출처로 잇기 - 여럿이면 나눔 */
  | { kind: "link"; targetIds: number[] }
  /** 아직 안 쓴 문서에 놓인 새 문장(docId의 target)에 이 줄을 출처로 더하기 - Old 여러 줄 → New 한 문장(합침). 글은 그대로 두고 그 뒤 고쳐 쓴다 */
  | { kind: "join"; docId: number; targetId: number }
  | { kind: "delete" }
  | { kind: "move" };

export interface DestinationOption {
  id: string;
  destination: Destination;
  docCode: string;
  label: string;
  /** N/A 칸 - 보이지만 고를 수 없다 */
  disabled: boolean;
  /** 나무의 들여쓰기 단 - SOP 칸은 골격 항목의 수준(최상위 0, 둘로 정해져 있지 않다), WI 자리는 0 */
  depth: number;
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
    case "join":
      return `join:${destination.targetId}`;
    default:
      return destination.kind;
  }
}

/** 나무·메뉴에 적는 칸 이름 - 그 항목의 이름만. 번호를 따로 적지 않는 항목(부록 - shows_number false)은 번호가 든 이름 "Appendix 2. 제목" */
function readPlaceName(item: OutlineItem): string {
  return item.shows_number ? item.title_en : item.label;
}

/**
 * To-Be 목록 → 메뉴 항목. SOP는 그 문서 골격에서 문장을 직접 받는 칸(is_assignable, 뺀 항목 제외 - 묶음과 앱이 채우는 목록은 보낼 곳이 아니다)을 골격 순서대로,
 * WI는 단계마다 Instruction·Why(단계가 없으면 단계 없는 Instruction·Why). 입구 2 문서는 이 화면의 보낼 곳이 아니다.
 * 칸 이름은 그 항목의 이름만이다(조상 이름은 붙이지 않는다 - 나무가 depth로 위계를 보인다)
 */
export function buildDestinationOptions(tobe: ToBe): DestinationOption[] {
  const options: DestinationOption[] = [];
  for (const doc of [...tobe.docs].sort((a, b) => a.order_index - b.order_index || a.id - b.id)) {
    if (doc.entrance !== "assign") continue;
    if (doc.doc_type === "sop") {
      const items = tobe.outline_items.filter((item) => item.code === doc.code && !item.is_removed);
      const parents = new Map(items.map((item) => [item.key, item.parent_key]));
      const naKeys = new Set(tobe.na_slots.filter((slot) => slot.code === doc.code).map((slot) => slot.slot_key));
      // N/A는 그 칸과 그 아래 전부를 막는다 - 부모를 따라 끝까지 올라가며 본다(배정할 수 없는 상위 항목의 N/A도 같다)
      const isNa = (slotKey: string): boolean => {
        for (let key: string | null = slotKey; key !== null; key = parents.get(key) ?? null) if (naKeys.has(key)) return true;
        return false;
      };
      for (const item of items) {
        if (!item.is_assignable) continue;
        const slotKey = item.key;
        const disabled = isNa(slotKey);
        const place = { docCode: doc.code, label: readPlaceName(item), depth: item.level };
        // N/A가 아닌 칸마다 칸 줄 바로 앞에 칸 제목 자리를 둔다
        if (!disabled) {
          const heading: Destination = { kind: "slot_heading", docId: doc.id, slotKey };
          options.push({ ...place, id: getDestinationId(heading), destination: heading, disabled: false });
        }
        const destination: Destination = { kind: "slot", docId: doc.id, slotKey };
        options.push({ ...place, id: getDestinationId(destination), destination, disabled });
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

/** 고르는 보낼 곳 - 새 문서를 만드는 쪽을 숨긴 동안은 없다. 이미 보낸 곳의 이름은 늘 buildDestinationOptions로 읽는다 */
export function listPickOptions(tobe: ToBe, drafting: boolean): DestinationOption[] {
  return drafting ? buildDestinationOptions(tobe) : [];
}

/** 아직 쓰지 않은 문서(숨긴 기능)의 자리면 그 번호와 칸 이름 - 이름을 못 찾으면(놓인 문장에 이은 초안 · 지운 칸) 이름은 빈 글. 아니면 null */
export function readHiddenPlace(destination: Destination | null, options: readonly DestinationOption[]): { docCode: string; label: string } | null {
  if (destination === null || destination.kind === "link" || destination.kind === "delete" || destination.kind === "move") return null;
  const option = options.find((item) => item.id === getDestinationId(destination));
  const sameDoc = option ?? options.find((item) => "docId" in item.destination && item.destination.docId === destination.docId);
  return { docCode: sameDoc?.docCode ?? "", label: option?.label ?? "" };
}

/** 세는 보낼 곳인가 - 칸 제목 항목은 칸 줄에 딸린 것이라 개수에 넣지 않는다 */
export function isPlaceOption(option: Pick<DestinationOption, "destination">): boolean {
  return option.destination.kind !== "slot_heading";
}

/** 나무에 보일 항목 - 칸 제목 자리는 줄이 칸 제목을 받을 수 있을 때만 */
export function listTreeOptions(options: DestinationOption[], canPickHeading: boolean): DestinationOption[] {
  return canPickHeading ? options : options.filter(isPlaceOption);
}

/**
 * 나무의 줄 - 보낼 곳(place)이거나, 문장을 받지 않는 상위 항목(묶음)의 이름 줄(heading).
 * 이름 줄은 보낼 곳이 아니다: 고를 수 없고 끌어 놓을 수도 없다(보낼 곳 목록 DestinationOption에는 들어 있지 않다)
 */
export type TreeRow =
  | { kind: "place"; option: DestinationOption }
  | { kind: "heading"; id: string; docCode: string; label: string; depth: number; isNa: boolean };

/**
 * 나무에 그릴 줄 - 보낼 곳 사이에, 문장을 받지 않는 조상 항목(7 Document Relationships › 7.1 Associated Documents)의 이름 줄을 그 아래 첫 칸 앞에 끼운다.
 * 하위 칸이 제 자리를 잃지 않게 하는 것이라, 아래에 보낼 곳이 하나도 없는 항목과 앱이 채우는 목록은 줄이 없다
 */
export function listTreeRows(tobe: ToBe, options: readonly DestinationOption[]): TreeRow[] {
  const outlines = new Map<string, Map<string, OutlineItem>>();
  for (const item of tobe.outline_items) {
    if (item.is_removed) continue;
    if (!outlines.has(item.code)) outlines.set(item.code, new Map());
    outlines.get(item.code)?.set(item.key, item);
  }
  const naKeys = new Set(tobe.na_slots.map((slot) => `${slot.code}\n${slot.slot_key}`));
  const shown = new Set<string>();
  const rows: TreeRow[] = [];
  for (const option of options) {
    const { destination } = option;
    if (destination.kind === "slot" || destination.kind === "slot_heading") {
      const items = outlines.get(option.docCode);
      const findParent = (key: string): OutlineItem | undefined => items?.get(items.get(key)?.parent_key ?? "");
      // 조상 - 가까운 것부터 모아, 바깥 항목부터 그리려고 뒤집는다
      const ancestors: OutlineItem[] = [];
      for (let item = findParent(destination.slotKey); item !== undefined; item = findParent(item.key)) ancestors.push(item);
      ancestors.reverse();
      ancestors.forEach((item, index) => {
        const id = `group:${destination.docId}:${item.key}`;
        if (item.is_assignable || shown.has(id)) return;
        shown.add(id);
        const isNa = ancestors.slice(0, index + 1).some((above) => naKeys.has(`${option.docCode}\n${above.key}`));
        rows.push({ kind: "heading", id, docCode: option.docCode, label: readPlaceName(item), depth: item.level, isNa });
      });
    }
    rows.push({ kind: "place", option });
  }
  return rows;
}

/** 이미 쓴 문서 표의 칸 새 문장인가 - 칸 좌표가 있는 입구 2 자식(캡션은 좌표가 없다). 문장처럼 잇는 대상이다(시안 2 D5) */
export function isWrittenCell(target: Pick<GroupTarget, "origin" | "parent_target_id" | "cell_row" | "cell_col">): boolean {
  return target.origin === "new_doc" && target.parent_target_id !== null && target.cell_row !== null && target.cell_col !== null;
}

/** 이미 쓴 문서의 칸 새 문장 id → 그 칸이 든 표 줄 - 칸은 문장 목록(writtenMap)에 따로 줄이 없어 문서·자리를 표 줄에서 읽는다 */
export function buildCellOwners(written: readonly WrittenSentence[]): Map<number, WrittenSentence> {
  return new Map(written.flatMap((row) => (row.table?.cells ?? []).map((cell) => [cell.target_id, row] as const)));
}

/** 옛 "다른 Bundle로 이동"(없앤 기능)으로 정한 줄이면 그 번호 - 읽기 전용으로 보이고 배정 취소만 된다. 아니면 null */
export function describeLegacyMove(units: readonly Pick<UnitRow, "decision">[]): { code: string } | null {
  const moved = units.find((unit) => unit.decision.disposition === "move_external");
  return moved ? { code: moved.decision.move_target_code } : null;
}

/** 저장된 판단·새 문장에서 지금 보낼 곳을 읽는다. 여러 곳이면 첫 새 문장 기준 */
export function readDestination(group: Group | null, unitIds: number[]): Destination | null {
  if (!group) return null;
  const units = group.units.filter((unit) => unitIds.includes(unit.unit_id));
  if (units.some((unit) => unit.decision.disposition === "delete")) return { kind: "delete" };
  if (units.some((unit) => unit.decision.disposition === "move_external")) return { kind: "move" };
  // 이미 쓴 문서의 문장·칸에 이어져 있으면 그것이 보낼 곳이다(줄로 만든 칸 새 문장이 함께 남아 있어도)
  const linked = group.targets.filter((item) => item.origin === "new_doc" && (item.parent_target_id === null || isWrittenCell(item)) && item.source_unit_ids.some((id) => unitIds.includes(id)));
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

const SYSTEM_PREFIX = "system:";

/** 문장 사이에 놓은 자리 - placeId는 놓은 곳의 getDestinationId, after는 그 뒤에 끼울 새 문장(null이면 칸의 맨 앞) */
export interface DropPosition {
  placeId: string;
  after: number | null;
}

export interface RowDraft {
  destination: Destination | null;
  /** 새 문장 칸(SentenceSlot.key)별로 사람이 고친 글자 - 고치지 않은 칸은 없다. 비우면 원문 그대로 */
  texts: Record<string, string>;
  /** 사람이 직접 쓰는 다른 언어 문장 칸 - 한 언어만 있는 줄에서 연다(buildSentenceSlots의 extra) */
  otherLang?: OtherLangSlot | null;
  /** 표·그림 캡션의 글 - 키는 caption-model getCaptionTextKey(캡션 단위의 고친 글은 단위, 써 넣은 캡션은 묶음·언어) */
  captionTexts?: Record<string, string>;
  reason: string;
  /** 없앤 "다른 Bundle로 이동"의 번호 - 화면은 더 채우지 않는다(이동한 줄은 저장하지 않는다) */
  moveCode?: string;
  /** 문장 사이에 놓아 만든 초안의 자리 - 보낼 곳이 놓은 곳일 때만 저장 요청에 싣는다 */
  position?: DropPosition | null;
}

/** 손으로 쓰는 다른 언어 문장 - 그 언어와 출처로 삼을 줄 단위 */
export interface OtherLangSlot {
  lang: "ko" | "en";
  unitId: number;
}

/** 저장 전 변경이 있는 초안인가 - 고른 곳·고친 글·사유·이동 코드 중 하나라도 손댔으면 참(편집 칸만 열어 둔 것은 변경이 아니다) */
export function hasDraftChange(draft: Pick<RowDraft, "destination" | "texts" | "captionTexts"> & { reason: string | null; moveCode?: string | null }): boolean {
  if (draft.destination !== null || draft.reason !== null || (draft.moveCode ?? null) !== null) return true;
  return [draft.texts, draft.captionTexts ?? {}].some((map) => Object.keys(map).length > 0);
}

interface SourceUnit {
  id: number;
  kind: string;
  lang: ViewUnit["lang"];
  text: string;
  /** text에서 내용이 시작하는 자리(문단 번호 뒤) - 새 문장의 원문은 번호를 뺀 내용이다. 없으면 0 */
  content_start?: number;
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
  /** 표·그림 단위 id → 묶인 캡션 단위. 없으면 캡션 단위가 없는 것으로 본다(써 넣은 캡션만) */
  captions?: Map<number, CaptionUnit[]>;
}

/**
 * 잇기에서 이번 저장의 줄 단위 - 이은 문장의 언어인 단위. 그런 단위가 없으면(한 언어 줄을 다른 언어 문장에만 이음) 줄의 단위 모두가
 * 출처라 번역이 된다(제품 명세 §7.7). 나머지는 이은 문장이 없는 언어의 짝 단위다.
 */
export function pickLinkUnits<T extends { lang: ViewUnit["lang"] }>(units: T[], pickedLangs: ReadonlySet<string>): T[] {
  const same = units.filter((unit) => pickedLangs.has(unit.lang));
  return same.length > 0 ? same : units;
}

/** 이 보낼 곳이 출처로 이어 받는 기존 새 문장들 - 이미 쓴 문서의 문장(link)이거나 놓인 새 문장(join) */
export function listJoinedTargetIds(destination: Destination | null): number[] {
  if (destination?.kind === "link") return destination.targetIds;
  return destination?.kind === "join" ? [destination.targetId] : [];
}

/**
 * 이미 쓴 문장을 한 언어만 이을 때 줄에 남는 단위 - 이은 문장이 없는 언어이고 아직 판단이 없는(처분 unassigned) 줄 단위.
 * 확정 저장은 판단 없는 단위를 받지 않아(서버 hold_required) 요청에서 빼고 release_unit_ids로 실어 서버가 같은 저장 안에서 짝을 푼다(제품 명세 §6.5).
 */
export function listLinkLeftovers(destination: Destination | null, context: Pick<SaveContext, "units" | "group">): number[] {
  if (destination?.kind !== "link" && destination?.kind !== "join") return [];
  const picked = new Set(listJoinedTargetIds(destination));
  const pickedLangs = new Set((context.group?.targets ?? []).filter((target) => picked.has(target.id)).map((target) => target.lang));
  // 고른 문장의 묶음이 아직 오지 않았으면 어느 언어가 남는지 모른다
  if (pickedLangs.size === 0) return [];
  const linked = new Set(pickLinkUnits(context.units, pickedLangs).map((unit) => unit.id));
  const undecided = new Set((context.group?.units ?? []).filter((unit) => unit.decision.disposition === "unassigned").map((unit) => unit.unit_id));
  return context.units.filter((unit) => !linked.has(unit.id) && undecided.has(unit.id)).map((unit) => unit.id);
}

/** 글자 비교로 정하는 변경 종류 - "=" 그대로 · "수정" 고침. 나눔·합침·번역은 서버가 구조에서 정한다 */
export type TextChangeType = Extract<ChangeType, "as_is" | "rewritten">;

/** 글자 비교 종류인가 */
export function isTextChangeType(value: ChangeType | null | undefined): value is TextChangeType {
  return value === "as_is" || value === "rewritten";
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
  /** 사람이 아직 확정하지 않은 AI 제안 - 그대로 받으면 글을 비워 보낸다 */
  isAiPending: boolean;
  /** 칸 언어가 출처 단위들의 언어와 모두 다르다 - 변경 종류는 서버가 번역으로 정한다 */
  isTranslated: boolean;
}

/** 새 문장 언어가 단위들의 언어와 모두 다른가 - 중립과 참조 줄(REF)은 번역이 될 수 없다(서버 _decide_change_type과 같다) */
export function isTranslationOf(lang: ViewUnit["lang"], unitLangs: readonly ViewUnit["lang"][]): boolean {
  const isLanguage = (value: ViewUnit["lang"]) => value !== "neutral" && value !== "ref";
  return isLanguage(lang) && unitLangs.length > 0 && unitLangs.every((source) => isLanguage(source) && source !== lang);
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

/** 새 문장 칸이 되는 단위인가 - 표·그림이 아닌 글 단위(문장·제목·표에 묶이지 않은 칸 문장) */
export function isSentenceUnit(kind: string): boolean {
  return kind !== "table" && kind !== "figure";
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
  // 새 문장의 원문 = 번호를 뺀 내용 - 문단 번호는 번호 칸의 것이라 초안에 따라가지 않는다(F5)
  const textOf = new Map(sentenceUnits.map((unit) => [unit.id, getContent(unit)]));
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
      slots.push({ key: `u${unit.id}`, target: null, lang: unit.lang, sourceIds: [unit.id], text: getContent(unit), sourceText: getContent(unit), isAiPending: false, isTranslated: false });
    }
  }
  if (extra) slots.push({ key: `x${extra.unitId}`, target: null, lang: extra.lang, sourceIds: [extra.unitId], text: "", sourceText: null, isAiPending: false, isTranslated: true });
  return slots;
}

/**
 * 칸의 구조 종류 - 서버 순서(합침 → 언어가 다름(번역) → 나눔)와 같다. null이면 글자 비교 종류다(previewSlotChange).
 * 나눔은 한 단위가 자기와 같은 언어의 칸을 둘 이상 낼 때만이다 - 다른 언어 칸은 번역이라 세지 않는다(제품 명세 §6.7).
 */
export function readSlotKind(slot: SentenceSlot, slots: SentenceSlot[]): "merged" | "translated" | "split" | null {
  if (slot.target?.change_type === "merged" || slot.sourceIds.length > 1) return "merged";
  if (slot.isTranslated) return "translated";
  const siblings = slots.filter((other) => other.lang === slot.lang && other.sourceIds.includes(slot.sourceIds[0]));
  return slot.target?.change_type === "split" || siblings.length > 1 ? "split" : null;
}

/**
 * 칸의 "=" / "수정" 미리 보기 - 서버 규칙(_decide_change_type)과 같다: 글이 원문(번호를 뺀 내용)과 같으면 그대로, 다르면 고침.
 * 손대지 않았거나 비운 기존 새 문장은 지금 글 그대로 저장되어 서버가 정해 둔 값이 이긴다(새 칸을 비우면 원문이라 그대로). 구조 종류(readSlotKind)를 먼저 본다.
 */
export function previewSlotChange(slot: SentenceSlot, edited: string | undefined): TextChangeType {
  const typed = (edited ?? "").trim();
  if (!typed && isTextChangeType(slot.target?.change_type)) return slot.target.change_type;
  const text = typed || slot.text.trim();
  return slot.sourceText !== null && text !== slot.sourceText.trim() ? "rewritten" : "as_is";
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
  const target = buildSentenceBody(slot, draft, place);
  return { ...target, ...readPosition(draft, place, slot.target) };
}

/** 변경 종류는 싣지 않는다 - 서버가 글 · 구조로 정한다(설계 2026-11-20-change-type-two D2) */
function buildSentenceBody(slot: SentenceSlot, draft: RowDraft, place: ReturnType<typeof placeTarget>): TargetInput {
  const base = { key: slot.key, ...(slot.target ? { id: slot.target.id, revision: slot.target.revision } : {}), ...place, kind: "sentence" as const, source_unit_ids: slot.sourceIds };
  const edited = readEditedText(slot, draft);
  // 손대지 않은 기존 새 문장: 글은 서버가 지금 글(AI 제안이면 제안 글)을 둔다
  if (slot.target && edited === null) return base;
  return { ...base, lang: slot.lang, text: edited ?? slot.text.trim() };
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

/** 놓은 자리를 싣는 항목 - 놓은 곳이 보낼 곳 그대로이고 새로 만들거나 (문서, 칸, step, part)가 바뀌는 최상위 문장만 */
function readPosition(draft: RowDraft, place: ReturnType<typeof placeTarget>, own?: GroupTarget | null): { position?: TargetPosition } {
  const { destination, position } = draft;
  if (!position || !destination || position.placeId !== getDestinationId(destination)) return {};
  const isHere = own && own.target_doc_id === place.target_doc_id && own.slot_key === place.slot_key && own.wi_step === place.wi_step && own.wi_part === place.wi_part;
  return isHere ? {} : { position: { after_target_id: position.after } };
}

/**
 * 이은 문장의 "=" / "수정" 미리 보기 - 같은 언어 원문과 글이 같으면 그대로, 아니면 고침(서버 _decide_change_type과 같다).
 * 이 줄을 이미 출처로 저장한 문장은 서버가 정한 값이 이긴다. 표 · 그림은 화면에서 모양을 바꾸지 않아 그대로로 보인다 -
 * 이은 표의 모양이 원문과 다르면 저장 뒤 서버가 고침으로 정한다.
 */
export function previewLinkChange(
  target: Pick<GroupTarget, "kind" | "lang" | "confirmed_text" | "change_type" | "source_unit_ids">,
  units: Array<Pick<SourceUnit, "lang" | "text" | "content_start">>,
  rowUnitIds: readonly number[],
): TextChangeType {
  if (isTextChangeType(target.change_type) && target.source_unit_ids.some((id) => rowUnitIds.includes(id))) return target.change_type;
  if (target.kind !== "sentence") return "as_is";
  const same = units.find((unit) => unit.lang === target.lang);
  // 번호를 뺀 내용과 같아도 그대로다
  return same && [same.text.trim(), getContent(same).trim()].includes(target.confirmed_text.trim()) ? "as_is" : "rewritten";
}

/**
 * 손대지 않는 새 문장을 되보낸다. 줄 단위로 만든 문장(origin units)은 서버가 보낸 자리를 그대로 읽으므로 지금 자리를 같이 싣고,
 * 입구 2·번역 문장은 자리가 잠겨 있어 id·출처만 보낸다.
 */
export function echoTarget(target: GroupTarget, sources: number[] = target.source_unit_ids): TargetInput {
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
 * 모두를 출처로 더한다. 변경 종류는 싣지 않는다(서버가 정한다). 확정에서 남는 짝 단위는 release_unit_ids로 싣는다.
 */
export function buildGroupSave(draft: RowDraft, context: SaveContext, action: "confirm" | "hold", holdReason = ""): GroupSaveInput {
  const { destination } = draft;
  if (!destination && action !== "hold") throw new Error("destination required");
  const existing = context.group?.targets ?? [];
  const picked = new Set(listJoinedTargetIds(destination));
  const isJoining = destination?.kind === "link" || destination?.kind === "join";
  // 이은 문장이 없는 언어의 줄 단위는 이번 저장의 줄이 아니다(설계 §5) - 판단이 있으면 묶음의 다른 단위처럼 지금 그대로 싣고, 없으면 뺀다(아래)
  const pickedLangs = new Set(existing.filter((target) => picked.has(target.id)).map((target) => target.lang));
  const active = isJoining ? pickLinkUnits(context.units, pickedLangs) : context.units;
  const rowIds = new Set(active.map((unit) => unit.id));
  const units: GroupSaveInput["units"] = active.map((unit) => ({
    unit_id: unit.id,
    revision: unit.revision,
    disposition: !destination ? ("unassigned" as const) : destination.kind === "delete" ? ("delete" as const) : destination.kind === "move" ? ("move_external" as const) : ("assigned" as const),
    move_target_code: destination?.kind === "move" ? (draft.moveCode ?? "").trim() : "",
    // 보낼 곳 없는 보류의 사유는 hold_reason이 맡는다
    reason: destination ? draft.reason.trim() : "",
  }));
  const targets: TargetInput[] = [];
  const kept = new Set<number>();
  // 다시 보낸 표·그림 아래에서 이번 캡션에 들지 않은 옛 캡션(캡션 단위가 붙어 밀려난 써 넣은 캡션 등) - 지운다
  const staleCaptions = new Set<number>();
  /** 표·그림 새 문장 아래 캡션 새 문장 - 칸 새 문장처럼 같은 자리에, 기존 것이면 id·revision을 되보낸다(F3) */
  function pushCaptions(parentKey: string, unitId: number, place: ReturnType<typeof placeTarget>) {
    const children = listCaptionChildren(context.group, unitId);
    const plans = planCaptions(unitId, context.captions?.get(unitId) ?? [], children, draft.captionTexts);
    for (const plan of plans) {
      if (plan.target) kept.add(plan.target.id);
      const base = { key: `${parentKey}-cap-${plan.unitId ?? plan.lang}`, ...(plan.target ? { id: plan.target.id, revision: plan.target.revision } : {}), ...place, kind: "sentence" as const, parent_key: parentKey, source_unit_ids: plan.unitId !== null ? [plan.unitId] : [] };
      // 손대지 않은 AI 제안 캡션은 문장 칸처럼 글을 비워 보낸다 - 서버가 제안 그대로 받는다(채택 판정이 사람의 고쳐 씀으로 남기지 않게)
      if (plan.target?.status === "ai_suggested" && !plan.isEdited) {
        targets.push(base);
        continue;
      }
      targets.push({ ...base, lang: plan.lang, text: plan.text });
    }
    for (const child of children) if (!kept.has(child.id)) staleCaptions.add(child.id);
  }
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
      if (unit.kind === "table") {
        const own = findOwnTarget(context.group, unit.id, "table");
        const ref = own ? { id: own.id, revision: own.revision } : {};
        if (own) kept.add(own.id);
        const table = context.tables.get(unit.id);
        targets.push({ key, ...ref, ...place, ...readPosition(draft, place, own), kind: "table", lang: "neutral", source_unit_ids: [unit.id], grid: table ? { rows: table.rows, cols: table.cols } : null });
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
            source_unit_ids: [cell.id],
            parent_key: key,
            cell_row: cell.row,
            cell_col: cell.col,
          });
        }
        pushCaptions(key, unit.id, place);
        continue;
      }
      if (unit.kind === "figure") {
        const own = findOwnTarget(context.group, unit.id, "figure");
        if (own) kept.add(own.id);
        targets.push({ key, ...(own ? { id: own.id, revision: own.revision } : {}), ...place, ...readPosition(draft, place, own), kind: "figure", lang: "neutral", source_unit_ids: [unit.id] });
        pushCaptions(key, unit.id, place);
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
    if (staleCaptions.has(target.id)) {
      removed.push(target.id);
      continue;
    }
    const touchesRow = target.source_unit_ids.some((id) => rowIds.has(id)) || (target.translation_source_unit_id !== null && rowIds.has(target.translation_source_unit_id));
    // 놓인 새 문장에 잇기 - 그 문장은 글·자리 그대로 출처만 더한다(출처가 둘 이상이라 종류는 서버가 합침으로 정한다)
    if (destination?.kind === "join" && target.id === destination.targetId) {
      targets.push(echoTarget(target, [...new Set([...target.source_unit_ids, ...active.map((unit) => unit.id)])]));
      continue;
    }
    if (target.origin === "new_doc") {
      const others = target.source_unit_ids.filter((id) => !rowIds.has(id));
      const sameLang = active.filter((unit) => unit.lang === target.lang);
      // 같은 언어 단위가 없으면 줄 전체가 출처다
      const added = picked.has(target.id) ? (sameLang.length === 0 ? active : sameLang).map((unit) => unit.id) : [];
      const sources = [...others, ...added];
      if (sources.length === 0) {
        // 줄만 출처였던 문장은 서버가 미배정으로 되돌린다. 원래 출처가 없던 문장은 묶음에 따라온 것이라 그대로 되보낸다
        if (touchesRow) removed.push(target.id);
        else targets.push(echoTarget(target, []));
        continue;
      }
      targets.push(echoTarget(target, sources));
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
/**
 * 확정 뒤 고를 다음 박스 - 줄 이동 차례(order, 문서 차례)에서 저장한 박스(from) 둘레만 본다. 되감기 없음(Assign 피드백 2026-11-20 항목 1:
 * 목록 처음으로 돌아가 다른 문서 · 그림 탭으로 튀었다). isCandidate - 같은 문서 · 같은 탭 · 거르기 목록이고 저장한 줄이 아닌 박스(부른 쪽이 정한다).
 * below - 삭제: 바로 아래 박스, 없으면 바로 위. open - 아래로 첫 미확정 박스, 없으면 null. from이 차례에 없으면 null(고름을 둔다)
 */
export function findNextAfterSave(order: readonly string[], from: string, mode: "below" | "open", isCandidate: (key: string) => boolean, isOpen: (key: string) => boolean): string | null {
  const at = order.indexOf(from);
  if (at < 0) return null;
  const below = order.slice(at + 1).filter(isCandidate);
  if (mode === "open") return below.find(isOpen) ?? null;
  return below[0] ?? order.slice(0, at).filter(isCandidate).at(-1) ?? null;
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
