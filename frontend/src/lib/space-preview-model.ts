// Assign Space 미리보기의 순수 셈 - 누르고 있기 · 짧게 탁 · 끌기 상태 기계, Space를 화면이 받을 포커스인가, 창 밖 줄 수, 확정 전 덮어 그리기 값.
// 화면은 components/assign/space-preview.tsx. 설계: MD 2 §3 S2(2026-11-18-2-followups.md)
import type { ChangeType, PreviewSheet, TargetDocType } from "@/lib/api-sop";
import { getFrozenCount, type SheetDraft } from "@/lib/sheet-view-model";

export const TAP_MS = 250; // 이보다 짧게 누르고 그사이 끌지 않았으면 "짧게 탁" - 열어 두거나(닫힌 데서) 닫는다(열어 둔 데서)
export const SHEET_HEIGHT_MIN = 0.3; // 시트 높이 비율(작업 화면 높이 대비 0~1)의 아래 한계 - 이보다 낮으면 머리 · 바닥만 남는다
export const SHEET_HEIGHT_MAX = 0.9; // 위 한계 - 위쪽 도구 줄이 조금은 보이게
export const SHEET_HEIGHT_DEFAULT = 0.7; // 처음 높이 비율 - 이 값이 시트 높이의 유일한 기본값이다
export const HINT_OPENS = 3; // 닫혀 있을 때의 작은 안내는 이만큼 열어 볼 때까지만 보인다

/** 시트 높이 비율을 한계 안으로 - 숫자가 아니면 기본값 */
export function clampSheetHeight(ratio: number): number {
  if (!Number.isFinite(ratio)) return SHEET_HEIGHT_DEFAULT;
  return Math.min(Math.max(ratio, SHEET_HEIGHT_MIN), SHEET_HEIGHT_MAX);
}

/** 끈 자리(clientY)에서 시트 높이 비율 - 시트는 작업 화면 바닥에 붙어 있어 (바닥 - 끈 자리) / 작업 화면 높이다 */
export function readDragHeight(clientY: number, parentBottom: number, parentHeight: number): number {
  if (!(parentHeight > 0)) return SHEET_HEIGHT_DEFAULT;
  return clampSheetHeight((parentBottom - clientY) / parentHeight);
}

/** closed · held(누르는 동안) · kept(열어 둠) · keptHeld(열어 둔 채 다시 누르는 동안) */
export type SpacePhase = "closed" | "held" | "kept" | "keptHeld";

export interface SpaceState {
  phase: SpacePhase;
  /** 지금 누른 Space의 keydown 시각(ms) */
  downAt: number;
  /** 지금 누르는 동안 시트를 끌었다 */
  dragged: boolean;
}

export type SpaceEvent = { type: "down"; at: number } | { type: "up"; at: number } | { type: "drag" } | { type: "escape" } | { type: "blur" };

export const SPACE_CLOSED: SpaceState = { phase: "closed", downAt: 0, dragged: false };

/** 상태 기계 한 걸음 - 끌었으면 떼는 순간 닫히고(열어 두지 않음), 열어 둔 채 길게 누르고 뗀 것은 닫지 않는다(끌기용) */
export function stepSpace(state: SpaceState, event: SpaceEvent): SpaceState {
  switch (event.type) {
    case "down":
      if (state.phase === "closed") return { phase: "held", downAt: event.at, dragged: false };
      if (state.phase === "kept") return { phase: "keptHeld", downAt: event.at, dragged: false };
      return state;
    case "up": {
      const isTap = event.at - state.downAt < TAP_MS && !state.dragged;
      if (state.phase === "held") return isTap ? { ...state, phase: "kept" } : SPACE_CLOSED;
      if (state.phase === "keptHeld") return isTap ? SPACE_CLOSED : { ...state, phase: "kept", dragged: false };
      return state;
    }
    case "drag":
      return state.phase === "held" || state.phase === "keptHeld" ? { ...state, dragged: true } : state;
    case "escape":
      return SPACE_CLOSED;
    case "blur":
      // 창 밖으로 포커스가 가면 keyup이 오지 않는다 - 누르는 동안은 닫고, 열어 둔 것은 남긴다
      if (state.phase === "held") return SPACE_CLOSED;
      if (state.phase === "keptHeld") return { ...state, phase: "kept", dragged: false };
      return state;
  }
}

export function isSpaceOpen(state: SpaceState): boolean {
  return state.phase !== "closed";
}

export function isSpaceKept(state: SpaceState): boolean {
  return state.phase === "kept" || state.phase === "keptHeld";
}

/** Space가 그 포커스의 것인가 - 글 입력칸 · 단추 · 링크 · 고르기 항목은 Space를 자기가 쓴다(화면 단축키가 아니다) */
export function isOwnSpaceTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return true;
  return target.closest("button, a, [role='option'], [role='button'], [role='menuitem'], [role='checkbox'], [role='switch']") !== null;
}

/** 미리보기 창 밖에 남은 줄 수 - 위로 · 아래로. 창이 시트 전체면 null */
export function getWindowRest(sheet: Pick<PreviewSheet, "truncated" | "offset" | "total_rows" | "rows">): { above: number; below: number } | null {
  if (!sheet.truncated) return null;
  return { above: sheet.offset, below: Math.max(sheet.total_rows - sheet.offset - sheet.rows.length, 0) };
}

/** 머리 줄(고정한 줄 - A는 상태 + 열 머리, 문단 Excel은 열 머리)을 뺀 자료 줄 수 - 이 문서가 시트에서 차지하는 줄 */
export function countDataRows(sheet: Pick<PreviewSheet, "total_rows" | "freeze">): number {
  return Math.max(sheet.total_rows - getFrozenCount(sheet.freeze), 0);
}

/** paragraphs = 그 문서의 문단 Excel, comparison = Old 문서의 Excel A(시안 2 D4) */
export type SpaceSheet = "paragraphs" | "comparison";

/** 한 단 보기(쪼개기를 보는 자리)는 문단 Excel, 양 단 보기는 지금처럼 비교 Excel A */
export function pickSpaceSheet(single: boolean): SpaceSheet {
  return single ? "paragraphs" : "comparison";
}

export interface SpaceEnableInput {
  /** 보는 문서(한 단이면 Old 또는 이미 쓴 New, 양 단이면 Old)가 있다 */
  hasDoc: boolean;
  /** 그 문서 보기의 단위 수 - 빈 템플릿처럼 단위가 없으면 문단 Excel이 없다 */
  unitCount: number;
  /** New 문서를 양 단에서 그 자리에서 고치는 중 */
  isNewEdit: boolean;
  /** Assign 줄 수 */
  rowCount: number;
}

/** Space가 켜지는가 - 문단 Excel은 단위가 있는 문서면, 비교 Excel A는 지금처럼 New를 그 자리에서 고치는 중이 아니고 Old 줄이 있을 때 */
export function isSpaceEnabled(sheet: SpaceSheet, input: SpaceEnableInput): boolean {
  if (!input.hasDoc) return false;
  return sheet === "paragraphs" ? input.unitCount > 0 : !input.isNewEdit && input.rowCount > 0;
}

/**
 * Space 미리보기가 가운데 맞출 단위 - 누른 박스(한/영 따로 문서에서 EN 박스를 누르면 EN 행)가 먼저이고, 시트에 없는 단위(문단 Excel은 본문만 -
 * 머리말 · 꼬리말)면 문서 차례(docOrder)로 가장 가까운 위의 시트 단위, 그것도 없으면 null(시트 맨 위). Assign 피드백 2026-11-20 항목 10
 */
export function pickSheetAnchor(unitIds: readonly number[], pickedId: number | null, docOrder: readonly number[], isInSheet: (unitId: number) => boolean): number | null {
  const first = pickedId !== null && unitIds.includes(pickedId) ? pickedId : unitIds[0];
  if (first === undefined) return null;
  if (isInSheet(first)) return first;
  for (let at = docOrder.indexOf(first) - 1; at >= 0; at -= 1) if (isInSheet(docOrder[at])) return docOrder[at];
  return null;
}

/** 고른 줄의 단위 가운데 시트에 줄이 있는 첫 단위의 줄 대표(unit_id) - 짝 줄은 A에서 한 단위로, 한 줄로 묶은 문단 Excel 줄은 첫 단위로 적힌다 */
export function findSheetUnit(sheet: Pick<PreviewSheet, "rows">, unitIds: readonly number[]): number | null {
  for (const id of unitIds) {
    const row = sheet.rows.find((candidate) => candidate.unit_id === id || candidate.unit_ids.includes(id));
    if (row) return row.unit_id;
  }
  return unitIds[0] ?? null;
}

// Excel A의 칸 글과 같은 영어 값(backend output_labels.py en) - 시트는 늘 영어다
const DEST_LABELS: Record<TargetDocType, string> = { sop: "New SOP", wi: "WI" };
const CHANGE_LABELS: Partial<Record<ChangeType, string>> = { as_is: "=", rewritten: "Modified", split: "Split", merged: "Merged", translated: "Translated", heading: "Slot heading" };
export const NO_NUMBER = "—"; // 아직 번호를 셀 수 없는 확정 전 자리

export interface SheetDraftInput {
  docType: TargetDocType;
  docCode: string;
  docTitle: string;
  place: string;
  /** 새 문장마다 지금 글(사람이 고친 글, 없으면 칸의 지금 글) */
  texts: readonly string[];
  /** 새 문장마다 변경 종류(글자 비교 종류는 화면의 미리 보기) */
  changes: readonly ChangeType[];
}

/** 확정 전에 고른 곳 → 고른 줄에 덮어 그릴 칸 값. 여러 문장은 줄을 바꿔 잇고, 변경 종류는 겹치지 않게 모은다 */
export function buildSheetDraft(input: SheetDraftInput): SheetDraft {
  const changes = [...new Set(input.changes.map((change) => CHANGE_LABELS[change] ?? change))];
  return {
    destination: DEST_LABELS[input.docType],
    new_doc: input.docCode,
    new_doc_title: input.docTitle,
    place: input.place,
    number: NO_NUMBER,
    new_text: input.texts.join("\n"),
    change: changes.join(" · "),
  };
}
