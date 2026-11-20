// Assign 화면의 상태 · 데이터 · 동작 - 화면(page.tsx)은 그리기만 한다. 쪼개기 1단계(신뢰 기반 계획 스텝 4): 본문은 page.tsx에서 글자 그대로 옮겼다.

import { Circle, CircleCheck, CircleDashed, CirclePause, ListFilter, type LucideIcon } from "lucide-react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { type DestinationManage } from "@/components/assign/destination-tree";
import { type CaptionRefEntry } from "@/components/assign/caption-ref-list";
import { type ShapeLine } from "@/components/assign/shape-tools";
import { SplitUnitActions } from "@/components/split/split-unit-actions";
import { type PendingItem } from "@/components/assign/pending-count";
import { createDragLinkLine, type DragLinkLine } from "@/components/assign/drag-link-line";
import { findNewLine, findOldStrip, readNewLineEnd, readOldLineStart } from "@/components/assign/link-lines";
import { type JoinMenuItem } from "@/components/assign/join-menu";
import { type ResetScope } from "@/components/assign/reset-modal";
import { type AiAskItem } from "@/components/manage/ai-ask-menu";
import { flashElement, useUnwrapMotion } from "@/components/ui/motion";
import { showToast } from "@/components/ui/toast";
import { ApiError } from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import { buildDropSections, buildOldDragCard, canDragOld, findAssignDrop, findDropBlock, getSectionKey, isPositionLive, listDraftLines, readSectionDestination, REFUSAL_KEYS, resolveDropLink, resolveGapDrop, resolveSlotDrop, resolveTreeDrop, type AssignDrop, type DraftLine, type DropSection, type SendDrop, type TreeDrop } from "@/lib/assign-drop-model";
import { buildGapBlocks, buildPlaceSections, findPlaceBlock, formatPlacement, formatPlacementDest, isSpotOpen, listGapSpots, PLACE_REFUSAL_KEYS, readFixedSpot, readObjectParticle, readPlacePosition, resolvePlaceSpot, type Placement, type PlaceSection, type PlaceSpot } from "@/lib/place-spot-model";
import { findUnderPoint, type BoxDragConfig, type DragHover, type DragPoint } from "@/lib/box-drag";
import { DROP_LINE_HALF_PX, type DropLineAt } from "@/lib/drop-line";
import { useBoxDrag } from "@/lib/use-box-drag";
import { findLastStep } from "@/lib/destination-manage-model";
import { findSplitBlock, readSplitOffsets } from "@/lib/split-ai-tabs-model";
import { planPairLanguages, type JoinKind, type JoinPlan } from "@/lib/split-menu-model";
import { listAppliedSuggestions, requestAi, setSuggestionAdoption, type AiKind, type AiScope } from "@/lib/api-manage";
import { addToBeDoc, addWiStep, acceptSuggestions, MAX_ACCEPT, bulkDecide, confirmPair, createPair, deletePair, editUnits, clearDecisions, confirmMatchesInBulk, getComposedDoc, getDocumentView, getGroupByTarget, getUnitRef, getGroupByUnit, getToBe, listDocuments, listIdenticalCandidates, listNewCandidates, listSuggestions, listWrittenSentences, redoDecision, removeToBeDoc, removeWiStep, saveGroup, undoDecision, updateCaptionRef, type AcceptKind, type AiSuggestion, type ComposedDoc, type ComposedItem, type DecisionStepResult, type DocumentView, type EditOp, type Group, type GroupSaveInput, type NewCandidate, type ToBe, type UndoMeta, type UnitRefDetail, type UnitRow, type ViewUnit, type WrittenSentence } from "@/lib/api-sop";
import { listRefCandidates } from "@/lib/caption-ref-model";
import { isBundleKind, isCaptionGate, listCaptionPendingRowKeys, makeIsLinkedToWritten, type CaptionUnit } from "@/lib/caption-model";
import { buildBlockPlaces, getCaptionMotion, resolveCaptionDetach, resolveCaptionDrop, type CaptionDetach, type CaptionDrop } from "@/lib/caption-slot-model";
import { applyJoinedSources, listJoinableIds, shouldAdvanceAfterSave } from "@/lib/join-sentence-model";
import { buildComposedMerge, buildComposedSplit, canEditComposed, findComposedCut, planComposedJoin, stepComposedCut } from "@/lib/composed-ops-model";
import { applySavedTargets, buildComposedRows, isWrittenRow, listHeadingNotes, listSectionMarks, readSectionHead, removeClearedUnits, type NewPaneRow } from "@/lib/composed-model";
import { addPartnerTargets, buildLinkPairs, buildRecommendations, listUnsourced, mergeGroups, readConfirmBlockKey, stepZoom, type Recommendation } from "@/lib/assign-model";
import { countLiveOffer, splitAcceptIds } from "@/lib/ai-accept-model";
import { buildUseDraft, findRowSuggestion, indexLiveSuggestions, readSuggestedDestination, readSuggestionPlace } from "@/lib/ai-suggestion-model";
import { buildAssignMenu, getPairPickBlocker, getPairSetBlocker, planAssignJoin, planShapeMode, type AssignMenuAction, type AssignMenuGroups } from "@/lib/assign-context-menu-model";
import { listHeadingBackUnits } from "@/lib/heading-shift-model";
import { countDecidedLines, getTableNumber, getUnitUnwrapTable, listUnwrapScopes } from "@/lib/unwrap-model";
import { resolveLineParam } from "@/lib/assign-line-param";
import { readAssignView, writeAssignView } from "@/lib/assign-view-prefs";
import { loadBundle, useBundle } from "@/lib/bundle-store";
import { describeDecisionStep, getAssignUndoKey, IN_PLACE_EDIT_OPS, isUnitEditStep, pickSaveOp, shouldDropSelectionOnStep } from "@/lib/decision-step-model";
import { buildCellOwners, buildDestinationOptions, buildGroupSave, buildRows, buildSentenceSlots, findNextOpen, findSystemHold, getDestinationId, getRowStep, hasDraftChange, isSentenceUnit, listJoinedTargetIds, listUnpairedKeys, readDestination, readHumanReason, stepInList, type CellSource, type ClassifyFilter, type ClassifyRow, type Destination, type DestinationOption, type DropPosition, type RowDraft } from "@/lib/classify-model";
import { buildDocDashboard } from "@/lib/doc-dashboard-model";
import { listEditUnitIds, listTableUnitIds, NO_FOCUS, NO_PLACE, planReload, readEditKind, readEditPlace, readPendingLabelKey, type Pending, type PendingPlace, type ReloadPlan } from "@/lib/assign-focus-model";
import { pickDocRevision } from "@/lib/doc-revision";
import { enqueueDocWrite } from "@/lib/doc-write-queue";
import type { PaperPending } from "@/components/paper/paper";
import { useI18n } from "@/lib/i18n";
import { genId } from "@/lib/id";
import { useLeaveGuard } from "@/lib/leave-guard";
import { buildIdenticalBatches } from "@/lib/match-model";
import { EMPTY_FOLD_OPEN, type FoldOpen } from "@/lib/paper-fold-model";
import { buildPaperModel, buildPaperTabs, findNearestCut, isBandHeading, listFigureTabUnitIds, resolvePickUnit, shouldRecenter, type PaperTabKey } from "@/lib/paper-model";
import { isSameOrder, movePairMember, orderPairCard, readPairSlot } from "@/lib/pair-order-model";
import { moveUnwrapLines, readUnwrapSlot } from "@/lib/unwrap-order-model";
import { buildPairColumns, canUndoPair, listPairLinks, PAIR_REFUSAL_KEYS, resolvePairDrop, type PairDrop, type PairDropContext } from "@/lib/pair-drop-model";
import { ASSIGN_DOC_PARAM, ASSIGN_UNIT_PARAM, EDIT_ORIGINAL_PARAM, getStageHref } from "@/lib/stages";
import { buildTemplateTitles } from "@/lib/template-model";
import { useRegisterAiAcceptOffer } from "@/lib/use-ai-accept-offer";
import { useAiJobs } from "@/lib/use-ai-jobs";
import { useAiPrepare } from "@/lib/use-ai-prepare";
import { useAssignFocus } from "@/lib/use-assign-focus";
import { useDelayedFlag } from "@/lib/use-delayed-flag";
import { useCutLine } from "@/lib/use-cut-line";
import { countRefLookups, isRefPending, pickRefUnit } from "@/lib/ref-model";
import { buildNavKeys, listTocBlocks, readTocNavKey, readUnitNavKey, toTocNavKey, toUnitNavKey } from "@/lib/toc-block-model";
import { useEquisPolling } from "@/lib/use-equis-polling";
import { useDocViews, type DocBatch } from "@/lib/use-doc-views";
import { useLoaded } from "@/lib/use-loaded";
import { usePaneSlide } from "@/lib/use-pane-slide";
import { usePaneZoom, type PaneKey, type ZoomDir } from "@/lib/use-pane-zoom";


export type Filter = ClassifyFilter;
export const FILTERS: Filter[] = ["unassigned", "ai_suggested", "on_hold", "confirmed", "all"];
// 필터 칩의 아이콘 - 색은 칩 톤(components.css .schip)이 상태 이름으로 정한다
export const FILTER_ICON: Record<Filter, LucideIcon> = {
  unassigned: Circle,
  ai_suggested: CircleDashed,
  on_hold: CirclePause,
  confirmed: CircleCheck,
  all: ListFilter,
};
export type Mode = "old" | "unsourced";

// backend constants.SYSTEM_HOLD_* - 모르는 코드는 "시스템 보류"로 보인다
export const SYSTEM_HOLDS = ["related_unit_changed", "ai_invalid_response"];

/** 화면의 줄 초안 - 사유·이동 코드는 null이면 손대지 않은 것(저장된 값을 보인다), ""이면 사람이 비운 것 */
export interface PageDraft extends Omit<RowDraft, "reason" | "moveCode"> {
  reason: string | null;
  moveCode: string | null;
  editing: boolean;
  /** Use로 받은 AI 제안 - 저장이 실어 보내 서버가 채택을 남긴다(설계 2026-11-19-ai-suggest-only D2). 다른 곳을 고르면 비운다 */
  suggestionId?: number | null;
}

export const EMPTY_DRAFT: PageDraft = { destination: null, texts: {}, reason: null, moveCode: null, editing: false, suggestionId: null };
export const NO_NUMBERS: ReadonlySet<number> = new Set();

// 고름 · 처리 중 · 따라가기는 assign-focus-model(설계 2026-11-20 D1) - 편집 중에도 고름은 그대로다

// 한 단으로 연 New 문서에서 연 우클릭 메뉴의 줄 키 자리 - 그 문서에는 줄이 없다
export const SOLO_ROW_KEY = "solo";

/** 고른 New 문서와 그 문장 - focus의 "new" 고름에서 kind를 뺀 것 */
interface SoloPick {
  docId: number;
  unitId: number | null;
  inPlace: boolean;
}

// Pair view를 끈 뒤 스크롤 자리 맞추기를 멈추는 사람의 입력 - 굴림(휠·스크롤 막대 누름)·글쇠가 이긴다
export const PAIR_RESTORE_STOPS = ["wheel", "pointerdown", "keydown", "touchstart"] as const;

/** 배정이 걸려 서버가 되물은 편집 - 확인하면 같은 일을 confirm을 켜고 다시 보낸다 */
export type ConfirmedEdit =
  | { kind: "edit"; op: EditOp; okText: string; followId: number | null }
  | { kind: "to_pair"; unit: ViewUnit }
  | { kind: "ai_split"; unit: ViewUnit; suggestion: AiSuggestion };

/** 거르기 - "AI 추천"은 상태가 아니라 미배정이면서 살아 있는 제안이 있는 줄이다(설계 §5 2-3) */
export function matchesFilter(item: { unitIds: number[]; status: string }, next: Filter, liveIndex: ReadonlyMap<number, AiSuggestion>): boolean {
  return next === "all" || (next === "ai_suggested" ? findRowSuggestion(item.unitIds, item.status, liveIndex) !== null : item.status === next);
}

export function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

/** 줄의 단위마다 그룹을 불러 합친다 - 짝의 두 쪽이 서로 다른 관계 묶음일 수 있다 */
export async function loadRowGroup(bundleId: number, unitIds: number[]): Promise<Group> {
  return mergeGroups(await Promise.all(unitIds.map((id) => getGroupByUnit(bundleId, id))));
}

/** 줄의 문장 단위마다 New 후보를 받아 합친다 - 같은 문장은 한 번 */
export async function loadRowCandidates(bundleId: number, unitIds: number[]): Promise<NewCandidate[]> {
  const lists = await Promise.all(unitIds.map((id) => listNewCandidates(bundleId, id)));
  const seen = new Set<number>();
  return lists.flat().filter((item) => !seen.has(item.target_id) && seen.add(item.target_id));
}

/** 고른 곳이 가리키는 New 문서(To-Be 문서 id) - 잇기는 그 문장의 문서, 칸·step은 그 문서, 삭제·이동은 없다 */
export function findDestinationDoc(destination: Destination | null, written: Map<number, WrittenSentence>): number | null {
  if (destination === null) return null;
  if (destination.kind === "link") return written.get(destination.targetIds[0])?.target_doc_id ?? null;
  return "docId" in destination ? destination.docId : null;
}

/** Remark 창 - 고른 줄의 사유(저장이 사유를 요구해 열었으면 확인 뒤 그 저장을 잇는다) 또는 출처 없는 New 문장의 Remark */
export type RemarkEdit = { kind: "row"; need: "delete" | "move" | "hold" | "duplicate" | null; then: "confirm" | "hold" | null } | { kind: "new"; targetId: number };

/** 그 자리 메뉴 - 붙을 요소, 누른 자리(요소 기준, 키보드·이동이면 null), 어느 줄의 어느 New 문장에 대한 메뉴인지 */
export interface MenuState {
  /** 열 때마다 새 값 - 메뉴를 새로 그려 늦게 뜨는 움직임과 포커스 옮기기를 다시 한다 */
  seq: number;
  anchor: HTMLElement;
  offset: { x: number; y: number } | null;
  rowKey: string;
  targetId: number | null;
}

/** 누른 자리를 요소 기준으로 - 키보드로 누르면(detail 0) 포인터 자리가 없다 */
export function readMenuOffset(anchor: HTMLElement, event: MouseEvent | null): { x: number; y: number } | null {
  if (!event || event.detail === 0) return null;
  const rect = anchor.getBoundingClientRect();
  return {
    x: event.clientX - rect.left, y: event.clientY - rect.top,
  };
}

/** 그 자리 메뉴가 덮지 않을 상자 - New 문장이면 함께 골라지는 짝 문장 전부, Old 조각이면 그 줄의 조각 전부 */
export function readMenuCover(anchor: HTMLElement, rowUnitIds: number[]): HTMLElement[] {
  // 놓은 자리의 점선 초안·빈 칸 자리 표시·이미 쓴 표의 칸 - 그 상자 옆에 띄운다(Old 조각까지 덮지 않으려 하면 메뉴가 초안에서 멀어진다)
  if (anchor.matches(".new-draft, .new-slot-empty, .new-cell")) return [anchor];
  if (anchor.matches(".new-line")) {
    const group = anchor.getAttribute("data-pair-group");
    return group ? [...document.querySelectorAll<HTMLElement>(`.new-line[data-pair-group="${CSS.escape(group)}"]`)] : [anchor];
  }
  return rowUnitIds.flatMap((id) => [...document.querySelectorAll<HTMLElement>(`[data-testid="assign-paper-piece-${id}"]`)]);
}

/** 이동해 간 자리를 보이게 - 이미 화면 안이면 움직이지 않는다 */
export function revealElement(el: HTMLElement) {
  const pane = el.closest(".pane-body");
  if (!pane) return;
  const box = el.getBoundingClientRect();
  const frame = pane.getBoundingClientRect();
  if (shouldRecenter(box.top, box.bottom, frame.top, frame.bottom)) el.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}

/** 칸(.pane-body) 안의 조각을 보이게 - Old 용지와 Pair view 칸이 같이 쓴다. 조각은 그려지기 전 높이를 어림하므로(content-visibility), 멀리 부드럽게 굴리면
 *  지나가며 그려진 조각이 자라 목표가 밀려 화면 밖에서 멈춘다(잰 값, 극단 자료 OLD-90: Pair view 칸 5,000px, Pair view를 끈 뒤 Old 용지 11,000px 모자랐다).
 *  한 화면 안이면 지금처럼(부드럽게), 더 멀면 바로 옮기고 조각 윗변이 칸 안에 두 프레임 버틸 때까지(길어도 10프레임) 다시 맞춘다 - 다시 그려진 용지는 몇 프레임에 걸쳐 자란다 */
export function revealFarElement(el: HTMLElement) {
  const pane = el.closest(".pane-body");
  if (!pane) return;
  const box = el.getBoundingClientRect();
  const frame = pane.getBoundingClientRect();
  if (!shouldRecenter(box.top, box.bottom, frame.top, frame.bottom)) return;
  if (box.bottom > frame.top - frame.height && box.top < frame.bottom + frame.height) {
    revealElement(el);
    return;
  }
  el.scrollIntoView({ block: "center" });
  let frames = 0;
  let held = 0;
  const check = () => {
    if (!el.isConnected) return;
    const top = el.getBoundingClientRect().top;
    const now = pane.getBoundingClientRect();
    if (top >= now.top && top < now.bottom) held += 1;
    else {
      held = 0;
      el.scrollIntoView({ block: "center" });
    }
    if (held < 2 && ++frames < 10) requestAnimationFrame(check);
  };
  requestAnimationFrame(check);
}

/** 편집 뒤 뒤에서 다시 받는 목록의 키 - planReload가 고른 것만 하나씩 오른다(설계 D2) */
const NO_RELOAD_KEYS = { tobe: 0, written: 0, identical: 0, split: 0 };

/** 끝낸 Old 줄 수 - 확정만 센다(보류는 아직 끝나지 않았다) */
function countDone(rows: ClassifyRow[]): number {
  return rows.filter((row) => row.status === "confirmed").length;
}

/** 처리 중인 일 → 용지의 알약 · 쉬머 · 잠금(설계 2026-11-20 D4). 판단 저장은 잠그기만(결정 칸 단추가 이미 보인다), 묶음 전체 일은 알약이 없다(단추가 모두 꺼진다) */
function buildPaperPending(pending: readonly Pending[], t: (key: string) => string): PaperPending {
  const shimmerIds = new Set<number>();
  const lockedIds = new Set<number>();
  const pills: PaperPending["pills"][number][] = [];
  for (const entry of pending) {
    for (const id of entry.unitIds) lockedIds.add(id);
    const key = readPendingLabelKey(entry.kind);
    if (key === null) continue;
    for (const id of entry.unitIds) shimmerIds.add(id);
    if (entry.place.at !== "none") pills.push({ id: entry.id, kind: entry.kind, label: t(key), place: entry.place });
  }
  return { shimmerIds, lockedIds, pills };
}

/** Assign 화면 한 벌의 상태와 동작 - page.tsx가 그리는 데 쓰는 이름을 모두 돌려준다 */
export function useAssignPage() {

  const { t, lang: uiLang } = useI18n();
  const bundleId = Number(useParams<{ id: string }>().id);
  const { bundle } = useBundle(bundleId);
  const canEdit = bundle?.my_role === "author" && bundle.status === "in_progress";
  // 옛 "원문 고치기" 주소(?edit=문서 id 또는 first) - 그 화면은 없어졌다. 그 문서를 한 단으로 열고 주소에서 값을 뗀다(아래 openEditParam)
  const searchParams = useSearchParams();
  const editParam = searchParams.get(EDIT_ORIGINAL_PARAM);
  // 참조 지도의 줄에서 온 주소(?doc=문서 id&unit=Unit id) - 그 줄을 고르고 주소에서 값을 뗀다(아래 openLineParam). edit이 같이 있으면 edit이 이긴다
  const lineDocParam = searchParams.get(ASSIGN_DOC_PARAM);
  const lineUnitParam = searchParams.get(ASSIGN_UNIT_PARAM);
  const router = useRouter();

  // --- 데이터 ---
  const docs = useLoaded(() => listDocuments(bundleId), String(bundleId));
  const oldDocs = (docs.data ?? []).filter((doc) => doc.side === "old" && doc.status === "ready");
  const oldDocIds = oldDocs.map((doc) => doc.id);
  // Old 문서 보기와 Unit 줄 - 문서마다 쥐고, 편집 뒤에는 고친 문서만 다시 받는다(설계 2026-11-20 D2)
  const docViews = useDocViews(bundleId, docs.data === null ? null : oldDocIds);
  // 판단 저장 · AI 작업 끝 · 일괄 일 뒤에 오른다 - 아래 목록이 모두 다시 받는다(분류 · 묶기 · 무효 제안과 Remark 최근 목록은 이때만).
  // 편집 뒤에는 오르지 않고 planReload가 고른 목록의 키만 오른다
  const [unitsKey, setUnitsKey] = useState(0);
  const dataKey = `${bundleId}:${unitsKey}`;
  const [reloadKeys, setReloadKeys] = useState(NO_RELOAD_KEYS);
  const tobeKey = `${dataKey}:${reloadKeys.tobe}`;
  const writtenKey = `${dataKey}:${reloadKeys.written}`;
  // 저장할 때마다 다시 받는다 - 문장이 든 자리 수(sentence_counts)가 보낼 곳 지우기 단추를 잠근다
  const tobe = useLoaded(() => getToBe(bundleId), tobeKey);
  // 이 화면에서 보낼 곳을 더하거나 지운 응답 - 그 뒤에 다시 받은 목록이 올 때까지 이쪽이 더 새롭다
  const [tobeFresh, setTobeFresh] = useState<{ key: string; data: ToBe } | null>(null);
  const tobeData = tobeFresh !== null && (tobeFresh.key === tobeKey || tobe.isLoading) ? tobeFresh.data : tobe.data;
  const [isPlaceBusy, setIsPlaceBusy] = useState(false);
  const writtenList = useLoaded(() => listWrittenSentences(bundleId), writtenKey);
  const identical = useLoaded(() => listIdenticalCandidates(bundleId), `${dataKey}:${reloadKeys.identical}`);
  // AI 작업이 끝나면 단위·제안·New 문장을 다시 불러온다 - 제안이 보이고 다음 저장이 낡은 revision으로 409가 나지 않는다.
  // 원문 보기도 다시 받는다 - 나누기 제안 표시(split_suggestion_id)와 AI가 제안한 한/영 짝이 거기 실려 온다
  const aiJobs = useAiJobs(bundleId, () => {
    // 한 단으로 연 New 문서의 원문 보기도(그 문서의 나누기 제안 표시)
    setSoloKey((key) => key + 1);
    reloadData(true);
    void loadBundle(bundleId);
  });
  const aiOn = aiJobs.status?.ai_enabled ?? false;
  const aiBusy = (aiJobs.status?.jobs.queued ?? 0) + (aiJobs.status?.jobs.running ?? 0);
  const suggestions = useLoaded(() => listSuggestions(bundleId, "classify"), dataKey);
  const matchSuggestions = useLoaded(() => listAppliedSuggestions(bundleId, "match"), dataKey);
  // 답이 무효였던 분류 - 그 줄은 미배정 그대로라 카드 자리에 "고르지 못했다" 한 줄만(설계 §5 2-6)
  const invalidSuggestions = useLoaded(() => listSuggestions(bundleId, "classify", "invalid"), dataKey);

  /** 판단 저장 · AI 작업 끝 · 일괄 일 뒤 - Unit 줄 전체와 판단이 바꾸는 목록을 모두. withViews면 Old 문서 보기도(서버가 짝을 정리했다) */
  function reloadData(withViews = false) {
    void docViews.reload({ docs: withViews ? "all" : [], units: "all" });
    setUnitsKey((key) => key + 1);
  }
  // 단위마다 가장 새 분류 답이 무효인 것만 - 그 뒤에 나온 답이 있으면 무효는 지난 일이다
  const invalidUnitIds = useMemo(() => {
    const newest = new Map<number, AiSuggestion>();
    for (const item of [...(suggestions.data ?? []), ...(invalidSuggestions.data ?? [])]) {
      for (const id of item.content.unit_ids ?? []) if ((newest.get(id)?.id ?? 0) < item.id) newest.set(id, item);
    }
    return new Set([...newest].filter(([, item]) => item.result === "invalid").map(([id]) => id));
  }, [suggestions.data, invalidSuggestions.data]);
  // 단위마다 가장 최근의 적용된 제안(분류·짝) - 이유를 보이는 데만 쓴다. 보낼 곳 자체는 저장된 묶음에서 읽는다
  const suggestionOf = useMemo(() => {
    const map = new Map<number, AiSuggestion>();
    for (const item of [...(suggestions.data ?? []), ...(matchSuggestions.data ?? [])]) for (const id of item.content.unit_ids ?? []) if ((map.get(id)?.id ?? 0) < item.id) map.set(id, item);
    return map;
  }, [suggestions.data, matchSuggestions.data]);
  /** 용지 줄의 상태 - 살아 있는 제안이 있는 미배정 단위는 ai_suggested(글 아래 AI 간 곳 줄, readAiPlace). 판단 상태는 바꾸지 않는다 */
  function readMarkStatus(unitId: number): UnitRow["status"] | undefined {
    const status = unitMap.get(unitId)?.status;
    return status === "unassigned" && liveIndex.has(unitId) ? "ai_suggested" : status;
  }
  // 살아 있는 제안(사람이 아직 받거나 버리지 않은 것) - AI는 판단을 쓰지 않으니 줄의 AI 추천은 여기서만 나온다
  const liveIndex = useMemo(() => indexLiveSuggestions([...(suggestions.data ?? []), ...(matchSuggestions.data ?? [])]), [suggestions.data, matchSuggestions.data]);
  // 살아 있는 묶기 제안이 잇자고 한 새 문장 → 그 제안의 Old 단위 - New 칸의 "고른 줄의 AI만" 거르기가 읽는다
  const suggestedTargetUnits = useMemo(() => {
    const map = new Map<number, number[]>();
    for (const item of new Set(liveIndex.values())) {
      if (item.kind !== "match") continue;
      const destination = readSuggestedDestination(item);
      if (destination?.kind === "link") for (const id of destination.targetIds) map.set(id, item.content.unit_ids ?? []);
    }
    return map;
  }, [liveIndex]);

  const unitList = docViews.units;
  const unitMap = useMemo(() => new Map((unitList ?? []).map((row) => [row.unit_id, row])), [unitList]);
  const written = useMemo(() => writtenList.data ?? [], [writtenList.data]);
  // New 원문의 참조 줄 번호는 이 목록을 읽는 요청이 조회한다(한 번에 10개) - 조회 중인 줄이 남은 동안 다시 읽어 표시가 새로 고침 없이 채워지게 한다
  const refLookups = countRefLookups(written);
  useEquisPolling(refLookups > 0, writtenList.reload, refLookups);
  const writtenMap = useMemo(() => new Map(written.map((row) => [row.target_id, row])), [written]);
  // 칸 새 문장은 목록에 줄이 없다 - 그 칸이 든 표 줄로 문서를 읽는다(시안 2 D5 칸 잇기)
  const cellOwners = useMemo(() => buildCellOwners(written), [written]);
  const findWrittenRow = (targetId: number) => writtenMap.get(targetId) ?? cellOwners.get(targetId);
  const viewList = docViews.views;
  const rows = useMemo(() => (viewList ? buildRows(viewList, unitMap) : []), [viewList, unitMap]);
  const rowMap = new Map(rows.map((row) => [row.key, row]));
  const rowOfUnit = new Map(rows.flatMap((row) => row.unitIds.map((id) => [id, row.key] as const)));
  const options = useMemo(() => (tobeData ? buildDestinationOptions(tobeData) : []), [tobeData]);
  /** Old 줄 아래 AI 간 곳 글 - 살아 있는 제안이 덮는 미배정 줄만. 확정 줄의 간 곳 줄과 같은 자리에 쓴다(줄 끝 ✦ 대신, 사용자 결정 2026-11-20) */
  function readAiPlace(unitIds: number[]): string | null {
    if (!unitIds.some((id) => readMarkStatus(id) === "ai_suggested")) return null;
    const live = findRowSuggestion(unitIds, "unassigned", liveIndex);
    const place = live ? readSuggestionPlace(live, options) : null;
    return place === "delete" ? t("classify.deleted") : place;
  }
  const ready = viewList !== null && unitList !== null && tobeData !== null && writtenList.data !== null;
  const showSkeleton = useDelayedFlag(!ready && docs.error === null);
  const unsourced = listUnsourced(written);

  // --- 거르기: 누를 때만 다시 줄 세운다(확정한 줄은 그 자리에 남는다). Old 원문은 그대로 두고 ↑↓가 이 순서만 밟는다 ---
  const [mode, setMode] = useState<Mode>("old");
  // 처음에는 All(용지 전부, 안 접힘) - 명세 2026-11-12 §4.4
  const [filter, setFilter] = useState<Filter>("all");
  const [snapshot, setSnapshot] = useState<{ filter: Filter; keys: string[] } | null>(null);
  const counts: Record<Filter, number> = { unassigned: 0, ai_suggested: 0, on_hold: 0, confirmed: 0, all: rows.length };
  for (const row of rows) {
    counts[row.status] += 1;
    if (matchesFilter(row, "ai_suggested", liveIndex)) counts.ai_suggested += 1;
  }
  const listKeys = useMemo(() => {
    const keys = new Set(rows.map((row) => row.key));
    return snapshot && snapshot.filter === filter ? snapshot.keys.filter((key) => keys.has(key)) : rows.filter((row) => matchesFilter(row, filter, liveIndex)).map((row) => row.key);
  }, [snapshot, filter, rows, liveIndex]);

  // 처음 불러온 순간의 목록을 붙잡는다 - 그래야 확정한 줄이 거르기에서 바로 빠지지 않는다(렌더 중 상태 맞추기)
  if (snapshot === null && rows.length > 0 && unitList !== null) {
    setFilter("all");
    setSnapshot({ filter: "all", keys: rows.map((item) => item.key) });
  }

  // 필터 접기의 펼침 - 필터를 걸 때마다(같은 필터를 다시 눌러도) 모두 접힌다
  const [foldOpen, setFoldOpen] = useState<FoldOpen>(EMPTY_FOLD_OPEN);
  function applyFilter(next: Filter) {
    setMode("old");
    setFilter(next);
    setSnapshot({ filter: next, keys: rows.filter((row) => matchesFilter(row, next, liveIndex)).map((row) => row.key) });
    setFoldOpen(EMPTY_FOLD_OPEN);
  }
  // 접을 때 맞는 Unit - 필터를 건 때의 목록(스냅숏)이라 확정·보류로 상태가 바뀌어도 그 자리에서 접히지 않는다. 출처 없는 New 모드는 Old를 넓게 훑으니 접지 않는다
  const foldMatch = useMemo(() => {
    if (mode !== "old" || filter === "all") return null;
    const unitIdsOf = new Map(rows.map((row) => [row.key, row.unitIds]));
    return new Set(listKeys.flatMap((key) => unitIdsOf.get(key) ?? []));
  }, [mode, filter, listKeys, rows]);

  // 고름 · 처리 중 · 따라가기 한 곳(설계 2026-11-20 D1) - 줄 · 목차 블록 · New 문서 고름이 모두 focus 하나에서 나온다.
  // 처음에는 아무 조각도 고르지 않는다 - 오른쪽 칸이 범례를 보인다
  const focusCtl = useAssignFocus();
  const { focus } = focusCtl;
  // 묶음 전체 일(Undo/Redo · 일괄 · 같은 글자 확정)을 시작할 수 없다 - 다른 일이 하나라도 처리 중이면(설계 D1 규칙 6)
  const isAnyPending = focusCtl.isAnyPending;
  // 줄은 고른 Unit에서 파생한다 - 짝이 맺히거나 풀려 줄이 다시 묶여도 그 Unit의 줄을 그대로 고른다
  const activeKey = (focus.kind === "unit" ? rowOfUnit.get(focus.unitId) : undefined) ?? null;
  const row: ClassifyRow | null = activeKey ? (rowMap.get(activeKey) ?? null) : null;
  // 한 단 보기에서 연 이미 쓴 New 문서(그 파일의 문서 id)와 거기서 고른 문장 - Old 원문 자리에 그 원문을 놓고 같은 도구로 다듬는다.
  // 이 문서의 문장은 배정하지 않으므로 줄(row)이 없다. 줄을 고르면(Old 문서로 돌아가는 것이다) 닫힌다
  // inPlace는 양 단에서 New 칸의 문장을 그 자리에서 고른 것이다 - 왼쪽은 Old 문서 그대로이고, 다듬는 대상만 그 New 문서가 된다
  const solo = focus.kind === "new" ? focus : null;
  /** New 문서 고름을 바꾼다 - null이면 New 문서 고름만 놓는다(Old 줄 · 목차 고름은 그대로) */
  function setSolo(next: SoloPick | null | ((prev: SoloPick | null) => SoloPick | null)) {
    const value = typeof next === "function" ? next(solo) : next;
    if (value !== null) focusCtl.pick({ kind: "new", docId: value.docId, unitId: value.unitId, inPlace: value.inPlace });
    else if (focus.kind === "new") focusCtl.pick(NO_FOCUS);
  }
  // 고른 박스 - 짝 줄이어도 누른 박스 하나다(설계 D3). 짝의 다른 구성원은 용지가 곁에 딸린 표시(data-mate)로만 보인다
  const pickedId = focus.kind === "unit" && row !== null ? focus.unitId : null;
  /** 줄 키로 고른다 - unitId가 그 줄의 박스면 그 박스, 아니면 이미 고른 그 줄의 박스를 두고, 처음 고르는 줄이면 첫 박스. 고른 박스 id를 돌려준다 */
  function pickRowKey(key: string, unitId?: number): number | null {
    const target = rowMap.get(key);
    const boxId = target === undefined ? null : unitId !== undefined && target.unitIds.includes(unitId) ? unitId : pickedId !== null && target.unitIds.includes(pickedId) ? pickedId : target.unitIds[0];
    focusCtl.pick(target && boxId !== null ? { kind: "unit", docId: target.documentId, unitId: boxId } : NO_FOCUS);
    return boxId;
  }
  /** Old 줄 고름만 놓는다 - New 문서 · 목차 고름은 그대로 */
  function clearRowPick() {
    if (focus.kind === "unit") focusCtl.pick(NO_FOCUS);
  }
  const isSolo = solo !== null && !solo.inPlace && row === null;
  const isNewEdit = solo !== null && solo.inPlace && row === null;
  const hasSolo = isSolo || isNewEdit;
  // 고른 것의 단추를 끈다 - 묶음 전체 일 동안은 모두, 그 밖에는 고른 줄(또는 New 문서의 고른 문장)이 처리 중일 때만. 다른 박스를 고르면 그 박스의 일은 된다(설계 D4)
  const busy = focusCtl.isGlobalPending || (row?.unitIds.some(focusCtl.isUnitLocked) ?? false) || (hasSolo && solo !== null && solo.unitId !== null && focusCtl.isUnitLocked(solo.unitId));
  // 목차 블록 고름(MD 1 F6 · F12) - 배정 줄(row)이 아니라 남은 수·필터 수에 들지 않는다. 줄이나 New 문서를 고르면 가려진다.
  // unitId가 null이면 블록 전체, 아니면 펼친 블록의 줄 하나. 펼침은 블록 키(첫 줄 단위 id)로 이 화면을 연 동안만 기억한다(처음엔 접힘)
  const tocSel = focus.kind === "toc" ? focus : null;
  const [tocOpen, setTocOpen] = useState<ReadonlySet<number>>(() => new Set());
  const tocPick = mode === "old" && row === null && !hasSolo ? tocSel : null;
  // 줄 이동(↑↓·J/K) 순서에 끼우는 목차 블록 - 문서 순 → 원문 순
  const tocBlocks = useMemo(() => (viewList ?? []).flatMap((view) => listTocBlocks(view.units).map((block) => ({ ...block, docId: view.document.id }))), [viewList]);
  const [soloKey, setSoloKey] = useState(0);
  const soloLoad = useLoaded<DocumentView | null>(() => (solo !== null ? getDocumentView(bundleId, solo.docId) : Promise.resolve(null)), `${bundleId}:${solo?.docId ?? ""}:${soloKey}`);
  // 받은 보기를 고름에 알린다 - 편집 응답에서 건 따라가기가 그 박스를 고르고(고름이 누른 때 그대로일 때만), 사라진 Unit의 고름은 놓는다
  // (렌더 중 상태 맞추기, D1 규칙 3 · 5). Old 문서는 보기와 그 문서 줄을 한 번에 놓은 뒤에(useDocViews) - 줄은 둘 다에서 나와, 새 보기에 옛 줄이 섞인 렌더가 없다.
  // 알리는 문서는 이번에 보기를 놓은 문서만(줄만 다시 받았으면 모든 문서) - 다른 문서의 고름은 그 문서 보기가 오지 않았으니 그대로다
  const [seenLoad, setSeenLoad] = useState<{ placed: number; solo: DocumentView | null }>({ placed: 0, solo: null });
  if (viewList !== null && unitList !== null && docViews.placed !== seenLoad.placed) {
    const placed = docViews.placed;
    const placedIds = docViews.listPlacedSince(seenLoad.placed);
    setSeenLoad((prev) => ({ ...prev, placed }));
    const groupOf = new Map(viewList.flatMap((view) => view.units.map((unit) => [unit.id, unit.group_unit_id] as const)));
    const batchViews = placedIds.length > 0 ? viewList.filter((view) => placedIds.includes(view.document.id)) : viewList;
    const loaded = focusCtl.load({
      type: "loaded",
      docs: batchViews.map((view) => ({ docId: view.document.id, revision: view.document.revision, unitIds: new Set(view.units.map((unit) => unit.id)) })),
      // 칸 문장은 묶인 표의 줄이다 - 줄이 없는 Unit은 묶음으로 올린다
      liftUnit: (unitId) => {
        const groupId = groupOf.get(unitId) ?? null;
        return rowOfUnit.has(unitId) ? unitId : groupId !== null && rowOfUnit.has(groupId) ? groupId : null;
      },
    });
    // 편집 뒤에는 거르기 목록도 새 줄로 다시 잡는다 - 따라간 줄은 거르기에 맞지 않아도 남긴다.
    // 판단 저장 뒤(짝을 풀고 남은 문장으로 옮김)는 다시 잡지 않는다 - 확정한 줄이 거르기에서 바로 빠지지 않게
    if (loaded.consumed.some((follow) => follow.kind !== "save")) {
      const key = loaded.picked !== null && loaded.focus.kind === "unit" ? rowOfUnit.get(loaded.focus.unitId) : undefined;
      setSnapshot((prev) => prev && { filter: prev.filter, keys: rows.filter((item) => prev.filter === "all" || item.status === prev.filter || item.key === key).map((item) => item.key) });
    }
    if (loaded.picked !== null) scrollToUnit(loaded.picked.pickUnitId);
  }
  if (soloLoad.data !== null && !soloLoad.isLoading && soloLoad.data !== seenLoad.solo) {
    const soloData = soloLoad.data;
    setSeenLoad((prev) => ({ ...prev, solo: soloData }));
    const unitIds = new Set(soloData.units.map((unit) => unit.id));
    const loaded = focusCtl.load({ type: "loaded", docs: [{ docId: soloData.document.id, revision: soloData.document.revision, unitIds }], liftUnit: (unitId) => (unitIds.has(unitId) ? unitId : null) });
    if (loaded.picked !== null && loaded.focus.kind === "new" && !loaded.focus.inPlace) scrollToUnit(loaded.picked.pickUnitId);
  }
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [selNew, setSelNew] = useState<number | null>(null);
  // 출처 없는 New 문장마다 적는 중인 Remark - 없으면 저장된 값을 보인다
  const [newRemarks, setNewRemarks] = useState<Record<number, string>>({});
  // 그 자리 메뉴와 이동 - 이동은 고른 줄·열린 문서가 다시 그려진 뒤에 그 자리를 찾는다
  const [menu, setMenu] = useState<MenuState | null>(null);
  const menuSeq = useRef(0);
  /** at은 누른 자리를 이미 잰 것(요소 기준) - 끌어 놓은 자리처럼 클릭 이벤트가 없을 때 */
  function openMenu(anchor: HTMLElement, event: MouseEvent | null, rowKey: string, targetId: number | null, at: { x: number; y: number } | null = null) {
    menuSeq.current += 1;
    setMenu({ seq: menuSeq.current, anchor, offset: at ?? readMenuOffset(anchor, event), rowKey, targetId });
  }
  // at - 끌어 놓은 자리(그 줄 기준). 있으면 메뉴가 클릭으로 연 것처럼 이음 선 끝에 뜬다. 키보드·"→ 간 곳" 이동에는 없다
  // confirm - 끌어 놓아 고른 것이라 그 자리 메뉴 대신 바로 확정한다(1.2.0 피드백). 막는 까닭이 있으면 메뉴가 까닭과 함께 뜬다
  const [jump, setJump] = useState<{ side: "old" | "new"; id: number; targetId: number; rowKey: string; quiet?: boolean; at?: { x: number; y: number }; confirm?: boolean } | null>(null);
  // 고른 줄이 어떤 길로든 바뀌면(↑↓·저장 뒤 다음 줄·짝 풀림·문서 바꾸기) 메뉴를 닫는다 - 다른 줄에서 낡은 메뉴가 되살아나지 않게(렌더 중 상태 맞추기)
  if (menu !== null && menu.rowKey !== activeKey) setMenu(null);
  // 놓인 New 문장을 눌러 연 작은 메뉴(이 문장에 잇기 · 이 줄 다음에 놓기) - 그 문장 줄 상자, 누른 자리. 고른 줄이 바뀌면 닫는다
  // 빈 템플릿 박스 안 나눌 선(스텝 8) - 그 박스가 고른 줄에서 왔을 때만 보인다(Old 선처럼 다른 줄을 고르면 사라진다)
  const [composedCutAt, setComposedCutAt] = useState<{ targetId: number; at: number } | null>(null);
  const [joinMenu, setJoinMenu] = useState<{ seq: number; rowKey: string; targetId: number; anchor: HTMLElement; offset: { x: number; y: number } | null } | null>(null);
  if (joinMenu !== null && joinMenu.rowKey !== activeKey) setJoinMenu(null);
  // Old 문장 우클릭 메뉴 - 누른 Unit, 그 줄 상자, 연 때 고른 박스(boxId, New 문서면 null), 누른 자리와 글자 자리(키보드로 열었으면 없음).
  // 고른 줄이 바뀌거나 같은 짝 줄에서 다른 박스를 고르면 닫는다(설계 D3 - 고름은 박스 하나)
  const [ctxMenu, setCtxMenu] = useState<{ seq: number; unitId: number; boxId: number | null; rowKey: string; anchor: HTMLElement; click: { x: number; y: number } | null; caret: { blockId: number; offset: number } | null } | null>(null);
  if (ctxMenu !== null && (ctxMenu.rowKey !== (activeKey ?? (hasSolo ? SOLO_ROW_KEY : null)) || (ctxMenu.boxId !== null && ctxMenu.boxId !== pickedId))) setCtxMenu(null);
  // 나눌 선이 놓인 Unit - 고른 줄 안의 것만 산다(줄을 바꾸면 선이 사라진다)
  const [cutUnitId, setCutUnitId] = useState<number | null>(null);
  const focusNew = mode === "unsourced" ? (unsourced.find((item) => item.target_id === selNew)?.target_id ?? unsourced[0]?.target_id ?? null) : null;

  // --- 고른 줄의 관계 묶음·후보와 초안 ---
  // 짝을 풀면 줄 키는 그대로인데 단위가 달라질 수 있다 - 줄의 단위를 키에 넣어 묶음·후보를 다시 받는다
  // 판단이 바뀌면(저장 · 일괄 · 되돌리기) 그 Unit의 판단 revision이 오른다 - 키는 그것으로, 다른 줄 · 다른 문서의 편집 뒤에는 다시 받지 않는다(설계 D2).
  // 그 줄의 문서 보기를 다시 받는 동안과, 처리 중인 일이 그 줄의 Unit을 은퇴시켰을 수 있는 동안(isViewSettled 거짓)은 묶음·후보를 부르지 않는다
  // (서버는 응답 전에 이미 바꿨을 수 있다 - 둘째 Undo가 처리 중일 때 첫 Undo의 다시 받기가 닿으면 은퇴할 줄의 묶음을 불러 404였다, D1 규칙 5.
  // 안 끝나는 약속은 그 자리의 이전 값을 두고 isLoading만 켠다)
  const isViewSettled = row === null || (!docViews.isReloading(row.documentId) && !row.unitIds.some((id) => focusCtl.isUnitUnsettled(row.documentId, id)));
  const rowKey = `${activeKey}:${row?.unitIds.map((id) => `${id}.${unitMap.get(id)?.decision.revision ?? ""}`).join(",") ?? ""}${isViewSettled ? "" : ":wait"}`;
  const group = useLoaded<Group | null>(() => (!row ? Promise.resolve(null) : !isViewSettled ? new Promise<never>(() => undefined) : loadRowGroup(bundleId, row.unitIds)), rowKey);
  const groupData = group.data;
  const sentenceUnitIds = (row?.unitIds ?? []).filter((id) => unitMap.get(id)?.kind !== "table" && unitMap.get(id)?.kind !== "figure");
  const similar = useLoaded<NewCandidate[]>(
    () => (written.length > 0 && sentenceUnitIds.length > 0 ? (isViewSettled ? loadRowCandidates(bundleId, sentenceUnitIds) : new Promise<never>(() => undefined)) : Promise.resolve([])),
    // 후보는 New 문장 목록에서 고른다 - 그 목록을 다시 받으면(판단 저장 · 판단을 푼 편집) 후보도
    `${rowKey}:${written.length > 0}:${writtenKey}`,
  );
  const [drafts, setDrafts] = useState<Record<string, PageDraft>>({});
  const draft = (activeKey && drafts[activeKey]) || EMPTY_DRAFT;
  const editing = draft.editing;
  // 고른 줄의 묶음이 아직 오지 않았으면 저장하지 않는다(이전 줄의 묶음으로 요청을 만들게 된다)
  const groupPending = group.isLoading || (row !== null && groupData === null);
  const savedDestination = readDestination(groupData, row?.unitIds ?? []);
  const destination: Destination | null = draft.destination ?? savedDestination;
  const rowUnits: UnitRow[] = (row?.unitIds ?? []).map((id) => unitMap.get(id)).filter((unit): unit is UnitRow => unit !== undefined);
  const rowLangs = rowUnits.map((unit) => unit.lang);
  const firstDecision = rowUnits[0]?.decision;
  // system: 코드는 사람 사유가 아니다 - 사유 칸에 넣지 않고 아래에 사람 말로 보인다(넣으면 삭제가 실제 사유 없이 통과한다)
  const savedReason = rowUnits.map((unit) => readHumanReason(unit.decision)).find(Boolean) ?? "";
  const systemHold = rowUnits.map((unit) => findSystemHold(unit.decision)).find((code) => code !== null) ?? null;
  const reasonNow = draft.reason ?? savedReason;
  const moveCode = draft.moveCode ?? firstDecision?.move_target_code ?? "";

  function setDraft(patch: Partial<PageDraft>, nextEditing = editing) {
    if (!activeKey) return;
    // 보낼 곳을 바꾸는 길은 모두 여기를 지난다 - Use로 받은 제안은 그 제안의 자리를 고른 채일 때만 산다(그 밖은 받은 것이 아니다)
    const use = "destination" in patch && !("suggestionId" in patch) ? { suggestionId: null } : {};
    setDrafts((prev) => ({ ...prev, [activeKey]: { ...draft, ...patch, ...use, editing: nextEditing } }));
  }

  function dropDraft(key: string) {
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  // 저장 전 고름·고친 글이 남은 줄이 있으면 다른 화면으로 가기 전에 묻는다(초안은 이 화면의 상태라 나가면 사라진다)
  const unsavedCount = Object.values(drafts).filter(hasDraftChange).length;
  const [leaveTo, setLeaveTo] = useState<string | null>(null);
  useLeaveGuard(unsavedCount > 0, setLeaveTo);

  // --- 추천(① 추천 카드) - 저장된 AI 제안 → 같은 글자 → 비슷한 문장 ---
  // 줄의 AI 추천 - 미배정 줄을 덮는 살아 있는 제안. 카드를 누르거나 A(Use)로 받으면 초안이 채워지고 확정은 사람이 한다(설계 §5 2-1)
  const rowLive = row ? findRowSuggestion(row.unitIds, row.status, liveIndex) : null;
  const aiDest = rowLive ? readSuggestedDestination(rowLive) : null;
  const aiWhy = typeof rowLive?.content.reason === "string" ? rowLive.content.reason : "";
  const isAiRow = aiDest !== null;
  const recommendations: Recommendation[] = row
    ? buildRecommendations({
        aiLinks: aiDest?.kind === "link" ? [{ targetIds: aiDest.targetIds, why: aiWhy }] : [],
        aiPlaces: aiDest && aiDest.kind !== "link" ? [{ destination: aiDest, why: aiWhy }] : [],
        identical: (identical.data ?? []).filter((item) => row.unitIds.includes(item.unit_id)).map((item) => item.target_id),
        similar: similar.data ?? [],
        headingPlaces: rowUnits.some(isBandHeading),
      }, (ids) => addPartnerTargets(ids, writtenMap))
    : [];
  const linkIds = destination?.kind === "link" ? destination.targetIds : [];
  // 고른 문장의 관계 묶음(합쳐진 다른 출처 등)은 고를 때 부른다 - 함께 확정되는 것을 미리 보이고 저장도 같은 묶음으로 한다
  const knownTargets = new Set(groupData?.targets.map((target) => target.id) ?? []);
  const missingIds = listJoinedTargetIds(destination).filter((id) => !knownTargets.has(id));
  const pickedGroups = useLoaded<Group[]>(
    () => (missingIds.length > 0 ? Promise.all(missingIds.map((id) => getGroupByTarget(bundleId, id))) : Promise.resolve([])),
    `${rowKey}:${missingIds.join(",")}`,
  );
  const saveGroupData = groupData ? mergeGroups([groupData, ...(pickedGroups.data ?? [])]) : null;
  const candidateIds = new Set(destination ? [] : recommendations.flatMap((rec) => (rec.destination.kind === "link" ? rec.destination.targetIds : [])));

  // --- 원문 두 칸 ---
  const viewOf = (docId: number | undefined) => (viewList ?? []).find((view) => view.document.id === docId) ?? null;
  const [manualOldDoc, setManualOldDoc] = useState<number | null>(null);
  const soloView = hasSolo && soloLoad.data?.document.id === solo.docId ? soloLoad.data : null;
  const oldView = isSolo ? soloView : viewOf(row?.documentId ?? manualOldDoc ?? oldDocIds[0]);
  // AI 추천 일괄 수락 - 상단 바 AI 알약 메뉴가 연다(그 알약은 묶음을 몰라 이 화면이 묶음·지금 Old 문서의 건수를 올려 둔다, 설계 §5 3-1)
  const [acceptKind, setAcceptKind] = useState<AcceptKind | null>(null);
  const acceptDoc = oldView && oldView.document.side === "old" ? { id: oldView.document.id, label: oldView.document.doc_code || oldView.document.file_name } : null;
  const acceptCounts = countLiveOffer([...(suggestions.data ?? []), ...(matchSuggestions.data ?? [])], acceptDoc?.id ?? null);
  useRegisterAiAcceptOffer(canEdit ? { bundleId, counts: acceptCounts } : null, setAcceptKind);
  const paperModel = useMemo(() => (oldView ? buildPaperModel(oldView) : null), [oldView]);
  // 처리 중인 일의 알약 · 쉬머 · 잠금 - 같은 목록이면 같은 값이라 용지의 먼 덩어리를 다시 그리지 않는다
  const pendingList = focusCtl.pending;
  const paperPending = useMemo(() => buildPaperPending(pendingList, t), [pendingList, t]);
  // Pair view - 한/영 따로 문서를 KO | EN 두 칸으로 편 문서 id. 이 화면을 연 동안만 기억한다(새로 고치면 꺼져 있다).
  // 다른 문서·한 단의 New 문서 원문·출처 없는 New로 가면 꺼진다(렌더 중 상태 맞추기 - dropLink와 같은 짜임)
  const [pairViewDoc, setPairViewDoc] = useState<number | null>(null);
  const canPairView = mode === "old" && !hasSolo && oldView?.document.language_layout === "ko_en_separate";
  const isPairView = canPairView && pairViewDoc === oldView?.document.id;
  if (oldView && pairViewDoc !== null && !isPairView) setPairViewDoc(null);
  const pairColumns = useMemo(() => (isPairView && oldView ? buildPairColumns(oldView) : null), [isPairView, oldView]);
  // 줄 이동(↑↓·J/K) 순서 - 평소는 박스 하나씩, Pair view는 한 줄에 두 언어가 나란하니 줄 하나씩(설계 D3). 목차 블록도 한 자리
  const navKeys = useMemo(() => {
    const position = new Map<number, readonly [number, number, number]>();
    (viewList ?? []).forEach((view, docAt) => {
      for (const unit of view.units) position.set(unit.id, [docAt, unit.pos_seq, unit.spans[0]?.[1] ?? 0]);
    });
    return buildNavKeys(rows, tocBlocks, position, { byUnit: !isPairView });
  }, [viewList, rows, tocBlocks, isPairView]);
  const pairLinks = useMemo(() => (pairColumns ? listPairLinks(pairColumns) : []), [pairColumns]);
  // 켜기 전 Old 용지의 스크롤 자리 - 고른 줄 없이 끄면 이리로 돌아간다
  const pairScrollRef = useRef(0);
  // 고른 줄 없이 끈 뒤 그 자리로 되풀이해 맞추는 중이면 그 멈춤 함수
  const pairRestoreRef = useRef<(() => void) | null>(null);
  // 본문·머리말·꼬리말 탭 - 고른 조각이 다른 탭에 있으면 그 탭으로 가고, 사람이 고른 탭은 그 줄에서 그대로 둔다
  const partKeys = useMemo(() => (paperModel ? (["body", "header", "footer", "figures"] as const).filter((key) => paperModel[key].length > 0) : []), [paperModel]);
  // 그림 탭으로 간 단위(모든 Old 문서) - J/K가 그림 탭에서는 이것만, 다른 탭에서는 이것을 건너뛴다(시안 2 D3)
  const figureTabIds = useMemo(() => new Set((viewList ?? []).flatMap((view) => [...listFigureTabUnitIds(view)])), [viewList]);
  const paperTabs = useMemo(() => (oldView && paperModel ? buildPaperTabs(oldView, paperModel) : null), [oldView, paperModel]);
  // AI 나누기 제안 - 보는 Old 문서의 아직 정하지 않은 것. 문장마다 가장 새 제안 하나(전에는 쪼개기 화면에서만 적용·거절했다)
  const oldDocId = oldView?.document.id ?? null;
  useAiPrepare(bundleId, { enabled: canEdit && aiOn, documentId: oldDocId, onQueued: (n) => { showToast(t("ai.prepareQueued", { n })); aiJobs.watch(); } });
  const splitSuggestions = useLoaded(() => (aiOn && oldDocId !== null ? listAppliedSuggestions(bundleId, "split", oldDocId) : Promise.resolve([])), `${aiOn}:${oldDocId}:${dataKey}:${reloadKeys.split}`);
  const splitByUnit = useMemo(() => {
    const map = new Map<number, AiSuggestion>();
    for (const item of splitSuggestions.data ?? []) {
      const unitId = item.content.unit_id;
      // 용지의 그 문장이 아직 이 제안을 달고 있을 때만(이미 잘렸거나 다른 문서의 것은 뺀다)
      if (typeof unitId === "number" && item.adoption === null && paperModel?.units.get(unitId)?.split_suggestion_id === item.id) map.set(unitId, item);
    }
    return map;
  }, [splitSuggestions.data, paperModel]);
  const partOf = paperTabs?.tabOf ?? null;
  // 다듬는 대상의 원문 - 보통은 왼쪽 용지(Old 문서, 또는 한 단으로 연 New 문서)이고, 양 단에서 New 문장을 고쳤으면 그 New 문서다
  const newEditModel = useMemo(() => (isNewEdit && soloView ? buildPaperModel(soloView) : null), [isNewEdit, soloView]);
  const newEditTabs = useMemo(() => (isNewEdit && soloView && newEditModel ? buildPaperTabs(soloView, newEditModel) : null), [isNewEdit, soloView, newEditModel]);
  const shapeView = isNewEdit ? soloView : oldView;
  const shapeModel = isNewEdit ? newEditModel : paperModel;
  const shapeTabs = isNewEdit ? newEditTabs : paperTabs;
  // New 문서에서 고른 문장과 그 짝 - 줄 대신 이것이 "고른 것"이다
  const soloUnit = hasSolo && solo.unitId !== null ? (shapeModel?.units.get(solo.unitId) ?? null) : null;
  const soloUnits: ViewUnit[] = soloUnit === null ? [] : soloUnit.pair_id === null ? [soloUnit] : (shapeView?.units ?? []).filter((unit) => unit.pair_id === soloUnit.pair_id);
  const cutUnit = cutUnitId !== null && (row?.unitIds.includes(cutUnitId) || soloUnits.some((unit) => unit.id === cutUnitId)) ? (shapeModel?.units.get(cutUnitId) ?? null) : null;
  const cutLine = useCutLine(cutUnit);
  // Old 조각 → 그 조각을 출처로 쓴 New 문장들(연결 배지)
  const linkedTargets = useMemo(() => {
    const map = new Map<number, WrittenSentence[]>();
    for (const item of written) for (const unitId of item.source_unit_ids) map.set(unitId, [...(map.get(unitId) ?? []), item]);
    return map;
  }, [written]);
  const [manualPart, setManualPart] = useState<{ key: string; part: PaperTabKey } | null>(null);
  const wantedPart = (manualPart?.key === (activeKey ?? "") ? manualPart.part : null) ?? partOf?.get(row?.unitIds[0] ?? (isSolo ? soloUnit?.id : undefined) ?? -1) ?? "body";
  const activePart = partKeys.includes(wantedPart) ? wantedPart : (partKeys[0] ?? "body");
  // 필터 접기 - 지금 문서·부분에 맞는(또는 고른) Unit이 없으면 용지 대신 빈 상태와 맞는 곳 바로 가기(저절로 옮기지 않는다)
  const isInPart = (unitId: number) => partKeys.length <= 1 || partOf?.get(unitId) === activePart;
  const isFoldEmpty = !isSolo && foldMatch !== null && oldView !== null && !oldView.units.some((unit) => isInPart(unit.id) && (foldMatch.has(unit.id) || (row?.unitIds.includes(unit.id) ?? false)));
  const foldElsewhere = useMemo(() => {
    if (!isFoldEmpty || !viewList) return [];
    const tabOfDoc = new Map<number, Map<number, PaperTabKey>>();
    const readTabOf = (docId: number) => {
      if (!tabOfDoc.has(docId)) {
        const view = viewList.find((item) => item.document.id === docId);
        tabOfDoc.set(docId, view ? buildPaperTabs(view, buildPaperModel(view)).tabOf : new Map());
      }
      return tabOfDoc.get(docId) ?? new Map<number, PaperTabKey>();
    };
    const rowOf = new Map(rows.map((item) => [item.key, item]));
    const places = new Map<string, { docId: number; part: PaperTabKey; count: number }>();
    for (const key of listKeys) {
      const item = rowOf.get(key);
      if (!item) continue;
      const part = readTabOf(item.documentId).get(item.unitIds[0]) ?? "body";
      const place = places.get(`${item.documentId}-${part}`) ?? { docId: item.documentId, part, count: 0 };
      place.count += 1;
      places.set(`${item.documentId}-${part}`, place);
    }
    return [...places.values()];
  }, [isFoldEmpty, viewList, listKeys, rows]);
  const writtenDocs = [...new Map(written.map((item) => [item.target_doc_id, item.doc_code])).entries()];
  // 오른쪽 칸은 항상 열려 있다 - 쓴 New 문서가 없으면 빈 안내
  // 아직 쓰지 않은 문서(To-Be의 Assign 입구) - 오른쪽 칸에 지금까지의 배정으로 엮어 보인다(서버 결과물 C 규칙, 읽기 전용)
  const composedDocs = (tobeData?.docs ?? []).filter((doc) => doc.entrance === "assign");
  const [manualNewDoc, setManualNewDoc] = useState<{ key: string; docId: number } | null>(null);
  // 방금 확정해 보낸 곳 - 확정 뒤 고른 줄(key)에 있는 동안만 오른쪽 칸을 그 문서에 두고 그 문장을 잇는 선을 진하게. 손으로 고른 문서가 먼저, 다른 줄로 옮기면 평소대로
  const [liveNew, setLiveNew] = useState<{ key: string; docId: number; targetIds: number[]; seq: number } | null>(null);
  const toggleKey = mode === "unsourced" ? "unsourced" : (activeKey ?? "");
  const unsourcedDoc = mode === "unsourced" ? (writtenMap.get(focusNew ?? -1)?.target_doc_id ?? null) : null;
  const liveDoc = liveNew?.key === toggleKey ? liveNew : null;
  // 지금 New 칸에 띄운 문서 - Old 줄을 바꿔도 그대로 둔다(1.2.0 피드백). 추천 카드·나무 항목·New 문장 고르기·끌어 놓기처럼 사람이 고른 곳으로만 옮긴다
  const [heldNewDoc, setHeldNewDoc] = useState<number | null>(null);
  const isNewDocOpen = (docId: number | null) => docId !== null && (writtenDocs.some(([id]) => id === docId) || composedDocs.some((doc) => doc.id === docId));
  const newDocId = (manualNewDoc?.key === toggleKey ? manualNewDoc.docId : null) ?? liveDoc?.docId ?? unsourcedDoc ?? (isNewDocOpen(heldNewDoc) ? heldNewDoc : null) ?? writtenDocs[0]?.[0] ?? composedDocs[0]?.id ?? null;
  if (newDocId !== null && newDocId !== heldNewDoc) setHeldNewDoc(newDocId);
  // AI 제안 알약으로 다른 New 문서를 열기 전에 보던 문서 - 그 줄(key)에 있는 동안 알약이 돌아가기가 된다
  const [newAiReturn, setNewAiReturn] = useState<{ key: string; docId: number } | null>(null);
  const isComposedDoc = newDocId !== null && !writtenDocs.some(([docId]) => docId === newDocId);
  // 이미 쓴 New 문서의 올린 파일(문서) id - 원문 고치기를 그 문서로 연다
  const newFileId = (tobeData?.docs ?? []).find((doc) => doc.id === newDocId)?.document_id ?? null;
  const composed = useLoaded(
    () => (isComposedDoc && newDocId !== null ? getComposedDoc(bundleId, newDocId, uiLang) : Promise.resolve(null)),
    // 엮은 문서는 New 문장 목록과 함께 바뀐다(판단 저장 · 판단을 푼 편집 · New 문서 편집)
    `${isComposedDoc ? newDocId : ""}:${writtenKey}:${uiLang}`,
  );
  // 저장 응답으로 미리 고친 엮은 문서 - 그때 받아 둔 문서(base)가 그대로인 동안만, 다시 읽은 서버 값이 오면 그것
  const [composedPatch, setComposedPatch] = useState<{ base: ComposedDoc; doc: ComposedDoc } | null>(null);
  const composedData = composed.data?.target_doc_id === newDocId ? composed.data : null;
  const composedDoc = composedData && composedPatch?.base === composedData ? composedPatch.doc : composedData;
  const newRows: NewPaneRow[] = isComposedDoc ? (composedDoc ? buildComposedRows(composedDoc) : []) : written.filter((item) => item.target_doc_id === newDocId);
  // 엮은 문서의 칸 머리 옆 칸 제목 출처 - 이미 쓴 문서에는 칸 제목이 없다
  const headingNotes = isComposedDoc && composedDoc ? listHeadingNotes(composedDoc) : undefined;
  const sectionMarks = isComposedDoc && composedDoc ? listSectionMarks(composedDoc) : undefined;
  // 고른 Old 줄을 더 이을 수 있는 놓인 문장 - 글 단위가 있는 줄(표·그림 줄은 아니다)을 고르고 편집할 수 있을 때만. 누르면 작은 메뉴가 뜬다
  const joinRowUnits = rowUnits.filter((unit) => isSentenceUnit(unit.kind)).map((unit) => ({ id: unit.unit_id, lang: unit.lang }));
  const joinableIds = listJoinableIds(isComposedDoc ? composedDoc : null, joinRowUnits, canEdit && mode === "old" && !isNewEdit && row !== null && joinRowUnits.length === rowUnits.length);
  // 템플릿 보기의 이름 사전(한글 절반의 6장 절 · 5장 범주 이름, WI 단계 이름) - 문서나 To-Be가 바뀔 때만 다시 짓는다(보기 모양 계산이 이것을 기억 키로 쓴다)
  const composedCode = composedDoc?.code ?? null;
  const templateTitles = useMemo(() => (tobeData && composedCode !== null ? buildTemplateTitles(tobeData, composedCode) : null), [tobeData, composedCode]);
  // 두 문서 사이 이음 - 저장된 출처와 고른 줄의 저장 전 고름
  const oldUnitIds = useMemo(() => new Set(oldView?.units.map((unit) => unit.id) ?? []), [oldView]);
  const linkPairs = buildLinkPairs(newRows.filter(isWrittenRow), oldUnitIds, draft.destination?.kind === "link" ? { units: rowUnits.map((unit) => ({ id: unit.unit_id, lang: unit.lang })), targetIds: draft.destination.targetIds } : null);

  const [view, setView] = useState(readAssignView);
  const paneSlide = usePaneSlide(view.single);
  function changeView(patch: Partial<typeof view>) {
    // 보기 단추(한 단·양 단)·세로선 끝까지 접기는 Pair view를 끄고 눌린 보기로 간다 - 다시 그려진 Old 용지는 고른 조각(없으면 켜기 전 자리)을 보인다
    if (patch.single !== undefined && isPairView) closePairView();
    // 한 단 ↔ 양 단 - 바꾸기 전 Old 용지의 자리를 재 둔다(바뀐 뒤 그 자리에서 미끄러져 온다)
    if (patch.single !== undefined && patch.single !== view.single) paneSlide.capture();
    // 양 단으로 펴면 한 단으로 연 New 문서는 닫힌다(양 단의 왼쪽은 늘 Old 문서다). 한 단으로 접으면 New 칸에서 고르던 문장은 그 문서를 한 단으로 연 것이 된다
    if (patch.single === false) setSolo(null);
    else if (patch.single === true) setSolo((prev) => (prev?.inPlace ? { ...prev, inPlace: false } : prev));
    setView((prev) => ({ ...prev, ...patch }));
    writeAssignView(patch);
  }
  function zoomPane(pane: PaneKey, dir: ZoomDir) {
    const name = pane === "old" ? "zoomOld" : "zoomNew";
    changeView({ [name]: stepZoom(view[name], dir) });
  }
  const panesRef = usePaneZoom(zoomPane);
  // 같은 틀을 끌기 층도 쓴다(끌어서 잇기) - 확대 훅은 콜백 ref라 틀 요소를 따로 들고 있는다
  const panesBoxRef = useRef<HTMLDivElement | null>(null);
  const setPanes = useCallback(
    (el: HTMLDivElement | null) => {
      panesBoxRef.current = el;
      panesRef(el);
    },
    [panesRef],
  );

  // --- AI 요청 ---
  async function askAiScope(kind: AiKind, body: AiScope & { direction?: "ko_to_en" | "en_to_ko" }) {
    try {
      const result = await requestAi(bundleId, kind, body);
      showToast(result.queued > 0 ? t("ai.queuedCount", { n: result.queued }) : t("ai.nothingQueued", { n: result.skipped_total }));
      aiJobs.watch();
    } catch (err) {
      showToast(humanizeApiError(err, t), "error");
    }
  }
  const aiMenuItems: AiAskItem[] = [];
  if (oldView) aiMenuItems.push({ key: "document", label: t("ai.classifyDocument"), run: () => askAiScope("classify", { document_id: oldView.document.id }) });
  if (writtenDocs.length > 0) aiMenuItems.push({ key: "match", label: t("ai.kind.match"), run: () => askAiScope("match", {}) });
  if (row && row.status !== "unassigned" && rowLangs.includes("ko")) aiMenuItems.push({ key: "to-en", label: t("ai.translateToEn"), run: () => askAiScope("translate", { unit_ids: row.unitIds, direction: "ko_to_en" }) });
  if (row && row.status !== "unassigned" && rowLangs.includes("en")) aiMenuItems.push({ key: "to-ko", label: t("ai.translateToKo"), run: () => askAiScope("translate", { unit_ids: row.unitIds, direction: "en_to_ko" }) });
  // 서버가 건너뛸 줄(제목·표, 사람이 정했거나 짝 맞추기 제안이 채운 문장)이면 미리 끄고 까닭을 툴팁으로
  const splitBlock = findSplitBlock(rowUnits.map((unit) => ({ ...unit, suggestionKind: suggestionOf.get(unit.unit_id)?.kind ?? null })));
  if (row) aiMenuItems.push({ key: "split", label: t("ai.splitRow"), disabledReason: splitBlock ? t(`ai.splitRowBlocked.${splitBlock}`) : null, run: () => askAiScope("split", { unit_ids: row.unitIds }) });
  // 문서 전체 요청 두 가지 - 전에는 쪼개기 화면 용지 위 막대에만 있었다. 짝 제안은 한글·영어가 따로 적힌 문서에서만
  if (oldView) aiMenuItems.push({ key: "split-document", label: t("ai.askSplitShort"), run: () => askAiScope("split", { document_id: oldView.document.id }) });
  if (oldView?.document.language_layout === "ko_en_separate") aiMenuItems.push({ key: "pair-document", label: t("ai.askPairShort"), run: () => askAiScope("pair", { document_id: oldView.document.id }) });

  const [remarkEdit, setRemarkEdit] = useState<RemarkEdit | null>(null);
  // Remark 창을 닫은 뒤 포커스를 둘 단추(testid) - 창이 여는 곳으로 되돌린 뒤에 옮겨 ↵가 바로 확정이 되게
  const focusAfterRef = useRef<string | null>(null);
  const firstTextRef = useRef<HTMLTextAreaElement>(null);
  // 배정이 걸린 문장을 자르거나 합치려 할 때 - 서버가 409 confirm_required로 물으면 확인을 받아 배정을 풀며 다시 보낸다(원문 고치기와 같은 규칙, 설계 2026-11-15 §3.5)
  // 다시 보낼 일은 함수가 아니라 값으로 둔다 - 확인을 누른 그때의 화면 값(원문 보기·문서 판)으로 보내야 고친 뒤 새 줄을 따라간다
  const [editConfirm, setEditConfirm] = useState<{ count: number; retry: ConfirmedEdit } | null>(null);
  // 표 벗기기 · 다시 표로의 풀기 전환(걷기 · 펼치기 · 붙이기, F10) - Old 칸 안에서 바뀌는 표를 찾고 잰다
  const oldPaneRef = useRef<HTMLElement | null>(null);
  const unwrapMotion = useUnwrapMotion(oldPaneRef);
  // 되돌리기 기록은 이 화면을 연 동안만 - 세션 키가 서버 기록을 가른다(설계 docs/superpowers/specs/2026-11-13-assign-undo-design.md)
  const undoSession = useRef(genId());
  const [undoState, setUndoState] = useState({ canUndo: false, canRedo: false });
  function buildUndo(extra: Omit<UndoMeta, "session"> = {}): UndoMeta {
    return { session: undoSession.current, ...extra };
  }
  /** 기록된 저장이 끝남 - 새 단계가 생겼으니 다시 하기 줄은 버려진다 */
  function markRecorded() {
    setUndoState({ canUndo: true, canRedo: false });
  }
  const [bulk, setBulk] = useState<"delete" | "move" | null>(null);
  const [confirmingIdentical, setConfirmingIdentical] = useState(false);
  const [resetScope, setResetScope] = useState<ResetScope | null>(null);
  const [openAcc, setOpenAcc] = useState<{ key: string; open: Set<string> }>({ key: "", open: new Set(["rec"]) });
  const accOpen = openAcc.key === toggleKey ? openAcc.open : new Set(["rec"]);
  function toggleAcc(section: string) {
    const next = new Set(accOpen);
    if (next.has(section)) next.delete(section);
    else next.add(section);
    setOpenAcc({ key: toggleKey, open: next });
  }

  const saveUnits = rowUnits.map((unit) => ({ id: unit.unit_id, kind: unit.kind, lang: unit.lang, text: unit.text, content_start: unit.content_start, revision: unit.decision.revision }));
  // 새 문장 칸 - AI가 나눈 문장은 칸 여럿, 합친 문장은 칸 하나다
  const slots = buildSentenceSlots(groupData, saveUnits, draft.otherLang ?? null);
  // Use(A)가 받는 카드 - 줄의 AI 추천 중 첫째
  const aiRecommendation = recommendations.find((rec) => rec.source === "ai") ?? null;
  // AI가 나누거나 합쳐 칸에 채우지 못한 고쳐 쓴 글 - 받을 때 카드에 글을 보여 사람이 옮긴다
  const aiUnfilled = rowLive ? buildUseDraft(rowLive, slots).unfilledLangs : [];

  // 지금 줄의 초안이 열린 엮은 문서의 칸이면 New 칸에 그린다 - 문장 사이에 놓은 자리면 점선 초안, 자리 없이 빈 칸이면 그 자리 표시의 테두리
  const draftPlace = draft.destination?.kind === "slot" || draft.destination?.kind === "step" ? draft.destination : null;
  const draftSectionKey = getSectionKey(draftPlace);
  const draftSection = isComposedDoc && composedDoc && draftPlace && draftPlace.docId === composedDoc.target_doc_id ? (composedDoc.sections.find((section) => section.location_key === draftSectionKey) ?? null) : null;
  const draftPosition = draft.position && draftPlace && draft.position.placeId === getDestinationId(draftPlace) ? draft.position : null;
  // 다시 읽은 문서에서 그 자리의 문장이 사라졌으면 자리만 버린다 - 칸 초안으로 남는다(렌더 중 상태 맞추기)
  if (draftPosition && composedDoc && draftSectionKey !== null && draftPlace?.docId === composedDoc.target_doc_id && !isPositionLive(buildDropSections(composedDoc.sections, (unitId) => rowOfUnit.get(unitId)), draftSectionKey, draftPosition.after)) {
    setDraft({ position: null });
  }
  let newDraft: { anchorKey: string; side: "before" | "after"; lines: DraftLine[] } | null = null;
  let draftSlotKey: string | null = null;
  if (draftSection && draftPosition && draftSection.items.length > 0) {
    // 표·그림 Unit은 글 대신 그 종류 한 줄
    const blockLines: DraftLine[] = rowUnits.flatMap((unit) =>
      unit.kind === "table" ? [{ key: `b${unit.unit_id}`, lang: "neutral" as const, text: t("split.table") }] : unit.kind === "figure" ? [{ key: `b${unit.unit_id}`, lang: "neutral" as const, text: t("assign.newFigure") }] : [],
    );
    const anchor = draftPosition.after !== null ? { anchorKey: `t:${draftPosition.after}`, side: "after" as const } : { anchorKey: `t:${draftSection.items[0].target_id}`, side: "before" as const };
    newDraft = { ...anchor, lines: [...listDraftLines(slots, draft.texts), ...blockLines] };
  } else if (draftSection && draftSection.items.length === 0) draftSlotKey = draftSection.location_key;

  // --- 클릭 배치(MD 2 S3) - 엮은 문서의 자리 목록(끌기와 같은 place-spot-model)과 고른 줄로 본 답. 문서나 고른 줄이 바뀔 때만 다시 짓는다(긴 문서) ---
  const placeUnitKey = row?.unitIds.join(",") ?? "";
  const placeResolved = useMemo(() => {
    if (!composedDoc) return null;
    const keyOf = new Map(rows.flatMap((item) => item.unitIds.map((id) => [id, item.key] as const)));
    const sections = buildPlaceSections(composedDoc.sections, (unitId) => keyOf.get(unitId));
    const blocks = buildGapBlocks(sections);
    const unitIds = placeUnitKey === "" ? [] : placeUnitKey.split(",").map(Number);
    if (unitIds.length === 0) return { sections, blocks, heads: [], gaps: [] };
    // 칸 머리는 그 칸 첫 줄(없으면 빈 칸 자리 표시)의 키로 - New 칸이 칸 머리를 첫 줄 앞에 그린다
    const heads = composedDoc.sections.map((section) => ({
      rowKey: section.items.length > 0 ? `t:${section.items[0].target_id}` : `slot:${section.location_key}`,
      sectionKey: section.location_key,
      placement: resolvePlaceSpot(sections, { kind: "section", sectionKey: section.location_key }, unitIds),
    }));
    const gaps = listGapSpots(sections, blocks).map((gap) => ({ ...gap, placement: resolvePlaceSpot(sections, gap.spot, unitIds) }));
    return { sections, blocks, heads, gaps };
  }, [composedDoc, rows, placeUnitKey]);
  // 자리를 누를 수 있나 - 엮은 문서에 Old 줄을 고른 채 고칠 수 있을 때만(이미 쓴 문서는 지금처럼 문장 잇기만)
  const canPlaceClick = canEdit && mode === "old" && row !== null && isComposedDoc && composedDoc !== null;
  // 누른 자리 - 그 줄의 초안이 그 자리(보낼 곳 · 놓을 자리)인 동안만 칠한다. 다른 길로 고름을 바꾸면 저절로 풀린다
  const [spotPick, setSpotPick] = useState<{ rowKey: string; key: string; placeId: string; after: number | null | "none" } | null>(null);
  const pickedSpotKey = spotPick !== null && spotPick.rowKey === activeKey && draftPlace !== null && getDestinationId(draftPlace) === spotPick.placeId && (draftPosition ? draftPosition.after : "none") === spotPick.after ? spotPick.key : null;

  function scrollToUnit(unitId: number) {
    requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>(`[data-testid="assign-paper-unit-${unitId}"]`);
      if (target) revealFarElement(target);
    });
  }

  // 용지에서 끌어 고른 글자 범위 - 그 범위로 새 Unit을 만든다(전에는 쪼개기 화면에서만). 고른 문서에 묶여, 문서를 바꾸면 버려진다
  const [carvePick, setCarvePick] = useState<{ docId: number; blockId: number; start: number; end: number } | null>(null);
  const carve = carvePick !== null && carvePick.docId === oldView?.document.id ? carvePick : null;
  const carveText = carve ? (oldView?.blocks.find((block) => block.id === carve.blockId)?.text.slice(carve.start, carve.end) ?? "") : "";
  function clearCarve() {
    setCarvePick(null);
    window.getSelection()?.removeAllRanges();
  }

  /** Pair view를 켠다 - 용지의 도구(나눌 선·긁은 글자·떠 있는 메뉴)는 거둔다. 짝 고르는 중이면 그대로 둔다(띠가 KO 칸 위로 옮겨 간다) */
  function openPairView() {
    if (!oldView) return;
    cutLine.clear();
    clearCarve();
    setMenu(null);
    setCtxMenu(null);
    stopPairRestore();
    pairScrollRef.current = document.querySelector<HTMLElement>('[data-pane="old"] .pane-body')?.scrollTop ?? 0;
    setPairViewDoc(oldView.document.id);
  }

  /** Pair view를 끈다 - 다시 그려진 Old 용지에서 고른 줄의 조각을 보이고, 고른 줄이 없으면 켜기 전 스크롤 자리로.
   *  unitId - 보일 조각(나누기는 나눌 문장). 끄는 길은 모두 여기를 지난다(단추·V·보기 단추·세로선 접기·New 칸으로 보내기·나누기). Old 자리로 뛰는 길(jumpToOld·다른 문서의 줄 고르기)은 그 길이 스크롤하니 상태만 끈다 */
  function closePairView(unitId: number | undefined = pickedId ?? undefined) {
    setPairViewDoc(null);
    if (unitId !== undefined) {
      scrollToUnit(unitId);
      return;
    }
    // 다시 그려진 용지는 몇 프레임에 걸쳐 높이가 자란다(첫 프레임에 맞추면 그때의 끝에 걸린다, 잰 값) - 자리가 두 프레임 버틸 때까지(길어도 30프레임) 다시 맞춘다.
    // 한 단처럼 용지가 짧아져 그 자리까지 못 가면 끝까지
    // 되풀이는 다시 켜기·화면 떠나기·사람의 굴림·누름·글쇠에서 멈춘다 - 다시 켠 KO 칸도 같은 선택자에 걸려 용지의 자리를 받는다
    stopPairRestore();
    const top = pairScrollRef.current;
    let frames = 0;
    let held = 0;
    let frame = 0;
    const stop = () => {
      cancelAnimationFrame(frame);
      for (const type of PAIR_RESTORE_STOPS) window.removeEventListener(type, stop, true);
      if (pairRestoreRef.current === stop) pairRestoreRef.current = null;
    };
    const restore = () => {
      const pane = document.querySelector<HTMLElement>('[data-pane="old"] .pane-body');
      if (pane) {
        const want = Math.min(top, pane.scrollHeight - pane.clientHeight);
        held = Math.abs(pane.scrollTop - want) <= 1 ? held + 1 : 0;
        if (held === 0) pane.scrollTop = want;
      }
      if (held < 2 && ++frames < 30) frame = requestAnimationFrame(restore);
      else stop();
    };
    for (const type of PAIR_RESTORE_STOPS) window.addEventListener(type, stop, { capture: true, passive: true });
    pairRestoreRef.current = stop;
    frame = requestAnimationFrame(restore);
  }
  function stopPairRestore() {
    pairRestoreRef.current?.();
  }
  useEffect(() => () => pairRestoreRef.current?.(), []);
  // Pair view 단추는 켜고 끌 때 다른 칸 머리의 다른 단추로 바뀐다(눌린 단추는 사라진다) - 단추로 바꿨으면 새로 보이는 단추로 포커스를 옮긴다
  const focusPairToggleRef = useRef(false);
  function togglePairViewByButton() {
    focusPairToggleRef.current = true;
    if (isPairView) closePairView();
    else openPairView();
  }
  useEffect(() => {
    if (!focusPairToggleRef.current) return;
    focusPairToggleRef.current = false;
    document.querySelector<HTMLElement>('[data-testid="assign-pair-view"]')?.focus({ preventScroll: true });
  }, [isPairView]);

  // Pair view 동안 고른 줄이 바뀌면 그 줄의 조각을 칸마다 화면 안으로(이미 보이면 움직이지 않는다) - 짝의 두 끝을 한 화면에 들이는 길이다
  const revealPairRow = useEffectEvent(() => {
    for (const unitId of row?.unitIds ?? []) {
      const el = document.querySelector<HTMLElement>(`[data-testid="assign-pair-piece-${unitId}"]`);
      if (el) revealFarElement(el);
    }
  });
  useEffect(() => {
    if (!isPairView || activeKey === null) return;
    const frame = requestAnimationFrame(() => revealPairRow());
    return () => cancelAnimationFrame(frame);
  }, [isPairView, activeKey]);
  // 떨어진 문장과 한/영 짝 맺기 - 메뉴에서 시작하면 다음에 누르는 문장이 짝이 된다(Esc로 거둔다). 문서를 바꾸면 버려진다.
  // 셋 이상이면 Shift+클릭으로 모으고(picked) 마지막 문장을 그냥 누르거나 줄의 단추로 맺는다
  const [pairFrom, setPairFrom] = useState<{ docId: number; unitId: number; picked: number[] } | null>(null);
  // 메뉴의 "참조 줄로 표시"로 번호 칸을 연 문장 - 제안도 확정도 없는 문장에 참조 카드를 띄운다
  const [refEntryId, setRefEntryId] = useState<number | null>(null);
  // 양 단에서 New 문장을 다듬는 중이면 그 New 문서의 문장이다(shapeView)
  const pairSource = pairFrom !== null && pairFrom.docId === shapeView?.document.id ? (shapeModel?.units.get(pairFrom.unitId) ?? null) : null;

  /** 목차 블록(unitId null) 또는 그 줄 하나를 고른다 - 배정 줄 고름을 놓고 그 Old 문서를 연다. 결정 칸이 목차 칸(F12 G2 · G3)을 보인다 */
  function selectToc(docId: number, key: number, unitId: number | null, scroll = true) {
    setMode("old");
    setChecked(new Set());
    setMenu(null);
    setCtxMenu(null);
    setCarvePick(null);
    setCutUnitId(null);
    setRefEntryId(null);
    setManualOldDoc(docId);
    focusCtl.pick({ kind: "toc", docId, key, unitId });
    if (scroll) requestAnimationFrame(() => document.querySelector(`[data-testid="assign-paper-toc-${key}"]`)?.scrollIntoView({ block: "nearest" }));
  }

  /** 줄을 고른다 - unitId를 주면 그 박스(누른 박스, 짝의 다른 구성원이어도 그것), 아니면 pickRowKey의 규칙. 고른 박스 id를 돌려준다 */
  function selectRow(key: string, scroll = true, unitId?: number): number | null {
    // 다른 박스를 고르면 편집 뒤 다시 받기를 기다리던 따라가기는 버려진다(모델의 pick) - 늦게 온 보기가 고름을 편집한 줄로 되돌리지 않게
    setMode("old");
    setCarvePick(null);
    const boxId = pickRowKey(key, unitId);
    setMenu(null);
    setCtxMenu(null);
    if (key !== activeKey) {
      setCutUnitId(null);
      setRefEntryId(null);
    }
    if (scroll && boxId !== null) scrollToUnit(boxId);
    return boxId;
  }

  /** 한 단의 New 문서에서 문장을 고른다 - 다른 문장으로 옮기면 나눌 선과 참조 칸을 거둔다 */
  function selectSolo(unitId: number) {
    if (solo === null || solo.unitId === unitId) return;
    setSolo({ ...solo, unitId });
    setCtxMenu(null);
    setCarvePick(null);
    setCutUnitId(null);
    setRefEntryId(null);
  }

  /** 양 단의 New 칸에서 그 문장의 줄을 화면에 들인다 */
  function revealNewUnit(unitId: number) {
    const targetId = written.find((item) => item.new_unit_id === unitId)?.target_id;
    if (targetId === undefined) return;
    requestAnimationFrame(() => document.querySelector(`[data-testid="assign-new-${targetId}"]`)?.scrollIntoView({ block: "nearest" }));
  }

  /** 양 단에서 New 칸의 문장을 다듬을 대상으로 고른다 - 고르던 Old 줄은 놓는다. 원문의 Unit을 모르는 문장(원문 없이 만든 것)은 고르지 않는다 */
  function selectNewSentence(targetId: number): boolean {
    const item = writtenMap.get(targetId);
    const docId = item ? ((tobeData?.docs ?? []).find((doc) => doc.id === item.target_doc_id)?.document_id ?? null) : null;
    const unitId = item?.new_unit_id ?? null;
    if (unitId === null || docId === null) return false;
    if (solo?.inPlace && solo.docId === docId && solo.unitId === unitId && row === null) return true;
    setMode("old");
    setChecked(new Set());
    setMenu(null);
    setCarvePick(null);
    setCutUnitId(null);
    setRefEntryId(null);
    setPairFrom(null);
    setSolo({ docId, unitId, inPlace: true });
    return true;
  }

  /** New 칸의 문장을 우클릭 - 그 문장을 고르고 고치기 메뉴를 연다(Old 줄을 고른 채여도) */
  function openNewCtxMenu(targetId: number, click: { x: number; y: number }) {
    const unitId = writtenMap.get(targetId)?.new_unit_id ?? null;
    const anchor = document.querySelector<HTMLElement>(`[data-testid="assign-new-${targetId}"]`);
    if (!canEdit || mode !== "old" || unitId === null || !anchor || !selectNewSentence(targetId)) return;
    menuSeq.current += 1;
    setCtxMenu({ seq: menuSeq.current, unitId, boxId: null, rowKey: SOLO_ROW_KEY, anchor, click, caret: null });
  }

  /** 이미 쓴 New 문서를 한 단으로 연다 - 고르던 줄을 놓고 그 문서의 원문을 넓게 보인다 */
  function openSolo(docId: number) {
    setMode("old");
    setChecked(new Set());
    setMenu(null);
    setCtxMenu(null);
    setCarvePick(null);
    setCutUnitId(null);
    setRefEntryId(null);
    setPairFrom(null);
    setSolo({ docId, unitId: null, inPlace: false });
    if (!view.single) changeView({ single: true });
  }

  /** 용지의 그 문장으로 간다 - Old 문서면 그 줄을, 한 단의 New 문서면 그 문장을 고른다 */
  function goToUnit(unitId: number) {
    if (hasSolo) {
      selectSolo(unitId);
      if (isSolo) scrollToUnit(unitId);
      else revealNewUnit(unitId);
      return;
    }
    const key = rowOfUnit.get(unitId);
    if (key !== undefined) selectRow(key, true, unitId);
  }

  function moveRow(step: 1 | -1) {
    if (hasSolo) {
      // 줄이 없는 문서 - 용지 순서로 다음(앞) 문장, 짝은 한 묶음으로 건너뛴다. 양 단의 New 칸에서는 그 칸에 줄이 있는 문장만 돈다
      const shown = new Set(written.map((item) => item.new_unit_id));
      const order = isNewEdit ? (shapeTabs?.order ?? []).filter((id) => shown.has(id)) : (paperTabs?.order ?? []).filter((id) => partKeys.length <= 1 || partOf?.get(id) === activePart);
      const held = new Set(soloUnits.map((unit) => unit.id));
      const from = soloUnits.length === 0 ? (step === 1 ? -1 : order.length) : order.indexOf(step === 1 ? soloUnits[soloUnits.length - 1].id : soloUnits[0].id);
      for (let at = from + step; at >= 0 && at < order.length; at += step) {
        if (held.has(order[at])) continue;
        goToUnit(order[at]);
        return;
      }
      return;
    }
    // 목차 블록도 한 자리로 밟는다(All에서만 - 다른 필터는 상태로 거른 줄 목록이다). 남은 수·필터 수에는 들지 않는다.
    // 평소는 박스 하나씩(떨어진 짝도 제 자리에서), Pair view는 줄 하나씩 - 거르기는 박스의 줄로 본다(설계 D3)
    const listed = new Set(listKeys);
    const isListed = (key: string) => {
      if (readTocNavKey(key) !== null) return filter === "all";
      const unitId = readUnitNavKey(key);
      return listed.has(unitId === null ? key : (rowOfUnit.get(unitId) ?? ""));
    };
    // 그림 탭에서는 그림 카드 차례만, 다른 탭에서는 그림 카드를 건너뛴다(시안 2 D3)
    const isFigureWalk = (key: string) => {
      const unitId = readUnitNavKey(key) ?? rowMap.get(key)?.unitIds[0] ?? null;
      return (unitId !== null && figureTabIds.has(unitId)) === (activePart === "figures");
    };
    const walk = navKeys.filter((key) => isListed(key) && isFigureWalk(key));
    const current = tocPick !== null ? toTocNavKey(tocPick.key) : isPairView ? activeKey : pickedId !== null ? toUnitNavKey(pickedId) : null;
    const next = stepInList(navKeys, walk, current, step);
    const tocKey = next === null ? null : readTocNavKey(next);
    const block = tocKey === null ? undefined : tocBlocks.find((item) => item.key === tocKey);
    const nextUnit = next === null ? null : readUnitNavKey(next);
    const nextRow = nextUnit === null ? next : (rowOfUnit.get(nextUnit) ?? null);
    if (block) selectToc(block.docId, block.key, null);
    else if (nextRow !== null && tocKey === null) selectRow(nextRow, true, nextUnit ?? undefined);
  }

  // --- Old 문장 고치기(우클릭 메뉴·두 번 누르기) - Split의 편집을 그대로 부른다. 판단이 없는 문장만(모델이 막는다) ---
  /** 단위(칸 문장이면 묶인 표)의 줄 키 */
  function findRowKey(unitId: number): string | undefined {
    const groupId = paperModel?.units.get(unitId)?.group_unit_id ?? null;
    return rowOfUnit.get(unitId) ?? (groupId !== null ? rowOfUnit.get(groupId) : undefined);
  }

  /** 그 단위가 든 박스(줄의 Unit) - 칸 문장 · 캡션이면 그 묶음 */
  function findBoxId(key: string, unitId: number): number | undefined {
    const groupId = paperModel?.units.get(unitId)?.group_unit_id ?? null;
    return rowMap.get(key)?.unitIds.find((id) => id === unitId || id === groupId);
  }

  /** 처리 중인 박스인가 - 누른 Unit이나 그 묶음(칸 문장 · 캡션의 표 · 그림)이 잠겼으면 고르기 · 메뉴 · 나눌 선 · 끌기를 받지 않는다(설계 D4) */
  function isBoxLocked(unitId: number): boolean {
    const groupId = shapeModel?.units.get(unitId)?.group_unit_id ?? paperModel?.units.get(unitId)?.group_unit_id ?? null;
    return focusCtl.isUnitLocked(unitId) || (groupId !== null && focusCtl.isUnitLocked(groupId));
  }

  function isUnitDecided(unit: { id: number; group_unit_id: number | null }): boolean {
    const decided = unitMap.get(unit.group_unit_id ?? unit.id);
    return decided !== undefined && (decided.status !== "unassigned" || decided.decision.disposition !== "unassigned");
  }

  function hasUnitDraft(unit: { id: number }): boolean {
    const key = findRowKey(unit.id);
    const pending = key ? drafts[key] : undefined;
    return pending !== undefined && hasDraftChange(pending);
  }

  const ctxTarget = ctxMenu ? (shapeModel?.units.get(ctxMenu.unitId) ?? null) : null;
  // 우클릭한 것이 든 표 단위 - 칸 문장이면 묶인 표, 표를 직접 눌렀으면 그 단위
  /** 그 단위가 든 표 단위 - 칸 문장이면 묶인 표, 표면 그 단위 */
  function findTableOf(target: ViewUnit | null): ViewUnit | null {
    if (!target || !shapeModel) return null;
    const holder = target.kind === "table" ? target : target.group_unit_id !== null ? (shapeModel.units.get(target.group_unit_id) ?? null) : null;
    return holder !== null && holder.kind === "table" ? holder : null;
  }

  /** 그 단위가 속한 묶음(표·그림) - 묶음이면 그 단위, 칸 문장·캡션이면 묶인 묶음, 아니면 null */
  function findBundleOf(unit: ViewUnit | null): ViewUnit | null {
    if (!unit || !shapeModel) return null;
    if (isBundleKind(unit.kind)) return unit;
    const holder = unit.group_unit_id !== null ? shapeModel.units.get(unit.group_unit_id) : undefined;
    return holder && isBundleKind(holder.kind) ? holder : null;
  }

  /** 묶음에 이미 있는 캡션의 언어 */
  function listCaptionLangs(bundle: ViewUnit): string[] {
    if (!shapeModel) return [];
    return [...shapeModel.units.values()].filter((unit) => unit.kind === "caption" && unit.group_unit_id === bundle.id).map((unit) => unit.lang);
  }

  /** 옛 이행(0020)이 그림 블록 위에 둔 캡션인가 - 떼면 그림 글이 문장이 되어 서버가 막는다(caption_in_figure_block) */
  function isFixedCaption(unit: ViewUnit): boolean {
    if (unit.kind !== "caption" || !shapeView) return false;
    const figureBlocks = new Set(shapeView.blocks.filter((block) => block.kind === "figure").map((block) => block.id));
    return unit.spans.some(([blockId]) => figureBlocks.has(blockId));
  }

  /** 용지 순서로 바로 앞·뒤 단위 - 묶음은 칸 문장·캡션까지 한 덩어리로 보고 그 앞·뒤(캡션으로 붙일 글을 찾는 자리) */
  function findNeighbors(target: ViewUnit): { prev: ViewUnit | null; next: ViewUnit | null } {
    if (!shapeTabs || !shapeModel) return { prev: null, next: null };
    const order = shapeTabs.order;
    const isBundle = isBundleKind(target.kind);
    const inside = order.flatMap((id, index) => {
      const unit = shapeModel.units.get(id);
      return unit && (id === target.id || (isBundle && unit.group_unit_id === target.id)) ? [index] : [];
    });
    if (inside.length === 0) return { prev: null, next: null };
    return { prev: shapeModel.units.get(order[Math.min(...inside) - 1]) ?? null, next: shapeModel.units.get(order[Math.max(...inside) + 1]) ?? null };
  }

  /** 그 단위에 할 수 있는 일과 못 하는 까닭 - 우클릭 메뉴와 오른쪽 칸의 다듬기 줄이 같은 답을 쓴다 */
  function buildUnitMenu(target: ViewUnit): AssignMenuGroups | null {
    if (!shapeTabs || !shapeModel) return null;
    const { prev, next } = findNeighbors(target);
    return buildAssignMenu({
      target,
      prev,
      next,
      prevBundle: findBundleOf(prev),
      nextBundle: findBundleOf(next),
      listCaptionLangs,
      isFixedCaption,
      captionBundle: target.kind === "caption" ? findBundleOf(target) : null,
      readOnly: !canEdit,
      rowStatus: row?.status ?? "unassigned",
      isDecided: isUnitDecided,
      hasDraft: hasUnitDraft,
      canSplit: findNearestCut(target, Math.floor(target.text.length / 2)) !== null,
      table: findTableOf(target),
    });
  }
  const ctxMenuGroups = ctxTarget ? buildUnitMenu(ctxTarget) : null;
  // New 문서의 문장에는 보낼 곳이 없다 - 고치기 묶음만
  const ctxGroups = ctxMenuGroups && hasSolo ? { ...ctxMenuGroups, assign: [] } : ctxMenuGroups;
  // 고른 줄의 문장에 걸린 AI 나누기 제안 - 저장 전 고름이 있으면 다른 문장 고치기처럼 적용을 잠근다(배정이 있으면 적용할 때 묻는다)
  const rowViewUnits = hasSolo ? soloUnits : (row?.unitIds ?? []).map((id) => paperModel?.units.get(id)).filter((unit): unit is ViewUnit => unit !== undefined);
  const rowSplitUnit: ViewUnit | null = rowViewUnits.find((unit) => splitByUnit.has(unit.id)) ?? null;
  const rowSplit = rowSplitUnit ? (splitByUnit.get(rowSplitUnit.id) ?? null) : null;
  const splitBlocked = rowSplitUnit !== null && hasUnitDraft(rowSplitUnit) ? t("assign.ctx.why.unsaved") : null;
  // 고른 줄의 참조 줄(REF) - 확인이 남은 제안이 먼저다. 제안이 남은 줄은 번호를 확인하거나 물려야 Confirm이 켜진다(이미 확정한 줄은 막지 않는다)
  const rowRefUnit = pickRefUnit(rowViewUnits) ?? rowViewUnits.find((unit) => unit.id === refEntryId) ?? null;
  // 저장 전 고름이 있어도 번호 확인은 된다 - 보낼 곳을 먼저 고른 사람이 확인 때문에 고름을 버리지 않게(단위가 바뀌지 않는 편집이다)
  const refBlocked = rowRefUnit !== null && isUnitDecided(rowRefUnit) ? t("assign.ctx.why.assigned") : null;
  const isRefGate = row !== null && row.status !== "confirmed" && rowViewUnits.some(isRefPending);
  // 새 문서 자리로 보내는 표·그림에 캡션이 없으면 Confirm이 꺼진다(명세 §3.4) - 캡션은 Edit and confirm에서 써 넣는다
  const isCaptionGateOn = row !== null && paperModel !== null && oldView?.document.id === row.documentId && isCaptionGate(row, destination, paperModel.units, draft, groupData);
  // Confirm을 막는 까닭 - 결정 칸 단추의 툴팁과 그 자리 메뉴(끌어 놓은 초안 포함)가 같은 답을 쓴다
  const confirmBlockKey = readConfirmBlockKey({ isRefGate, isCaptionGate: isCaptionGateOn });
  // 오른쪽 칸 1번(다듬기) - 고른 줄의 문장마다 할 수 있는 일. 우클릭 메뉴와 같은 답이다. 고칠 수 없는 사람에게는 줄을 보이지 않는다
  // 표·그림 줄이면 그 묶음의 캡션도 문장처럼 한 줄씩(언어 세 칸·자르기·캡션 떼기) - 용지 순서대로(캡션이 위면 위에)
  const rowBundleSpan = new Set(rowViewUnits.filter((unit) => isBundleKind(unit.kind)).map((unit) => unit.id));
  const rowCaptionUnits = hasSolo || rowBundleSpan.size === 0 ? [] : [...(paperModel?.units.values() ?? [])].filter((unit) => unit.kind === "caption" && unit.group_unit_id !== null && rowBundleSpan.has(unit.group_unit_id));
  const shapeOrder = shapeTabs?.order ?? [];
  const shapeUnits = rowCaptionUnits.length === 0 ? rowViewUnits : [...rowViewUnits, ...rowCaptionUnits].sort((a, b) => shapeOrder.indexOf(a.id) - shapeOrder.indexOf(b.id));
  // 고른 줄의 글(캡션 포함)이 가리키는 표·그림 - 단위마다의 참조를 한 카드에. 다시 이을 후보는 같은 문서의 표·그림 묶음
  const rowCaptionRefs: CaptionRefEntry[] = shapeUnits.flatMap((unit) => unit.caption_refs.map((ref) => ({ ref, from: unit })));
  const refCandidates = rowCaptionRefs.length > 0 && shapeModel !== null ? [...listRefCandidates("table", shapeModel.units), ...listRefCandidates("figure", shapeModel.units)] : [];
  // 표·그림의 캡션은 다듬기 줄 대신 아래 캡션 자리(F7)가 칩으로 보인다 - 캡션의 언어 바꾸기는 우클릭 메뉴에 남는다
  // 누른 박스가 맨 앞(설계 D3) - 나머지는 짝 카드 안 순서(바꾼 적 없으면 문서 순서, lib/pair-order-model). 합치기(switchShapeMode)는 서버가 원문 범위 순서로 잇는다
  const shapeFirstId = hasSolo ? (soloUnit?.id ?? null) : pickedId;
  const shapeCardUnits = orderPairCard(rowViewUnits);
  const shapeLineUnits = shapeFirstId === null ? shapeCardUnits : [...shapeCardUnits].sort((a, b) => Number(b.id === shapeFirstId) - Number(a.id === shapeFirstId));
  const shapeLines: ShapeLine[] = canEdit && mode === "old" ? shapeLineUnits.flatMap((unit) => { const menu = buildUnitMenu(unit); return menu ? [{ unit, items: menu.edit }] : []; }) : [];
  // 캡션 자리의 블록 자리(문단 · 표 · 그림 하나가 한 자리) - 후보와 끌어 놓기가 같은 거리를 잰다(서버 caption_slot.py와 같다)
  const slotPlaces = useMemo(() => (shapeView ? buildBlockPlaces(shapeView.blocks, shapeView.tables) : null), [shapeView]);
  const slotBlockKinds = useMemo(() => new Map((shapeView?.blocks ?? []).map((block) => [block.id, block.kind])), [shapeView]);
  // 고른 줄이 한/영 짝이거나 합친 한 문장이면 둘 사이를 바꾸는 전환을 다듬기에 둔다
  const shapeMode = shapeLines.length > 0 ? planShapeMode(rowViewUnits, shapeTabs?.order ?? [], hasUnitDraft) : null;
  // 고른 줄이 제목에서 바꾼 문장이면 다듬기 맨 아래 [제목으로 되돌리기] - 짝이면 두 조항 줄을 함께(F12 D2)
  const headingBackIds = shapeLines.length > 0 ? listHeadingBackUnits(rowViewUnits) : [];
  const headingBack = headingBackIds.length > 0 ? { reasonKey: rowViewUnits.some(hasUnitDraft) ? "assign.ctx.why.unsaved" : null, onBack: () => revertHeadings(headingBackIds) } : null;
  // 고른 줄이 벗긴 표의 줄이면 다듬기 맨 아래 [↺ 다시 표로] - 용지 묶음 머리 단추와 같은 일(F12 A3). 띠 표는 벗긴 표 목록에 없어 아래 [표로 되돌리기]만 선다
  const rewrapTableId = shapeLines.length > 0 && paperModel && !isSolo ? getUnitUnwrapTable(rowViewUnits, paperModel.unwrapped) : null;
  const rewrap = rewrapTableId !== null ? { reasonKey: rowViewUnits.some(hasUnitDraft) ? "assign.ctx.why.unsaved" : null, onBack: () => rewrapTable(rewrapTableId) } : null;
  // 고른 줄이 띠 표 제목 줄이면 다듬기 맨 아래 [표로 되돌리기] - 그 띠 표를 표 한 줄로(F4 · F12 G5, 한 편집이라 Ctrl+Z로 다시 제목 줄)
  const bandUnit = shapeLines.length > 0 ? (rowViewUnits.find(isBandHeading) ?? null) : null;
  const bandTableId = bandUnit?.table_id ?? null;
  // 띠 표는 표 머리가 없다 - 처리 중 알약은 그 제목 줄에
  const bandBack = bandUnit !== null && bandTableId !== null
    ? { reasonKey: rowViewUnits.some(hasUnitDraft) ? "assign.ctx.why.unsaved" : null, onBack: () => void runUnitEdit({ type: "set_layout_table", table_id: bandTableId, is_layout: false }, t("assign.band.didTable"), null, false, null, { at: "box", unitId: bandUnit.id }) }
    : null;
  const stepBase = shapeLines.length > 0 ? 1 : 0;
  const refPendingIds = (shapeTabs?.order ?? []).filter((id) => isRefPending(shapeModel?.units.get(id)) && (hasSolo || rowOfUnit.has(id)));
  // 캡션이 필요한 표·그림의 줄 - 머리 줄의 Caption needed와 같은 규칙(lib/caption-model). 위쪽 줄에 남은 수, 누르면 다음 줄
  // 캡션이 필요 없는 묶음(이미 쓴 New 문서를 혼자 연 동안의 그 문서 단위, 그 문서에 이은 묶음) - 위쪽 줄 수와 머리 줄이 같은 판단을 쓴다
  const isLinkedToWritten = useMemo(() => makeIsLinkedToWritten(new Set(isSolo ? (soloView?.units.map((unit) => unit.id) ?? []) : []), linkedTargets), [isSolo, soloView, linkedTargets]);
  const captionPendingKeys = useMemo(() => listCaptionPendingRowKeys(rows, unitMap, isLinkedToWritten), [rows, unitMap, isLinkedToWritten]);
  // Old 칸 문서 대시보드의 수 - 배정 줄이 없는 문서(혼자 연 이미 쓴 New 문서)는 내려받기만 보인다
  const dashDocId = oldView?.document.id ?? null;
  const docDashboard = useMemo(() => {
    if (dashDocId === null || isSolo) return null;
    const codes = new Map<number, string>([...written.map((item): [number, string] => [item.target_doc_id, item.doc_code]), ...(tobeData?.docs ?? []).map((doc): [number, string] => [doc.id, doc.code])]);
    return buildDocDashboard(rows, dashDocId, unitMap, (id) => codes.get(id) ?? "");
  }, [dashDocId, isSolo, rows, unitMap, written, tobeData]);
  // 그 줄의 번호에 대한 EQUIS 표시와 새 문장에 쓸 제안 - 참조 카드와 결정 칸의 새 문장이 같은 답을 쓴다. 조회가 도는 동안은 조금 뒤 다시 읽는다
  const rowRefMark = rowRefUnit?.ref ?? null;
  // 묶음 · 후보와 같다 - 처리 중인 일이 그 Unit을 은퇴시켰을 수 있는 동안과 그 문서를 다시 받는 동안은 묻지 않는다(404)
  const isRefSettled = rowRefUnit === null || shapeView === null || (!docViews.isReloading(shapeView.document.id) && !focusCtl.isUnitUnsettled(shapeView.document.id, rowRefUnit.id));
  const refDetail = useLoaded<UnitRefDetail | null>(
    () => (rowRefUnit !== null && rowRefMark !== null && shapeView !== null ? (isRefSettled ? getUnitRef(bundleId, shapeView.document.id, rowRefUnit.id) : new Promise<never>(() => undefined)) : Promise.resolve(null)),
    `${shapeView?.document.id ?? ""}:${rowRefUnit?.id ?? ""}:${rowRefMark?.state ?? ""}:${rowRefMark?.number ?? ""}${isRefSettled ? "" : ":wait"}`,
  );
  // 앞서 고른 줄의 답이 남아 있을 수 있다 - 이 줄의 이 번호에 대한 답만 쓴다
  const refInfo = !refDetail.isLoading && rowRefMark !== null && refDetail.data?.number === rowRefMark.number ? refDetail.data : null;
  useEquisPolling(refInfo?.equis?.refreshing === true, refDetail.reload);
  // 메뉴를 연 뒤 편집으로 그 문장이 사라졌으면 닫는다(렌더 중 상태 맞추기)
  if (ctxMenu !== null && shapeModel !== null && ctxTarget === null) setCtxMenu(null);

  /** 우클릭(또는 메뉴 글쇠) - 그 문장의 줄을 고르고 줄 상자 옆에 메뉴를 연다 */
  function openCtxMenu(unitId: number, click: { x: number; y: number } | null, caret: { blockId: number; offset: number } | null) {
    if (mode !== "old" || isBoxLocked(unitId)) return;
    const key = isSolo ? SOLO_ROW_KEY : findRowKey(unitId);
    const anchor = document.querySelector<HTMLElement>(`[data-testid="assign-paper-piece-${unitId}"]`) ?? document.querySelector<HTMLElement>(`[data-testid="assign-paper-unit-${unitId}"]`);
    if (!key || !anchor) return;
    // 누른 것이 든 박스(칸 문장 · 캡션이면 그 묶음) - 짝의 다른 구성원을 눌렀으면 그 박스로 옮겨 고른다
    const boxId = isSolo ? null : (findBoxId(key, unitId) ?? null);
    let picked = pickedId;
    if (isSolo) selectSolo(unitId);
    else if (key !== activeKey || (boxId !== null && boxId !== pickedId)) picked = selectRow(key, false, boxId ?? undefined);
    setChecked(new Set());
    setMenu(null);
    menuSeq.current += 1;
    setCtxMenu({ seq: menuSeq.current, unitId, boxId: isSolo ? null : picked, rowKey: key, anchor, click, caret });
  }

  /** 서버가 "판단이 걸린 단위를 바꾼다"고 물었으면 그 단위 수 - 다른 오류면 null */
  function readConfirmCount(err: unknown): number | null {
    const unitIds = err instanceof ApiError && err.rule?.code === "confirm_required" ? err.rule.unit_ids : null;
    return Array.isArray(unitIds) ? unitIds.length : null;
  }

  /**
   * 편집 뒤 다시 받기(설계 D2) - 고친 Old 문서의 보기와 그 줄은 한 번에 받아 놓고(따라가기가 이것을 기다린다), 나머지는 planReload가 고른 목록만 뒤에서.
   * ready - 이미 받아 둔 그 문서(같은 문서를 두 번 받지 않는다). Old 문서가 아닌 문서(한 단으로 연 New 문서)는 그 보기를 다시 받고,
   * 그 문서의 Unit이 바뀌는 편집(나누기 제안 적용 · 짝)이면 New 문서 편집처럼 New 문장 목록 · To-Be도
   */
  function reloadAfterEdit(plan: ReloadPlan, ready: DocBatch | null = null) {
    const oldIds = plan.docs === "all" ? "all" : plan.docs.filter((id) => oldDocIds.includes(id));
    const isNewDoc = oldIds !== "all" && oldIds.length < plan.docs.length;
    if (plan.newDoc !== null || isNewDoc) setSoloKey((key) => key + 1);
    const tobe = plan.tobe || (isNewDoc && plan.units);
    const written = plan.written || (isNewDoc && plan.units);
    if (tobe || written || plan.identical || plan.splitSuggestions !== null) {
      setReloadKeys((prev) => ({ tobe: prev.tobe + Number(tobe), written: prev.written + Number(written), identical: prev.identical + Number(plan.identical), split: prev.split + Number(plan.splitSuggestions !== null) }));
    }
    if (plan.bundle) void loadBundle(bundleId);
    if (ready !== null) docViews.apply(ready);
    else if (oldIds === "all" || oldIds.length > 0) void docViews.reload({ docs: oldIds, units: plan.units ? oldIds : null });
  }

  /** 편집 한 번 - 끝나면 원문 보기·단위를 다시 받고 followId(없으면 새로 생긴 첫 단위)의 줄을 고른다. confirm은 확인 창에서 다시 보낼 때만 켠다 */
  /** thenLang - 참조 줄을 푼 뒤 그 문장을 이 언어로(Shape 언어 세 칸에서 참조 줄의 KO·EN). place - 알약 자리(없으면 편집이 가리키는 곳, 틈의 붙이기는 그 틈) */
  async function runUnitEdit(op: EditOp, okText: string, followId: number | null, confirm = false, thenLang: "ko" | "en" | null = null, place: PendingPlace | null = null) {
    if (!shapeView) return;
    const view = shapeView;
    const docId = view.document.id;
    const isOld = oldDocIds.includes(docId);
    // confirm은 판단을 풀며 보낸 편집이다 - 대상(Target)이 지워져 To-Be · New 문장도 다시 받는다
    const plan = planReload(isOld ? { kind: "old_edit", docId, isInPlace: IN_PLACE_EDIT_OPS.has(op.type), isReleased: confirm } : { kind: "new_edit", docId }, { aiOn });
    // 표 바꾸기는 그 표의 Unit 전부를 잡는다(벗기면 표 단위가 은퇴하고 칸 문장이 풀린다)
    const unitIds = op.type === "set_layout_table" ? listTableUnitIds(view.units, view.tables, op.table_id) : listEditUnitIds(op);
    await focusCtl.runPending({ kind: readEditKind(op), docId, unitIds, place: place ?? readEditPlace(op), isGlobal: false }, (job) => sendUnitEdit(job, view, op, okText, followId, confirm, thenLang, plan));
  }

  /** runUnitEdit의 보내기 - 같은 문서의 앞 쓰기 응답 뒤에 불린다(보낼 revision은 그때 고른다) */
  async function sendUnitEdit(job: string, view: DocumentView, op: EditOp, okText: string, followId: number | null, confirm: boolean, thenLang: "ko" | "en" | null, plan: ReloadPlan) {
    const docId = view.document.id;
    const isOld = oldDocIds.includes(docId);
    let isAsking = false;
    let isReloaded = false;
    try {
      // 자르기·합치기·언어 바꾸기 모두 Assign 기록에 넣는다(설계 §4.4) - 서버는 Split 편집 기록 번호만 가리킨다
      const undo = buildUndo({ focus_unit_id: op.type === "split" ? op.unit_id : (followId ?? undefined) });
      // 보낸 revision과 같으면 서버가 아무것도 쓰지 않은 편집이다 - 이 탭이 먼저 쓴 값이 화면 값보다 새로울 수 있다(doc-revision.ts, 줄 선 앞 쓰기의 응답 포함)
      const sentRevision = pickDocRevision(docId, view.document.revision);
      const result = await editUnits(bundleId, docId, sentRevision, op, confirm, undo);
      let revision = result.document_revision;
      // 받아 둔 그 문서의 새 보기 · 줄 - 아래에서 그대로 놓아 같은 문서를 또 받지 않는다
      let ready: DocBatch | null = null;
      // 참조를 풀면 서버가 그 전 언어로 돌린다 - 고른 언어와 다를 때만 한 번 더 바꾼다
      if (thenLang !== null && op.type === "clear_ref") {
        ready = isOld ? await docViews.fetch({ docs: [docId], units: [docId] }) : null;
        const restored = (ready?.views[0] ?? (await getDocumentView(bundleId, docId))).units.find((unit) => unit.id === op.unit_id);
        if (restored && restored.lang !== thenLang) {
          revision = (await editUnits(bundleId, docId, revision, { type: "set_language", unit_ids: [op.unit_id], lang: thenLang }, false, buildUndo({ focus_unit_id: op.unit_id }))).document_revision;
          // 언어를 또 바꿨다 - 받아 둔 것은 그 사이 모습이라 놓고(따라가기는 revision이 모자라 기다린다) 다시 받는다
          if (ready !== null) docViews.apply(ready);
          ready = null;
        }
      }
      // 문서가 바뀌지 않은 편집(참조 제안 물리기)은 서버도 단계를 남기지 않는다
      if (revision !== sentRevision) markRecorded();
      setRefEntryId(null);
      cutLine.clear();
      setCutUnitId(null);
      // 고름은 처리 중에도 그대로 - 응답의 첫 새 Unit(합친 박스 · 나눈 앞 조각, 없으면 followId)을, 고름이 누른 때 그대로면 다시 받은 뒤 고른다.
      // 다시 받기보다 먼저 건다 - 아래 풀기 전환이 기다리는 사이에 새 보기가 닿아도 따라가게(D1 규칙 2 · 3)
      focusCtl.succeed(job, { docId, revision, pickUnitId: result.created_unit_ids[0] ?? followId });
      // 표 벗기기 · 다시 표로와 캡션 붙이기 · 떼기 · 첫 행 올리기 · 그림 묶기 - 새 원문 보기를 먼저 받아 풀기 전환 안에서 놓는다
      // (F10, 화면 안만 움직이고 움직임 줄이기면 번쩍임만). 캡션은 글이 캡션 자리로 미끄러져 들어간다. 알림은 전환 뒤
      // 표는 바로 안쪽 띠 표도 함께 제목 줄 ↔ 표로 바뀐다(F2)
      const motion = op.type === "set_layout_table"
        ? { scopes: listUnwrapScopes(new Map(view.tables.map((table) => [table.id, table])), op.table_id), reverse: !op.is_layout }
        : getCaptionMotion(op, followId);
      if (motion !== null && isOld) {
        const fresh = ready ?? (await docViews.fetch({ docs: [docId], units: [docId] }));
        isReloaded = true;
        // 새 보기를 놓는 순간 처리 중을 걷는다 - 잠금 · 알약은 거기까지, 남은 움직임은 보이기만이다(같은 문서의 다음 쓰기는 전환 끝까지 줄에서 기다린다)
        await unwrapMotion.run(() => {
          reloadAfterEdit(plan, fresh);
          focusCtl.end(job);
        }, motion);
      } else if (ready !== null) {
        isReloaded = true;
        reloadAfterEdit(plan, ready);
      }
      showToast(okText);
    } catch (err) {
      // 판단이 걸린 단위를 바꾸는 편집은 한 번 묻는다 - 확인하면 배정을 풀며 다시 보낸다
      const count = readConfirmCount(err);
      isAsking = count !== null && !confirm;
      if (count !== null && !confirm) setEditConfirm({ count, retry: { kind: "edit", op, okText, followId } });
      else showToast(humanizeApiError(err, t), "error");
    } finally {
      // 되묻는 동안은 다시 받지 않는다 - 바뀐 것이 없고, 늦게 닿은 응답이 확인 뒤의 편집과 엇갈리면 새 줄을 따라가지 못한다.
      // 일은 runPending이 이 뒤에 걷는다 - 다시 받기가 그 문서를 받는 중으로 센 뒤라 그 사이 은퇴한 Unit을 묻지 않는다
      if (!isAsking && !isReloaded) reloadAfterEdit(plan);
    }
  }

  /** 표 벗기기(F1) - 누른 표 하나만 벗긴다. 한/영 따로 문서에서 대응 표도 벗기면 서버가 같은 행끼리 짝을 제안한다(F8a) */
  function unwrapTable(tableId: number) {
    void runUnitEdit({ type: "set_layout_table", table_id: tableId, is_layout: true }, t("assign.unwrap.didUnwrap"), null);
  }

  /** 다시 표로(F1) - 벗긴 표 전체를 표 한 줄로 되돌린다. 그 표의 줄에 배정이 있으면 서버가 되묻고 확인창이 한 번 묻는다(표 밖 줄의 배정은 그대로) */
  function rewrapTable(tableId: number) {
    const op: EditOp = { type: "set_layout_table", table_id: tableId, is_layout: false };
    const okText = t("assign.unwrap.didRewrap");
    // 판단이 풀릴 줄이 있으면 서버에 보내기 전에 확인창부터 - 확인하면 confirm을 켜고 보낸다(409를 거쳐 되묻지 않는다)
    const decided = paperModel ? countDecidedLines(paperModel.units.values(), tableId, (unitId) => unitMap.get(unitId)?.status, paperModel.tables) : 0;
    if (decided > 0) setEditConfirm({ count: decided, retry: { kind: "edit", op, okText, followId: null } });
    else void runUnitEdit(op, okText, null);
  }

  /** 편집 확인창의 글 - 다시 표로면 그 표의 말(표 번호 · 확정된 줄 수, F12 A6), 아니면 판단이 지워진다는 공통 글 */
  function describeEditConfirm({ count, retry }: { count: number; retry: ConfirmedEdit }): { title: string; summary: string; confirmLabel: string } {
    const op = retry.kind === "edit" ? retry.op : null;
    if (op?.type === "set_layout_table" && !op.is_layout) {
      const table = (viewList ?? []).flatMap((view) => view.tables).find((item) => item.id === op.table_id);
      return {
        // ko는 표 번호 끝자리 소리로 을/를(F12 A6 "표 3을 다시 표로 묶을까요?"), en은 {p}를 쓰지 않는다
        title: t("assign.unwrap.confirmTitle", { n: table ? getTableNumber(table) : "", p: table ? readObjectParticle(getTableNumber(table)) : "을" }),
        summary: t("assign.unwrap.confirmBody", { m: count }),
        confirmLabel: t("assign.unwrap.confirmRun"),
      };
    }
    return { title: t("split.confirmTitle"), summary: t("split.confirmBody", { n: count }), confirmLabel: t("split.confirmRun") };
  }

  /** 목차 아님(줄 하나) · 모두 목차 아님(블록 전체) - 표시만 비우는 편집. 목차 고름을 놓고, 다시 받은 뒤 돌아온 첫 줄을 보통 줄로 고른다(F12 G4) */
  function clearToc(unitIds: number[]) {
    if (unitIds.length === 0) return;
    if (focus.kind === "toc") focusCtl.pick(NO_FOCUS);
    // 블록 전체(또는 첫 줄)를 돌리면 그 키의 블록이 없어진다 - 되돌려 다시 생긴 블록은 처음처럼 접혀 있다
    setTocOpen((open) => new Set([...open].filter((key) => !unitIds.includes(key))));
    void runUnitEdit({ type: "clear_noise", unit_ids: unitIds }, t(unitIds.length > 1 ? "assign.toc.didClearAll" : "assign.toc.didClear"), unitIds[0]);
  }

  /**
   * 한/영 짝을 맺거나(kind pair) 푼다(unpair) - 편집 기록(되돌리기)에는 들어가지 않는다. 반대 동작이 같은 메뉴에 있다.
   * unitIds - 맺거나 풀 박스(잠긴다), place - 알약 자리(틈에서 맺었으면 그 틈, 아니면 앞 박스)
   */
  async function runPairChange(write: (docId: number, revision: number) => Promise<unknown>, okText: string, followId: number, kind: "pair" | "unpair", unitIds: readonly number[], place: PendingPlace = { at: "box", unitId: unitIds[0] ?? followId }) {
    if (!shapeView) return;
    const view = shapeView;
    const docId = view.document.id;
    await focusCtl.runPending({ kind, docId, unitIds, place, isGlobal: false }, async (job) => {
      try {
        // 보낼 revision은 sendDocWrite가 앞 쓰기의 응답으로 이어 준다
        await write(docId, view.document.revision);
        // 짝이 바뀌면 줄이 다시 묶인다 - 고름은 두고(다시 받는 동안 옛 줄은 묶음을 부르지 않는다), 받은 뒤 그 문장의 줄을 고른다
        showToast(okText);
        focusCtl.succeed(job, { docId, revision: null, pickUnitId: followId });
      } catch (err) {
        const isLinked = err instanceof ApiError && err.rule?.code === "confirm_required";
        showToast(isLinked ? t("assign.ctx.why.assigned") : humanizeApiError(err, t), "error");
      } finally {
        reloadAfterEdit(planReload({ kind: "pair", docId }, { aiOn }));
      }
    });
  }

  /** 표·그림 참조를 떼거나 다시 잇는다 - 단위는 그대로라 고름을 두고 보기만 다시 받는다. 편집 기록(되돌리기)에는 들어가지 않는다 */
  async function runCaptionRefChange(refId: number, change: { state: "detached" } | { target_unit_id: number }, okText: string) {
    if (!shapeView) return;
    const view = shapeView;
    const docId = view.document.id;
    await focusCtl.runPending({ kind: "caption", docId, unitIds: [], place: NO_PLACE, isGlobal: false }, async () => {
      try {
        await updateCaptionRef(bundleId, docId, refId, { revision: view.document.revision, ...change });
        showToast(okText);
      } catch (err) {
        showToast(humanizeApiError(err, t), "error");
      } finally {
        reloadAfterEdit(planReload({ kind: "caption_ref", docId }, { aiOn }));
      }
    });
  }

  /** 다듬기의 `One sentence | KO/EN pair` - 짝이면 문서 순서대로 한 문장으로 합치고, 합친 한 문장이면 풀어서 짝으로 맺는다 */
  function switchShapeMode(next: "one" | "pair") {
    if (!shapeTabs || shapeMode === null || shapeMode.current === next || shapeMode.reasonKey !== null) return;
    if (next === "pair") {
      void switchToPair(rowViewUnits[0]);
      return;
    }
    const order = shapeTabs.order;
    const unitIds = rowViewUnits.map((unit) => unit.id).sort((a, b) => order.indexOf(a) - order.indexOf(b));
    void runUnitEdit({ type: "merge", unit_ids: unitIds }, t("split.didMerge"), null);
  }

  /**
   * 합친 한 문장 → 한/영 짝: 합치기를 풀고(배정이 걸렸으면 한 번 묻는다) 되살아난 문장의 언어를 맞춘 뒤 짝으로 맺는다.
   * 풀기와 언어 바꾸기는 되돌리기 기록에 남고 짝 맺기는 남지 않는다. 푼 뒤에 실패하면 어디까지 됐는지 알린다.
   */
  async function switchToPair(unit: ViewUnit, confirm = false) {
    if (!shapeView) return;
    const view = shapeView;
    await focusCtl.runPending({ kind: "pair", docId: view.document.id, unitIds: [unit.id], place: { at: "box", unitId: unit.id }, isGlobal: false }, (job) => sendSwitchToPair(job, view, unit, confirm));
  }

  async function sendSwitchToPair(job: string, sentView: DocumentView, unit: ViewUnit, confirm: boolean) {
    const docId = sentView.document.id;
    let restoredIds: number[] | null = null;
    let isAsking = false;
    try {
      const undone = await editUnits(bundleId, docId, sentView.document.revision, { type: "unmerge", unit_id: unit.id }, confirm, buildUndo({ focus_unit_id: unit.id }));
      restoredIds = undone.created_unit_ids;
      markRecorded();
      const view = await getDocumentView(bundleId, docId);
      const restored = view.units.filter((item) => undone.created_unit_ids.includes(item.id));
      const changes = restored.length < 2 ? null : planPairLanguages(restored);
      if (changes === null) throw new Error(`cannot pair ${restored.length} restored unit(s)`);
      let revision = view.document.revision;
      for (const change of changes) {
        revision = (await editUnits(bundleId, docId, revision, { type: "set_language", unit_ids: change.unitIds, lang: change.lang }, false, buildUndo({ focus_unit_id: change.unitIds[0] }))).document_revision;
      }
      await createPair(bundleId, docId, revision, restored.map((item) => item.id));
      showToast(t("split.didJoin"));
    } catch (err) {
      const count = readConfirmCount(err);
      isAsking = count !== null && !confirm;
      if (count !== null && !confirm) setEditConfirm({ count, retry: { kind: "to_pair", unit } });
      else showToast(restoredIds !== null ? t("split.join.partly") : humanizeApiError(err, t), "error");
    } finally {
      if (restoredIds !== null) {
        // 풀린 뒤로는 옛 단위가 없다 - 다시 받은 뒤 되살아난 첫 문장의 줄을 고른다(고름이 그대로일 때)
        setRefEntryId(null);
        cutLine.clear();
        setCutUnitId(null);
        focusCtl.succeed(job, { docId, revision: null, pickUnitId: restoredIds[0] ?? null });
      }
      // 풀기 · 언어 · 짝 맺기 - confirm이면 판단을 풀며 보냈다
      if (!isAsking) reloadAfterEdit(planReload(oldDocIds.includes(docId) ? { kind: "old_edit", docId, isInPlace: false, isReleased: confirm } : { kind: "new_edit", docId }, { aiOn }));
    }
  }

  /** AI 나누기 제안 적용 - 뒤쪽 위치부터 자르면 앞 조각의 위치가 바뀌지 않는다. 자를 때마다 되돌리기 기록에 한 단계씩 남는다 */
  async function applySplitSuggestion(unit: ViewUnit, suggestion: AiSuggestion, confirm = false) {
    if (!oldView) return;
    const view = oldView;
    const docId = view.document.id;
    await focusCtl.runPending({ kind: "split", docId, unitIds: [unit.id], place: { at: "box", unitId: unit.id }, isGlobal: false }, async (job) => {
      let isAsking = false;
      try {
        let unitId = unit.id;
        let revision = view.document.revision;
        for (const at of readSplitOffsets(suggestion.content.offsets).sort((a, b) => b - a)) {
          const result = await editUnits(bundleId, docId, revision, { type: "split", unit_id: unitId, at }, confirm, buildUndo({ focus_unit_id: unitId }));
          revision = result.document_revision;
          unitId = result.created_unit_ids[0] ?? unitId;
        }
        await setSuggestionAdoption(bundleId, suggestion.id, "as_is");
        markRecorded();
        cutLine.clear();
        setCutUnitId(null);
        showToast(t("split.didSplit"));
        focusCtl.succeed(job, { docId, revision, pickUnitId: unitId });
      } catch (err) {
        // 첫 자르기에서 묻는다(배정이 걸린 것은 자르기 전의 그 문장이다) - 확인하면 처음부터 다시 자른다
        const count = readConfirmCount(err);
        isAsking = count !== null && !confirm;
        if (count !== null && !confirm) setEditConfirm({ count, retry: { kind: "ai_split", unit, suggestion } });
        else showToast(humanizeApiError(err, t), "error");
      } finally {
        // 확인 창을 거쳐(confirm) 판단을 풀며 잘랐으면 판단을 푼 편집과 같다
        if (!isAsking) reloadAfterEdit(planReload(confirm ? { kind: "old_edit", docId, isInPlace: false, isReleased: true } : { kind: "split_suggestion", docId, isApplied: true }, { aiOn }));
      }
    });
  }

  async function dismissSplitSuggestion(suggestion: AiSuggestion) {
    if (!oldView) return;
    const docId = oldView.document.id;
    await focusCtl.runPending({ kind: "save", docId, unitIds: suggestion.content.unit_ids ?? [], place: NO_PLACE, isGlobal: false }, async () => {
      try {
        await setSuggestionAdoption(bundleId, suggestion.id, "rejected");
      } catch (err) {
        showToast(humanizeApiError(err, t), "error");
      } finally {
        // 용지의 제안 표시는 문서 보기에서 온다(한 단으로 연 New 문서면 그 보기)
        reloadAfterEdit(planReload({ kind: "split_suggestion", docId, isApplied: false }, { aiOn }));
      }
    });
  }

  /** 다음 나누기 제안이 붙은 줄로 - 용지 순서로 지금 줄 다음, 끝이면 처음으로 돈다 */
  // AI 나누기 제안이 붙은 줄 - 용지 순서. 위쪽 줄의 수와 목록 창이 쓴다
  const splitPendingIds = (paperTabs?.order ?? []).filter((id) => splitByUnit.has(id) && (hasSolo || rowOfUnit.has(id)));
  /** 확인할 것 목록 창의 한 줄 - 표시 ID와 글 앞부분 */
  function readPendingItem(unitId: number): PendingItem {
    const unit = unitMap.get(unitId);
    return { unitId, label: unit?.display_id ?? String(unitId), text: unit?.text ?? "" };
  }

  function selectNextSplit() {
    const ids = splitPendingIds;
    if (ids.length === 0) return;
    const current = ids.findIndex((id) => (hasSolo ? soloUnits.some((unit) => unit.id === id) : rowOfUnit.get(id) === activeKey));
    goToUnit(ids[(current + 1) % ids.length]);
  }

  /** 확인이 남은 다음 참조 줄로 - 용지 순서로 지금 줄 다음, 끝이면 처음으로 돈다 */
  function selectNextRef() {
    if (refPendingIds.length === 0) return;
    const current = refPendingIds.findIndex((id) => (hasSolo ? soloUnits.some((unit) => unit.id === id) : rowOfUnit.get(id) === activeKey));
    goToUnit(refPendingIds[(current + 1) % refPendingIds.length]);
  }

  /** 캡션이 필요한 다음 표·그림 줄로 - 문서 순서로 지금 줄 다음, 끝이면 처음으로 돈다 */
  function selectNextCaption() {
    if (captionPendingKeys.length === 0) return;
    const next = captionPendingKeys[(captionPendingKeys.indexOf(activeKey ?? "") + 1) % captionPendingKeys.length];
    const unitId = rowMap.get(next)?.unitIds[0];
    if (unitId !== undefined) goToUnit(unitId);
  }

  function splitAtCut() {
    // Pair view에는 용지(나눌 선)가 없다 - 보이지 않는 자리에서 자르지 않는다
    if (!cutUnit || cutLine.at === null || isPairView) return;
    void runUnitEdit({ type: "split", unit_id: cutUnit.id, at: cutLine.at }, t("split.didSplit"), null);
  }

  /** 두 번 누른 자리에 나눌 선 - 메뉴의 "Split here"를 쓸 수 있는 문장만 */
  function handleOldDoubleClick(unitId: number, caret: { blockId: number; offset: number } | null) {
    const unit = paperModel?.units.get(unitId);
    if (!unit || !canEdit || mode !== "old" || isBoxLocked(unitId) || hasUnitDraft(unit) || unit.noise_kind || !["sentence", "heading", "cell_sentence"].includes(unit.kind)) return;
    if (cutLine.placeAtCaret(unit, caret)) setCutUnitId(unit.id);
  }

  function runCtx(action: AssignMenuAction, lang?: "ko" | "en") {
    const target = ctxTarget;
    const caret = ctxMenu?.caret ?? null;
    setCtxMenu(null);
    if (target) runUnitAction(target, action, lang, caret);
  }

  /** 문장 하나에 대한 동작 - 우클릭 메뉴와 오른쪽 칸의 다듬기 줄이 함께 쓴다. caret은 누른 글자 자리(자를 선을 그 가까이에 놓는다) */
  function runUnitAction(target: ViewUnit, action: AssignMenuAction, lang?: "ko" | "en", caret: { blockId: number; offset: number } | null = null) {
    const table = findTableOf(target);
    if (action === "clear") void runClear();
    // 앱이 제안한 참조 줄(옛 추출의 REF?)은 언어 칸의 REF를 누르면 그 번호로 바로 확정한다(요청서 14) - 확인 단추와 같은 편집
    else if (action === "ref_mark" && target.ref?.state === "proposed") void runUnitEdit({ type: "set_ref", unit_id: target.id, number: target.ref.number }, t("assign.ref.didConfirm"), target.id);
    else if (action === "ref_mark") setRefEntryId(target.id);
    else if (action === "ref_clear") void runUnitEdit({ type: "clear_ref", unit_id: target.id }, t("assign.ref.didReject"), target.id);
    else if (action === "split") {
      // Pair view에는 용지가 없어 선이 보이지 않는다 - 끄고(고른 조각이 Old 용지에 보인다) 그 용지에 선을 놓는다
      if (isPairView) {
        closePairView(target.id);
        if (cutLine.placeNear(target, caret)) setCutUnitId(target.id);
      }
      // 이미 그 문장에 선이 있으면 바로 나누고, 없으면 누른 자리(키보드면 가운데) 가까이에 선을 놓는다 - 끌거나 ←→로 옮긴 뒤 Split here
      else if (cutUnit?.id === target.id && cutLine.at !== null) splitAtCut();
      else if (isNewEdit && solo && !written.some((item) => item.new_unit_id === target.id && item.text === target.text)) {
        // New 칸의 줄에 그 문장의 글이 그대로 있지 않으면(표 칸 등) 그 자리에 선을 그릴 수 없다 - 한 단으로 열어 원문에서 자른다
        setSolo({ ...solo, unitId: target.id, inPlace: false });
        changeView({ single: true });
        if (cutLine.placeNear(target, null)) setCutUnitId(target.id);
      } else if (cutLine.placeNear(target, caret)) setCutUnitId(target.id);
    } else if ((action === "merge_prev" || action === "merge_next") && shapeTabs) {
      const order = shapeTabs.order;
      const other = order[order.indexOf(target.id) + (action === "merge_prev" ? -1 : 1)];
      const ids = action === "merge_prev" ? [other, target.id] : [target.id, other];
      void runUnitEdit({ type: "merge", unit_ids: ids }, t("split.didMerge"), null);
    } else if ((action === "pair_prev" || action === "pair_next") && shapeTabs) {
      const order = shapeTabs.order;
      const other = order[order.indexOf(target.id) + (action === "pair_prev" ? -1 : 1)];
      void runPairChange((docId, revision) => createPair(bundleId, docId, revision, [target.id, other]), t("split.didJoin"), target.id, "pair", [target.id, other]);
    } else if (action === "pair_pick") {
      if (!shapeView) return;
      clearCarve();
      setPairFrom({ docId: shapeView.document.id, unitId: target.id, picked: [] });
    } else if (action === "unpair") {
      const pairId = target.pair_id;
      // 짝의 구성원 모두가 잠긴다 - 알약은 누른 박스에
      const members = [...(shapeModel?.units.values() ?? [])].filter((unit) => unit.pair_id === pairId).map((unit) => unit.id);
      if (pairId !== null) void runPairChange((docId, revision) => deletePair(bundleId, docId, pairId, revision), t("split.pairRemoved"), target.id, "unpair", members.length > 0 ? members : [target.id], { at: "box", unitId: target.id });
    } else if (action === "table_layout" && table && table.table_id !== null) unwrapTable(table.table_id);
    else if (action === "caption_attach_prev" || action === "caption_attach_next") {
      // 같은 일, 대상에 따라 짝이 바뀐다 - 묶음 대상이면 이웃 글을, 글 대상이면 이웃 묶음에 붙인다. 붙인 뒤 묶음 줄을 고른다
      const neighbor = findNeighbors(target)[action === "caption_attach_prev" ? "prev" : "next"];
      const isBundle = isBundleKind(target.kind);
      const text = isBundle ? neighbor : target;
      const holder = isBundle ? target : findBundleOf(neighbor);
      if (text && holder) void runUnitEdit({ type: "attach_caption", unit_id: text.id, bundle_unit_id: holder.id }, t("assign.ctx.didAttachCaption"), holder.id);
    } else if (action === "caption_detach" && target.group_unit_id !== null) void runUnitEdit({ type: "detach_caption", unit_id: target.id }, t("assign.ctx.didDetachCaption"), target.group_unit_id);
    else if (action === "lang" && lang && target.lang === "ref") void runUnitEdit({ type: "clear_ref", unit_id: target.id }, t("common.saved"), target.id, false, lang);
    else if (action === "lang" && lang) void runUnitEdit({ type: "set_language", unit_ids: [target.id], lang }, t("common.saved"), target.id);
    else if (action === "to_sentence") void runUnitEdit({ type: "set_heading", unit_ids: [target.id], heading: false }, t("assign.headingShift.didSentence"), null);
    else if (action === "to_heading") revertHeadings([target.id]);
  }

  /** 제목으로(되돌리기) - 제목에서 바꾼 문장은 서버가 그 조항 줄 전체를 모아 제목 하나로 돌린다(F8b). 한 편집이라 Ctrl+Z 한 번이다 */
  function revertHeadings(unitIds: number[]) {
    if (unitIds.length === 0) return;
    void runUnitEdit({ type: "set_heading", unit_ids: unitIds, heading: true }, t("assign.headingShift.didHeading"), null);
  }

  /** 조각 사이의 붙이기 단추가 할 일 - 같은 언어면 합치기, 한글·영어면 짝(원문 고치기와 같은 규칙에 Assign의 막는 까닭을 더한다) */
  function planOldJoin(firstId: number, secondId: number): JoinPlan {
    return planAssignJoin(paperModel?.units.get(firstId), paperModel?.units.get(secondId), { isDecided: isUnitDecided, hasDraft: hasUnitDraft });
  }

  function joinOld(firstId: number, secondId: number, kind: JoinKind) {
    // 처리 중 알약은 누른 틈에(설계 D4)
    const gap: PendingPlace = { at: "gap", firstId, secondId };
    if (kind === "merge") void runUnitEdit({ type: "merge", unit_ids: [firstId, secondId] }, t("split.didMerge"), null, false, null, gap);
    else void runPairChange((docId, revision) => createPair(bundleId, docId, revision, [firstId, secondId]), t("split.didJoin"), firstId, "pair", [firstId, secondId], gap);
  }

  /** 고른 조각의 글 아래 단추 - 합친 문장 풀기(풀 것이 있을 때만 줄이 생긴다). 짝 풀기는 우클릭 메뉴에 있어 여기 두지 않는다(줄마다 단추 줄이 붙지 않게) */
  function renderOldActions(unitId: number): ReactNode {
    const unit = paperModel?.units.get(unitId);
    if (!canEdit || mode !== "old" || !unit || !unit.can_unmerge || hasUnitDraft(unit)) return null;
    return (
      <SplitUnitActions
        key={unit.id}
        testIdPrefix="assign"
        unitId={unit.id}
        canUnpair={false}
        canUnmerge
        busy={busy}
        onUnpair={() => undefined}
        onUnmerge={() => void runUnitEdit({ type: "unmerge", unit_id: unit.id }, t("split.didUnmerge"), null)}
      />
    );
  }

  function buildTables(): Map<number, { rows: number; cols: number; cells: CellSource[] }> {
    const tables = new Map<number, { rows: number; cols: number; cells: CellSource[] }>();
    const source = viewOf(row?.documentId);
    if (!source || !row) return tables;
    for (const unitId of row.unitIds) {
      const unit = source.units.find((item) => item.id === unitId);
      if (!unit || unit.kind !== "table" || unit.table_id === null) continue;
      const table = source.tables.find((item) => item.id === unit.table_id);
      const cells = source.units
        .filter((item) => item.group_unit_id === unit.id && item.kind === "cell_sentence")
        .map((item) => {
          const block = source.blocks.find((candidate) => candidate.id === item.block_id);
          return { id: item.id, lang: item.lang, text: item.text, row: block?.row_index ?? item.row_index ?? 0, col: block?.col_index ?? 0 };
        });
      tables.set(unit.id, { rows: table?.n_rows ?? 1, cols: table?.n_cols ?? 1, cells });
    }
    return tables;
  }

  /** 줄의 표·그림에 묶인 캡션 단위 - 저장 요청의 캡션 새 문장 출처(buildTables의 칸 문장과 같은 길) */
  function buildCaptions(): Map<number, CaptionUnit[]> {
    const captions = new Map<number, CaptionUnit[]>();
    const source = viewOf(row?.documentId);
    if (!source || !row) return captions;
    for (const unitId of row.unitIds) {
      const units = source.units.filter((item) => item.kind === "caption" && item.group_unit_id === unitId);
      if (units.length > 0) captions.set(unitId, units.map((item) => ({ id: item.id, lang: item.lang, text: item.text })));
    }
    return captions;
  }

  /**
   * 묶음 저장 응답의 짝 정리를 화면에 반영한다 - 짝은 서버가 같은 저장 안에서 확정하거나 푼다(제품 명세 §6.5).
   * 푼 짝이 있을 때만 원문 보기를 다시 받는다 - 줄은 보기의 짝에서 나온다. 확정만 됐으면 줄이 그대로이고 이 화면은 짝 상태도 문서 revision도 쓰지 않는다.
   * 이 줄의 짝이 풀렸으면 거르기 자리의 짝 줄을 풀린 줄들로 바꾸고 true - 남은 문장이 목록에서 사라지지 않게.
   */
  function applyPairSettle(savedRow: ClassifyRow, saved: Group, leftovers: number[]): boolean {
    const dissolved = saved.pairs_dissolved ?? [];
    if (dissolved.length > 0) void docViews.reload({ docs: "all", units: null });
    if (savedRow.pairId === null || !dissolved.includes(savedRow.pairId)) return false;
    setSnapshot((prev) => prev && { ...prev, keys: prev.keys.flatMap((key) => (key === savedRow.key ? listUnpairedKeys(savedRow) : [key])) });
    const ids = leftovers.map((id) => unitMap.get(id)?.display_id ?? String(id)).join(", ");
    showToast(leftovers.length > 0 ? t("assign.leftover.split", { ids }) : t("assign.pairDissolved"));
    return true;
  }

  /** 이 저장에 사유가 꼭 있어야 하는 까닭 - 없으면 null. 삭제·이동은 선택이다(비면 결과물이 "삭제"·"이동"으로 적는다, 요청서 4번) */
  function readReasonNeed(action: "confirm" | "hold"): "hold" | "duplicate" | null {
    if (action === "hold") return "hold";
    return new Set(linkIds.map((id) => findWrittenRow(id)?.target_doc_id)).size > 1 ? "duplicate" : null;
  }

  /** reasonOverride는 Remark 창에서 방금 확인한 사유 - 초안 상태가 아직 반영되기 전이라 직접 넘긴다 */
  async function runSave(action: "confirm" | "hold", reasonOverride?: string) {
    // 보낼 곳 없이는 보류만 된다(처분 unassigned + hold, 사유는 hold_reason)
    if (!row || busy || (!destination && action !== "hold")) return;
    if (isRowLoading) {
      // 줄의 정보를 받는 중이다 - 누른 것을 버리지 않고, 다 받으면 한다(전에는 단추가 켜져 보이는데 눌러도 아무 일이 없었다)
      queuedSaveRef.current = { key: row.key, action, reason: reasonOverride };
      return;
    }
    if (action === "confirm" && isRefGate) {
      // 참조 줄 제안이 남았다 - 결정 전에 번호만 확인한다(오른쪽 칸 맨 위 카드). ↵·메뉴·사유 창 뒤 확정이 모두 여기를 지난다
      showToast(t("assign.ref.checkFirst"), "error");
      return;
    }
    if (action === "confirm" && isCaptionGateOn) {
      // 캡션 없는 표·그림 - 단추는 꺼져 있고, ↵·메뉴 확정도 같은 까닭으로 멈춘다
      showToast(t("assign.caption.needed"), "error");
      return;
    }
    const reason = reasonOverride ?? reasonNow;
    // 대상 문서를 먼저 본다 - 사유 창을 거친 뒤에 다시 막히지 않게
    if (destination?.kind === "move" && !moveCode.trim()) {
      showToast(t("classify.moveCodeNeeded"), "error");
      document.querySelector<HTMLElement>('[data-testid="assign-move-code"]')?.focus();
      return;
    }
    const need = readReasonNeed(action);
    if (need !== null && !reason.trim()) {
      // 알림만 띄우지 않고 사유 창을 연다 - 확인하면 이 저장을 잇는다
      setRemarkEdit({ kind: "row", need, then: action });
      return;
    }
    const saveRow = row;
    await focusCtl.runPending({ kind: "save", docId: row.documentId, unitIds: row.unitIds, place: NO_PLACE, isGlobal: false }, (job) => sendSave(job, saveRow, action, reason));
  }

  /** runSave의 보내기 - 그 줄의 Unit은 응답까지 잠긴다(알약은 그리지 않는다, 설계 D4) */
  async function sendSave(job: string, row: ClassifyRow, action: "confirm" | "hold", reason: string) {
    try {
      // 고친 칸만 글을 보낸다 - 손대지 않은 AI 제안은 글·종류를 비워 보내 제안 그대로 받는다
      const context = { units: saveUnits, group: saveGroupData, tables: buildTables(), captions: buildCaptions() };
      const body = buildGroupSave({ ...draft, destination, reason, moveCode }, context, action, action === "hold" ? reason.trim() : "");
      // Use로 받은 제안을 싣는다 - 서버가 판단에 잇고 채택(그대로·고침·버림)을 남긴다
      if (draft.suggestionId) body.suggestion_id = draft.suggestionId;
      const leftovers = body.release_unit_ids ?? [];
      // 끌어 놓은 자리를 실은 저장이면 미리 고침도 그 자리에 넣는다 - 끝에 넣으면 다시 읽을 때 줄이 뛴다
      const sectionKey = getSectionKey(destination);
      const at = draft.position && sectionKey !== null && body.targets.some((target) => target.position !== undefined) ? { sectionKey, after: draft.position.after } : null;
      // 놓인 문장에 잇기도 출처를 잇는 일이라 알림의 되돌리기 이름이 잇기다
      const op = destination?.kind === "join" && action === "confirm" ? "link" : pickSaveOp({ action, destinationKind: destination?.kind ?? null, savedLinkIds: savedDestination?.kind === "link" ? savedDestination.targetIds : [], nextLinkIds: linkIds });
      // 엮은 문서의 칸에 놓는 확정은 어디 몇 번이 되는지 알리고 되돌리기를 단다(MD 2 S3) - 저장 전 자리로 센다
      const placedNote = action === "confirm" ? formatPlacedToast() : null;
      const saved = await saveGroup(bundleId, body, buildUndo({ op, focus_unit_id: row.unitIds[0] }));
      markRecorded();
      // 저장했으면 메뉴의 고름은 끝났다 - 다음 줄이 없거나 같은 줄에 남아도 닫는다
      setMenu(null);
      if (placedNote !== null) showToast(placedNote, "ok", { action: { label: t("common.undo"), run: () => void undoStepRef.current("undo") } });
      else showToast(action === "hold" ? t("classify.held") : t("classify.confirmed"));
      const isSplit = applyPairSettle(row, saved, leftovers) && leftovers.length > 0;
      // 다음 미확정 줄로 - 지금 줄은 거르기 자리에 남는다. 남는 쪽을 풀었으면 남은 문장의 줄이 다음이다
      // 놓인 문장에 잇기는 그 줄에 머문다 - 곧바로 그 문장의 연필(Rewrite)로 포커스를 옮겨 고쳐 쓰게(MD 1 F12 E4)
      const next = shouldAdvanceAfterSave({ action, destinationKind: destination?.kind ?? null, isSplit }) ? findNextOpen(listKeys, rowMap, row.key) : null;
      if (action === "confirm" && destination?.kind === "join" && !isSplit) setEditFocus({ key: row.key });
      if (action === "confirm") showSent(row, saved, next ?? row.key, at);
      dropDraft(row.key);
      // 한 언어만 이어 짝을 풀었으면 남은 문장의 줄로 옮긴다 - 다시 받아 그 줄이 생긴 뒤, 그 사이 다른 줄을 고르지 않았을 때
      if (isSplit) focusCtl.succeed(job, { docId: row.documentId, revision: null, pickUnitId: leftovers[0] });
      if (next) selectRow(next);
      reloadData();
      void loadBundle(bundleId);
    } catch (err) {
      showToast(humanizeApiError(err, t), "error");
      reloadData();
    }
  }

  // 줄의 정보를 받는 사이에 누른 확정·보류 - 다 받은 뒤 그 줄을 그대로 고르고 있을 때만 한다(그 사이 다른 줄로 갔으면 버린다)
  const queuedSaveRef = useRef<{ key: string; action: "confirm" | "hold"; reason?: string } | null>(null);
  const isRowLoading = groupPending || pickedGroups.isLoading;
  const runQueuedSave = useEffectEvent(() => {
    const queued = queuedSaveRef.current;
    queuedSaveRef.current = null;
    if (queued && row?.key === queued.key) void runSave(queued.action, queued.reason);
  });
  const queuedRowKey = row?.key ?? null;
  useEffect(() => {
    if (!isRowLoading) runQueuedSave();
  }, [isRowLoading, queuedRowKey]);

  /**
   * 확정한 곳을 오른쪽 칸에 바로 보인다 - 그 문서로 옮기고(다음 줄에서도, 손으로 고른 문서가 없을 때), 엮은 문서면 저장 응답으로 칸에 미리 넣는다.
   * 그 문장이 그려지면 NewPane이 화면에 들이고, 잇는 선은 진하게 그린다. at은 저장이 실은 놓은 자리(칸 끝 대신 그 자리에 넣는다)
   */
  function showSent(savedRow: ClassifyRow, saved: Group, nextKey: string, at: { sectionKey: string; after: number | null } | null) {
    const docId = destination?.kind === "slot" || destination?.kind === "step" || destination?.kind === "join" ? destination.docId : destination?.kind === "link" ? (findWrittenRow(destination.targetIds[0])?.target_doc_id ?? null) : null;
    if (docId === null || !destination) return;
    const isMine = (target: Group["targets"][number]) => target.source_unit_ids.some((id) => savedRow.unitIds.includes(id)) || (target.translation_source_unit_id !== null && savedRow.unitIds.includes(target.translation_source_unit_id));
    const targetIds = destination.kind === "link" ? destination.targetIds : destination.kind === "join" ? [destination.targetId] : saved.targets.filter((target) => target.target_doc_id === docId && target.parent_target_id === null && isMine(target)).map((target) => target.id);
    setLiveNew((prev) => ({ key: nextKey, docId, targetIds, seq: (prev?.seq ?? 0) + 1 }));
    if (composed.data?.target_doc_id === docId && destination.kind === "join") {
      // 놓인 문장은 그 자리에서 출처만 늘고 번호·글은 그대로다 - 칸 끝에 다시 넣지 않는다
      const joined = saved.targets.find((target) => target.id === destination.targetId);
      if (joined) setComposedPatch({ base: composed.data, doc: applyJoinedSources(composedDoc ?? composed.data, joined.id, joined.source_unit_ids) });
    } else if (composed.data?.target_doc_id === docId) {
      const textOf = (unitIds: number[]) => unitIds.map((id) => unitMap.get(id)?.text ?? "").join(" ");
      // 앞 저장의 미리 고침 위에 얹는다 - 다시 읽기가 오기 전에 연달아 확정해도 앞 문장이 빠지지 않게
      setComposedPatch({ base: composed.data, doc: applySavedTargets(composedDoc ?? composed.data, saved.targets, textOf, at) });
    }
  }

  async function runClear() {
    if (!row || busy) return;
    const decided = rowUnits.filter((unit) => unit.decision.disposition !== "unassigned" || unit.status !== "unassigned");
    if (decided.length === 0) return;
    const clearRow = row;
    await focusCtl.runPending({ kind: "save", docId: row.documentId, unitIds: row.unitIds, place: NO_PLACE, isGlobal: false }, async () => {
      try {
        await clearDecisions(bundleId, decided.map((unit) => ({ unit_id: unit.unit_id, revision: unit.decision.revision })), buildUndo({ step_key: genId(), focus_unit_id: clearRow.unitIds[0] }));
        markRecorded();
        // 엮은 문서에서 그 문장을 바로 뺀다 - 오른쪽 칸은 그 문서에 머물러(배정이 없어져 저절로 다른 문서로 가지 않게) 접히며 사라지는 것이 보이고, 다시 읽은 값이 맞춘다
        if (composed.data && isComposedDoc && newDocId !== null) {
          const docId = newDocId;
          setLiveNew((prev) => ({ key: toggleKey, docId, targetIds: [], seq: (prev?.seq ?? 0) + 1 }));
          setComposedPatch({ base: composed.data, doc: removeClearedUnits(composedDoc ?? composed.data, new Set(clearRow.unitIds)) });
        }
        setMenu(null);
        showToast(t("classify.cleared"));
        dropDraft(clearRow.key);
        reloadData();
        void loadBundle(bundleId);
      } catch (err) {
        showToast(humanizeApiError(err, t), "error");
        reloadData();
      }
    });
  }

  /** 묶음 전체 일 하나(같은 글자 일괄 확정) - withViews면 원문 보기도(서버가 짝을 정리하지만 어느 짝인지 알려 주지 않는다). 다른 일이 처리 중이면 시작하지 않는다 */
  async function run(action: () => Promise<unknown>, message: string, withViews = false) {
    await focusCtl.runPending({ kind: "bulk", docId: null, unitIds: [], place: NO_PLACE, isGlobal: true }, async () => {
      try {
        await action();
        showToast(message);
        reloadData(withViews);
        void loadBundle(bundleId);
      } catch (err) {
        showToast(humanizeApiError(err, t), "error");
        reloadData();
      }
    });
  }

  /** 되돌리기·다시 하기 - 다시 받은 뒤 그 단계의 줄(없으면 New 문장)을 고른다. 거절은 기록을 그대로 두고 이유만 알린다 */
  /** 칸에 놓는 확정의 알림 글 - "확정함 · OLD-7-015 → 6.1. Filter change · 6.1.2"(번호를 세지 않는 칸은 번호 없이). 지금 초안이 열린 엮은 문서의 칸 · step이 아니면 null */
  function formatPlacedToast(): string | null {
    if (!row || !draftPlace || !composedDoc || !placeResolved || draftPlace.docId !== composedDoc.target_doc_id || draftSectionKey === null) return null;
    const section = composedDoc.sections.find((candidate) => candidate.location_key === draftSectionKey);
    const place = readPlacePosition(placeResolved.sections, draftSectionKey, draftPosition ? draftPosition.after : undefined);
    if (!section || !place) return null;
    const vars = { id: unitMap.get(row.unitIds[0])?.display_id ?? "", head: readSectionHead(section) };
    return place.position.kind === "number" ? t("assign.place.toastNumber", { ...vars, n: place.position.numbers.becomes }) : t("assign.place.toast", vars);
  }

  // 알림의 되돌리기는 화면을 넘어 남는다 - 그 렌더의 함수를 붙들지 않게 가장 최근의 것을 미러한다(pairUndoRef와 같은 짜임)
  const undoStepRef = useRef(runUndoStep);
  useEffect(() => {
    undoStepRef.current = runUndoStep;
  });

  async function runUndoStep(kind: "undo" | "redo") {
    if (!canEdit) return;
    // 묶음 전체 일이라 다른 일이 처리 중이면 시작하지 않고, 시작하면서 앞 편집의 따라가기를 버린다(모델의 start) - 응답을 기다리는 사이 그 편집의
    // 다시 받기가 오면 따라가기가 걸려, 서버에서 이미 은퇴한 Unit을 골라 묶음을 부른다(404). 되돌리기는 응답의 focus로 따로 따라간다
    await focusCtl.runPending({ kind: "undo", docId: null, unitIds: [], place: NO_PLACE, isGlobal: true }, (job) => sendUndoStep(job, kind));
  }

  async function sendUndoStep(job: string, kind: "undo" | "redo") {
    let stepOp: string | null = null;
    try {
      const result = await (kind === "undo" ? undoDecision : redoDecision)(bundleId, undoSession.current);
      stepOp = result.op;
      setUndoState({ canUndo: result.can_undo, canRedo: result.can_redo });
      setMenu(null);
      setCtxMenu(null);
      setChecked(new Set());
      // 되돌린 줄의 초안은 바뀌기 전 판단 위의 고름이다
      for (const key of new Set(result.unit_ids.map((id) => rowOfUnit.get(id)).filter((key) => key !== undefined))) dropDraft(key);
      // 모양 편집(자르기·합치기·제목↔문장·캡션·그림 묶기 …)을 거꾸로·다시 하면 Unit이 은퇴할 수 있다 - 그 Unit에 놓인 나눌 선을 거둔다.
      // 고름은 둔다 - 다시 받은 보기에 없으면 모델이 놓는다(D1 규칙 5)
      if (shouldDropSelectionOnStep(result)) {
        cutLine.clear();
        setCutUnitId(null);
      }
      // 응답은 문서를 알려 주지 않는다 - New 문서를 고른 채면 그 문서에서, 아니면 다시 받은 Old 문서 어디서든 찾는다
      if (mode === "unsourced" && result.focus_target_id !== null) setSelNew(result.focus_target_id);
      else if (result.focus_unit_id !== null) focusCtl.succeed(job, { docId: hasSolo && solo ? solo.docId : null, revision: null, pickUnitId: result.focus_unit_id });
      else if (result.focus_target_id !== null) showInNew(result.focus_target_id);
      showToast(formatDecisionStep(result, kind));
    } catch (err) {
      const code = err instanceof ApiError ? err.rule?.code : undefined;
      if (code === "nothing_to_undo") setUndoState((prev) => ({ ...prev, canUndo: false }));
      else if (code === "nothing_to_redo") setUndoState((prev) => ({ ...prev, canRedo: false }));
      // 자르기를 거꾸로 할 조각에 그 사이 판단이 걸렸다 - 묻지 않고 거절한다(설계 §4.4)
      if (code === "confirm_required") showToast(t("assign.ctx.why.assigned"), "error");
      else if (code === "undo_conflict" && err instanceof ApiError) showToast(formatUndoRefusal(err.rule?.unit_ids, kind), "error");
      else showToast(humanizeApiError(err, t), "error");
    } finally {
      // Old 원문 편집의 되돌리기는 판단이 그대로라 Old 문서 보기 · 줄과 같은 글자 후보만(응답이 문서를 알려 주지 않아 모든 Old 문서, 설계 D2).
      // 판단 저장 단계 · New 문서를 고른 채 · 거절은 지금처럼 모두 - 거절도 그 사이 바뀐 것이 있다는 뜻이고, 짝 모양이 바뀌었을 수 있어 원문 보기도
      if (stepOp !== null && solo === null && isUnitEditStep(stepOp)) reloadAfterEdit(planReload({ kind: "edit_undo", docId: null }, { aiOn }));
      else {
        if (solo !== null) setSoloKey((key) => key + 1);
        reloadData(true);
        void loadBundle(bundleId);
      }
    }
  }

  /** 되돌리기 거절 알림 - 어느 줄이 걸렸는지 번호로(3개까지). 지금 목록에 없는 Unit(은퇴한 조각)은 빼고, 남는 것이 없으면 번호 없이 */
  function formatUndoRefusal(unitIds: unknown, kind: "undo" | "redo"): string {
    const ids = Array.isArray(unitIds) ? unitIds.filter((id): id is number => typeof id === "number") : [];
    const labels = [...new Set(ids.map((id) => unitMap.get(id)?.display_id).filter((label): label is string => label !== undefined))];
    const rows = labels.length === 0 ? "" : ` (${labels.slice(0, 3).join(", ")}${labels.length > 3 ? ` +${labels.length - 3}` : ""})`;
    return t(kind === "undo" ? "assign.undoRefused" : "assign.redoRefused", { rows });
  }

  /** 되돌리기·다시 하기 알림 - Split formatStep과 같은 꼴(무엇 · 대상) */
  function formatDecisionStep(result: DecisionStepResult, kind: "undo" | "redo"): string {
    const message = describeDecisionStep(
      result,
      kind,
      (unitId) => unitMap.get(unitId)?.display_id ?? null,
      (targetId) => {
        const target = writtenMap.get(targetId);
        return target ? `${target.doc_code} ${target.section_path || target.order_index}` : null;
      },
    );
    const { action, target } = message.vars;
    let label = "";
    if (typeof target === "number") label = t("assign.step.lines", { n: target });
    else if (target === "assign.step.wholeBundle") label = t(target);
    else if (target !== undefined) label = String(target);
    return t(message.key, { action: t(String(action)), target: label === "" ? "" : ` · ${label}` });
  }

  async function confirmIdenticalAll() {
    const items = identical.data ?? [];
    // 서버 상한(1000)씩 차례로 - revision은 후보 목록에 실려 온다
    if (items.length > 0) {
      // 나눠 보낸 요청 모두가 같은 step_key - Ctrl+Z 한 번에 한꺼번에 되돌아간다
      const undo = buildUndo({ step_key: genId() });
      await run(async () => {
        for (const batch of buildIdenticalBatches(items)) {
          await confirmMatchesInBulk(bundleId, batch, undo);
          markRecorded();
        }
        // 한 번에 확정도 서버가 짝을 정리하지만 어느 짝인지 알려 주지 않는다 - 짝 모양·문서 revision을 다시 받는다
      }, t("match.identicalDone", { n: items.length }), true);
    }
    setConfirmingIdentical(false);
  }

  /** 고른 AI 추천을 한 번에 받는다 - 서버가 제안마다 사람의 저장 경로로 확정하고 한 되돌리기 단계로 남긴다. 그 사이 바뀐 것은 건너뛴 수로 알린다 */
  async function acceptAll(kind: AcceptKind, ids: number[], deleteReason: string) {
    await focusCtl.runPending({ kind: "bulk", docId: null, unitIds: [], place: NO_PLACE, isGlobal: true }, async () => {
      try {
        // 서버 상한(2000)씩 차례로 - 나눠 보낸 요청 모두가 같은 step_key라 Ctrl+Z 한 번에 한꺼번에 되돌아간다
        const undo = buildUndo({ step_key: genId() });
        const out = { accepted: 0, skipped: 0 };
        for (const batch of splitAcceptIds(ids, MAX_ACCEPT)) {
          const done = await acceptSuggestions(bundleId, { kind, suggestion_ids: batch, delete_reason: deleteReason }, undo);
          out.accepted += done.accepted;
          out.skipped += done.skipped;
        }
        if (out.accepted > 0) markRecorded();
        showToast(t(out.skipped > 0 ? "aiAccept.doneSkipped" : "aiAccept.done", { n: out.accepted, skipped: out.skipped }));
        setAcceptKind(null);
      } catch (err) {
        showToast(humanizeApiError(err, t), "error");
      } finally {
        // 받은 줄의 짝을 서버가 정리한다 - 짝 모양·문서 revision도 다시 받는다(같은 글자 한 번에 확정과 같다)
        reloadData(true);
        void loadBundle(bundleId);
      }
    });
  }

  /** 출처 없는 New 문장을 신규로 확정 - Remark를 같이 싣는다(단위 판단이 없어 새 문장이 글을 담는다, 제품 명세 §7.7) */
  function markNew() {
    const target = writtenMap.get(focusNew ?? -1);
    if (!target) return;
    const remark = (newRemarks[target.target_id] ?? target.remark).trim();
    const body: GroupSaveInput = {
      action: "confirm",
      hold_reason: "",
      units: [],
      targets: [{ key: `t${target.target_id}`, id: target.target_id, revision: target.revision, source_unit_ids: [], remark }],
      removed_target_ids: [],
    };
    void run(async () => {
      await saveGroup(bundleId, body, buildUndo({ op: "mark_new", focus_target_id: target.target_id }));
      markRecorded();
    }, t("match.newDone"));
  }

  /** 출처 없는 New 모드에서 Old 조각을 누르면 그 줄을 이 문장의 출처로 잇는다(그 줄의 다른 곳은 바꾸기로 뗀다) */
  async function linkAsSource(unitId: number) {
    const key = rowOfUnit.get(unitId);
    const sourceRow = key ? rowMap.get(key) : undefined;
    const target = writtenMap.get(focusNew ?? -1);
    if (!sourceRow || !target || isAnyPending || !canEdit) return;
    if (sourceRow.status !== "confirmed" && sourceRow.unitIds.some((id) => isRefPending(paperModel?.units.get(id)))) {
      // 눌러서 출처로 잇는 것도 그 줄의 결정이다 - 참조 줄 제안이 남았으면 먼저 그 줄에서 번호를 확인한다
      showToast(t("assign.ref.checkFirst"), "error");
      selectRow(sourceRow.key);
      return;
    }
    const sourceUnits = sourceRow.unitIds.map((id) => unitMap.get(id)).filter((unit): unit is UnitRow => unit !== undefined);
    const targetIds = addPartnerTargets([target.target_id], writtenMap);
    await run(async () => {
      const rowGroup = await loadRowGroup(bundleId, sourceRow.unitIds);
      const extra = await Promise.all(targetIds.map((id) => getGroupByTarget(bundleId, id)));
      const link: Destination = { kind: "link", targetIds };
      const context = {
        units: sourceUnits.map((unit) => ({ id: unit.unit_id, kind: unit.kind, lang: unit.lang, text: unit.text, content_start: unit.content_start, revision: unit.decision.revision })),
        group: mergeGroups([rowGroup, ...extra]),
        tables: new Map(),
      };
      const body = buildGroupSave({ destination: link, texts: {}, reason: readHumanReason(sourceUnits[0]?.decision), moveCode: "" }, context, "confirm");
      // 이 문장에 없는 언어의 Old 문장은 서버가 짝을 풀어 제 줄로 남긴다 - 출처 없는 New를 계속 보게 고른 줄은 옮기지 않는다
      const saved = await saveGroup(bundleId, body, buildUndo({ op: "link_source", focus_unit_id: unitId, focus_target_id: target.target_id }));
      markRecorded();
      applyPairSettle(sourceRow, saved, body.release_unit_ids ?? []);
    }, t("match.linked"));
  }

  /**
   * 칸 칩의 × - 그 Old 줄을 그 칸에서 뗀다(시안 2 D5). 그 자리 메뉴의 Unlink와 같은 저장이다: 줄의 다른 이음이 남으면 그곳만 남겨
   * 확정하고, 없으면 배정을 지운다. 표의 다른 칸은 서버가 손대지 않는다(구경꾼)
   */
  async function unlinkCell(cellId: number, unitId: number) {
    const key = rowOfUnit.get(unitId);
    const sourceRow = key ? rowMap.get(key) : undefined;
    if (!sourceRow || isAnyPending || !canEdit) return;
    const sourceUnits = sourceRow.unitIds.map((id) => unitMap.get(id)).filter((unit): unit is UnitRow => unit !== undefined);
    await run(async () => {
      const group = mergeGroups([await loadRowGroup(bundleId, sourceRow.unitIds), await getGroupByTarget(bundleId, cellId)]);
      const saved = readDestination(group, sourceRow.unitIds);
      const remainder = saved?.kind === "link" ? saved.targetIds.filter((id) => id !== cellId) : [];
      if (remainder.length === 0) {
        const decided = group.units.filter((unit) => sourceRow.unitIds.includes(unit.unit_id) && unit.decision.disposition !== "unassigned");
        await clearDecisions(bundleId, decided.map((unit) => ({ unit_id: unit.unit_id, revision: unit.decision.revision })), buildUndo({ step_key: genId(), focus_unit_id: unitId }));
      } else {
        const context = {
          units: sourceUnits.map((unit) => ({ id: unit.unit_id, kind: unit.kind, lang: unit.lang, text: unit.text, content_start: unit.content_start, revision: unit.decision.revision })),
          group,
          tables: new Map(),
        };
        const body = buildGroupSave({ destination: { kind: "link", targetIds: remainder }, texts: {}, reason: readHumanReason(sourceUnits[0]?.decision), moveCode: "" }, context, "confirm");
        applyPairSettle(sourceRow, await saveGroup(bundleId, body, buildUndo({ op: "unlink", focus_unit_id: unitId, focus_target_id: cellId })), body.release_unit_ids ?? []);
      }
      markRecorded();
      if (sourceRow.key === activeKey) dropDraft(sourceRow.key);
    }, t("assign.cellLink.unlinked"));
  }

  /** 보낼 곳 한 줄을 더하거나 지운다 - 응답의 새 목록을 바로 쓰고, 묶음 revision이 올랐으니 묶음도 다시 읽는다 */
  async function writePlace(write: () => Promise<ToBe>, okText: string): Promise<ToBe | null> {
    if (isPlaceBusy) return null;
    setIsPlaceBusy(true);
    try {
      const next = await write();
      setTobeFresh({ key: tobeKey, data: next });
      void loadBundle(bundleId);
      showToast(okText);
      return next;
    } catch (err) {
      showToast(humanizeApiError(err, t), "error");
      return null;
    } finally {
      setIsPlaceBusy(false);
    }
  }

  const placeManage: DestinationManage | undefined =
    canEdit && tobeData
      ? {
          tobe: tobeData,
          busy: isPlaceBusy,
          onAddDoc: async (draft) =>
            (await writePlace(() => addToBeDoc(bundleId, { code: draft.code, doc_type: draft.docType, parent_code: draft.parentCode }), t("assign.tree.added", { name: draft.code }))) !== null,
          onAddStep: async (doc, title) => {
            const next = await writePlace(() => addWiStep(bundleId, doc.id, title), t("assign.tree.added", { name: doc.code }));
            return next ? findLastStep(next, doc.code) : null;
          },
          onRemoveDoc: async (doc) => {
            if ((await writePlace(() => removeToBeDoc(bundleId, doc.id), t("assign.tree.removed", { name: doc.code }))) === null) return false;
            // 오른쪽 칸에 열어 둔 문서였거나 아직 저장하지 않은 고름이 그 문서였으면 놓는다 - 없어진 곳으로 확정하지 않게
            setManualNewDoc((prev) => (prev?.docId === doc.id ? null : prev));
            setLiveNew((prev) => (prev?.docId === doc.id ? null : prev));
            if (destination !== null && "docId" in destination && destination.docId === doc.id) setDraft({ destination: null });
            return true;
          },
          onRemoveStep: async (doc, stepNo) => {
            const name = `${doc.code} · ${t("assign.tree.stepName", { n: stepNo })}`;
            if ((await writePlace(() => removeWiStep(bundleId, doc.id, stepNo), t("assign.tree.removed", { name }))) === null) return false;
            if (destination?.kind === "step" && destination.docId === doc.id && destination.step === stepNo) setDraft({ destination: null });
            return true;
          },
        }
      : undefined;

  /** use - Use로 받은 AI 제안의 초안(고쳐 쓴 글)과 제안 id. 없으면 다른 곳을 고른 것이라 받은 제안을 비운다 */
  function pickDestination(next: Destination, use: Pick<PageDraft, "texts" | "suggestionId"> | null = null) {
    // 보낼 곳을 다시 고르면 끌어 놓은 자리는 버린다
    setDraft({
      destination: next.kind === "link" ? { kind: "link", targetIds: addPartnerTargets(next.targetIds, writtenMap) } : next,
      position: null,
      suggestionId: use?.suggestionId ?? null,
      ...(use ? { texts: { ...draft.texts, ...use.texts } } : {}),
    });
    // 고른 곳의 New 문서로 칸을 옮긴다 - Old 줄을 바꾸는 것만으로는 옮기지 않으니 여기가 따라가는 길이다
    const docId = findDestinationDoc(next, writtenMap);
    if (docId !== null && docId !== newDocId && isNewDocOpen(docId)) setManualNewDoc({ key: toggleKey, docId });
  }

  /** New 문장 고르기 - 고른 곳이 바뀌었으면 true */
  function pickNewSentence(targetId: number, additive: boolean): boolean {
    if (mode === "unsourced") {
      setSelNew(targetId);
      return false;
    }
    if (!row || !canEdit) return false;
    // 이 줄에 없는 언어의 New 문장도 잇는다 - 줄의 조각이 출처가 되어 번역이 된다(제품 명세 §7.7)
    const current = destination?.kind === "link" ? destination.targetIds : [];
    const isRemoving = additive && current.includes(targetId);
    const next = additive ? (isRemoving ? current.filter((id) => id !== targetId) : [...current, targetId]) : [targetId];
    if (next.length === 0) setDraft({ destination: null });
    // 함께 골라진 짝 문장을 Ctrl로 빼면 다시 붙이지 않는다 - 뺀 문장은 출처 없이 남아 신규가 된다(제품 명세 §7.7)
    else if (isRemoving) setDraft({ destination: { kind: "link", targetIds: next } });
    else pickDestination({ kind: "link", targetIds: next });
    return next.length > 0;
  }

  /** New 원문의 줄을 누름 - 이미 확정해 이은 문장이면 고름을 바꾸지 않고 끊기 메뉴를, 아니면 고른 뒤 확정 메뉴를 그 자리에 띄운다 */
  function handleNewPick(targetId: number, additive: boolean, anchor: HTMLElement, event: MouseEvent) {
    // New 문장의 짝을 고르는 중 - 누른 문장이 짝이 된다(다듬을 대상을 바꾸지 않는다). 원문의 Unit을 모르는 문장은 짝이 될 수 없다
    if (isNewEdit && pairSource && pairFrom) {
      const unitId = writtenMap.get(targetId)?.new_unit_id ?? null;
      if (unitId !== null) pickPairUnit(unitId, event.shiftKey);
      return;
    }
    // Old 줄을 고르지 않은 채 누르면 그 New 문장을 다듬을 대상으로 고른다(Old 줄을 고른 채면 전처럼 그 줄에 잇는다)
    if (mode === "old" && row === null && canEdit) {
      selectNewSentence(targetId);
      return;
    }
    if (mode === "old" && row && !additive && draft.destination === null && savedDestination?.kind === "link" && savedDestination.targetIds.includes(targetId)) {
      openMenu(anchor, event, row.key, targetId);
      return;
    }
    if (pickNewSentence(targetId, additive) && row) openMenu(anchor, event, row.key, additive ? null : targetId);
  }

  /** 놓인 New 문장을 누름(엮은 문서) - 그 줄 옆에 작은 메뉴를 연다. 고르기만 하고 저장은 결정 칸의 Confirm이 한다 */
  function handleJoinPick(targetId: number, anchor: HTMLElement, event: MouseEvent) {
    if (activeKey === null) return;
    setJoinMenu((prev) => ({ seq: (prev?.seq ?? 0) + 1, rowKey: activeKey, targetId, anchor, offset: readMenuOffset(anchor, event) }));
  }

  /** 엮은 문서의 박스 - 화면 문서(기다리는 편집을 얹은 것)에서 찾는다 */
  function findComposedItem(targetId: number): ComposedItem | undefined {
    for (const section of composedDoc?.sections ?? []) for (const item of section.items) if (item.target_id === targetId) return item;
    return undefined;
  }
  const composedCutItem = composedCutAt ? findComposedItem(composedCutAt.targetId) : undefined;
  const composedCut = composedCutAt && composedCutItem && row && composedCutItem.source_unit_ids.some((id) => row.unitIds.includes(id)) ? composedCutAt : null;

  /** 빈 템플릿 박스를 두 번 누름 - 그 박스의 Old 줄을 고르고 누른 자리 가까이에 나눌 선(Old 두 번 누르기와 같다). 첫 누름이 연 잇기 메뉴는 닫는다 */
  function handleComposedDoubleClick(targetId: number, at: number | null) {
    const item = findComposedItem(targetId);
    if (!item || !canEdit || mode !== "old" || isAnyPending || !canEditComposed(item)) return;
    const cut = findComposedCut(item.text, at ?? Math.floor(item.text.length / 2));
    if (cut === null) return;
    setJoinMenu(null);
    window.getSelection()?.removeAllRanges();
    const key = rowOfUnit.get(item.source_unit_ids[0]);
    if (key !== undefined && key !== activeKey) selectRow(key);
    setComposedCutAt({ targetId, at: cut });
  }

  function dragComposedCut(pos: number | "start" | "end") {
    if (!composedCut || !composedCutItem) return;
    const text = composedCutItem.text;
    const next = findComposedCut(text, pos === "start" ? 0 : pos === "end" ? text.length : pos);
    if (next !== null && next !== composedCut.at) setComposedCutAt({ targetId: composedCut.targetId, at: next });
  }

  /** 나눌 선에서 둘로 - 그 박스의 관계 묶음을 받아 앞 글 · 뒤 글 두 새 문장으로 확정한다(종류 나눔은 서버가) */
  function splitComposedAtCut() {
    if (!composedCut || !composedCutItem || !canEdit) return;
    const { targetId, at } = composedCut;
    const item = composedCutItem;
    void run(async () => {
      const body = buildComposedSplit(await getGroupByTarget(bundleId, targetId), targetId, item.text, at);
      await saveGroup(bundleId, body, buildUndo({ op: "split_new", focus_unit_id: item.source_unit_ids[0], focus_target_id: targetId }));
      markRecorded();
      setComposedCutAt(null);
    }, t("assign.composedOps.didSplit"));
  }

  /** 이웃한 두 박스의 틈 - 같은 언어면 합치기, 한/영이면 두 Old 줄을 짝으로(planComposedJoin) */
  function planComposedGap(upperId: number, lowerId: number): JoinPlan | null {
    const upper = findComposedItem(upperId);
    const lower = findComposedItem(lowerId);
    if (!upper || !lower || !canEdit || mode !== "old") return null;
    return planComposedJoin(upper, lower, (unitId) => paperModel?.units.get(unitId));
  }

  function joinComposed(upperId: number, lowerId: number, kind: JoinKind) {
    const upper = findComposedItem(upperId);
    const lower = findComposedItem(lowerId);
    if (!upper || !lower || !canEdit || isAnyPending) return;
    if (kind === "pair") {
      const ids = [upper.source_unit_ids[0], lower.source_unit_ids[0]];
      void runPairChange((docId, revision) => createPair(bundleId, docId, revision, ids), t("split.didJoin"), ids[0], "pair", ids);
      return;
    }
    void run(async () => {
      const group = mergeGroups(await Promise.all([getGroupByTarget(bundleId, upperId), getGroupByTarget(bundleId, lowerId)]));
      const body = buildComposedMerge(group, { id: upperId, text: upper.text }, { id: lowerId, text: lower.text });
      await saveGroup(bundleId, body, buildUndo({ op: "merge_new", focus_unit_id: upper.source_unit_ids[0], focus_target_id: upperId }));
      markRecorded();
    }, t("assign.composedOps.didMerge"));
  }

  /** 놓인 문장 뒤에 놓으면 - 끌어 놓기와 같은 규칙(그 문장이 든 의미 묶음 뒤, 고른 줄이 이미 그 칸에 있으면 자리를 못 바꾼다) */
  function readJoinAfter(targetId: number): SendDrop {
    const section = composedDoc ? buildDropSections(composedDoc.sections, (unitId) => rowOfUnit.get(unitId)).find((candidate) => candidate.items.some((item) => item.targetId === targetId)) : undefined;
    return section && row ? resolveGapDrop(section, targetId, false, row.unitIds) : { kind: "none" };
  }

  /** 작은 메뉴의 항목 - "이 문장에 잇기"는 그 문장이 보낼 곳이 되고, "이 줄 다음에 놓기"는 그 칸의 그 자리가 된다. 둘 다 Confirm으로 포커스를 옮겨 ↵가 확정한다 */
  function pickJoinMenu(item: JoinMenuItem) {
    const target = joinMenu?.targetId;
    setJoinMenu(null);
    if (target === undefined || !composedDoc) return;
    if (item === "join") pickDestination({ kind: "join", docId: composedDoc.target_doc_id, targetId: target });
    else {
      const drop = readJoinAfter(target);
      const destination = drop.kind === "gap" ? readSectionDestination(composedDoc.target_doc_id, drop.sectionKey) : null;
      if (drop.kind !== "gap" || destination === null) return;
      setDraft({ destination, position: { placeId: getDestinationId(destination), after: drop.after } });
    }
    requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-testid="assign-primary"]')?.focus({ preventScroll: true }));
  }

  /** 결정 칸의 Confirm으로 포커스 - 고른 자리에 남으면 ↵가 확정 대신 그 자리를 다시 누른다 */
  function focusPrimary() {
    requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-testid="assign-primary"]')?.focus({ preventScroll: true }));
  }

  /** New 칸의 자리를 누름(클릭 배치, MD 2 S3) - 고르기만 한다. 끌기와 같은 자리 목록의 답으로 보낼 곳과 자리(position)를 정하고, 확정은 Confirm(↵) */
  function pickPlaceSpot(spot: PlaceSpot, key: string) {
    if (!row || !composedDoc || !placeResolved) return;
    const placement = resolvePlaceSpot(placeResolved.sections, spot, row.unitIds);
    if (placement.kind !== "place") return;
    const destination = readSectionDestination(composedDoc.target_doc_id, placement.sectionKey);
    if (destination === null) return;
    const placeId = getDestinationId(destination);
    // 빈 칸은 자리 없이(position 키를 넣지 않는다), 칸 끝 · 틈은 그 자리 - 저장 꼴은 TargetPosition 약속 그대로
    if (placement.position === null) pickDestination(destination);
    else setDraft({ destination, position: { placeId, after: placement.position.after } });
    setSpotPick({ rowKey: row.key, key, placeId, after: placement.position ? placement.position.after : "none" });
    focusPrimary();
  }

  /** 고른 줄 자신의 AI 제안 줄을 누름 - 오른쪽 AI 추천 카드를 누른 것과 같다(MD 2 §9-7). 카드가 없으면 그 칸을 고른다 */
  function pickOwnAiLine(targetId: number) {
    if (!composedDoc) return;
    const docId = composedDoc.target_doc_id;
    const section = composedDoc.sections.find((candidate) => candidate.items.some((item) => item.target_id === targetId));
    if (!section) return;
    const rec = recommendations.find((item) => item.source === "ai" && "docId" in item.destination && item.destination.docId === docId && getSectionKey(item.destination) === section.location_key);
    if (rec) {
      pickRecommendation(rec);
      return;
    }
    const destination = readSectionDestination(docId, section.location_key);
    if (destination === null) return;
    pickDestination(destination);
    focusPrimary();
  }

  /** Old 조각 아래 "→ 간 곳"을 누름 - 그 줄을 고르고 New 문서(닫혀 있거나 다른 문서면 열어서)의 그 문장으로 간다 */
  function jumpToNew(unitId: number, targetId: number) {
    const key = rowOfUnit.get(unitId);
    const docId = findWrittenRow(targetId)?.target_doc_id;
    if (!key || docId === undefined) return;
    setMode("old");
    pickRowKey(key);
    setChecked(new Set());
    setMenu(null);
    setManualNewDoc({ key, docId });
    // New 칸의 그 문장으로 가는 길이라 한 단이면 양 단으로 편다
    if (view.single) changeView({ single: false });
    setJump({ side: "new", id: targetId, targetId, rowKey: key });
  }

  /** 문서 대시보드의 받는 New 문서를 누름 - 그 문서를 New 칸에 연다 */
  function openNewDoc(docId: number) {
    if (isPairView) closePairView();
    setManualNewDoc({ key: toggleKey, docId });
    if (view.single) changeView({ single: false });
  }

  /** Old 조각의 연결 배지를 누름 - 고름·메뉴는 그대로 두고 오른쪽 칸을 그 문장으로 보내 번쩍이게만 한다 */
  function showInNew(targetId: number) {
    if (isPairView) closePairView();
    const docId = findWrittenRow(targetId)?.target_doc_id;
    if (docId !== undefined) setManualNewDoc({ key: toggleKey, docId });
    if (view.single) changeView({ single: false });
    setJump({ side: "new", id: targetId, targetId, rowKey: "", quiet: true });
  }

  /**
   * New 문장의 "← 출처" 칩을 누름 - 그 출처 줄을 고르고(다른 Old 문서면 그 문서로) Old의 그 조각으로 간다.
   * keep.docId는 엮은 문서(템플릿 보기)에서 그대로 둘 New 문서, keep.quiet면 그 자리 메뉴를 띄우지 않는다
   */
  function jumpToOld(unitId: number, targetId: number, keep: { docId?: number; quiet?: boolean } = {}) {
    setPairViewDoc(null);
    const key = rowOfUnit.get(unitId);
    const docId = keep.docId ?? findWrittenRow(targetId)?.target_doc_id;
    if (!key) return;
    setMode("old");
    pickRowKey(key);
    setChecked(new Set());
    setMenu(null);
    // 지금 보던 New 문서를 그대로 둔다 - 줄이 바뀌어도 이 문장 옆에서 이어 보게
    if (docId !== undefined) setManualNewDoc({ key, docId });
    setJump({ side: "old", id: unitId, targetId, rowKey: key, quiet: keep.quiet });
  }

  /** 템플릿 보기의 줄을 누름 - 출처 칩과 같은 길로 그 줄의 Old 출처를 고른다(지금 New 문서와 보기는 그대로) */
  function pickTemplateLine(item: ComposedItem) {
    // 클릭 배치 중의 AI 제안 줄 - 고른 줄 자신의 것은 그 AI 추천을 고르고, 다른 줄의 것(확정 전)은 누를 수 없다
    if (canPlaceClick && item.status === "ai_suggested") {
      if (row && item.source_unit_ids.some((id) => row.unitIds.includes(id))) pickOwnAiLine(item.target_id);
      return;
    }
    const unitId = item.source_unit_ids[0];
    if (unitId !== undefined && newDocId !== null) jumpToOld(unitId, item.target_id, { docId: newDocId });
  }

  // 놓인 문장에 잇고 난 뒤 - 그 줄의 결정 칸이 다시 그려지면(묶음을 다시 받기까지 몇 프레임) 문장 줄의 연필(Rewrite)로 포커스
  const [editFocus, setEditFocus] = useState<{ key: string } | null>(null);
  useEffect(() => {
    if (editFocus === null) return;
    let tries = 0;
    let frame = requestAnimationFrame(function step() {
      const button = document.querySelector<HTMLButtonElement>('[data-testid="assign-edit"]');
      if (button && !button.disabled) {
        button.focus();
        setEditFocus(null);
        return;
      }
      tries += 1;
      if (tries < 180) frame = requestAnimationFrame(step);
      else setEditFocus(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [editFocus]);

  // "번역 없음" 자리를 누른 뒤 - 고른 줄의 결정 칸이 그려지면(관계 묶음이 오기까지 몇 프레임) 번역 만들기(없으면 직접 쓰기) 단추로 포커스
  const [fillOtherSeq, setFillOtherSeq] = useState(0);
  useEffect(() => {
    if (fillOtherSeq === 0) return;
    let tries = 0;
    let frame = requestAnimationFrame(function step() {
      const button = document.querySelector<HTMLButtonElement>('[data-testid="assign-make-other"], [data-testid="assign-write-other"]');
      if (button && !button.disabled) {
        button.focus();
        return;
      }
      tries += 1;
      if (tries < 60) frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [fillOtherSeq]);

  /** 템플릿 보기의 "번역 없음" 자리를 누름 - 비춘 줄의 Old 출처를 메뉴 없이 고르고, 빠진 언어는 지금 있는 번역 만들기 · 직접 쓰기로 채운다 */
  function fillTemplateMissing(source: ComposedItem) {
    const unitId = source.source_unit_ids[0];
    if (unitId === undefined || newDocId === null) return;
    jumpToOld(unitId, source.target_id, { docId: newDocId, quiet: true });
    setFillOtherSeq((seq) => seq + 1);
  }

  // 이동한 뒤 - 그 자리가 그려지면 보이게 하고 번쩍인 뒤 그 옆에 메뉴를 띄운다(다른 문서를 받는 중이면 몇 프레임 기다린다)
  useEffect(() => {
    if (!jump) return;
    let tries = 0;
    let frame = requestAnimationFrame(function step() {
      const el = jump.side === "new" ? findNewLine(document, jump.id) : findOldStrip(document, jump.id);
      if (!el) {
        tries += 1;
        if (tries < 60) frame = requestAnimationFrame(step);
        else setJump(null);
        return;
      }
      revealElement(el);
      flashElement(el);
      if (jump.confirm) settleDrop(el, jump.rowKey, jump.targetId, jump.at ?? null);
      else if (!jump.quiet) openMenu(el, null, jump.rowKey, jump.targetId, jump.at ?? null);
      setJump(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [jump]);

  // --- 끌어서 잇기(끌어다 놓기 설계 §6) - Old 조각을 이미 쓴 New 문장에 놓으면 클릭과 같은 상태가 된다(그 줄 고름 · 그 문장 고름 · 그 자리 메뉴, 저장은 하지 않는다) ---
  // 놓은 줄의 관계 묶음이 와야 클릭과 같은 판단을 한다 - 그때까지 들고 있다가 렌더 중에 푼다(그 사이 다른 줄을 고르면 버린다). 메뉴는 jump 이펙트가 그 문장을 찾아 띄운다.
  // at(놓은 자리, 그 줄 기준)을 메뉴에 넘겨 클릭으로 연 것처럼 이음 선 끝에 뜨게 한다(사용자 결정 v1.1.1 - 놓기는 그 문장 클릭과 같다)
  const [dropLink, setDropLink] = useState<{ rowKey: string; targetId: number; at: { x: number; y: number } } | null>(null);
  if (dropLink !== null && activeKey !== dropLink.rowKey) setDropLink(null);
  else if (dropLink !== null && !groupPending) {
    setDropLink(null);
    const { rowKey: dropKey, targetId, at } = dropLink;
    const action = resolveDropLink({ draftDestination: draft.destination, savedDestination, targetId });
    // 이미 이은 문장(끊기 메뉴)은 그대로 메뉴, 새로 고른 것은 바로 확정
    if (action === "menu_only") setJump({ side: "new", id: targetId, targetId, rowKey: dropKey, at });
    else if (pickNewSentence(targetId, false)) setJump({ side: "new", id: targetId, targetId, rowKey: dropKey, at, confirm: true });
  }
  // --- 끌어서 보내기(3걸음) - New · from Assign 문서의 두 문장 사이·빈 칸에 놓으면 그 줄의 초안이 된다(저장은 하지 않는다). 잇기와 같이 관계 묶음이 온 뒤 렌더 중에 푼다 ---
  // position은 문장 사이에 놓은 자리(없으면 빈 칸 - 클릭과 같은 pickDestination). menu면 이어서 점선 초안(빈 칸이면 그 자리 표시)에 그 자리 메뉴를 띄운다
  // anchor는 템플릿 보기에 놓았을 때 메뉴를 띄울 자리(그 보기에는 점선 초안이 없다)
  const [dropPlace, setDropPlace] = useState<{ rowKey: string; destination: Destination; position: DropPosition | null; menu: boolean; anchor?: string } | null>(null);
  // 나무 줄에 놓은 뒤 - 그 칸이 보낼 곳이 된 다음 렌더에서 바로 확정한다
  const [treeConfirm, setTreeConfirm] = useState<string | null>(null);
  const [draftMenu, setDraftMenu] = useState<{ rowKey: string; anchor?: string } | null>(null);
  if (dropPlace !== null && activeKey !== dropPlace.rowKey) setDropPlace(null);
  else if (dropPlace !== null && !groupPending) {
    setDropPlace(null);
    if (dropPlace.position === null) pickDestination(dropPlace.destination);
    else setDraft({ destination: dropPlace.destination, position: dropPlace.position });
    if (dropPlace.menu) setDraftMenu({ rowKey: dropPlace.rowKey, anchor: dropPlace.anchor });
    else setTreeConfirm(dropPlace.rowKey);
  }
  if (treeConfirm !== null && treeConfirm !== activeKey) setTreeConfirm(null);
  // 메뉴를 띄우기 전에 다른 줄을 고르면 버린다 - 그 줄의 초안 자리 표시를 대신 찾아 번쩍이지 않게
  if (draftMenu !== null && draftMenu.rowKey !== activeKey) setDraftMenu(null);
  // 놓은 뒤 - 점선 초안(없으면 초안이 든 빈 칸 자리 표시)이 그려지면 보이게 하고 번쩍인 뒤 그 옆에 메뉴(jump 이펙트와 같은 짜임)
  useEffect(() => {
    if (!draftMenu) return;
    let tries = 0;
    let frame = requestAnimationFrame(function step() {
      const el = draftMenu.anchor ? document.querySelector<HTMLElement>(draftMenu.anchor) : (document.querySelector<HTMLElement>('[data-testid="assign-new-draft"]') ?? document.querySelector<HTMLElement>(".new-slot-empty[data-draft]"));
      if (!el) {
        tries += 1;
        if (tries < 60) frame = requestAnimationFrame(step);
        else setDraftMenu(null);
        return;
      }
      revealElement(el);
      flashElement(el);
      settleDrop(el, draftMenu.rowKey, null, null);
      setDraftMenu(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [draftMenu]);
  /** 끌어 놓은 고름 - 막는 까닭(참조 번호 · 캡션)이 없으면 바로 확정하고, 있으면 그 자리 메뉴가 까닭을 보인다. 사유가 필요하면 확정이 사유 창을 연다 */
  const settleDrop = useEffectEvent((el: HTMLElement, rowKey: string, targetId: number | null, at: { x: number; y: number } | null) => {
    if (confirmBlockKey === null) void runSave("confirm");
    else openMenu(el, null, rowKey, targetId, at);
  });
  const confirmTreeDrop = useEffectEvent(() => {
    setTreeConfirm(null);
    if (confirmBlockKey === null) void runSave("confirm");
  });
  useEffect(() => {
    if (treeConfirm !== null) confirmTreeDrop();
  }, [treeConfirm]);
  // 끄는 동안 New 문장에 잇는 자리에서만 따라오는 점선(설계 2026-11-20 D7) - React 상태가 아니다
  const dragLineRef = useRef<DragLinkLine | null>(null);
  // 끄는 동안 엮은 문서의 칸 목록 - 끌기마다 한 번(그 사이 문서가 바뀌면 다시) 짓는다. React 상태가 아니다
  const dropSectionsRef = useRef<{ doc: ComposedDoc; sections: DropSection[] } | null>(null);
  function readDropSections(): DropSection[] {
    if (!isComposedDoc || !composedDoc) return [];
    if (dropSectionsRef.current?.doc !== composedDoc) dropSectionsRef.current = { doc: composedDoc, sections: buildDropSections(composedDoc.sections, (unitId) => rowOfUnit.get(unitId)) };
    return dropSectionsRef.current.sections;
  }
  /** 포인터 밑의 New 칸 줄 상자와 거기 놓으면 보낼 곳 - 엮은 문서는 문장 사이(의미 묶음 상자의 중간선으로 앞·뒤)·빈 칸, 이미 쓴 문서는 문장 상자 밖이면 거절 */
  function readSendAt(point: DragPoint, dragUnitIds: readonly number[]): { drop: SendDrop; item: HTMLElement | null } {
    const item = findUnderPoint(point, '[data-pane="new"] .new-item[data-row]:not([data-leave])');
    if (!item) return { drop: { kind: "none" }, item: null };
    if (!item.closest(".pg[data-read-only]")) return { drop: findUnderPoint(point, ".new-line, .new-block") ? { kind: "none" } : { kind: "refused", reason: "written_doc" }, item };
    const key = item.dataset.row ?? "";
    const sections = readDropSections();
    if (key.startsWith("slot:")) {
      const section = sections.find((candidate) => candidate.key === key.slice("slot:".length));
      return { drop: section ? resolveSlotDrop(section) : { kind: "none" }, item };
    }
    const hoverId = Number(key.slice("t:".length));
    const section = sections.find((candidate) => candidate.items.some((entry) => entry.targetId === hoverId));
    const block = section ? findDropBlock(section, hoverId) : null;
    if (!section || !block) return { drop: { kind: "none" }, item };
    const sheet = item.parentElement;
    const first = sheet?.querySelector(`.new-item[data-row="t:${block.firstId}"]:not([data-leave])`) ?? item;
    const last = sheet?.querySelector(`.new-item[data-row="t:${block.lastId}"]:not([data-leave])`) ?? item;
    const middle = (first.getBoundingClientRect().top + last.getBoundingClientRect().bottom) / 2;
    return { drop: resolveGapDrop(section, hoverId, point.y < middle, dragUnitIds), item };
  }
  /** 문장 사이의 놓을 자리 선 - 기준 줄 상자의 그 변, 왼쪽 끝·폭은 그 줄의 문장 상자. New 칸 화면 밖이면 없다(선을 감춘다) */
  function readDropGap(drop: SendDrop, item: HTMLElement | null): DropLineAt | null {
    const edgeItem = drop.kind === "gap" ? item?.parentElement?.querySelector(`.new-item[data-row="t:${drop.edge.targetId}"]:not([data-leave])`) : null;
    const box = edgeItem?.querySelector(".new-line, .new-block")?.getBoundingClientRect();
    const frame = edgeItem?.closest(".pane-body")?.getBoundingClientRect();
    if (drop.kind !== "gap" || !edgeItem || !box || !frame) return null;
    const rect = edgeItem.getBoundingClientRect();
    const y = drop.edge.side === "top" ? rect.top : rect.bottom;
    if (y < frame.top || y > frame.bottom) return null;
    return { left: box.left, top: y - DROP_LINE_HALF_PX, width: box.width };
  }
  /** 보내기의 상태 글과 테두리 - 문장 사이·빈 칸은 "→ 칸 머리 글", 거절은 이유(N/A는 그 자리 표시, 같은 칸은 올린 줄의 문장 상자에 테두리) */
  function readSendHover(drop: SendDrop, item: HTMLElement | null): DragHover {
    if (drop.kind === "gap" || drop.kind === "slot") {
      const section = composedDoc?.sections.find((candidate) => candidate.location_key === drop.sectionKey);
      const note = section ? `→ ${readSectionHead(section)}` : undefined;
      return drop.kind === "slot" ? { state: "ok", note, dest: note, target: item?.querySelector<HTMLElement>(".new-slot-empty") } : { state: "ok", note, dest: note };
    }
    if (drop.kind === "refused") {
      const target = drop.reason === "written_doc" ? null : (item?.querySelector<HTMLElement>(".new-slot-empty, .new-line, .new-block") ?? null);
      return { state: "refused", note: t(REFUSAL_KEYS[drop.reason]), target };
    }
    return { state: "none" };
  }
  /** 문장 사이·빈 칸에 놓음 - 잇기와 같은 줄 고르기 뒤 초안 적용은 관계 묶음이 온 뒤(dropPlace) */
  function applySendDrop(rowKey: string, drop: SendDrop) {
    if ((drop.kind !== "gap" && drop.kind !== "slot") || newDocId === null) return;
    const destination = readSectionDestination(newDocId, drop.sectionKey);
    if (destination === null) return;
    setChecked(new Set());
    setCtxMenu(null);
    selectRow(rowKey, false);
    setManualNewDoc({ key: rowKey, docId: newDocId });
    setDropPlace({ rowKey, destination, position: drop.kind === "gap" ? { placeId: getDestinationId(destination), after: drop.after } : null, menu: true });
  }
  // --- 템플릿 보기에 끌어 놓기(MD 1 F9) - 자리 목록 모델(place-spot-model)이 기본 보기와 같은 규칙으로 판단한다. 놓으면 기본 보기와 같이 바로 확정 ---
  const placeSectionsRef = useRef<{ doc: ComposedDoc; sections: PlaceSection[] } | null>(null);
  function readPlaceSections(): PlaceSection[] {
    if (!isComposedDoc || !composedDoc) return [];
    if (placeSectionsRef.current?.doc !== composedDoc) placeSectionsRef.current = { doc: composedDoc, sections: buildPlaceSections(composedDoc.sections, (unitId) => rowOfUnit.get(unitId)) };
    return placeSectionsRef.current.sections;
  }
  // 끄는 동안 결정 칸의 보낼 곳 목록 대신 놓는 법 글 - 끌기를 시작·끝낼 때만 바뀐다(포인터가 움직일 때는 그리지 않는다)
  const [isTemplateDrag, setTemplateDrag] = useState(false);
  /** 템플릿 줄의 의미 묶음 상자 - 같은 절반 안의 첫·끝 줄(짝의 반대 언어 줄은 다른 절반에 있어 없으면 올린 줄) */
  interface TemplateBox {
    first: Element;
    last: Element;
  }
  /** 템플릿 자리 요소가 가리키는 자리 - 줄은 의미 묶음 상자의 중간선으로 앞·뒤를 정한다 */
  function readTemplateSpot(el: HTMLElement, point: DragPoint, sections: readonly PlaceSection[]): { spot: PlaceSpot | null; box: TemplateBox | null } {
    const kind = el.dataset.tplSpot;
    if (kind === "fixed") {
      const what = readFixedSpot(el.dataset.tplFixed);
      return { spot: what ? { kind: "fixed", what } : null, box: null };
    }
    if (kind === "section") return { spot: el.dataset.section ? { kind: "section", sectionKey: el.dataset.section } : null, box: null };
    if (kind !== "line") return { spot: null, box: null };
    const targetId = Number((el.dataset.row ?? "").slice("t:".length));
    const block = findPlaceBlock(sections, targetId);
    const half = el.closest(".tpl-half");
    const first = (block && half?.querySelector(`[data-tpl-spot="line"][data-row="t:${block.firstId}"]`)) || el;
    const last = (block && half?.querySelector(`[data-tpl-spot="line"][data-row="t:${block.lastId}"]`)) || el;
    const middle = (first.getBoundingClientRect().top + last.getBoundingClientRect().bottom) / 2;
    return { spot: { kind: "line", targetId, isUpperHalf: point.y < middle }, box: { first, last } };
  }
  /** 포인터 밑의 템플릿 자리와 거기 놓으면 - 템플릿 보기가 아니면 none */
  function readTemplateAt(point: DragPoint, dragUnitIds: readonly number[]): { placement: Placement; el: HTMLElement | null; box: TemplateBox | null } {
    const el = findUnderPoint(point, '[data-pane="new"] .tpl-paper [data-tpl-spot]');
    if (!el) return { placement: { kind: "none" }, el: null, box: null };
    const sections = readPlaceSections();
    const { spot, box } = readTemplateSpot(el, point, sections);
    return { placement: spot ? resolvePlaceSpot(sections, spot, dragUnitIds) : { kind: "none" }, el, box };
  }
  /** 템플릿 줄 사이 선 - 올린 절반의 묶음 상자 그 변(위면 첫 줄 위, 아래면 끝 줄 아래). 칸 화면 밖이면 없다(선을 감춘다) */
  function readTemplateGap(placement: Placement, box: TemplateBox | null): DropLineAt | null {
    const edge = placement.kind === "place" ? placement.edge : null;
    const edgeEl = edge && box ? (edge.side === "top" ? box.first : box.last) : null;
    const frame = edgeEl?.closest(".pane-body")?.getBoundingClientRect();
    if (!edge || !edgeEl || !frame) return null;
    const rect = edgeEl.getBoundingClientRect();
    const y = edge.side === "top" ? rect.top : rect.bottom;
    if (y < frame.top || y > frame.bottom) return null;
    return { left: rect.left, top: y - DROP_LINE_HALF_PX, width: rect.width };
  }
  /** 템플릿 자리의 상태 글과 테두리 - 칸 자리는 그 자리에, 줄 사이는 선만(테두리 없음) */
  function readTemplateHover(placement: Placement, el: HTMLElement | null): DragHover {
    if (placement.kind === "place") return { state: "ok", note: formatPlacement(placement, t), dest: formatPlacementDest(placement), target: placement.edge ? null : el };
    if (placement.kind === "refused") return { state: "refused", note: t(PLACE_REFUSAL_KEYS[placement.reason]), target: el };
    return { state: "none" };
  }
  /** 템플릿 자리에 놓음 - 기본 보기 보내기와 같은 길(줄 고르기 → 관계 묶음이 온 뒤 초안 → 바로 확정). 막는 까닭이 있으면 메뉴를 그 자리 옆에 띄운다 */
  function applyTemplateDrop(rowKey: string, placement: Placement, el: HTMLElement | null) {
    if (placement.kind !== "place" || newDocId === null) return;
    const destination = readSectionDestination(newDocId, placement.sectionKey);
    if (destination === null) return;
    const scope = '[data-testid="assign-new-tpl"]';
    const anchor = placement.edge ? `${scope} [data-tpl-spot="line"][data-row="t:${placement.edge.targetId}"]` : `${scope} [data-tpl-spot="section"][data-section="${CSS.escape(el?.dataset.section ?? placement.sectionKey)}"]`;
    setChecked(new Set());
    setCtxMenu(null);
    selectRow(rowKey, false);
    setManualNewDoc({ key: rowKey, docId: newDocId });
    setDropPlace({ rowKey, destination, position: placement.position ? { placeId: getDestinationId(destination), after: placement.position.after } : null, menu: true, anchor });
  }
  /** 끌기를 시작하면 놓을 수 있는 칸 자리를 칠한다 - DOM에 바로 달아 끄는 동안 종이를 다시 그리지 않는다 */
  function lightTemplateSpots(root: HTMLElement, dragUnitIds: readonly number[]): boolean {
    const paper = root.querySelector<HTMLElement>('[data-pane="new"] .tpl-paper');
    if (!paper) return false;
    const sections = readPlaceSections();
    for (const el of paper.querySelectorAll<HTMLElement>('[data-tpl-spot="section"]')) {
      const key = el.dataset.section;
      if (key && isSpotOpen(sections, { kind: "section", sectionKey: key }, dragUnitIds)) el.dataset.tplOpen = "";
    }
    return true;
  }
  /** 포인터 밑의 옆 패널 All 나무 줄과 거기 놓으면 할 일 - 칸·step 줄만 받고 N/A는 거절(클릭이 받는 그대로). 칸 제목 줄은 모델이 none으로 본다 */
  function readTreeAt(point: DragPoint): { drop: TreeDrop; row: HTMLElement | null; option: DestinationOption | undefined } {
    const row = findUnderPoint(point, ".dest-tree .tree-row[data-place]");
    const option = row ? options.find((candidate) => candidate.id === row.dataset.place) : undefined;
    return { drop: resolveTreeDrop(option), row, option };
  }
  /** 나무 줄에 놓음 - 그 줄을 누른 것과 같다(관계 묶음이 온 뒤 클릭과 같은 pickDestination, 자리·그 자리 메뉴 없음). New 칸의 문서는 바꾸지 않는다 */
  function applyTreeDrop(rowKey: string, destination: Destination) {
    setChecked(new Set());
    setCtxMenu(null);
    selectRow(rowKey, false);
    setDropPlace({ rowKey, destination, position: null, menu: false });
  }
  const isOldDrag = canDragOld({ canEdit, mode, isPairPicking: pairSource !== null && pairFrom !== null, isSolo });
  /** 포인터 밑의 New 줄과 거기 놓으면 할 일 - 이번 걸음에는 이미 쓴 문서의 고를 수 있는 문장만 받는다 */
  function readDropAt(point: DragPoint): { line: HTMLElement | null; drop: AssignDrop } {
    // 이미 쓴 문서 표의 칸 상자(data-drop="cell")도 문장처럼 받는다(시안 2 D5)
    const cell = findUnderPoint(point, '[data-pane="new"] [data-drop="cell"][data-cell-target]');
    if (cell) return { line: cell, drop: findAssignDrop({ targetId: Number(cell.dataset.cellTarget), isReadOnly: false, hasPickButton: false, isCell: true }) };
    const line = findUnderPoint(point, '[data-pane="new"] .new-line[data-target]');
    const hit = line ? { targetId: Number(line.dataset.target), isReadOnly: line.closest(".pg[data-read-only]") !== null, hasPickButton: line.querySelector("button.new-hit") !== null } : null;
    return { line, drop: findAssignDrop(hit) };
  }
  /** 포인터 밑의 Old 캡션 자리(표 머리 줄 · 그림 아래)와 끈 줄을 거기 놓으면 할 일(F7 - 2칸 안 글 한 줄이면 캡션으로 붙인다) */
  function readCaptionDropAt(point: DragPoint, unitIds: readonly number[]): { drop: CaptionDrop; el: HTMLElement } | null {
    const el = findUnderPoint(point, '[data-pane="old"] [data-caption-slot]');
    const bundle = el ? shapeModel?.units.get(Number(el.dataset.captionSlot)) : undefined;
    if (!el || !bundle || !shapeModel || !slotPlaces) return null;
    return { drop: resolveCaptionDrop(unitIds.flatMap((id) => shapeModel.units.get(id) ?? []), bundle, shapeModel.units, slotPlaces), el };
  }
  /** 캡션 칩을 끈 곳 - 제 캡션 자리 밖 Old 용지 위면 떼서 문장으로(F7) */
  function readCaptionDetachAt(point: DragPoint, captionId: number): { detach: CaptionDetach; bundleId: number | null } {
    const caption = shapeModel?.units.get(captionId);
    if (!caption || caption.group_unit_id === null) return { detach: { kind: "none" }, bundleId: null };
    const slot = findUnderPoint(point, '[data-pane="old"] [data-caption-slot]');
    const detach = resolveCaptionDetach({
      captionBundleId: caption.group_unit_id,
      slotBundleId: slot ? Number(slot.dataset.captionSlot) : null,
      // Old 칸 어디든(용지 여백 포함) - 칩을 놓은 곳이 글 위가 아니어도 뗀다
      isOverOld: findUnderPoint(point, '[data-pane="old"]') !== null,
      isFixed: isFixedCaption(caption),
    });
    return { detach, bundleId: caption.group_unit_id };
  }
  const dragConfig: BoxDragConfig<{ rowKey: string; unitIds: number[]; captionId: number | null }> = {
    pick: (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const box = target?.closest<HTMLElement>('[data-pane="old"] [data-drag-box]');
      if (!target || !box) return null;
      // 캡션 칩은 칩째 끈다 - 제 자리 밖에 놓으면 떼어져 문장으로 돌아간다(F7). 칩의 줄은 그 묶음의 줄이다
      const chipId = Number(target.closest<HTMLElement>("[data-caption-chip]")?.dataset.captionChip);
      const chipBundle = Number.isFinite(chipId) ? shapeModel?.units.get(chipId)?.group_unit_id : null;
      const chipKey = chipBundle != null ? rowOfUnit.get(chipBundle) : undefined;
      // 처리 중인 박스는 끌리지 않는다(설계 D4) - 용지도 그 박스에 끌기 표시를 달지 않는다
      if (chipKey !== undefined) return isBoxLocked(chipId) ? null : { rowKey: chipKey, unitIds: [chipId], captionId: chipId };
      // 누른 곳의 가장 안쪽 Unit(글 조각·표 칸 조각·캡션), 없으면 그 조각의 Unit. 묶음에 든 칸·캡션은 누를 때처럼 그 묶음으로 올린다(resolvePickUnit) - 끄는 것과 누르면 골라지는 것이 같다
      const holder = target.closest<HTMLElement>("[data-unit], [data-strip-unit]");
      const pressedId = Number(holder?.dataset.unit ?? holder?.dataset.stripUnit ?? box.dataset.stripUnit);
      const unitId = paperModel ? resolvePickUnit(pressedId, paperModel.units) : pressedId;
      const key = rowOfUnit.get(unitId) ?? rowOfUnit.get(Number(box.dataset.stripUnit));
      const unitIds = key === undefined ? undefined : rowMap.get(key)?.unitIds;
      return key !== undefined && unitIds && !unitIds.some(focusCtl.isUnitLocked) ? { rowKey: key, unitIds, captionId: null } : null;
    },
    getCard: ({ unitIds }) => buildOldDragCard(unitIds.flatMap((id) => unitMap.get(id) ?? []), (count) => t("assign.drag.units", { count })),
    // 옆 패널(두 문서 틀 밖)의 스크롤 칸도 넣는다 - 긴 나무가 끄는 동안 가장자리에서 스스로 스크롤하게
    getScrollers: () => [...(panesBoxRef.current?.querySelectorAll<HTMLElement>(".pane-body") ?? []), ...document.querySelectorAll<HTMLElement>(".assign-side :is(.assign-side-body, .assign-pick)")],
    onStart: ({ unitIds }) => {
      const root = panesBoxRef.current;
      if (!root) return;
      for (const id of unitIds) findOldStrip(root, id)?.setAttribute("data-drag-src", "");
      // 끌기 직전에 올려 둔 조각의 이음 강조는 끄는 동안 남기지 않는다(G10) - LinkLines는 끄는 동안 올림을 읽지 않는다
      for (const el of root.querySelectorAll<HTMLElement>("[data-link-hover], [data-link-hot]")) {
        delete el.dataset.linkHover;
        delete el.dataset.linkHot;
      }
      dragLineRef.current = createDragLinkLine(root);
      dropSectionsRef.current = null;
      placeSectionsRef.current = null;
      if (lightTemplateSpots(root, unitIds)) setTemplateDrag(true);
    },
    onMove: ({ unitIds, captionId }, point) => {
      // 출발 → 포인터 점선은 New 문장에 잇는 자리에서만 - 놓은 뒤 남는 이음 선과 같은 뜻이라서(설계 2026-11-20 D7). 그 밖의 자리에서는 감춘다
      const unlinked = (hover: DragHover): DragHover => {
        dragLineRef.current?.update(null, point);
        return hover;
      };
      // 캡션 칩 - 제 자리 밖 Old 용지 위면 "떼서 문장으로", 그 밖은 놓을 자리가 아니다
      if (captionId !== null) {
        const { detach } = readCaptionDetachAt(point, captionId);
        if (detach.kind === "detach") return unlinked({ state: "ok", note: t("assign.captionSlot.drag.detach"), dest: t("assign.drag.dest.sentence") });
        return unlinked(detach.kind === "refused" ? { state: "refused", note: t(detach.reasonKey) } : { state: "none" });
      }
      // Old 캡션 자리 위면 캡션으로 붙이기(그 자리에 테두리) - 그 묶음 자신을 끌어 왔으면 다른 놓을 곳을 본다
      const slot = readCaptionDropAt(point, unitIds);
      if (slot !== null && slot.drop.kind !== "none") {
        return unlinked(slot.drop.kind === "attach" ? { state: "ok", note: t("assign.captionSlot.drag.attach"), dest: t("assign.drag.dest.caption"), target: slot.el } : { state: "refused", note: t(slot.drop.reasonKey), target: slot.el });
      }
      // 옆 패널 나무를 먼저 본다 - 칸·step 줄이면 "→ 문서 번호 · 칸 이름", N/A면 이유. 줄 상자에 테두리
      const tree = readTreeAt(point);
      if (tree.drop.kind !== "none") {
        if (tree.drop.kind === "refused") return unlinked({ state: "refused", note: t(REFUSAL_KEYS[tree.drop.reason]), target: tree.row });
        const note = tree.option ? `→ ${tree.option.docCode} · ${tree.option.label}` : undefined;
        return unlinked({ state: "ok", note, dest: note, target: tree.row });
      }
      const { line, drop } = readDropAt(point);
      if (drop.kind === "link" && line !== null) {
        // 점선의 시작 - 이음 선과 같은 자리, 출발 조각이 Old 칸 화면 밖이면 감춘다
        const root = panesBoxRef.current;
        const strip = root ? findOldStrip(root, unitIds[0]) : null;
        const frame = root?.querySelector<HTMLElement>('[data-pane="old"] .pane-body')?.getBoundingClientRect();
        const start = strip ? readOldLineStart(strip) : null;
        const isStartShown = start !== null && frame !== undefined && start.y >= frame.top && start.y <= frame.bottom;
        dragLineRef.current?.update(isStartShown ? start : null, readNewLineEnd(line, unitIds[0]));
        return { state: "ok", note: t("assign.drag.link"), dest: t("assign.drag.dest.link"), target: line };
      }
      // 한/영 두 언어 문서의 Old 조각 위면 짝 맺기(5걸음, 따로 쓴 문서는 D8)
      const pair = readPairAt(point, unitIds);
      if (pair.drop.kind !== "none") return unlinked(readPairHover(pair.drop, pair.target, pair.el));
      // 템플릿 보기의 자리 - 줄 사이면 놓을 자리 선
      const tpl = readTemplateAt(point, unitIds);
      if (tpl.placement.kind !== "none") return unlinked({ ...readTemplateHover(tpl.placement, tpl.el), line: readTemplateGap(tpl.placement, tpl.box) });
      // 이음도 짝도 아니면 보내기 - 문장 사이면 놓을 자리 선
      const send = readSendAt(point, unitIds);
      return unlinked({ ...readSendHover(send.drop, send.item), line: readDropGap(send.drop, send.item) });
    },
    onDrop: ({ rowKey, unitIds, captionId }, point) => {
      if (captionId !== null) {
        const { detach, bundleId } = readCaptionDetachAt(point, captionId);
        if (detach.kind === "detach") void runUnitEdit({ type: "detach_caption", unit_id: captionId }, t("assign.ctx.didDetachCaption"), bundleId);
        return;
      }
      const slot = readCaptionDropAt(point, unitIds);
      if (slot !== null && slot.drop.kind !== "none") {
        if (slot.drop.kind === "attach") void runUnitEdit({ type: "attach_caption", unit_id: slot.drop.unitId, bundle_unit_id: slot.drop.bundleId }, t("assign.ctx.didAttachCaption"), slot.drop.bundleId);
        return;
      }
      const tree = readTreeAt(point).drop;
      if (tree.kind === "place") applyTreeDrop(rowKey, tree.destination);
      if (tree.kind !== "none") return;
      const { line, drop } = readDropAt(point);
      if (drop.kind !== "link" || line === null) {
        // 짝 맺기는 줄을 고르지 않는다 - 저장 뒤 따라가기가 새 짝 줄을 고른다. 거절이면 아무 일도 없다
        const pair = readPairAt(point, unitIds).drop;
        if (pair.kind === "pair" || pair.kind === "confirm") void runPairDrop(pair);
        if (pair.kind !== "none") return;
        const tpl = readTemplateAt(point, unitIds);
        if (tpl.placement.kind !== "none") {
          applyTemplateDrop(rowKey, tpl.placement, tpl.el);
          return;
        }
        applySendDrop(rowKey, readSendAt(point, unitIds).drop);
        return;
      }
      const lineRect = line.getBoundingClientRect();
      setChecked(new Set());
      setCtxMenu(null);
      selectRow(rowKey, false);
      // 다른 줄을 골라도 New 칸은 놓은 문서에 둔다 - "→ 간 곳"과 같이(그 줄의 추천 문서로 넘어갔다 돌아오지 않게)
      const docId = findWrittenRow(drop.targetId)?.target_doc_id;
      if (docId !== undefined) setManualNewDoc({ key: rowKey, docId });
      setDropLink({ rowKey, targetId: drop.targetId, at: { x: point.x - lineRect.left, y: point.y - lineRect.top } });
    },
    onEnd: () => {
      for (const el of panesBoxRef.current?.querySelectorAll("[data-drag-src]") ?? []) el.removeAttribute("data-drag-src");
      dragLineRef.current?.remove();
      dragLineRef.current = null;
      for (const el of panesBoxRef.current?.querySelectorAll<HTMLElement>("[data-tpl-open]") ?? []) delete el.dataset.tplOpen;
      setTemplateDrag(false);
    },
  };
  // 두 문서 틀은 불러온 뒤에야 그려진다 - 그려지면 다시 붙도록 조건에 넣는다. Pair view에서는 짝 끌기만 붙는다(KO 칸도 data-pane="old"라 둘이 한 누름을 다투지 않게)
  useBoxDrag(panesBoxRef, isOldDrag && ready && rows.length > 0 && !isPairView ? dragConfig : null);

  // --- Pair view 끌기(끌어다 놓기 4걸음) - 조각을 맞은편 언어의 조각에 놓아 짝 맺기·제안 확정. 바로 저장하고 알림의 Undo가 푼다 ---
  const pairOfUnit = useMemo(() => new Map((oldView?.pairs ?? []).flatMap((pair) => pair.unit_ids.map((unitId) => [unitId, pair] as const))), [oldView]);
  /** 짝 놓기가 보는 지금 상태 - 렌더마다 한 번 짓는다(포인터가 움직일 때마다 짓지 않는다) */
  const pairDropCtx: PairDropContext = { pairOf: (unitId) => pairOfUnit.get(unitId), isDecided: isUnitDecided, hasDraft: hasUnitDraft };
  /** Pair view - 포인터 밑의 조각과 거기 놓으면 할 일 */
  function readPairViewAt(source: ViewUnit, point: DragPoint): { drop: PairDrop; target: ViewUnit | undefined; el: HTMLElement | null } {
    const el = findUnderPoint(point, "[data-pair-col] .pair-piece[data-unit]");
    const target = el ? paperModel?.units.get(Number(el.dataset.unit)) : undefined;
    return { drop: resolvePairDrop([source], target, pairDropCtx), target, el };
  }
  /**
   * 가까운 줄(5걸음) - 평소 Old 칸에서 포인터 밑의 가장 안쪽 조각과 거기 놓으면 할 일. 끄는 것은 줄 전부(짝 카드는 한 장)다.
   * 한/영 두 언어 문서(연달아·따로, 설계 2026-11-20 D8)에서만 - 한 언어 문서에서 Old 조각 위는 지금처럼 놓을 자리 밖이다("같은 언어" 거절이 번쩍이지 않게)
   */
  function readPairAt(point: DragPoint, unitIds: readonly number[]): { drop: PairDrop; el: HTMLElement | null; target: ViewUnit | undefined } {
    const nowhere = { drop: { kind: "none" } as const, el: null, target: undefined };
    const layout = oldView?.document.language_layout;
    if ((layout !== "ko_en_interleaved" && layout !== "ko_en_separate") || !paperModel) return nowhere;
    const sources = unitIds.flatMap((id) => paperModel.units.get(id) ?? []);
    // 줄의 Unit이 그 문서에 다 없으면 한 Unit만으로 맺게 되니 놓을 자리 밖
    if (sources.length !== unitIds.length) return nowhere;
    const el = findUnderPoint(point, '[data-pane="old"] :is(.cell-piece, .strip)[data-strip-unit]');
    const target = el ? paperModel.units.get(Number(el.dataset.stripUnit)) : undefined;
    return { drop: resolvePairDrop(sources, target, pairDropCtx), el, target };
  }
  /** 짝 놓기의 상태 글과 테두리 - pair는 "Pair with <번호>", confirm은 "Confirm this suggested pair", refused는 이유, none은 놓을 자리 밖 */
  function readPairHover(drop: PairDrop, target: ViewUnit | undefined, el: HTMLElement | null): DragHover {
    if (drop.kind === "pair") return { state: "ok", note: t("assign.pairDrag.pair", { id: target?.display_id ?? "" }), dest: t("assign.drag.dest.pair"), target: el };
    if (drop.kind === "confirm") return { state: "ok", note: t("assign.pairDrag.confirm"), dest: t("assign.drag.dest.pair"), target: el };
    if (drop.kind === "refused") return { state: "refused", note: t(PAIR_REFUSAL_KEYS[drop.reason]), target: el };
    return { state: "none" };
  }
  const findPairPiece = (root: ParentNode, unitId: number) => root.querySelector<HTMLElement>(`[data-pair-col] .pair-piece[data-unit="${unitId}"]`);
  const pairDragConfig: BoxDragConfig<{ unit: ViewUnit }> = {
    pick: (event) => {
      const el = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-pair-col] .pair-piece[data-drag-box]") : null;
      const unit = el ? paperModel?.units.get(Number(el.dataset.unit)) : undefined;
      return unit && !focusCtl.isUnitLocked(unit.id) ? { unit } : null;
    },
    getCard: ({ unit }) => buildOldDragCard([unit], (count) => t("assign.drag.units", { count })),
    getScrollers: () => [...(panesBoxRef.current?.querySelectorAll<HTMLElement>(".pane-body") ?? [])],
    onStart: ({ unit }) => {
      const root = panesBoxRef.current;
      if (root) findPairPiece(root, unit.id)?.setAttribute("data-drag-src", "");
    },
    // 점선은 따라오지 않는다 - New 문장에 잇는 끌기에서만 그린다(설계 2026-11-20 D7). 놓을 조각의 테두리가 자리를 말한다
    onMove: ({ unit }, point) => {
      const { drop, target, el } = readPairViewAt(unit, point);
      return readPairHover(drop, target, el);
    },
    onDrop: ({ unit }, point) => {
      const { drop } = readPairViewAt(unit, point);
      if (drop.kind === "pair" || drop.kind === "confirm") void runPairDrop(drop);
    },
    onEnd: () => {
      for (const el of panesBoxRef.current?.querySelectorAll("[data-drag-src]") ?? []) el.removeAttribute("data-drag-src");
    },
  };
  useBoxDrag(panesBoxRef, isPairView && isOldDrag && ready ? pairDragConfig : null);

  // --- 짝 카드 안 순서(설계 D8) - 고른 박스 왼쪽 손잡이를 끌어 카드 안 자리를 바꾼다. 박스 전체 끌기(잇기 · 보내기 · 짝)는 손잡이 밖의 누름만 받는다 ---
  /** 손잡이를 그릴 박스 - 배정이 걸린 짝은 순서를 바꾸지 않는다(서버도 409 unit_has_decision) */
  const pairGrip = canEdit && mode === "old" && !isNewEdit && !isSolo && !isPairView
    ? { isAllowed: (unitId: number) => { const unit = paperModel?.units.get(unitId); return unit !== undefined && !isUnitDecided(unit); } }
    : undefined;
  /** 손잡이를 끈 자리 - 끄는 박스를 뺀 카드 상자들의 가운데 y로 자리를 세고, 그 자리에 놓은 새 순서와 놓일 선. 카드 위아래 밖이면 놓을 자리 밖 */
  function readGripDrop(source: { unitId: number; order: number[] }, point: DragPoint): { order: number[]; line: DropLineAt } | null {
    const root = panesBoxRef.current;
    if (!root) return null;
    const boxes = source.order.map((id) => ({ id, rect: findOldStrip(root, id)?.getBoundingClientRect() }));
    if (boxes.some((box) => box.rect === undefined) || findUnderPoint(point, '[data-pane="old"]') === null) return null;
    const rects = boxes.map((box) => box.rect as DOMRect);
    const reach = 24; // 카드 위아래로 이만큼까지 - 맨 위 · 맨 아래 자리를 카드 가장자리 바로 바깥에서도 잡는다
    if (point.y < rects[0].top - reach || point.y > rects[rects.length - 1].bottom + reach) return null;
    const others = boxes.filter((box) => box.id !== source.unitId).map((box) => box.rect as DOMRect);
    const slot = readPairSlot(others.map((rect) => (rect.top + rect.bottom) / 2), point.y);
    const y = slot === 0 ? others[0].top : others[slot - 1].bottom;
    return { order: movePairMember(source.order, source.unitId, slot), line: { left: rects[0].left, top: y - DROP_LINE_HALF_PX, width: rects[0].width } };
  }
  const gripConfig: BoxDragConfig<{ unitId: number; pairId: number; order: number[] }> = {
    handleOnly: true,
    pick: (event) => {
      const grip = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-pane="old"] [data-grip-unit]') : null;
      const unit = grip ? paperModel?.units.get(Number(grip.dataset.gripUnit)) : undefined;
      if (!unit || unit.pair_id === null || !oldView || focusCtl.isUnitLocked(unit.id)) return null;
      const pairId = unit.pair_id;
      const order = orderPairCard(oldView.units.filter((member) => member.pair_id === pairId)).map((member) => member.id);
      return order.some(focusCtl.isUnitLocked) ? null : { unitId: unit.id, pairId, order };
    },
    getCard: ({ unitId }) => buildOldDragCard([unitId].flatMap((id) => unitMap.get(id) ?? []), (count) => t("assign.drag.units", { count })),
    getScrollers: () => [...(panesBoxRef.current?.querySelectorAll<HTMLElement>(".pane-body") ?? [])],
    onStart: ({ unitId }) => {
      const root = panesBoxRef.current;
      if (root) findOldStrip(root, unitId)?.setAttribute("data-drag-src", "");
    },
    onMove: (source, point) => {
      const drop = readGripDrop(source, point);
      if (drop === null || isSameOrder(drop.order, source.order)) return { state: "none" };
      return { state: "ok", note: t("assign.pairOrder.drag"), dest: t("assign.drag.dest.order"), line: drop.line };
    },
    onDrop: (source, point) => {
      const drop = readGripDrop(source, point);
      if (drop === null || isSameOrder(drop.order, source.order)) return;
      void runUnitEdit({ type: "reorder_pair", pair_id: source.pairId, unit_ids: drop.order }, t("assign.pairOrder.done"), source.unitId, false, null, { at: "box", unitId: source.unitId });
    },
    onEnd: () => {
      for (const el of panesBoxRef.current?.querySelectorAll("[data-drag-src]") ?? []) el.removeAttribute("data-drag-src");
    },
  };
  useBoxDrag(panesBoxRef, isOldDrag && ready && rows.length > 0 && !isPairView ? gripConfig : null);

  // --- 벗긴 표 덩이 안 줄 순서(시안 2 D2) - 덩이 안에서는 용지가 짝 카드 손잡이 대신 이 손잡이를 그린다. 같은 엔진 · 같은 모양, 판단은 막지 않는다 ---
  /** 손잡이를 누른 줄의 덩이 - 지금 덩이 줄 차례(J/K와 같은 model.order)와 함께 움직일 줄(이어 붙은 짝 카드면 구성원 전부) */
  function readUnwrapSource(unitId: number): { unitId: number; tableId: number; order: number[]; moving: number[] } | null {
    const model = paperModel;
    const tableId = model?.unwrapLines.get(unitId);
    if (!model || tableId === undefined) return null;
    const order = model.order.filter((id) => model.unwrapLines.get(id) === tableId);
    const pairId = model.units.get(unitId)?.pair_id ?? null;
    const card = pairId === null ? [] : order.filter((id) => model.units.get(id)?.pair_id === pairId);
    const isCard = card.length > 1 && order.indexOf(card[card.length - 1]) - order.indexOf(card[0]) === card.length - 1;
    return { unitId, tableId, order, moving: isCard ? card : [unitId] };
  }
  /** 손잡이를 끈 자리 - 끄는 줄을 뺀 덩이 줄의 가운데 y로 자리를 세고(lib/unwrap-order-model), 새 차례와 놓일 선. 덩이 위아래 밖이면 놓을 자리 밖 */
  function readUnwrapDrop(source: { order: number[]; moving: number[] }, point: DragPoint): { order: number[]; line: DropLineAt } | null {
    const root = panesBoxRef.current;
    if (!root || findUnderPoint(point, '[data-pane="old"]') === null) return null;
    const rectOf = (id: number) => findOldStrip(root, id)?.getBoundingClientRect() ?? null;
    const reach = 24; // 덩이 위아래로 이만큼까지 - 맨 위 · 맨 아래 자리를 덩이 가장자리 바로 바깥에서도 잡는다(화면 밖 끝 줄은 재지 않는다)
    const first = rectOf(source.order[0]);
    const last = rectOf(source.order[source.order.length - 1]);
    if ((first && point.y < first.top - reach) || (last && point.y > last.bottom + reach)) return null;
    const rects = source.order.filter((id) => !source.moving.includes(id)).map(rectOf);
    const slot = readUnwrapSlot(rects.map((rect) => (rect ? (rect.top + rect.bottom) / 2 : null)), point.y);
    const above = slot > 0 ? rects[slot - 1] : null;
    const at = above ?? rects[slot] ?? null;
    if (!at) return null;
    const y = above ? above.bottom : at.top;
    return { order: moveUnwrapLines(source.order, source.moving, slot), line: { left: at.left, top: y - DROP_LINE_HALF_PX, width: at.width } };
  }
  const unwrapGripConfig: BoxDragConfig<{ unitId: number; tableId: number; order: number[]; moving: number[] }> = {
    handleOnly: true,
    pick: (event) => {
      const grip = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-pane="old"] [data-unwrap-grip-unit]') : null;
      const source = grip && canEdit && !isNewEdit ? readUnwrapSource(Number(grip.dataset.unwrapGripUnit)) : null;
      return source === null || source.order.some(focusCtl.isUnitLocked) ? null : source;
    },
    getCard: ({ moving }) => buildOldDragCard(moving.flatMap((id) => unitMap.get(id) ?? []), (count) => t("assign.drag.units", { count })),
    getScrollers: () => [...(panesBoxRef.current?.querySelectorAll<HTMLElement>(".pane-body") ?? [])],
    onStart: ({ moving }) => {
      const root = panesBoxRef.current;
      for (const id of moving) if (root) findOldStrip(root, id)?.setAttribute("data-drag-src", "");
    },
    onMove: (source, point) => {
      const drop = readUnwrapDrop(source, point);
      if (drop === null || isSameOrder(drop.order, source.order)) return { state: "none" };
      return { state: "ok", note: t("assign.unwrapOrder.drag"), dest: t("assign.drag.dest.order"), line: drop.line };
    },
    onDrop: (source, point) => {
      const drop = readUnwrapDrop(source, point);
      if (drop === null || isSameOrder(drop.order, source.order)) return;
      void runUnitEdit({ type: "reorder_unwrapped", table_id: source.tableId, unit_ids: drop.order }, t("assign.unwrapOrder.done"), source.unitId, false, null, { at: "table", tableId: source.tableId });
    },
    onEnd: () => {
      for (const el of panesBoxRef.current?.querySelectorAll("[data-drag-src]") ?? []) el.removeAttribute("data-drag-src");
    },
  };
  useBoxDrag(panesBoxRef, isOldDrag && ready && rows.length > 0 && !isPairView ? unwrapGripConfig : null);

  /** 놓아서 맺기·확정 - 바로 저장하고 Undo가 든 알림을 띄운다. 놓은 박스가 처리 중이거나 묶음 전체 일 중이면 버린다 */
  async function runPairDrop(drop: Extract<PairDrop, { kind: "pair" | "confirm" }>) {
    if (!oldView || focusCtl.isGlobalPending) return;
    // 문서와 revision은 보던 Old 문서에서 - 양 단에서 New 문장을 다듬는 중이면 shapeView는 New 문서다
    const doc = oldView.document;
    const unitIds = drop.kind === "pair" ? drop.unitIds : [...(paperModel?.units.values() ?? [])].filter((unit) => unit.pair_id === drop.pairId).map((unit) => unit.id);
    // New 문장 다듬기를 닫고(그 고름에서 건 따라가기도 버려진다) 저장 뒤 Old 줄을 따라간다
    setSolo(null);
    await focusCtl.runPending({ kind: "pair", docId: doc.id, unitIds, place: unitIds.length > 0 ? { at: "box", unitId: unitIds[0] } : NO_PLACE, isGlobal: false }, async (job) => {
      try {
        const { pair } = drop.kind === "pair" ? await createPair(bundleId, doc.id, doc.revision, drop.unitIds) : await confirmPair(bundleId, doc.id, drop.pairId, doc.revision);
        if (pair === null) return;
        // 알림은 같은 글이면 앞의 것을 지운다 - 번호를 적어 잇달아 맺어도 알림마다 제 Undo가 남게
        const ids = pair.unit_ids.flatMap((unitId) => unitMap.get(unitId)?.display_id ?? []).join(" + ");
        showToast(t(drop.kind === "pair" ? "assign.pairDrag.done" : "assign.pairDrag.confirmed", { ids }), "ok", {
          action: { label: t("common.undo"), run: () => void pairUndoRef.current(doc.id, pair.id, pair.unit_ids) },
        });
        focusCtl.succeed(job, { docId: doc.id, revision: null, pickUnitId: pair.unit_ids[0] });
      } catch (err) {
        showToast(humanizeApiError(err, t), "error");
      } finally {
        reloadAfterEdit(planReload({ kind: "pair", docId: doc.id }, { aiOn }));
      }
    });
  }

  /**
   * 알림의 Undo - 다시 읽어 그 짝이 같은 Unit들로 확정된 채이고 판단이 없을 때만 푼다. 아니면 아무것도 쓰지 않고 알린다.
   * 알림의 단추는 한 번뿐이라 처리 중 잠금으로 막지 않는다(start · end를 바로) - 같은 문서의 쓰기 줄에는 선다
   */
  async function undoPairDrop(docId: number, pairId: number, unitIds: readonly number[]) {
    const job = focusCtl.start({ kind: "unpair", docId, unitIds, place: unitIds.length > 0 ? { at: "box", unitId: unitIds[0] } : NO_PLACE, isGlobal: false });
    try {
      await enqueueDocWrite(docId, async () => {
        try {
          const fresh = await getDocumentView(bundleId, docId);
          if (!canUndoPair(fresh, pairId, unitIds)) {
            showToast(t("assign.pairDrag.undoStale"), "info");
            return;
          }
          await deletePair(bundleId, docId, pairId, fresh.document.revision);
          showToast(t("split.pairRemoved"));
          focusCtl.succeed(job, { docId, revision: null, pickUnitId: unitIds[0] });
        } catch (err) {
          showToast(humanizeApiError(err, t), "error");
        } finally {
          reloadAfterEdit(planReload({ kind: "pair", docId }, { aiOn }));
        }
      });
    } finally {
      focusCtl.end(job);
    }
  }
  // 알림은 화면을 넘어 남는다 - 콜백이 그 렌더의 함수를 붙들지 않게 가장 최근의 것을 미러한다(use-box-drag의 최신 config와 같은 짜임)
  const pairUndoRef = useRef(undoPairDrop);
  useEffect(() => {
    pairUndoRef.current = undoPairDrop;
  });

  /** 짝 고르기를 맺는다 - 처음 문장과 고른 문장들이 한 짝이 된다. 맺을 수 없으면 까닭을 알리고 고르던 것을 그대로 둔다 */
  function finishPairPick(pickedIds: number[]) {
    if (!pairSource || pickedIds.length === 0) return;
    const others = pickedIds.map((id) => shapeModel?.units.get(id)).filter((unit): unit is ViewUnit => unit !== undefined);
    const blocker = others.map((unit) => getPairPickBlocker(unit, { isDecided: isUnitDecided, hasDraft: hasUnitDraft })).find((reason) => reason !== null) ?? getPairSetBlocker([pairSource, ...others]);
    if (blocker !== null) {
      showToast(t(blocker), "error");
      return;
    }
    const unitIds = [pairSource.id, ...others.map((unit) => unit.id)];
    setPairFrom(null);
    void runPairChange((docId, revision) => createPair(bundleId, docId, revision, unitIds), t("split.didJoin"), unitIds[0], "pair", unitIds);
  }

  /** 짝 고르는 중에 문장을 눌렀다 - 그냥 누르면 그 문장까지 넣어 맺고, Shift+클릭은 모은다(Old 용지와 양 단의 New 칸이 같이 쓴다) */
  function pickPairUnit(unitId: number, shiftKey: boolean) {
    const other = shapeModel?.units.get(unitId);
    if (!pairSource || !pairFrom || !other || other.id === pairSource.id) return;
    const { picked } = pairFrom;
    if (!shiftKey) {
      // 그냥 누르면 그 문장까지 넣어 바로 맺는다 - 둘뿐인 흔한 경우는 누르기 한 번이다
      finishPairPick(picked.includes(other.id) ? picked : [...picked, other.id]);
      return;
    }
    // Shift+클릭은 모으기 - 다시 누르면 뺀다. 넣을 수 없는 문장은 까닭을 알리고 계속 기다린다
    if (picked.includes(other.id)) {
      setPairFrom({ ...pairFrom, picked: picked.filter((id) => id !== other.id) });
      return;
    }
    const blocker = getPairPickBlocker(other, { isDecided: isUnitDecided, hasDraft: hasUnitDraft });
    if (blocker !== null) showToast(t(blocker), "error");
    else setPairFrom({ ...pairFrom, picked: [...picked, other.id] });
  }

  /** isMargin - 문단 상자의 글 밖(여백·앞머리)을 눌렀다(용지만 안다, 짝 칸은 넘기지 않는다) */
  function handleOldClick(unitId: number, keys: { shiftKey: boolean }, isMargin = false) {
    // 나눌 선이 있는 문단 상자의 글 밖을 누르면 선을 거둔다 - 선을 풀 길이 Esc · 취소 단추뿐이라 어려웠다(사용자 보고 2026-11-19)
    if (isMargin && cutLine.at !== null && cutUnitId !== null && !keys.shiftKey && findRowKey(unitId) === findRowKey(cutUnitId)) {
      cutLine.clear();
      return;
    }
    // 처리 중인 박스는 고르지 않는다 - 다른 박스는 그대로 고른다(설계 D4)
    if (isBoxLocked(unitId)) return;
    if (mode === "unsourced") {
      void linkAsSource(unitId);
      return;
    }
    // 짝 고르는 중 - New 문장의 짝을 고르는 중이면 Old 용지의 누르기는 평소처럼 그 줄을 고른다(짝은 같은 문서 안에서만 맺는다)
    if (pairSource && pairFrom && !isNewEdit) {
      pickPairUnit(unitId, keys.shiftKey);
      return;
    }
    if (isSolo) {
      selectSolo(unitId);
      return;
    }
    const key = findRowKey(unitId);
    if (!key) return;
    if (keys.shiftKey && canEdit) {
      setChecked((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        if (activeKey && prev.size === 0 && activeKey !== key) next.add(activeKey);
        return next;
      });
      return;
    }
    setChecked(new Set());
    setCtxMenu(null);
    // 누른 박스를 고른다 - 짝의 아래 박스를 눌러도 위 박스가 잡히지 않는다(설계 D3)
    selectRow(key, false, findBoxId(key, unitId));
  }

  /** 그림 탭 카드의 삭제 확정 - 그 그림 줄(캡션 포함)을 삭제로(Remark 선택, 한 번에 삭제와 같은 저장 - 되돌리기로 돌린다, 시안 2 D3) */
  async function deleteFigure(unitId: number, reason: string) {
    const key = rowOfUnit.get(unitId);
    const ids = (key === undefined ? undefined : rowMap.get(key)?.unitIds) ?? [unitId];
    const units = ids.map((id) => unitMap.get(id)).filter((unit): unit is UnitRow => unit !== undefined);
    try {
      await bulkDecide(bundleId, { action: "delete", reason, move_target_code: "", units: units.map((unit) => ({ unit_id: unit.unit_id, revision: unit.decision.revision })) }, buildUndo({ focus_unit_id: unitId }));
      markRecorded();
      showToast(t("figures.deleted"), "ok", { action: { label: t("common.undo"), run: () => void undoStepRef.current("undo") } });
      reloadData(true);
      void loadBundle(bundleId);
    } catch (err) {
      showToast(humanizeApiError(err, t), "error");
      // revision이 낡아 거절됐을 수 있다 - 다시 불러와야 다음 시도가 같은 이유로 실패하지 않는다
      reloadData();
    }
  }
  // 그림 탭 카드 - 지우기는 Old 문서의 줄에만(한 단으로 연 New 문서는 줄이 없다)
  const figureTab = canEdit && !isSolo ? { onDelete: deleteFigure } : undefined;

  function handlePrimary() {
    if (!destination) {
      // 고른 곳이 없으면 ↵는 바로 위 목록의 첫 후보(추천이 없으면 첫 묶음 제목)로 간다
      (document.querySelector<HTMLElement>(".assign-pick .dest-card") ?? document.querySelector<HTMLElement>(".assign-pick .dest-acc-head"))?.focus();
      return;
    }
    void runSave("confirm");
  }

  /** 고쳐 쓰기를 닫는다 - 직접 쓰는 다른 언어 칸이 비어 있으면 그 칸도 걷어 "쓰기" 단추가 다시 나오게 한다 */
  function closeEditing() {
    const other = draft.otherLang ?? null;
    const isOtherEmpty = other !== null && !(draft.texts[`x${other.unitId}`] ?? "").trim();
    setDraft(isOtherEmpty ? { otherLang: null } : {}, false);
  }

  function startEdit() {
    if (!destination || destination.kind !== "slot" && destination.kind !== "step") return;
    setDraft({}, true);
    requestAnimationFrame(() => firstTextRef.current?.focus());
  }

  const handleKey = useEffectEvent((event: KeyboardEvent) => {
    // 짝 고르는 중의 Esc는 그것부터 거둔다
    if (event.key === "Escape" && pairSource && !isTypingTarget(event.target) && !document.querySelector('[role="dialog"],[role="menu"],[role="listbox"]')) {
      event.preventDefault();
      setPairFrom(null);
      return;
    }
    // 짝 고르는 중에 모은 문장이 있으면 ↵가 맺는다(확정의 ↵보다 먼저)
    if (event.key === "Enter" && pairSource && pairFrom && pairFrom.picked.length > 0 && !isTypingTarget(event.target) && !document.querySelector('[role="dialog"],[role="menu"],[role="listbox"]')) {
      event.preventDefault();
      finishPairPick(pairFrom.picked);
      return;
    }
    // 메뉴 글쇠·Shift+F10 - 고른 줄(나눌 선이 있으면 그 문장)에서 우클릭 메뉴를 연다
    const isMenuKey = event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey);
    if (isMenuKey && row && mode === "old" && !bulk && !isTypingTarget(event.target) && !document.querySelector('[role="dialog"],[role="menu"],[role="listbox"]')) {
      event.preventDefault();
      openCtxMenu(cutUnit?.id ?? pickedId ?? row.unitIds[0], null, null);
      return;
    }
    // 그 자리 메뉴는 화면 단축키를 막지 않는다 - 메뉴가 떠 있어도 ↵가 확정이다(메뉴 안의 키는 메뉴가 먼저 받는다)
    if (bulk || isTypingTarget(event.target) || document.querySelector('[role="dialog"],[role="menu"]:not([data-link-menu]),[role="listbox"]')) {
      if (event.key === "Escape" && editing) closeEditing();
      // 고치는 중에는 Enter가 줄바꿈이라 Ctrl+Enter로 저장한다
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && editing && isTypingTarget(event.target)) {
        event.preventDefault();
        void runSave("confirm");
      }
      return;
    }
    // Ctrl/⌘+Z·+Shift - 글자 입력 중이거나 층이 열려 있으면 위에서 이미 돌아갔다(브라우저 글자 되돌리기)
    const undoKind = getAssignUndoKey(event, { typing: isTypingTarget(event.target), layerOpen: document.querySelector('[role="dialog"],[role="menu"]:not([data-link-menu]),[role="listbox"]') !== null, canEdit });
    if (undoKind !== null) {
      event.preventDefault();
      if (undoKind === "undo" ? undoState.canUndo : undoState.canRedo) void runUndoStep(undoKind);
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    // 포커스된 단추·링크(추천 카드·나무 항목 등)의 Enter·Space는 그 단추를 누른다
    if ((event.key === "Enter" || event.key === " ") && event.target instanceof HTMLElement && event.target.closest("button, a, [role='option'], [role='button']")) return;
    // 세로선에 포커스가 있으면 ←→는 폭이다
    if (event.target instanceof HTMLElement && event.target.closest(".pane-divider")) return;
    const key = event.key.toLowerCase();
    const step = getRowStep(key);
    if (step !== null) moveRow(step);
    else if (key === "escape") {
      // 나눌 선이 있으면 선부터 거둔다(Split과 같다)
      if (composedCut) setComposedCutAt(null);
      else if (cutLine.at !== null) cutLine.clear();
      else if (isNewEdit) setSolo(null);
      else setChecked(new Set());
    } else if (key === "v") {
      // Pair view 동안은 보기를 바꾸지 않고 Pair view만 끈다 - 켜기 전 보기로 돌아간다
      if (isPairView) closePairView();
      else changeView({ single: !view.single });
    }
    else if (key === "s" && canEdit && composedCut) splitComposedAtCut();
    else if ((key === "arrowleft" || key === "arrowright") && canEdit && composedCut && composedCutItem) setComposedCutAt({ ...composedCut, at: stepComposedCut(composedCutItem.text, composedCut.at, key === "arrowleft" ? -1 : 1) });
    else if (key === "s" && canEdit && hasSolo && cutLine.at !== null) splitAtCut();
    else if ((key === "arrowleft" || key === "arrowright") && canEdit && isNewEdit && cutLine.at !== null) cutLine.nudge(key === "arrowleft" ? -1 : 1);
    else if (!canEdit || !row) return;
    else if (key === "s" && cutLine.at !== null) splitAtCut();
    else if (key === "enter") handlePrimary();
    else if (key === "a" && canEdit && aiRecommendation) pickRecommendation(aiRecommendation); // Use - 줄의 AI 추천을 초안으로 받는다
    else if (key === "e") startEdit();
    else if (key === "h") void runSave("hold");
    else if (key === "u") void runClear();
    else return;
    event.preventDefault();
  });

  useEffect(() => {
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  // 옛 "원문 고치기" 주소로 들어옴 - 그 문서를 한 단으로 연다(Old 문서면 배정하던 그대로 넓게, 이미 쓴 New 문서면 그 원문). 없는 문서면 그냥 배정 화면이다
  const openEditParam = useEffectEvent((param: string) => {
    const doc = param === "first" ? oldDocs[0] : (docs.data ?? []).find((item) => String(item.id) === param && item.status === "ready");
    if (doc?.side === "new") openSolo(doc.id);
    else if (doc) {
      setSolo(null);
      setManualOldDoc(doc.id);
      clearRowPick();
      if (!view.single) changeView({ single: true });
    }
    router.replace(getStageHref(bundleId, "assign"), { scroll: false });
  });
  const hasDocs = docs.data !== null;
  useEffect(() => {
    if (editParam !== null && hasDocs) openEditParam(editParam);
  }, [editParam, hasDocs]);

  // 참조 지도의 줄에서 들어옴 - 그 Unit이 든 줄을 고르고 그 조각으로 간다. 보기(한 단·양 단)는 바꾸지 않는다(edit과 달리 줄을 가리킬 뿐이다).
  // 그 줄이 그사이 사라졌으면(쪼개기 편집·다른 문서의 Unit) 문서만 열고 알린다. 이 Bundle의 읽힌 Old 문서가 아니면 아무 일도 없다. 어느 쪽이든 주소에서 값을 뗀다
  const openLineParam = useEffectEvent((docParam: string, unitParam: string | null) => {
    const lineUnits = (viewList ?? []).flatMap((item) => item.units.map((unit) => ({ docId: item.document.id, groupId: unit.group_unit_id, id: unit.id })));
    const target = resolveLineParam({
      doc: docParam,
      unit: unitParam,
      oldDocIds,
      docOfUnit: (unitId) => lineUnits.find((unit) => unit.id === unitId)?.docId,
      // 칸 문장은 묶인 표의 줄이다 - 편집 뒤 따라가기(liftUnit)와 같은 식
      findRowKey: (unitId) => {
        const groupId = lineUnits.find((unit) => unit.id === unitId)?.groupId ?? null;
        return rowOfUnit.get(unitId) ?? (groupId !== null ? rowOfUnit.get(groupId) : undefined);
      },
    });
    if (target.kind === "row") {
      selectRow(target.rowKey, false);
      // 이펙트에서 바꾼 상태는 누름과 달리 다음 작업에서 그려진다 - 다른 문서의 줄이면 그 용지가 그려진 뒤에 조각을 찾도록 두 프레임 미룬다.
      // 표로 옮긴 줄은 글 조각(unit)이 없어 조각 상자(piece)로 간다 - scrollToUnit은 글 조각만 찾는다
      const { unitId } = target;
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const el = document.querySelector<HTMLElement>(`[data-testid="assign-paper-unit-${unitId}"]`) ?? document.querySelector<HTMLElement>(`[data-testid="assign-paper-piece-${unitId}"]`);
          if (el) revealFarElement(el);
        }),
      );
    } else if (target.kind === "document") {
      setSolo(null);
      setManualOldDoc(target.docId);
      clearRowPick();
      if (target.isGone) showToast(t("map.assign.gone"));
    }
    router.replace(getStageHref(bundleId, "assign"), { scroll: false });
  });
  // 용지가 그려진 뒤에(ready) 한 번 - 그 전에는 갈 조각이 화면에 없다
  useEffect(() => {
    if (lineDocParam !== null && editParam === null && ready) openLineParam(lineDocParam, lineUnitParam);
  }, [lineDocParam, lineUnitParam, editParam, ready]);

  // 출처 없는 New 문장을 고르면 New 원문이 그 문장을 보이게. Old 줄을 바꿀 때는 New 칸을 움직이지 않는다(1.2.0 피드백) - 추천 카드를 누를 때만 그리로 간다
  const newFocusId = focusNew;
  useEffect(() => {
    if (newFocusId === null || newDocId === null) return;
    const frame = requestAnimationFrame(() => document.querySelector(`[data-testid="assign-new-${newFocusId}"]`)?.scrollIntoView({ block: "nearest" }));
    return () => cancelAnimationFrame(frame);
  }, [newFocusId, newDocId]);

  // Remark 창이 닫히고(창을 거친 저장이면 저장이 끝난 뒤) 확정 단추로 포커스 - 꺼진 단추면 창이 되돌린 자리 그대로
  useEffect(() => {
    const testId = focusAfterRef.current;
    if (testId === null || remarkEdit !== null || busy) return;
    focusAfterRef.current = null;
    const button = document.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
    if (button && !button.disabled) button.focus({ preventScroll: true });
  }, [remarkEdit, busy]);

  /** 추천을 누름 - 고르고 New 칸을 그 자리로 옮긴다(다른 문서면 넘긴다). 확정은 결정 칸의 Confirm 하나 - 카드 옆 확정 메뉴는 띄우지 않는다(1.2.0 피드백).
   *  포커스는 Confirm으로 - 카드에 남으면 ↵가 확정 대신 카드를 다시 누른다 */
  function pickRecommendation(rec: Recommendation) {
    if (rec.source === "ai" && rowLive) {
      const use = buildUseDraft(rowLive, slots);
      pickDestination(rec.destination, { texts: use.texts, suggestionId: rowLive.id });
    } else pickDestination(rec.destination);
    markRecHover([]);
    setRevealPick({ destination: rec.destination, rowKey: activeKey });
    requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-testid="assign-primary"]')?.focus({ preventScroll: true }));
  }

  /** 추천 카드 ↔ New 상자를 같이 밝힌다 - 표시만 붙였다 뗀다(호버마다 화면을 다시 그리지 않게, 긴 문서) */
  function markRecHover(els: HTMLElement[]) {
    for (const el of document.querySelectorAll("[data-rec-hover]")) el.removeAttribute("data-rec-hover");
    for (const el of els) el.setAttribute("data-rec-hover", "");
  }

  // 누른 추천의 자리로 New 칸을 옮긴 뒤 - 그 자리가 그려지면(다른 문서·엮은 문서는 받아 온 뒤) 보이게 하고 번쩍인다. 다른 줄을 고르면 버린다
  const [revealPick, setRevealPick] = useState<{ destination: Destination; rowKey: string | null } | null>(null);
  const done = countDone(rows);

  function renderPlaceLabel(dest: Destination): { title: string; text: string } {
    const option = options.find((item) => getDestinationId(item.destination) === getDestinationId(dest));
    return { title: option?.docCode ?? "", text: option?.label ?? "" };
  }

  /** 고른 곳이 New 칸에 그려진 상자 - 잇기는 그 문장(짝 포함), 엮은 문서의 칸·step은 그 칸의 줄(비었으면 빈 칸 자리). 지금 칸에 없으면 빈 목록 */
  function listDestinationEls(dest: Destination): HTMLElement[] {
    const find = (id: number) => document.querySelector<HTMLElement>(`[data-pane="new"] [data-testid="assign-new-${id}"]`);
    let els: (HTMLElement | null)[] = [];
    if (dest.kind === "link") els = addPartnerTargets(dest.targetIds, writtenMap).map(find);
    else if (dest.kind === "join") els = composedDoc?.target_doc_id === dest.docId ? [find(dest.targetId)] : [];
    else if ("docId" in dest && composedDoc?.target_doc_id === dest.docId) {
      const key = dest.kind === "step" ? getSectionKey(dest) : dest.slotKey;
      const section = composedDoc.sections.find((item) => item.location_key === key);
      if (section && section.items.length > 0) els = section.items.map((item) => find(item.target_id));
      else if (section) els = [document.querySelector<HTMLElement>(`[data-pane="new"] [data-testid="assign-new-slot-${CSS.escape(section.location_key)}"]`)];
    }
    return els.filter((el): el is HTMLElement => el !== null);
  }

  const canClear = row !== null && row.status !== "unassigned";

  const error = docs.error ?? docViews.error ?? tobe.error ?? writtenList.error;

  return {
    t, bundleId, bundle, canEdit, docs, oldDocs, oldDocIds, docViews, unitsKey, reloadData, tobe, tobeData, writtenList, identical,
    aiJobs, aiOn, aiBusy, suggestions, invalidUnitIds, readMarkStatus, readAiPlace, suggestedTargetUnits, unitMap, written, writtenMap, rows, rowMap,
    rowOfUnit, options, ready, showSkeleton, unsourced, mode, setMode, filter, counts, foldOpen, setFoldOpen, applyFilter, foldMatch,
    clearRowPick, activeKey, row, pickedId, solo, setSolo, isSolo, isNewEdit, hasSolo, tocOpen, setTocOpen, tocPick, tocBlocks, checked,
    setChecked, newRemarks, setNewRemarks, menu, setMenu, joinMenu, setJoinMenu, ctxMenu, setCtxMenu, cutUnitId, focusNew,
    groupData, setDrafts, draft, editing, groupPending, savedDestination, destination, rowUnits, rowLangs, firstDecision, systemHold,
    reasonNow, moveCode, setDraft, unsavedCount, leaveTo, setLeaveTo, rowLive, aiDest, aiWhy, isAiRow, recommendations, linkIds,
    pickedGroups, saveGroupData, candidateIds, viewOf, setManualOldDoc, oldView, acceptKind, setAcceptKind, acceptDoc,
    paperModel, canPairView, isPairView, pairColumns, pairLinks, partKeys, oldDocId, splitByUnit, shapeView, shapeModel, soloUnit,
    soloUnits, cutUnit, cutLine, linkedTargets, setManualPart, activePart, isFoldEmpty, foldElsewhere, writtenDocs, composedDocs,
    setManualNewDoc, toggleKey, liveDoc, isNewDocOpen, newDocId, newAiReturn, setNewAiReturn, isComposedDoc, newFileId, composedDoc,
    newRows, headingNotes, sectionMarks, joinableIds, templateTitles, linkPairs, view, changeView, zoomPane, setPanes, askAiScope,
    aiMenuItems, remarkEdit, setRemarkEdit, focusAfterRef, firstTextRef, busy, isAnyPending, isGlobalPending: focusCtl.isGlobalPending, paperPending, editConfirm, setEditConfirm,
    oldPaneRef, undoState, buildUndo, markRecorded, bulk, setBulk, confirmingIdentical, setConfirmingIdentical,
    resetScope, setResetScope, accOpen, toggleAcc, saveUnits, slots, aiUnfilled, draftPlace, draftSectionKey, draftPosition, newDraft,
    draftSlotKey, placeResolved, canPlaceClick, pickedSpotKey, setCarvePick, carve, carveText, clearCarve, togglePairViewByButton,
    pairFrom, setPairFrom, setRefEntryId, pairSource, selectToc, selectRow, openNewCtxMenu, openSolo, goToUnit, moveRow, hasUnitDraft,
    isFixedCaption, ctxGroups, rowViewUnits, rowSplitUnit, rowSplit, splitBlocked, rowRefUnit, refBlocked, isRefGate, isCaptionGateOn,
    confirmBlockKey, rowCaptionRefs, refCandidates, shapeLines, shapeFirstId, slotPlaces, slotBlockKinds, shapeMode, headingBack, rewrap, bandBack,
    stepBase, refPendingIds, isLinkedToWritten, captionPendingKeys, docDashboard, refDetail, refInfo, openCtxMenu, runUnitEdit,
    rewrapTable, describeEditConfirm, pairGrip, clearToc, runCaptionRefChange, switchShapeMode, switchToPair,
    applySplitSuggestion, dismissSplitSuggestion, splitPendingIds, readPendingItem, selectNextSplit, selectNextRef, selectNextCaption,
    splitAtCut, handleOldDoubleClick, runCtx, runUnitAction, revertHeadings, planOldJoin, joinOld, renderOldActions, readReasonNeed,
    runSave, runClear, runUndoStep, confirmIdenticalAll, acceptAll, markNew, placeManage, pickDestination, pickNewSentence, handleNewPick, unlinkCell,
    handleJoinPick, readJoinAfter, pickJoinMenu, pickPlaceSpot, pickOwnAiLine, jumpToNew, openNewDoc, showInNew, jumpToOld,
    pickTemplateLine, fillTemplateMissing, isTemplateDrag, isOldDrag, finishPairPick, handleOldClick, handlePrimary, startEdit,
    pickRecommendation, markRecHover, revealPick, setRevealPick, done, renderPlaceLabel, listDestinationEls,
    canClear, error, figureTab, composedCut, setComposedCutAt, handleComposedDoubleClick, dragComposedCut, splitComposedAtCut, planComposedGap, joinComposed,
  };
}

export type AssignPageState = ReturnType<typeof useAssignPage>;
