// 3단계 Assign - Old 조각을 한 줄씩(한/영 짝은 함께) 보낼 곳을 정한다. 보낼 곳은 이미 쓴 New 문서의 문장(옛 짝 맞추기)이거나
// 아직 안 쓴 To-Be 문서의 칸(옛 분류), 또는 삭제·외부 이동이다. 가운데는 Old 원문(Split 조각이 곧 목록) ‖ New 원문,
// 오른쪽은 고른 곳·확정·우선순위 아코디언이다(설계 docs/superpowers/specs/2026-11-09-assign-unified-design.md).
// 보기는 둘이다 - 양 단(Old ‖ New)과 한 단(Old 문서 하나만 넓게, 설계 2026-11-15-assign-merge-documents-design.md §3.1). 한 단에서는 New 칸·세로선·연결선을 그리지 않는다.
"use client";

import { ArrowDown, ArrowUp, BookMarked, Check, Circle, CircleCheck, CircleDashed, CirclePause, Columns2, ExternalLink, FileCheck2, FilePen, FileUp, FolderOutput, Inbox, Link2, ListFilter, ListTree, Locate, MapPin, MoveRight, Redo2, RefreshCw, Sparkles, Square, SquarePlus, Trash2, TriangleAlert, Undo2, WandSparkles, X, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Fragment, useEffect, useEffectEvent, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";

import { AssignContextMenu } from "@/components/assign/assign-context-menu";
import { AssignHelp } from "@/components/assign/assign-help";
import { DestCard } from "@/components/assign/dest-card";
import { DestinationAccordion, type AccordionSection } from "@/components/assign/destination-accordion";
import { DestinationTree, type DestinationManage } from "@/components/assign/destination-tree";
import { MissingWarnings } from "@/components/assign/missing-warnings";
import { RefCard } from "@/components/assign/ref-card";
import { ShapeTools, type ShapeLine } from "@/components/assign/shape-tools";
import { SplitSuggestionCard } from "@/components/assign/split-suggestion";
import { SplitUnitActions } from "@/components/split/split-unit-actions";
import { LinkChoice } from "@/components/assign/link-choice";
import { findNewLine, findOldStrip, LinkLines } from "@/components/assign/link-lines";
import { LinkMenu } from "@/components/assign/link-menu";
import { LinkBadge } from "@/components/assign/link-badge";
import { MoveTargetField } from "@/components/assign/move-target-field";
import { runPickFlight, type FlightSource } from "@/components/assign/pick-flight";
import { NewPane, NewPaneEmpty } from "@/components/assign/new-pane";
import { OldPane } from "@/components/assign/old-pane";
import { PaneDivider } from "@/components/assign/pane-divider";
import { RecentRemarks, REMARK_MAX_LENGTH, RemarkModal } from "@/components/assign/remark-modal";
import { ResetMenu } from "@/components/assign/reset-menu";
import { ResetModal, type ResetScope } from "@/components/assign/reset-modal";
import { AiAskMenu, type AiAskItem } from "@/components/manage/ai-ask-menu";
import { Modal } from "@/components/modal";
import { ReadOnlyNote } from "@/components/read-only-note";
import { CutPop } from "@/components/paper/cut-pop";
import { LangToken } from "@/components/paper/lang-token";
import { SourceFontMenu } from "@/components/paper/source-font-menu";
import { FilterChip, UnitStatusChip } from "@/components/status";
import { ClampText } from "@/components/ui/clamp-text";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { EmptyState } from "@/components/ui/empty-state";
import { BundleLoadError } from "@/components/bundle-load-error";
import { Truncate } from "@/components/ui/motion";
import { showToast } from "@/components/ui/toast";
import { Tooltip } from "@/components/ui/tooltip";
import { ApiError } from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import { findLastStep } from "@/lib/destination-manage-model";
import { listAckWarnings } from "@/lib/missing-warnings-model";
import { readSplitOffsets } from "@/lib/split-ai-tabs-model";
import { planPairLanguages, type JoinKind, type JoinPlan } from "@/lib/split-menu-model";
import { listAppliedSuggestions, requestAi, setSuggestionAdoption, type AiKind, type AiScope } from "@/lib/api-manage";
import {
  addToBeDoc,
  addWiStep,
  bulkDecide,
  createPair,
  deletePair,
  editUnits,
  clearDecisions,
  confirmMatchesInBulk,
  getComposedDoc,
  getDocumentView,
  getGroupByTarget,
  getUnitRef,
  getGroupByUnit,
  getToBe,
  listAllUnits,
  listDocuments,
  listIdenticalCandidates,
  listNewCandidates,
  listSuggestions,
  listWrittenSentences,
  redoDecision,
  removeToBeDoc,
  removeWiStep,
  saveGroup,
  undoDecision,
  type AiSuggestion,
  type ChangeTypeInput,
  type ComposedDoc,
  type DecisionStepResult,
  type DocumentView,
  type EditOp,
  type Group,
  type GroupSaveInput,
  type NewCandidate,
  type ToBe,
  type UndoMeta,
  type UnitRefDetail,
  type UnitRow,
  type ViewUnit,
  type WrittenSentence,
} from "@/lib/api-sop";
import { applySavedTargets, buildComposedRows, isWrittenRow, listHeadingNotes, removeClearedUnits, type NewPaneRow } from "@/lib/composed-model";
import {
  addPartnerTargets,
  buildLinkPairs,
  buildRecommendations,
  canMakeOtherLanguage,
  isRecommendationPicked,
  listCoConfirmed,
  listLinkMenuItems,
  listSiblingPlaces,
  listUnlinkRemainder,
  listUnsourced,
  mergeGroups,
  pickNearby,
  stepZoom,
  type LinkMenuItem,
  type Recommendation,
} from "@/lib/assign-model";
import { buildAssignMenu, getPairPickBlocker, getPairSetBlocker, planAssignJoin, planShapeMode, type AssignMenuAction, type AssignMenuGroups } from "@/lib/assign-context-menu-model";
import { readAssignView, writeAssignView } from "@/lib/assign-view-prefs";
import { loadBundle, useBundle } from "@/lib/bundle-store";
import { describeDecisionStep, getAssignUndoKey, pickSaveOp } from "@/lib/decision-step-model";
import {
  buildDestinationOptions,
  buildGroupSave,
  buildRows,
  buildSentenceSlots,
  buildViewsKey,
  findNextOpen,
  findSystemHold,
  getDestinationId,
  getRowStep,
  hasDraftChange,
  hasRowLanguage,
  isHeadingSourceUnit,
  isPlaceOption,
  listTreeOptions,
  isSentenceUnit,
  isTextChangeType,
  isTranslationOf,
  listLinkLeftovers,
  listUnpairedKeys,
  pickLinkUnits,
  readCheckKey,
  readDestination,
  readHumanReason,
  readLinkDefault,
  readSlotKind,
  stepInList,
  type CellSource,
  type ClassifyFilter,
  type ClassifyRow,
  type Destination,
  type DestinationOption,
  type RowDraft,
} from "@/lib/classify-model";
import { formatKst } from "@/lib/datetime";
import { useI18n } from "@/lib/i18n";
import { genId } from "@/lib/id";
import { useLeaveGuard } from "@/lib/leave-guard";
import { buildIdenticalBatches } from "@/lib/match-model";
import { navigate } from "@/lib/nav-buffer";
import { EMPTY_FOLD_OPEN, type FoldOpen } from "@/lib/paper-fold-model";
import { buildPaperModel, buildPaperTabs, findNearestCut, listPartSheets, shouldRecenter, type PaperTabKey } from "@/lib/paper-model";
import { SLOT_LABELS } from "@/lib/slot-labels";
import { EDIT_ORIGINAL_PARAM, getNewDocumentsHref, getStageHref } from "@/lib/stages";
import { useAiJobs } from "@/lib/use-ai-jobs";
import { useDelayedFlag } from "@/lib/use-delayed-flag";
import { useCutLine } from "@/lib/use-cut-line";
import { countRefLookups, isRefPending, pickRefUnit, readRefAdvice } from "@/lib/ref-model";
import { useEquisPolling } from "@/lib/use-equis-polling";
import { useLoaded } from "@/lib/use-loaded";
import { usePaneZoom, type PaneKey, type ZoomDir } from "@/lib/use-pane-zoom";
import { Select, type SelectOption } from "@/components/ui/select";

type Filter = ClassifyFilter;
const FILTERS: Filter[] = ["unassigned", "ai_suggested", "on_hold", "confirmed", "all"];
// 필터 칩의 아이콘 - 색은 칩 톤(components.css .schip)이 상태 이름으로 정한다
const FILTER_ICON: Record<Filter, LucideIcon> = {
  unassigned: Circle,
  ai_suggested: CircleDashed,
  on_hold: CirclePause,
  confirmed: CircleCheck,
  all: ListFilter,
};
type Mode = "old" | "unsourced";

// backend constants.SYSTEM_HOLD_* - 모르는 코드는 "시스템 보류"로 보인다
const SYSTEM_HOLDS = ["related_unit_changed", "ai_invalid_response"];

/** 화면의 줄 초안 - 사유·이동 코드는 null이면 손대지 않은 것(저장된 값을 보인다), ""이면 사람이 비운 것 */
interface PageDraft extends Omit<RowDraft, "reason" | "moveCode"> {
  reason: string | null;
  moveCode: string | null;
  editing: boolean;
}

const EMPTY_DRAFT: PageDraft = { destination: null, texts: {}, changeTypes: {}, linkChangeTypes: {}, reason: null, moveCode: null, editing: false };
const NO_NUMBERS: ReadonlySet<number> = new Set();

/** 되돌리면 단위가 은퇴할 수 있는 편집 - 그 줄을 고른 채 다시 받으면 없는 단위의 묶음을 부르게 된다 */
const RETIRING_OPS: ReadonlySet<string> = new Set(["cut", "carve", "merge", "unmerge", "split_table_rows", "merge_table_rows", "set_layout_table"]);

// 한 단으로 연 New 문서에서 연 우클릭 메뉴의 줄 키 자리 - 그 문서에는 줄이 없다
const SOLO_ROW_KEY = "solo";

/** 배정이 걸려 서버가 되물은 편집 - 확인하면 같은 일을 confirm을 켜고 다시 보낸다 */
type ConfirmedEdit =
  | { kind: "edit"; op: EditOp; okText: string; followId: number | null }
  | { kind: "to_pair"; unit: ViewUnit }
  | { kind: "ai_split"; unit: ViewUnit; suggestion: AiSuggestion };

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

/** 줄의 단위마다 그룹을 불러 합친다 - 짝의 두 쪽이 서로 다른 관계 묶음일 수 있다 */
async function loadRowGroup(bundleId: number, unitIds: number[]): Promise<Group> {
  return mergeGroups(await Promise.all(unitIds.map((id) => getGroupByUnit(bundleId, id))));
}

/** 줄의 문장 단위마다 New 후보를 받아 합친다 - 같은 문장은 한 번 */
async function loadRowCandidates(bundleId: number, unitIds: number[]): Promise<NewCandidate[]> {
  const lists = await Promise.all(unitIds.map((id) => listNewCandidates(bundleId, id)));
  const seen = new Set<number>();
  return lists.flat().filter((item) => !seen.has(item.target_id) && seen.add(item.target_id));
}

/** 고른 곳에서 New 원문을 열 이미 쓴 문서 */
function findLinkDoc(destination: Destination | null, written: Map<number, WrittenSentence>): number | null {
  return destination?.kind === "link" ? (written.get(destination.targetIds[0])?.target_doc_id ?? null) : null;
}

/** Remark 창 - 고른 줄의 사유(저장이 사유를 요구해 열었으면 확인 뒤 그 저장을 잇는다) 또는 출처 없는 New 문장의 Remark */
type RemarkEdit = { kind: "row"; need: "delete" | "move" | "hold" | "duplicate" | null; then: "confirm" | "hold" | null } | { kind: "new"; targetId: number };

/** 그 자리 메뉴 - 붙을 요소, 누른 자리(요소 기준, 키보드·이동이면 null), 어느 줄의 어느 New 문장에 대한 메뉴인지 */
interface MenuState {
  /** 열 때마다 새 값 - 메뉴를 새로 그려 늦게 뜨는 움직임과 포커스 옮기기를 다시 한다 */
  seq: number;
  anchor: HTMLElement;
  offset: { x: number; y: number } | null;
  rowKey: string;
  targetId: number | null;
}

/** 누른 자리를 요소 기준으로 - 키보드로 누르면(detail 0) 포인터 자리가 없다 */
function readMenuOffset(anchor: HTMLElement, event: MouseEvent | null): { x: number; y: number } | null {
  if (!event || event.detail === 0) return null;
  const rect = anchor.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

/** 그 자리 메뉴가 덮지 않을 상자 - New 문장이면 함께 골라지는 짝 문장 전부, Old 조각이면 그 줄의 조각 전부 */
function readMenuCover(anchor: HTMLElement, rowUnitIds: number[]): HTMLElement[] {
  if (anchor.matches(".new-line")) {
    const group = anchor.getAttribute("data-pair-group");
    return group ? [...document.querySelectorAll<HTMLElement>(`.new-line[data-pair-group="${CSS.escape(group)}"]`)] : [anchor];
  }
  return rowUnitIds.flatMap((id) => [...document.querySelectorAll<HTMLElement>(`[data-testid="assign-paper-piece-${id}"]`)]);
}

/** 이동해 간 자리를 잠깐 번쩍인다 - 다시 이동하면 처음부터 */
function flashElement(el: HTMLElement) {
  delete el.dataset.flash;
  void el.offsetWidth; // 애니메이션을 다시 시작하게 스타일을 한 번 계산시킨다
  el.dataset.flash = "";
  window.setTimeout(() => delete el.dataset.flash, 1300);
}

/** 이동해 간 자리를 보이게 - 이미 화면 안이면 움직이지 않는다 */
function revealElement(el: HTMLElement) {
  const pane = el.closest(".pane-body");
  if (!pane) return;
  const box = el.getBoundingClientRect();
  const frame = pane.getBoundingClientRect();
  if (shouldRecenter(box.top, box.bottom, frame.top, frame.bottom)) el.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}

// 도구 줄이 이보다 좁으면 오른쪽 단추는 아이콘만(라벨은 툴팁) - 1440 창에서 한 줄을 지킨다(한·영 모두 AI 메뉴가 있어도)
const BAR_COMPACT_BELOW = 1200;

export default function AssignPage() {
  const { t, lang: uiLang } = useI18n();
  const bundleId = Number(useParams<{ id: string }>().id);
  const { bundle } = useBundle(bundleId);
  const canEdit = bundle?.my_role === "author" && bundle.status === "in_progress";
  // 옛 "원문 고치기" 주소(?edit=문서 id 또는 first) - 그 화면은 없어졌다. 그 문서를 한 단으로 열고 주소에서 값을 뗀다(아래 openEditParam)
  const editParam = useSearchParams().get(EDIT_ORIGINAL_PARAM);
  const router = useRouter();

  // --- 데이터 ---
  const docs = useLoaded(() => listDocuments(bundleId), String(bundleId));
  const oldDocs = (docs.data ?? []).filter((doc) => doc.side === "old" && doc.status === "ready");
  const oldDocIds = oldDocs.map((doc) => doc.id);
  const views = useLoaded<DocumentView[] | null>(
    () => (docs.data === null ? Promise.resolve(null) : Promise.all(oldDocIds.map((id) => getDocumentView(bundleId, id)))),
    buildViewsKey(docs.data === null ? null : oldDocIds),
  );
  const [unitsKey, setUnitsKey] = useState(0);
  const dataKey = `${bundleId}:${unitsKey}`;
  const units = useLoaded(() => listAllUnits(bundleId), dataKey);
  // 저장할 때마다 다시 받는다 - 문장이 든 자리 수(sentence_counts)가 보낼 곳 지우기 단추를 잠근다
  const tobe = useLoaded(() => getToBe(bundleId), dataKey);
  // 이 화면에서 보낼 곳을 더하거나 지운 응답 - 그 뒤에 다시 받은 목록이 올 때까지 이쪽이 더 새롭다
  const [tobeFresh, setTobeFresh] = useState<{ key: string; data: ToBe } | null>(null);
  const tobeData = tobeFresh !== null && (tobeFresh.key === dataKey || tobe.isLoading) ? tobeFresh.data : tobe.data;
  const [isPlaceBusy, setIsPlaceBusy] = useState(false);
  const writtenList = useLoaded(() => listWrittenSentences(bundleId), dataKey);
  const identical = useLoaded(() => listIdenticalCandidates(bundleId), dataKey);
  // AI 작업이 끝나면 단위·제안·New 문장을 다시 불러온다 - 제안이 보이고 다음 저장이 낡은 revision으로 409가 나지 않는다.
  // 원문 보기도 다시 받는다 - 나누기 제안 표시(split_suggestion_id)와 AI가 제안한 한/영 짝이 거기 실려 온다
  const aiJobs = useAiJobs(bundleId, () => {
    // 한 단으로 연 New 문서의 원문 보기도(그 문서의 나누기 제안 표시)
    setSoloKey((key) => key + 1);
    views.reload();
    setUnitsKey((key) => key + 1);
    void loadBundle(bundleId);
  });
  const aiOn = aiJobs.status?.ai_enabled ?? false;
  const aiBusy = (aiJobs.status?.jobs.queued ?? 0) + (aiJobs.status?.jobs.running ?? 0);
  const suggestions = useLoaded(() => listSuggestions(bundleId, "classify"), dataKey);
  const matchSuggestions = useLoaded(() => listAppliedSuggestions(bundleId, "match"), dataKey);
  // 단위마다 가장 최근의 적용된 제안(분류·짝) - 이유를 보이는 데만 쓴다. 보낼 곳 자체는 저장된 묶음에서 읽는다
  const suggestionOf = useMemo(() => {
    const map = new Map<number, AiSuggestion>();
    for (const item of [...(suggestions.data ?? []), ...(matchSuggestions.data ?? [])]) for (const id of item.content.unit_ids ?? []) if ((map.get(id)?.id ?? 0) < item.id) map.set(id, item);
    return map;
  }, [suggestions.data, matchSuggestions.data]);

  const unitMap = useMemo(() => new Map((units.data ?? []).map((row) => [row.unit_id, row])), [units.data]);
  const written = useMemo(() => writtenList.data ?? [], [writtenList.data]);
  // New 원문의 참조 줄 번호는 이 목록을 읽는 요청이 조회한다(한 번에 10개) - 조회 중인 줄이 남은 동안 다시 읽어 표시가 새로 고침 없이 채워지게 한다
  const refLookups = countRefLookups(written);
  useEquisPolling(refLookups > 0, writtenList.reload, refLookups);
  const writtenMap = useMemo(() => new Map(written.map((row) => [row.target_id, row])), [written]);
  const viewList = views.data;
  const rows = useMemo(() => (viewList ? buildRows(viewList, unitMap) : []), [viewList, unitMap]);
  const rowMap = new Map(rows.map((row) => [row.key, row]));
  const rowOfUnit = new Map(rows.flatMap((row) => row.unitIds.map((id) => [id, row.key] as const)));
  const options = useMemo(() => (tobeData ? buildDestinationOptions(tobeData, SLOT_LABELS) : []), [tobeData]);
  const ready = viewList !== null && units.data !== null && tobeData !== null && writtenList.data !== null;
  const showSkeleton = useDelayedFlag(!ready && docs.error === null);
  const unsourced = listUnsourced(written);

  // --- 거르기: 누를 때만 다시 줄 세운다(확정한 줄은 그 자리에 남는다). Old 원문은 그대로 두고 ↑↓가 이 순서만 밟는다 ---
  const [mode, setMode] = useState<Mode>("old");
  // 처음에는 All(용지 전부, 안 접힘) - 명세 2026-11-12 §4.4
  const [filter, setFilter] = useState<Filter>("all");
  const [snapshot, setSnapshot] = useState<{ filter: Filter; keys: string[] } | null>(null);
  const counts: Record<Filter, number> = { unassigned: 0, ai_suggested: 0, on_hold: 0, confirmed: 0, all: rows.length };
  for (const row of rows) counts[row.status] += 1;
  const listKeys = useMemo(() => {
    const keys = new Set(rows.map((row) => row.key));
    return snapshot && snapshot.filter === filter ? snapshot.keys.filter((key) => keys.has(key)) : rows.filter((row) => filter === "all" || row.status === filter).map((row) => row.key);
  }, [snapshot, filter, rows]);

  // 처음 불러온 순간의 목록을 붙잡는다 - 그래야 확정한 줄이 거르기에서 바로 빠지지 않는다(렌더 중 상태 맞추기)
  if (snapshot === null && rows.length > 0 && units.data !== null) {
    setFilter("all");
    setSnapshot({ filter: "all", keys: rows.map((item) => item.key) });
  }

  // 필터 접기의 펼침 - 필터를 걸 때마다(같은 필터를 다시 눌러도) 모두 접힌다
  const [foldOpen, setFoldOpen] = useState<FoldOpen>(EMPTY_FOLD_OPEN);
  function applyFilter(next: Filter) {
    setMode("old");
    setFilter(next);
    setSnapshot({ filter: next, keys: rows.filter((row) => next === "all" || row.status === next).map((row) => row.key) });
    setFoldOpen(EMPTY_FOLD_OPEN);
  }
  // 접을 때 맞는 Unit - 필터를 건 때의 목록(스냅숏)이라 확정·보류로 상태가 바뀌어도 그 자리에서 접히지 않는다. 출처 없는 New 모드는 Old를 넓게 훑으니 접지 않는다
  const foldMatch = useMemo(() => {
    if (mode !== "old" || filter === "all") return null;
    const unitIdsOf = new Map(rows.map((row) => [row.key, row.unitIds]));
    return new Set(listKeys.flatMap((key) => unitIdsOf.get(key) ?? []));
  }, [mode, filter, listKeys, rows]);

  // 처음에는 아무 조각도 고르지 않는다 - 오른쪽 칸이 범례를 보인다
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const activeKey = selectedKey && rowMap.has(selectedKey) ? selectedKey : null;
  const row: ClassifyRow | null = activeKey ? (rowMap.get(activeKey) ?? null) : null;
  // 한 단 보기에서 연 이미 쓴 New 문서(그 파일의 문서 id)와 거기서 고른 문장 - Old 원문 자리에 그 원문을 놓고 같은 도구로 다듬는다.
  // 이 문서의 문장은 배정하지 않으므로 줄(row)이 없다. 줄을 고르면(Old 문서로 돌아가는 것이다) 닫힌다
  // inPlace는 양 단에서 New 칸의 문장을 그 자리에서 고른 것이다 - 왼쪽은 Old 문서 그대로이고, 다듬는 대상만 그 New 문서가 된다
  const [solo, setSolo] = useState<{ docId: number; unitId: number | null; inPlace: boolean } | null>(null);
  if (solo !== null && row !== null) setSolo(null);
  const isSolo = solo !== null && !solo.inPlace && row === null;
  const isNewEdit = solo !== null && solo.inPlace && row === null;
  const hasSolo = isSolo || isNewEdit;
  const [soloKey, setSoloKey] = useState(0);
  const soloLoad = useLoaded<DocumentView | null>(() => (solo !== null ? getDocumentView(bundleId, solo.docId) : Promise.resolve(null)), `${bundleId}:${solo?.docId ?? ""}:${soloKey}`);
  // 편집 뒤 고를 문장 - 그 문서의 원문 보기를 다시 받으면 고른다(follow의 New 문서판)
  const [soloFollow, setSoloFollow] = useState<{ unitId: number; stale: DocumentView | null } | null>(null);
  if (soloFollow !== null && soloLoad.data !== null && soloLoad.data !== soloFollow.stale) {
    setSoloFollow(null);
    if (solo !== null && soloLoad.data.units.some((unit) => unit.id === soloFollow.unitId)) {
      setSolo({ ...solo, unitId: soloFollow.unitId });
      if (!solo.inPlace) scrollToUnit(soloFollow.unitId);
    }
  }
  // 한 언어만 이어 짝을 푼 줄 - 원문 보기를 다시 받아 남은 문장의 줄이 생기면 그 줄로 옮긴다(렌더 중 상태 맞추기)
  const [splitRow, setSplitRow] = useState<{ from: string; unit: number } | null>(null);
  if (splitRow !== null) {
    // 그 사이 사람이 다른 줄을 골랐으면 따라가지 않는다
    if (selectedKey !== splitRow.from) setSplitRow(null);
    else if (rowMap.get(`u${splitRow.unit}`)?.unitIds.length === 1) {
      setSplitRow(null);
      setSelectedKey(`u${splitRow.unit}`);
    }
  }
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [selNew, setSelNew] = useState<number | null>(null);
  // 출처 없는 New 문장마다 적는 중인 Remark - 없으면 저장된 값을 보인다
  const [newRemarks, setNewRemarks] = useState<Record<number, string>>({});
  // 그 자리 메뉴와 이동 - 이동은 고른 줄·열린 문서가 다시 그려진 뒤에 그 자리를 찾는다
  const [menu, setMenu] = useState<MenuState | null>(null);
  const menuSeq = useRef(0);
  function openMenu(anchor: HTMLElement, event: MouseEvent | null, rowKey: string, targetId: number | null) {
    menuSeq.current += 1;
    setMenu({ seq: menuSeq.current, anchor, offset: readMenuOffset(anchor, event), rowKey, targetId });
  }
  const [jump, setJump] = useState<{ side: "old" | "new"; id: number; targetId: number; rowKey: string; quiet?: boolean } | null>(null);
  // 고른 줄이 어떤 길로든 바뀌면(↑↓·저장 뒤 다음 줄·짝 풀림·문서 바꾸기) 메뉴를 닫는다 - 다른 줄에서 낡은 메뉴가 되살아나지 않게(렌더 중 상태 맞추기)
  if (menu !== null && menu.rowKey !== activeKey) setMenu(null);
  // Old 문장 우클릭 메뉴 - 누른 Unit, 그 줄 상자, 누른 자리와 글자 자리(키보드로 열었으면 없음). 고른 줄이 바뀌면 닫는다
  const [ctxMenu, setCtxMenu] = useState<{ seq: number; unitId: number; rowKey: string; anchor: HTMLElement; click: { x: number; y: number } | null; caret: { blockId: number; offset: number } | null } | null>(null);
  if (ctxMenu !== null && ctxMenu.rowKey !== (activeKey ?? (hasSolo ? SOLO_ROW_KEY : null))) setCtxMenu(null);
  // 나눌 선이 놓인 Unit - 고른 줄 안의 것만 산다(줄을 바꾸면 선이 사라진다)
  const [cutUnitId, setCutUnitId] = useState<number | null>(null);
  // 편집 뒤 고를 Unit - 원문 보기와 단위 목록을 둘 다 다시 받으면 그 줄을 고른다(stale…는 편집 전 것, 줄은 둘 다에서 나온다)
  const [follow, setFollow] = useState<{ unitId: number; staleViews: DocumentView[] | null; staleUnits: UnitRow[] | null } | null>(null);
  // 편집 뒤 - 원문 보기를 다시 받아 줄이 새로 생기면 편집한 문장의 줄을 고르고, 거르기 목록도 새 줄로 다시 잡는다(렌더 중 상태 맞추기)
  if (follow !== null && viewList !== follow.staleViews && viewList !== null && units.data !== follow.staleUnits) {
    const groupOf = viewList.flatMap((view) => view.units).find((unit) => unit.id === follow.unitId)?.group_unit_id ?? null;
    const key = rowOfUnit.get(follow.unitId) ?? (groupOf !== null ? rowOfUnit.get(groupOf) : undefined);
    setFollow(null);
    setSnapshot((prev) => prev && { filter: prev.filter, keys: rows.filter((item) => prev.filter === "all" || item.status === prev.filter || item.key === key).map((item) => item.key) });
    if (key) {
      setSelectedKey(key);
      scrollToUnit(follow.unitId);
    }
  }
  const focusNew = mode === "unsourced" ? (unsourced.find((item) => item.target_id === selNew)?.target_id ?? unsourced[0]?.target_id ?? null) : null;

  // --- 고른 줄의 관계 묶음·후보와 초안 ---
  // 짝을 풀면 줄 키는 그대로인데 단위가 달라질 수 있다 - 줄의 단위를 키에 넣어 묶음·후보를 다시 받는다
  const rowKey = `${activeKey}:${row?.unitIds.join(",") ?? ""}:${unitsKey}`;
  const group = useLoaded<Group | null>(() => (row ? loadRowGroup(bundleId, row.unitIds) : Promise.resolve(null)), rowKey);
  const groupData = group.data;
  const sentenceUnitIds = (row?.unitIds ?? []).filter((id) => unitMap.get(id)?.kind !== "table" && unitMap.get(id)?.kind !== "table_row" && unitMap.get(id)?.kind !== "figure");
  const similar = useLoaded<NewCandidate[]>(
    () => (written.length > 0 && sentenceUnitIds.length > 0 ? loadRowCandidates(bundleId, sentenceUnitIds) : Promise.resolve([])),
    `${rowKey}:${written.length > 0}`,
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
  const rowSuggestion = row ? (row.unitIds.map((id) => suggestionOf.get(id)).find(Boolean) ?? null) : null;

  function setDraft(patch: Partial<PageDraft>, nextEditing = editing) {
    if (!activeKey) return;
    setDrafts((prev) => ({ ...prev, [activeKey]: { ...draft, ...patch, editing: nextEditing } }));
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
  const aiWhy = typeof rowSuggestion?.content.reason === "string" ? rowSuggestion.content.reason : "";
  const isAiRow = row?.status === "ai_suggested" && savedDestination !== null;
  const recommendations: Recommendation[] = row
    ? buildRecommendations({
        aiLinks: isAiRow && savedDestination?.kind === "link" ? [{ targetIds: savedDestination.targetIds, why: aiWhy }] : [],
        aiPlaces: isAiRow && savedDestination && savedDestination.kind !== "link" ? [{ destination: savedDestination, why: aiWhy }] : [],
        identical: (identical.data ?? []).filter((item) => row.unitIds.includes(item.unit_id)).map((item) => item.target_id),
        similar: similar.data ?? [],
      }, (ids) => addPartnerTargets(ids, writtenMap))
    : [];
  const linkIds = destination?.kind === "link" ? destination.targetIds : [];
  // 고른 문장의 관계 묶음(합쳐진 다른 출처 등)은 고를 때 부른다 - 함께 확정되는 것을 미리 보이고 저장도 같은 묶음으로 한다
  const knownTargets = new Set(groupData?.targets.map((target) => target.id) ?? []);
  const missingIds = linkIds.filter((id) => !knownTargets.has(id));
  const pickedGroups = useLoaded<Group[]>(
    () => (missingIds.length > 0 ? Promise.all(missingIds.map((id) => getGroupByTarget(bundleId, id))) : Promise.resolve([])),
    `${rowKey}:${missingIds.join(",")}`,
  );
  const saveGroupData = groupData ? mergeGroups([groupData, ...(pickedGroups.data ?? [])]) : null;
  const candidateIds = new Set(destination ? [] : recommendations.flatMap((rec) => (rec.destination.kind === "link" ? rec.destination.targetIds : [])));
  const aiPending = new Set(linkIds.filter((id) => writtenMap.get(id)?.status === "ai_suggested" && (writtenMap.get(id)?.source_unit_ids ?? []).some((unit) => row?.unitIds.includes(unit))));

  // --- 원문 두 칸 ---
  const viewOf = (docId: number | undefined) => (viewList ?? []).find((view) => view.document.id === docId) ?? null;
  const [manualOldDoc, setManualOldDoc] = useState<number | null>(null);
  const soloView = hasSolo && soloLoad.data?.document.id === solo.docId ? soloLoad.data : null;
  const oldView = isSolo ? soloView : viewOf(row?.documentId ?? manualOldDoc ?? oldDocIds[0]);
  const paperModel = useMemo(() => (oldView ? buildPaperModel(oldView) : null), [oldView]);
  // 본문·머리말·꼬리말 탭 - 고른 조각이 다른 탭에 있으면 그 탭으로 가고, 사람이 고른 탭은 그 줄에서 그대로 둔다
  const partKeys = useMemo(() => (paperModel ? (["body", "header", "footer"] as const).filter((key) => paperModel[key].length > 0) : []), [paperModel]);
  const paperTabs = useMemo(() => (oldView && paperModel ? buildPaperTabs(oldView, paperModel) : null), [oldView, paperModel]);
  // AI 나누기 제안 - 보는 Old 문서의 아직 정하지 않은 것. 문장마다 가장 새 제안 하나(전에는 쪼개기 화면에서만 적용·거절했다)
  const oldDocId = oldView?.document.id ?? null;
  const splitSuggestions = useLoaded(() => (aiOn && oldDocId !== null ? listAppliedSuggestions(bundleId, "split", oldDocId) : Promise.resolve([])), `${aiOn}:${oldDocId}:${dataKey}`);
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
  const topLink = recommendations.find((rec) => rec.destination.kind === "link")?.destination ?? null;
  // 칸에 확정한 줄은 그 문서를 연다 - 이어 둔 문서가 없을 때 추천보다 먼저
  const savedPlaceDoc = savedDestination?.kind === "slot" || savedDestination?.kind === "step" ? savedDestination.docId : null;
  const autoNewDoc = mode === "unsourced" ? (writtenMap.get(focusNew ?? -1)?.target_doc_id ?? null) : (findLinkDoc(destination, writtenMap) ?? savedPlaceDoc ?? findLinkDoc(topLink, writtenMap));
  const liveDoc = liveNew?.key === toggleKey ? liveNew : null;
  const newDocId = (manualNewDoc?.key === toggleKey ? manualNewDoc.docId : null) ?? liveDoc?.docId ?? autoNewDoc ?? writtenDocs[0]?.[0] ?? composedDocs[0]?.id ?? null;
  const isComposedDoc = newDocId !== null && !writtenDocs.some(([docId]) => docId === newDocId);
  // 이미 쓴 New 문서의 올린 파일(문서) id - 원문 고치기를 그 문서로 연다
  const newFileId = (tobeData?.docs ?? []).find((doc) => doc.id === newDocId)?.document_id ?? null;
  const composed = useLoaded(
    () => (isComposedDoc && newDocId !== null ? getComposedDoc(bundleId, newDocId, uiLang) : Promise.resolve(null)),
    `${isComposedDoc ? newDocId : ""}:${dataKey}:${uiLang}`,
  );
  // 저장 응답으로 미리 고친 엮은 문서 - 그때 받아 둔 문서(base)가 그대로인 동안만, 다시 읽은 서버 값이 오면 그것
  const [composedPatch, setComposedPatch] = useState<{ base: ComposedDoc; doc: ComposedDoc } | null>(null);
  const composedData = composed.data?.target_doc_id === newDocId ? composed.data : null;
  const composedDoc = composedData && composedPatch?.base === composedData ? composedPatch.doc : composedData;
  const newRows: NewPaneRow[] = isComposedDoc ? (composedDoc ? buildComposedRows(composedDoc) : []) : written.filter((item) => item.target_doc_id === newDocId);
  // 엮은 문서의 칸 머리 옆 칸 제목 출처 - 이미 쓴 문서에는 칸 제목이 없다
  const headingNotes = isComposedDoc && composedDoc ? listHeadingNotes(composedDoc) : undefined;
  // 두 문서 사이 이음 - 저장된 출처와 고른 줄의 저장 전 고름
  const oldUnitIds = useMemo(() => new Set(oldView?.units.map((unit) => unit.id) ?? []), [oldView]);
  const linkPairs = buildLinkPairs(newRows.filter(isWrittenRow), oldUnitIds, draft.destination?.kind === "link" ? { units: rowUnits.map((unit) => ({ id: unit.unit_id, lang: unit.lang })), targetIds: draft.destination.targetIds } : null);

  const [view, setView] = useState(readAssignView);
  function changeView(patch: Partial<typeof view>) {
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
  if (row) aiMenuItems.push({ key: "split", label: t("ai.splitRow"), run: () => askAiScope("split", { unit_ids: row.unitIds }) });
  // 문서 전체 요청 두 가지 - 전에는 쪼개기 화면 용지 위 막대에만 있었다. 짝 제안은 한글·영어가 따로 적힌 문서에서만
  if (oldView) aiMenuItems.push({ key: "split-document", label: t("ai.askSplitShort"), run: () => askAiScope("split", { document_id: oldView.document.id }) });
  if (oldView?.document.language_layout === "ko_en_separate") aiMenuItems.push({ key: "pair-document", label: t("ai.askPairShort"), run: () => askAiScope("pair", { document_id: oldView.document.id }) });

  const [remarkEdit, setRemarkEdit] = useState<RemarkEdit | null>(null);
  // 목록에서 고를 때마다 늘어 결정 칸의 고른 곳 상자를 다시 그린다(그때만 잠깐 번쩍여 눈이 따라가게 - 줄을 옮길 때는 그대로)
  const [pickSeq, setPickSeq] = useState(0);
  const flightRef = useRef<FlightSource | null>(null);
  // Remark 창을 닫은 뒤 포커스를 둘 단추(testid) - 창이 여는 곳으로 되돌린 뒤에 옮겨 ↵가 바로 확정이 되게
  const focusAfterRef = useRef<string | null>(null);
  const [barEl, setBarEl] = useState<HTMLDivElement | null>(null);
  const [isBarCompact, setIsBarCompact] = useState(false);
  useEffect(() => {
    if (!barEl) return;
    const observer = new ResizeObserver(([entry]) => setIsBarCompact(entry.contentRect.width < BAR_COMPACT_BELOW));
    observer.observe(barEl);
    return () => observer.disconnect();
  }, [barEl]);
  const firstTextRef = useRef<HTMLTextAreaElement>(null);
  const [busy, setBusy] = useState(false);
  // 배정이 걸린 문장을 자르거나 합치려 할 때 - 서버가 409 confirm_required로 물으면 확인을 받아 배정을 풀며 다시 보낸다(원문 고치기와 같은 규칙, 설계 2026-11-15 §3.5)
  // 다시 보낼 일은 함수가 아니라 값으로 둔다 - 확인을 누른 그때의 화면 값(원문 보기·문서 판)으로 보내야 고친 뒤 새 줄을 따라간다
  const [editConfirm, setEditConfirm] = useState<{ count: number; retry: ConfirmedEdit } | null>(null);
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

  const saveUnits = rowUnits.map((unit) => ({ id: unit.unit_id, kind: unit.kind, lang: unit.lang, text: unit.text, revision: unit.decision.revision }));
  // 새 문장 칸 - AI가 나눈 문장은 칸 여럿, 합친 문장은 칸 하나다
  const slots = buildSentenceSlots(groupData, saveUnits, draft.otherLang ?? null);

  function scrollToUnit(unitId: number) {
    requestAnimationFrame(() => {
      const target = document.querySelector(`[data-testid="assign-paper-unit-${unitId}"]`);
      const pane = document.querySelector('[data-pane="old"] .pane-body');
      if (!target || !pane) return;
      const box = target.getBoundingClientRect();
      const frame = pane.getBoundingClientRect();
      if (shouldRecenter(box.top, box.bottom, frame.top, frame.bottom)) target.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
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
  // 떨어진 문장과 한/영 짝 맺기 - 메뉴에서 시작하면 다음에 누르는 문장이 짝이 된다(Esc로 거둔다). 문서를 바꾸면 버려진다.
  // 셋 이상이면 Shift+클릭으로 모으고(picked) 마지막 문장을 그냥 누르거나 줄의 단추로 맺는다
  const [pairFrom, setPairFrom] = useState<{ docId: number; unitId: number; picked: number[] } | null>(null);
  // 메뉴의 "참조 줄로 표시"로 번호 칸을 연 문장 - 제안도 확정도 없는 문장에 참조 카드를 띄운다
  const [refEntryId, setRefEntryId] = useState<number | null>(null);
  const pairSource = pairFrom !== null && pairFrom.docId === oldView?.document.id ? (paperModel?.units.get(pairFrom.unitId) ?? null) : null;

  function selectRow(key: string, scroll = true) {
    setMode("old");
    setCarvePick(null);
    setSelectedKey(key);
    setMenu(null);
    setCtxMenu(null);
    if (key !== activeKey) {
      setCutUnitId(null);
      setRefEntryId(null);
    }
    const first = rowMap.get(key)?.unitIds[0];
    if (scroll && first !== undefined) scrollToUnit(first);
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
    setSelectedKey(null);
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
    setCtxMenu({ seq: menuSeq.current, unitId, rowKey: SOLO_ROW_KEY, anchor, click, caret: null });
  }

  /** 이미 쓴 New 문서를 한 단으로 연다 - 고르던 줄을 놓고 그 문서의 원문을 넓게 보인다 */
  function openSolo(docId: number) {
    setMode("old");
    setSelectedKey(null);
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

  /** 편집·되돌리기 뒤 그 문장으로 - 다시 받은 뒤에 고른다(Old 문서면 그 문장의 줄, 한 단의 New 문서면 그 문장) */
  function followUnit(unitId: number) {
    if (hasSolo) setSoloFollow({ unitId, stale: soloLoad.data });
    else setFollow({ unitId, staleViews: viewList, staleUnits: units.data });
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
    if (key !== undefined) selectRow(key);
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
    const next = stepInList(rows.map((item) => item.key), listKeys, activeKey, step);
    if (next !== null) selectRow(next);
  }

  // --- Old 문장 고치기(우클릭 메뉴·두 번 누르기) - Split의 편집을 그대로 부른다. 판단이 없는 문장만(모델이 막는다) ---
  /** 단위(칸 문장이면 묶인 표·행)의 줄 키 */
  function findRowKey(unitId: number): string | undefined {
    const groupId = paperModel?.units.get(unitId)?.group_unit_id ?? null;
    return rowOfUnit.get(unitId) ?? (groupId !== null ? rowOfUnit.get(groupId) : undefined);
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
  // 우클릭한 것이 든 표(또는 행) 단위 - 칸 문장이면 묶인 표·행, 표·행을 직접 눌렀으면 그 단위
  /** 그 단위가 든 표(또는 행) 단위 - 칸 문장이면 묶인 표·행, 표·행이면 그 단위 */
  function findTableOf(target: ViewUnit | null): ViewUnit | null {
    if (!target || !shapeModel) return null;
    const holder = target.kind === "table" || target.kind === "table_row" ? target : target.group_unit_id !== null ? (shapeModel.units.get(target.group_unit_id) ?? null) : null;
    return holder !== null && (holder.kind === "table" || holder.kind === "table_row") ? holder : null;
  }

  /** 그 단위에 할 수 있는 일과 못 하는 까닭 - 우클릭 메뉴와 오른쪽 칸의 다듬기 줄이 같은 답을 쓴다 */
  function buildUnitMenu(target: ViewUnit): AssignMenuGroups | null {
    if (!shapeTabs || !shapeModel) return null;
    const order = shapeTabs.order;
    const at = order.indexOf(target.id);
    const neighbor = (step: number) => (at < 0 ? null : (shapeModel.units.get(order[at + step]) ?? null));
    const table = findTableOf(target);
    const groups = buildAssignMenu({
      target,
      prev: neighbor(-1),
      next: neighbor(1),
      readOnly: !canEdit,
      rowStatus: row?.status ?? "unassigned",
      hasDestination: destination !== null,
      isConfirmedAsIs: row?.status === "confirmed" && !hasDraftChange(draft),
      isDecided: isUnitDecided,
      hasDraft: hasUnitDraft,
      canSplit: findNearestCut(target, Math.floor(target.text.length / 2)) !== null,
      table,
      tableRows: table?.kind === "table_row" ? [...shapeModel.units.values()].filter((unit) => unit.kind === "table_row" && unit.table_id === table.table_id) : [],
    });
    // 양 단의 New 칸에서는 떨어진 문장을 눌러 짝 맺는 길이 없다(그 칸의 누르기는 고르기다) - 그 일은 한 단으로 열어서 한다
    return isNewEdit ? { ...groups, edit: groups.edit.filter((item) => item.action !== "pair_pick") } : groups;
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
  // 오른쪽 칸 1번(다듬기) - 고른 줄의 문장마다 할 수 있는 일. 우클릭 메뉴와 같은 답이다. 고칠 수 없는 사람에게는 줄을 보이지 않는다
  const shapeLines: ShapeLine[] = canEdit && mode === "old" ? rowViewUnits.flatMap((unit) => { const menu = buildUnitMenu(unit); return menu ? [{ unit, items: menu.edit }] : []; }) : [];
  // 고른 줄이 한/영 짝이거나 합친 한 문장이면 둘 사이를 바꾸는 전환을 다듬기에 둔다
  const shapeMode = shapeLines.length > 0 ? planShapeMode(rowViewUnits, shapeTabs?.order ?? [], hasUnitDraft) : null;
  const stepBase = shapeLines.length > 0 ? 1 : 0;
  const refPendingIds = (shapeTabs?.order ?? []).filter((id) => isRefPending(shapeModel?.units.get(id)) && (hasSolo || rowOfUnit.has(id)));
  // 그 줄의 번호에 대한 EQUIS 표시와 새 문장에 쓸 제안 - 참조 카드와 결정 칸의 새 문장이 같은 답을 쓴다. 조회가 도는 동안은 조금 뒤 다시 읽는다
  const rowRefMark = rowRefUnit?.ref ?? null;
  const refDetail = useLoaded<UnitRefDetail | null>(
    () => (rowRefUnit !== null && rowRefMark !== null && shapeView !== null ? getUnitRef(bundleId, shapeView.document.id, rowRefUnit.id) : Promise.resolve(null)),
    `${shapeView?.document.id ?? ""}:${rowRefUnit?.id ?? ""}:${rowRefMark?.state ?? ""}:${rowRefMark?.number ?? ""}`,
  );
  // 앞서 고른 줄의 답이 남아 있을 수 있다 - 이 줄의 이 번호에 대한 답만 쓴다
  const refInfo = !refDetail.isLoading && rowRefMark !== null && refDetail.data?.number === rowRefMark.number ? refDetail.data : null;
  useEquisPolling(refInfo?.equis?.refreshing === true, refDetail.reload);
  // 메뉴를 연 뒤 편집으로 그 문장이 사라졌으면 닫는다(렌더 중 상태 맞추기)
  if (ctxMenu !== null && shapeModel !== null && ctxTarget === null) setCtxMenu(null);

  /** 우클릭(또는 메뉴 글쇠) - 그 문장의 줄을 고르고 줄 상자 옆에 메뉴를 연다 */
  function openCtxMenu(unitId: number, click: { x: number; y: number } | null, caret: { blockId: number; offset: number } | null) {
    if (mode !== "old") return;
    const key = isSolo ? SOLO_ROW_KEY : findRowKey(unitId);
    const anchor = document.querySelector<HTMLElement>(`[data-testid="assign-paper-piece-${unitId}"]`) ?? document.querySelector<HTMLElement>(`[data-testid="assign-paper-unit-${unitId}"]`);
    if (!key || !anchor) return;
    if (isSolo) selectSolo(unitId);
    else if (key !== activeKey) selectRow(key, false);
    setChecked(new Set());
    setMenu(null);
    menuSeq.current += 1;
    setCtxMenu({ seq: menuSeq.current, unitId, rowKey: key, anchor, click, caret });
  }

  /** 서버가 "판단이 걸린 단위를 바꾼다"고 물었으면 그 단위 수 - 다른 오류면 null */
  function readConfirmCount(err: unknown): number | null {
    const unitIds = err instanceof ApiError && err.rule?.code === "confirm_required" ? err.rule.unit_ids : null;
    return Array.isArray(unitIds) ? unitIds.length : null;
  }

  /** 편집 뒤 - 원문 보기·단위·Bundle을 다시 받는다 */
  function reloadAfterEdit() {
    if (solo !== null) setSoloKey((key) => key + 1);
    views.reload();
    setUnitsKey((key) => key + 1);
    void loadBundle(bundleId);
  }

  /** 편집 한 번 - 끝나면 원문 보기·단위를 다시 받고 followId(없으면 새로 생긴 첫 단위)의 줄을 고른다. confirm은 확인 창에서 다시 보낼 때만 켠다 */
  async function runUnitEdit(op: EditOp, okText: string, followId: number | null, confirm = false) {
    if (!shapeView || busy) return;
    setBusy(true);
    let isAsking = false;
    try {
      // 자르기·합치기·언어 바꾸기 모두 Assign 기록에 넣는다(설계 §4.4) - 서버는 Split 편집 기록 번호만 가리킨다
      const undo = buildUndo({ focus_unit_id: op.type === "split" ? op.unit_id : (followId ?? undefined) });
      const result = await editUnits(bundleId, shapeView.document.id, shapeView.document.revision, op, confirm, undo);
      // 문서가 바뀌지 않은 편집(참조 제안 물리기)은 서버도 단계를 남기지 않는다
      if (result.document_revision !== shapeView.document.revision) markRecorded();
      setRefEntryId(null);
      cutLine.clear();
      setCutUnitId(null);
      // 고친 줄의 Unit은 은퇴했을 수 있다 - 다시 받는 동안 그 Unit의 묶음·후보를 부르지 않게 고름을 비우고, 새 줄이 생기면 follow가 고른다
      setSelectedKey(null);
      showToast(okText);
      const next = result.created_unit_ids[0] ?? followId;
      if (next !== null && next !== undefined) followUnit(next);
    } catch (err) {
      // 판단이 걸린 단위를 바꾸는 편집은 한 번 묻는다 - 확인하면 배정을 풀며 다시 보낸다
      const count = readConfirmCount(err);
      isAsking = count !== null && !confirm;
      if (count !== null && !confirm) setEditConfirm({ count, retry: { kind: "edit", op, okText, followId } });
      else showToast(humanizeApiError(err, t), "error");
    } finally {
      // 되묻는 동안은 다시 받지 않는다 - 바뀐 것이 없고, 늦게 닿은 응답이 확인 뒤의 편집과 엇갈리면 새 줄을 따라가지 못한다
      if (!isAsking) reloadAfterEdit();
      setBusy(false);
    }
  }

  /** 한/영 짝을 맺거나 푼다 - 편집 기록(되돌리기)에는 들어가지 않는다. 반대 동작이 같은 메뉴에 있다 */
  async function runPairChange(write: (docId: number, revision: number) => Promise<unknown>, okText: string, followId: number) {
    if (!shapeView || busy) return;
    setBusy(true);
    try {
      await write(shapeView.document.id, shapeView.document.revision);
      // 짝이 바뀌면 줄이 다시 묶인다 - 다시 받는 동안 옛 줄을 부르지 않게 고름을 비우고, 받은 뒤 그 문장의 줄을 고른다
      setSelectedKey(null);
      showToast(okText);
      followUnit(followId);
    } catch (err) {
      const isLinked = err instanceof ApiError && err.rule?.code === "confirm_required";
      showToast(isLinked ? t("assign.ctx.why.assigned") : humanizeApiError(err, t), "error");
    } finally {
      reloadAfterEdit();
      setBusy(false);
    }
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
    if (!shapeView || busy) return;
    setBusy(true);
    const docId = shapeView.document.id;
    let restoredIds: number[] | null = null;
    let isAsking = false;
    try {
      const undone = await editUnits(bundleId, docId, shapeView.document.revision, { type: "unmerge", unit_id: unit.id }, confirm, buildUndo({ focus_unit_id: unit.id }));
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
        // 풀린 뒤로는 옛 단위가 없다 - 고름을 비우고, 다시 받은 뒤 되살아난 첫 문장의 줄을 고른다
        setRefEntryId(null);
        cutLine.clear();
        setCutUnitId(null);
        setSelectedKey(null);
        if (restoredIds.length > 0) followUnit(restoredIds[0]);
      }
      if (!isAsking) reloadAfterEdit();
      setBusy(false);
    }
  }

  /** AI 나누기 제안 적용 - 뒤쪽 위치부터 자르면 앞 조각의 위치가 바뀌지 않는다. 자를 때마다 되돌리기 기록에 한 단계씩 남는다 */
  async function applySplitSuggestion(unit: ViewUnit, suggestion: AiSuggestion, confirm = false) {
    if (!oldView || busy) return;
    setBusy(true);
    let isAsking = false;
    try {
      let unitId = unit.id;
      let revision = oldView.document.revision;
      for (const at of readSplitOffsets(suggestion.content.offsets).sort((a, b) => b - a)) {
        const result = await editUnits(bundleId, oldView.document.id, revision, { type: "split", unit_id: unitId, at }, confirm, buildUndo({ focus_unit_id: unitId }));
        revision = result.document_revision;
        unitId = result.created_unit_ids[0] ?? unitId;
      }
      await setSuggestionAdoption(bundleId, suggestion.id, "as_is");
      markRecorded();
      cutLine.clear();
      setCutUnitId(null);
      setSelectedKey(null);
      showToast(t("split.didSplit"));
      followUnit(unitId);
    } catch (err) {
      // 첫 자르기에서 묻는다(배정이 걸린 것은 자르기 전의 그 문장이다) - 확인하면 처음부터 다시 자른다
      const count = readConfirmCount(err);
      isAsking = count !== null && !confirm;
      if (count !== null && !confirm) setEditConfirm({ count, retry: { kind: "ai_split", unit, suggestion } });
      else showToast(humanizeApiError(err, t), "error");
    } finally {
      if (!isAsking) reloadAfterEdit();
      setBusy(false);
    }
  }

  async function dismissSplitSuggestion(suggestion: AiSuggestion) {
    if (busy) return;
    setBusy(true);
    try {
      await setSuggestionAdoption(bundleId, suggestion.id, "rejected");
    } catch (err) {
      showToast(humanizeApiError(err, t), "error");
    } finally {
      // 용지의 제안 표시는 문서 보기에서 온다
      if (solo !== null) setSoloKey((key) => key + 1);
      views.reload();
      setUnitsKey((key) => key + 1);
      setBusy(false);
    }
  }

  /** 다음 나누기 제안이 붙은 줄로 - 용지 순서로 지금 줄 다음, 끝이면 처음으로 돈다 */
  function selectNextSplit() {
    const ids = (paperTabs?.order ?? []).filter((id) => splitByUnit.has(id) && (hasSolo || rowOfUnit.has(id)));
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

  function splitAtCut() {
    if (!cutUnit || cutLine.at === null) return;
    void runUnitEdit({ type: "split", unit_id: cutUnit.id, at: cutLine.at }, t("split.didSplit"), null);
  }

  /** 두 번 누른 자리에 나눌 선 - 메뉴의 "Split here"를 쓸 수 있는 문장만 */
  function handleOldDoubleClick(unitId: number, caret: { blockId: number; offset: number } | null) {
    const unit = paperModel?.units.get(unitId);
    if (!unit || !canEdit || mode !== "old" || hasUnitDraft(unit) || !["sentence", "heading", "cell_sentence"].includes(unit.kind)) return;
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
    if (action === "confirm") handlePrimary();
    else if (action === "clear") void runClear();
    else if (action === "ref_mark") setRefEntryId(target.id);
    else if (action === "ref_clear") void runUnitEdit({ type: "clear_ref", unit_id: target.id }, t("assign.ref.didReject"), target.id);
    else if (action === "split") {
      // 이미 그 문장에 선이 있으면 바로 나누고, 없으면 누른 자리(키보드면 가운데) 가까이에 선을 놓는다 - 끌거나 ←→로 옮긴 뒤 Split here
      if (cutUnit?.id === target.id && cutLine.at !== null) splitAtCut();
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
      void runPairChange((docId, revision) => createPair(bundleId, docId, revision, [target.id, other]), t("split.didJoin"), target.id);
    } else if (action === "pair_pick") {
      if (!oldView || isNewEdit) return;
      clearCarve();
      setPairFrom({ docId: oldView.document.id, unitId: target.id, picked: [] });
    } else if (action === "unpair") {
      const pairId = target.pair_id;
      if (pairId !== null) void runPairChange((docId, revision) => deletePair(bundleId, docId, pairId, revision), t("split.pairRemoved"), target.id);
    } else if (action === "table_rows" && table) void runUnitEdit({ type: "split_table_rows", table_unit_id: table.id }, t("split.didSplit"), null);
    else if (action === "table_merge" && table && table.table_id !== null) void runUnitEdit({ type: "merge_table_rows", table_id: table.table_id }, t("split.didMerge"), null);
    else if (action === "table_layout" && table && table.table_id !== null) void runUnitEdit({ type: "set_layout_table", table_id: table.table_id, is_layout: true }, t("common.saved"), null);
    else if (action === "lang" && lang) void runUnitEdit({ type: "set_language", unit_ids: [target.id], lang }, t("common.saved"), target.id);
  }

  /** 조각 사이의 붙이기 단추가 할 일 - 같은 언어면 합치기, 한글·영어면 짝(원문 고치기와 같은 규칙에 Assign의 막는 까닭을 더한다) */
  function planOldJoin(firstId: number, secondId: number): JoinPlan {
    return planAssignJoin(paperModel?.units.get(firstId), paperModel?.units.get(secondId), { isDecided: isUnitDecided, hasDraft: hasUnitDraft });
  }

  function joinOld(firstId: number, secondId: number, kind: JoinKind) {
    if (kind === "merge") void runUnitEdit({ type: "merge", unit_ids: [firstId, secondId] }, t("split.didMerge"), null);
    else void runPairChange((docId, revision) => createPair(bundleId, docId, revision, [firstId, secondId]), t("split.didJoin"), firstId);
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
      if (!unit || (unit.kind !== "table" && unit.kind !== "table_row") || unit.table_id === null) continue;
      const table = source.tables.find((item) => item.id === unit.table_id);
      // 행 단위("행으로 나누기")는 그 행 하나짜리 표이고 칸 자리는 그 행 기준이다 - 서버 칸 자리 검사(원문 칸 블록 좌표)와 같다
      const isRow = unit.kind === "table_row";
      const firstRow = isRow ? (unit.row_index ?? 0) : 0;
      const cells = source.units
        .filter((item) => item.group_unit_id === unit.id && item.kind === "cell_sentence")
        .map((item) => {
          const block = source.blocks.find((candidate) => candidate.id === item.block_id);
          return { id: item.id, lang: item.lang, text: item.text, row: (block?.row_index ?? item.row_index ?? 0) - firstRow, col: block?.col_index ?? 0 };
        });
      tables.set(unit.id, { rows: isRow ? 1 : (table?.n_rows ?? 1), cols: table?.n_cols ?? 1, cells });
    }
    return tables;
  }

  /**
   * 묶음 저장 응답의 짝 정리를 화면에 반영한다 - 짝은 서버가 같은 저장 안에서 확정하거나 푼다(제품 명세 §6.5).
   * 푼 짝이 있을 때만 원문 보기를 다시 받는다 - 줄은 보기의 짝에서 나온다. 확정만 됐으면 줄이 그대로이고 이 화면은 짝 상태도 문서 revision도 쓰지 않는다.
   * 이 줄의 짝이 풀렸으면 거르기 자리의 짝 줄을 풀린 줄들로 바꾸고 true - 남은 문장이 목록에서 사라지지 않게.
   */
  function applyPairSettle(savedRow: ClassifyRow, saved: Group, leftovers: number[]): boolean {
    const dissolved = saved.pairs_dissolved ?? [];
    if (dissolved.length > 0) views.reload();
    if (savedRow.pairId === null || !dissolved.includes(savedRow.pairId)) return false;
    setSnapshot((prev) => prev && { ...prev, keys: prev.keys.flatMap((key) => (key === savedRow.key ? listUnpairedKeys(savedRow) : [key])) });
    const ids = leftovers.map((id) => unitMap.get(id)?.display_id ?? String(id)).join(", ");
    showToast(leftovers.length > 0 ? t("assign.leftover.split", { ids }) : t("assign.pairDissolved"));
    return true;
  }

  /** 이 저장에 사유가 꼭 있어야 하는 까닭 - 없으면 null */
  function readReasonNeed(action: "confirm" | "hold"): "delete" | "move" | "hold" | "duplicate" | null {
    if (action === "hold") return "hold";
    if (destination?.kind === "delete" || destination?.kind === "move") return destination.kind;
    return new Set(linkIds.map((id) => writtenMap.get(id)?.target_doc_id)).size > 1 ? "duplicate" : null;
  }

  /** reasonOverride는 Remark 창에서 방금 확인한 사유 - 초안 상태가 아직 반영되기 전이라 직접 넘긴다 */
  async function runSave(action: "confirm" | "hold", reasonOverride?: string) {
    // 보낼 곳 없이는 보류만 된다(처분 unassigned + hold, 사유는 hold_reason)
    if (!row || busy || groupPending || pickedGroups.isLoading || (!destination && action !== "hold")) return;
    if (action === "confirm" && isRefGate) {
      // 참조 줄 제안이 남았다 - 결정 전에 번호만 확인한다(오른쪽 칸 맨 위 카드). ↵·메뉴·사유 창 뒤 확정이 모두 여기를 지난다
      showToast(t("assign.ref.checkFirst"), "error");
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
    setBusy(true);
    try {
      // 고친 칸만 글을 보낸다 - 손대지 않은 AI 제안은 글·종류를 비워 보내 제안 그대로 받는다
      const context = { units: saveUnits, group: saveGroupData, tables: buildTables() };
      const body = buildGroupSave({ ...draft, destination, reason, moveCode }, context, action, action === "hold" ? reason.trim() : "");
      const leftovers = body.release_unit_ids ?? [];
      const op = pickSaveOp({ action, destinationKind: destination?.kind ?? null, savedLinkIds: savedDestination?.kind === "link" ? savedDestination.targetIds : [], nextLinkIds: linkIds });
      const saved = await saveGroup(bundleId, body, buildUndo({ op, focus_unit_id: row.unitIds[0] }));
      markRecorded();
      // 저장했으면 메뉴의 고름은 끝났다 - 다음 줄이 없거나 같은 줄에 남아도 닫는다
      setMenu(null);
      showToast(action === "hold" ? t("classify.held") : t("classify.confirmed"));
      const isSplit = applyPairSettle(row, saved, leftovers) && leftovers.length > 0;
      // 다음 미확정 줄로 - 지금 줄은 거르기 자리에 남는다. 남는 쪽을 풀었으면 남은 문장의 줄이 다음이다
      const next = action === "confirm" && !isSplit ? findNextOpen(listKeys, rowMap, row.key) : null;
      if (action === "confirm") showSent(row, saved, next ?? row.key);
      dropDraft(row.key);
      if (isSplit) setSplitRow({ from: row.key, unit: leftovers[0] });
      if (next) selectRow(next);
      setUnitsKey((key) => key + 1);
      void loadBundle(bundleId);
    } catch (err) {
      showToast(humanizeApiError(err, t), "error");
      setUnitsKey((key) => key + 1);
    } finally {
      setBusy(false);
    }
  }

  /**
   * 확정한 곳을 오른쪽 칸에 바로 보인다 - 그 문서로 옮기고(다음 줄에서도, 손으로 고른 문서가 없을 때), 엮은 문서면 저장 응답으로 칸에 미리 넣는다.
   * 그 문장이 그려지면 NewPane이 화면에 들이고, 잇는 선은 진하게 그린다
   */
  function showSent(savedRow: ClassifyRow, saved: Group, nextKey: string) {
    const docId = destination?.kind === "slot" || destination?.kind === "step" ? destination.docId : destination?.kind === "link" ? (writtenMap.get(destination.targetIds[0])?.target_doc_id ?? null) : null;
    if (docId === null || !destination) return;
    const isMine = (target: Group["targets"][number]) => target.source_unit_ids.some((id) => savedRow.unitIds.includes(id)) || (target.translation_source_unit_id !== null && savedRow.unitIds.includes(target.translation_source_unit_id));
    const targetIds = destination.kind === "link" ? destination.targetIds : saved.targets.filter((target) => target.target_doc_id === docId && target.parent_target_id === null && isMine(target)).map((target) => target.id);
    setLiveNew((prev) => ({ key: nextKey, docId, targetIds, seq: (prev?.seq ?? 0) + 1 }));
    if (composed.data?.target_doc_id === docId) {
      const textOf = (unitIds: number[]) => unitIds.map((id) => unitMap.get(id)?.text ?? "").join(" ");
      // 앞 저장의 미리 고침 위에 얹는다 - 다시 읽기가 오기 전에 연달아 확정해도 앞 문장이 빠지지 않게
      setComposedPatch({ base: composed.data, doc: applySavedTargets(composedDoc ?? composed.data, saved.targets, textOf) });
    }
  }

  async function runClear() {
    if (!row || busy) return;
    const decided = rowUnits.filter((unit) => unit.decision.disposition !== "unassigned" || unit.status !== "unassigned");
    if (decided.length === 0) return;
    setBusy(true);
    try {
      await clearDecisions(bundleId, decided.map((unit) => ({ unit_id: unit.unit_id, revision: unit.decision.revision })), buildUndo({ step_key: genId(), focus_unit_id: row.unitIds[0] }));
      markRecorded();
      // 엮은 문서에서 그 문장을 바로 뺀다 - 오른쪽 칸은 그 문서에 머물러(배정이 없어져 저절로 다른 문서로 가지 않게) 접히며 사라지는 것이 보이고, 다시 읽은 값이 맞춘다
      if (composed.data && isComposedDoc && newDocId !== null) {
        const docId = newDocId;
        setLiveNew((prev) => ({ key: toggleKey, docId, targetIds: [], seq: (prev?.seq ?? 0) + 1 }));
        setComposedPatch({ base: composed.data, doc: removeClearedUnits(composedDoc ?? composed.data, new Set(row.unitIds)) });
      }
      setMenu(null);
      showToast(t("classify.cleared"));
      dropDraft(row.key);
      setUnitsKey((key) => key + 1);
      void loadBundle(bundleId);
    } catch (err) {
      showToast(humanizeApiError(err, t), "error");
      setUnitsKey((key) => key + 1);
    } finally {
      setBusy(false);
    }
  }

  async function run(action: () => Promise<unknown>, message: string) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      showToast(message);
      setUnitsKey((key) => key + 1);
      void loadBundle(bundleId);
    } catch (err) {
      showToast(humanizeApiError(err, t), "error");
      setUnitsKey((key) => key + 1);
    } finally {
      setBusy(false);
    }
  }

  /** 되돌리기·다시 하기 - 다시 받은 뒤 그 단계의 줄(없으면 New 문장)을 고른다. 거절은 기록을 그대로 두고 이유만 알린다 */
  async function runUndoStep(kind: "undo" | "redo") {
    if (busy || !canEdit) return;
    setBusy(true);
    try {
      const result = await (kind === "undo" ? undoDecision : redoDecision)(bundleId, undoSession.current);
      setUndoState({ canUndo: result.can_undo, canRedo: result.can_redo });
      setMenu(null);
      setCtxMenu(null);
      setChecked(new Set());
      // 되돌린 줄의 초안은 바뀌기 전 판단 위의 고름이다
      for (const key of new Set(result.unit_ids.map((id) => rowOfUnit.get(id)).filter((key) => key !== undefined))) dropDraft(key);
      // 자르기·표 행 나누기(합치기)를 거꾸로 하면 Unit이 은퇴할 수 있다 - 다시 받는 동안 그 줄의 묶음·후보를 부르지 않게 고름을 비운다
      if (RETIRING_OPS.has(result.op)) {
        cutLine.clear();
        setCutUnitId(null);
        setSelectedKey(null);
      }
      if (mode === "unsourced" && result.focus_target_id !== null) setSelNew(result.focus_target_id);
      else if (result.focus_unit_id !== null) followUnit(result.focus_unit_id);
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
      // 거절도 그 사이 바뀐 것이 있다는 뜻이라 다시 받는다 - 짝 모양이 바뀌었을 수 있어 원문 보기도
      reloadAfterEdit();
      setBusy(false);
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
        views.reload();
      }, t("match.identicalDone", { n: items.length }));
    }
    setConfirmingIdentical(false);
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
    if (!sourceRow || !target || busy || !canEdit) return;
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
        units: sourceUnits.map((unit) => ({ id: unit.unit_id, kind: unit.kind, lang: unit.lang, text: unit.text, revision: unit.decision.revision })),
        group: mergeGroups([rowGroup, ...extra]),
        tables: new Map(),
      };
      const body = buildGroupSave({ destination: link, texts: {}, changeTypes: {}, linkChangeTypes: {}, reason: readHumanReason(sourceUnits[0]?.decision), moveCode: "" }, context, "confirm");
      // 이 문장에 없는 언어의 Old 문장은 서버가 짝을 풀어 제 줄로 남긴다 - 출처 없는 New를 계속 보게 고른 줄은 옮기지 않는다
      const saved = await saveGroup(bundleId, body, buildUndo({ op: "link_source", focus_unit_id: unitId, focus_target_id: target.target_id }));
      markRecorded();
      applyPairSettle(sourceRow, saved, body.release_unit_ids ?? []);
    }, t("match.linked"));
  }

  /** 보낼 곳 한 줄을 더하거나 지운다 - 응답의 새 목록을 바로 쓰고, 묶음 revision이 올랐으니 묶음도 다시 읽는다 */
  async function writePlace(write: () => Promise<ToBe>, okText: string): Promise<ToBe | null> {
    if (isPlaceBusy) return null;
    setIsPlaceBusy(true);
    try {
      const next = await write();
      setTobeFresh({ key: dataKey, data: next });
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

  function pickDestination(next: Destination) {
    const linkTypes: Record<number, ChangeTypeInput | null> = {};
    // AI가 이어 둔 문장을 다시 고르면 기본은 제안 그대로 받기
    if (next.kind === "link") for (const id of next.targetIds) if (writtenMap.get(id)?.status === "ai_suggested") linkTypes[id] = null;
    setDraft({ destination: next.kind === "link" ? { kind: "link", targetIds: addPartnerTargets(next.targetIds, writtenMap) } : next, linkChangeTypes: linkTypes });
    setPickSeq((seq) => seq + 1);
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
    else if (isRemoving) {
      setDraft({ destination: { kind: "link", targetIds: next } });
      setPickSeq((seq) => seq + 1);
    } else pickDestination({ kind: "link", targetIds: next });
    return next.length > 0;
  }

  /** New 원문의 줄을 누름 - 이미 확정해 이은 문장이면 고름을 바꾸지 않고 끊기 메뉴를, 아니면 고른 뒤 확정 메뉴를 그 자리에 띄운다 */
  function handleNewPick(targetId: number, additive: boolean, anchor: HTMLElement, event: MouseEvent) {
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

  /** Old 조각 아래 "→ 간 곳"을 누름 - 그 줄을 고르고 New 문서(닫혀 있거나 다른 문서면 열어서)의 그 문장으로 간다 */
  function jumpToNew(unitId: number, targetId: number) {
    const key = rowOfUnit.get(unitId);
    const docId = writtenMap.get(targetId)?.target_doc_id;
    if (!key || docId === undefined) return;
    setMode("old");
    setSelectedKey(key);
    setChecked(new Set());
    setMenu(null);
    setManualNewDoc({ key, docId });
    // New 칸의 그 문장으로 가는 길이라 한 단이면 양 단으로 편다
    if (view.single) changeView({ single: false });
    setJump({ side: "new", id: targetId, targetId, rowKey: key });
  }

  /** Old 조각의 연결 배지를 누름 - 고름·메뉴는 그대로 두고 오른쪽 칸을 그 문장으로 보내 번쩍이게만 한다 */
  function showInNew(targetId: number) {
    const docId = writtenMap.get(targetId)?.target_doc_id;
    if (docId !== undefined) setManualNewDoc({ key: toggleKey, docId });
    if (view.single) changeView({ single: false });
    setJump({ side: "new", id: targetId, targetId, rowKey: "", quiet: true });
  }

  /** New 문장의 "← 출처" 칩을 누름 - 그 출처 줄을 고르고(다른 Old 문서면 그 문서로) Old의 그 조각으로 간다 */
  function jumpToOld(unitId: number, targetId: number) {
    const key = rowOfUnit.get(unitId);
    const docId = writtenMap.get(targetId)?.target_doc_id;
    if (!key) return;
    setMode("old");
    setSelectedKey(key);
    setChecked(new Set());
    setMenu(null);
    // 지금 보던 New 문서를 그대로 둔다 - 줄이 바뀌어도 이 문장 옆에서 이어 보게
    if (docId !== undefined) setManualNewDoc({ key, docId });
    setJump({ side: "old", id: unitId, targetId, rowKey: key });
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
      if (!jump.quiet) openMenu(el, null, jump.rowKey, jump.targetId);
      setJump(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [jump]);

  /** 짝 고르기를 맺는다 - 처음 문장과 고른 문장들이 한 짝이 된다. 맺을 수 없으면 까닭을 알리고 고르던 것을 그대로 둔다 */
  function finishPairPick(pickedIds: number[]) {
    if (!pairSource || pickedIds.length === 0) return;
    const others = pickedIds.map((id) => paperModel?.units.get(id)).filter((unit): unit is ViewUnit => unit !== undefined);
    const blocker = others.map((unit) => getPairPickBlocker(unit, { isDecided: isUnitDecided, hasDraft: hasUnitDraft })).find((reason) => reason !== null) ?? getPairSetBlocker([pairSource, ...others]);
    if (blocker !== null) {
      showToast(t(blocker), "error");
      return;
    }
    const unitIds = [pairSource.id, ...others.map((unit) => unit.id)];
    setPairFrom(null);
    void runPairChange((docId, revision) => createPair(bundleId, docId, revision, unitIds), t("split.didJoin"), unitIds[0]);
  }

  function handleOldClick(unitId: number, keys: { shiftKey: boolean }) {
    if (mode === "unsourced") {
      void linkAsSource(unitId);
      return;
    }
    if (pairSource && pairFrom) {
      const other = paperModel?.units.get(unitId);
      if (!other || other.id === pairSource.id) return;
      const { picked } = pairFrom;
      if (!keys.shiftKey) {
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
      return;
    }
    if (isSolo) {
      selectSolo(unitId);
      return;
    }
    const key = rowOfUnit.get(unitId);
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
    selectRow(key, false);
  }

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
      openCtxMenu(cutUnit?.id ?? row.unitIds[0], null, null);
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
    if ((event.key === "Enter" || event.key === " ") && event.target instanceof HTMLElement && event.target.closest("button, a, [role='option']")) return;
    // 세로선에 포커스가 있으면 ←→는 폭이다
    if (event.target instanceof HTMLElement && event.target.closest(".pane-divider")) return;
    const key = event.key.toLowerCase();
    const step = getRowStep(key);
    if (step !== null) moveRow(step);
    else if (key === "escape") {
      // 나눌 선이 있으면 선부터 거둔다(Split과 같다)
      if (cutLine.at !== null) cutLine.clear();
      else if (isNewEdit) setSolo(null);
      else setChecked(new Set());
    } else if (key === "v") changeView({ single: !view.single });
    else if (key === "s" && canEdit && hasSolo && cutLine.at !== null) splitAtCut();
    else if ((key === "arrowleft" || key === "arrowright") && canEdit && isNewEdit && cutLine.at !== null) cutLine.nudge(key === "arrowleft" ? -1 : 1);
    else if (!canEdit || !row) return;
    else if (key === "s" && cutLine.at !== null) splitAtCut();
    else if (key === "enter") handlePrimary();
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
      setSelectedKey(null);
      if (!view.single) changeView({ single: true });
    }
    router.replace(getStageHref(bundleId, "assign"), { scroll: false });
  });
  const hasDocs = docs.data !== null;
  useEffect(() => {
    if (editParam !== null && hasDocs) openEditParam(editParam);
  }, [editParam, hasDocs]);

  // New 원문은 고른 문장(없으면 후보)이 보이게 - 줄을 바꾸거나 고를 때
  // 엮은 문서는 고른 줄이 들어간 문장(그 문서의 후보·이음은 없다)
  const composedFocusId = isComposedDoc ? (newRows.filter(isWrittenRow).find((item) => item.source_unit_ids.some((id) => row?.unitIds.includes(id)))?.target_id ?? null) : null;
  const newFocusId = mode === "unsourced" ? focusNew : isComposedDoc ? composedFocusId : (linkIds[0] ?? [...candidateIds][0] ?? null);
  useEffect(() => {
    if (newFocusId === null || newDocId === null) return;
    const frame = requestAnimationFrame(() => document.querySelector(`[data-testid="assign-new-${newFocusId}"]`)?.scrollIntoView({ block: "nearest" }));
    return () => cancelAnimationFrame(frame);
  }, [newFocusId, newDocId]);

  // 고르면 결정 칸의 고른 곳 상자가 보이게 한 뒤(결정 칸이 제 안에서 스크롤되어 있어도) 시선을 그리로 끈다 -
  // 위 목록을 마우스로 눌렀으면 그 항목이 상자로 날아가고, 키보드·New 원문·메뉴로 골랐으면 상자 번쩍임만
  useEffect(() => {
    if (pickSeq === 0) return;
    const source = flightRef.current;
    flightRef.current = null;
    const frame = requestAnimationFrame(() => {
      const box = document.querySelector<HTMLElement>('[data-testid="assign-chosen"]');
      if (!box) return;
      box.scrollIntoView({ block: "nearest" });
      runPickFlight(box, source);
    });
    return () => cancelAnimationFrame(frame);
  }, [pickSeq]);

  /** 위 목록의 마우스 클릭을 고름보다 먼저 잰다(캡처) - 날릴 그림자의 출발 자리. 키보드로 누른 클릭(detail 0)은 날리지 않는다 */
  function handlePickClickCapture(event: MouseEvent<HTMLDivElement>) {
    const item = event.target instanceof Element ? event.target.closest<HTMLElement>(".dest-card, .tree-leaf") : null;
    flightRef.current = item && event.detail > 0 ? { rect: item.getBoundingClientRect(), text: item.innerText, at: performance.now() } : null;
  }

  // Remark 창이 닫히고(창을 거친 저장이면 저장이 끝난 뒤) 확정 단추로 포커스 - 꺼진 단추면 창이 되돌린 자리 그대로
  useEffect(() => {
    const testId = focusAfterRef.current;
    if (testId === null || remarkEdit !== null || busy) return;
    focusAfterRef.current = null;
    const button = document.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
    if (button && !button.disabled) button.focus({ preventScroll: true });
  }, [remarkEdit, busy]);

  // --- 그리기 ---
  const isPlace = destination?.kind === "slot" || destination?.kind === "step";
  const primaryState = !destination ? "choose" : editing ? "save" : "confirm";
  // 줄에 이미 그 언어 새 문장이 있으면(직접 쓴 것·쓰는 중인 칸·AI 번역) 만들기·쓰기를 보이지 않는다
  const missingLang = canMakeOtherLanguage(rowLangs, savedDestination, row?.status === "confirmed");
  const otherLang = missingLang !== null && !hasRowLanguage(missingLang, slots, groupData, row?.unitIds ?? []) ? missingLang : null;
  // 직접 쓰는 다른 언어 문장의 출처 - 줄의 글 단위(문장·제목·묶이지 않은 칸 문장. 표·그림은 칸 문장을 따로 쓰지 않는다)
  const writeOtherUnit = rowUnits.find((unit) => isSentenceUnit(unit.kind))?.unit_id ?? null;

  /** 다른 언어 직접 쓰기 - 고쳐 쓰기로 들어가 빈 칸 하나를 더하고 그 칸에 포커스 */
  function startWriteOther(lang: "ko" | "en", unitId: number) {
    setDraft({ otherLang: { lang, unitId } }, true);
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(`[data-testid="assign-text-x${unitId}"]`)?.focus());
  }

  function renderPlaceLabel(dest: Destination): { title: string; text: string } {
    const option = options.find((item) => getDestinationId(item.destination) === getDestinationId(dest));
    return { title: option?.docCode ?? "", text: option?.label ?? "" };
  }

  /** 우클릭 메뉴 확정 항목 옆의 짧은 이름 - 잇기는 New 문서 번호, 자리는 To-Be 문서 번호, 지우기·옮기기는 그 이름(옮기기는 대상 문서) */
  function readDestinationLabel(dest: Destination): string {
    if (dest.kind === "link") return writtenMap.get(dest.targetIds[0])?.doc_code ?? "";
    if (dest.kind === "delete") return t("classify.deleted");
    if (dest.kind === "move") return moveCode.trim() || t("classify.moved");
    return renderPlaceLabel(dest).title;
  }

  /** 추천을 누름 - 고른 뒤 그 카드 옆에 확정 메뉴를 띄운다(고른 상자가 카드보다 위라 화면 밖일 수 있다) */
  function pickRecommendation(rec: Recommendation, event: MouseEvent<HTMLButtonElement>) {
    pickDestination(rec.destination);
    if (row) openMenu(event.currentTarget, event, row.key, null);
  }

  function renderRecommendation(rec: Recommendation, index: number) {
    const pressed = isRecommendationPicked(draft.destination, rec.destination, writtenMap);
    const pending = pressed ? t("assign.unsaved") : undefined;
    const chip = <span className="dest-chip" data-source={rec.source}>{t(`assign.src.${rec.source}`)}</span>;
    const why = rec.why ? <span className="dest-card-why">{rec.why}</span> : null;
    if (rec.destination.kind === "link") {
      const targets = rec.destination.targetIds.map((id) => writtenMap.get(id)).filter((item): item is WrittenSentence => item !== undefined);
      const section = targets[0]?.section_path;
      return (
        <DestCard
          key={rec.key}
          icon={Link2}
          tone="link"
          title={
            <>
              <b>{targets[0]?.doc_code}</b> · {t("assign.chosen.link")}
            </>
          }
          text={targets.map((item) => item.text).join(" / ")}
          foot={
            <>
              {section && <span className="dest-card-sec">§ {section}</span>}
              {chip}
              {why}
            </>
          }
          pressed={pressed}
          pending={pending}
          testId={`assign-rec-${index}`}
          onClick={(event) => pickRecommendation(rec, event)}
        />
      );
    }
    if (rec.destination.kind === "delete" || rec.destination.kind === "move") {
      const isDelete = rec.destination.kind === "delete";
      return (
        <DestCard
          key={rec.key}
          icon={isDelete ? Trash2 : MoveRight}
          tone="danger"
          title={t("assign.acc.move")}
          text={t(isDelete ? "classify.deleted" : "classify.moved")}
          foot={
            <>
              {chip}
              {why}
            </>
          }
          pressed={pressed}
          pending={pending}
          testId={`assign-rec-${index}`}
          onClick={(event) => pickRecommendation(rec, event)}
        />
      );
    }
    const label = renderPlaceLabel(rec.destination);
    return (
      <DestCard
        key={rec.key}
        icon={MapPin}
        title={
          <>
            <b>{label.title}</b> · {t("assign.chosen.place")}
          </>
        }
        text={label.text}
        foot={
          <>
            {chip}
            {why}
          </>
        }
        pressed={pressed}
        pending={pending}
        testId={`assign-rec-${index}`}
        onClick={(event) => pickRecommendation(rec, event)}
      />
    );
  }

  // 칸 제목 자리는 줄 단위가 모두 제목·문장일 때만 보인다 - 표·그림은 칸 제목의 출처가 아니다
  const canPickHeading = rowUnits.length > 0 && rowUnits.every((unit) => isHeadingSourceUnit(unit.kind));
  const treeOptions = listTreeOptions(options, canPickHeading);
  const nearAnchor = destination ?? recommendations[0]?.destination ?? null;
  const nearLinks = nearAnchor?.kind === "link" ? pickNearby(written, nearAnchor.targetIds) : [];
  const nearPlaces: DestinationOption[] = nearAnchor && nearAnchor.kind !== "link" ? listSiblingPlaces(options, nearAnchor) : [];

  function renderNearby() {
    if (nearLinks.length + nearPlaces.length === 0) return <p className="text-xs text-ink-3">{t("assign.acc.none")}</p>;
    if (nearAnchor?.kind === "link") {
      return nearLinks.map((item) => (
        <button key={item.target_id} type="button" className="tree-leaf" data-testid={`assign-near-${item.target_id}`} onClick={(event) => pickNewSentence(item.target_id, event.ctrlKey || event.metaKey)}>
          {item.text}
        </button>
      ));
    }
    return nearPlaces.map((option) => (
      <button key={option.id} type="button" className="tree-leaf" disabled={option.disabled} data-testid={`assign-near-${option.id}`} onClick={() => pickDestination(option.destination)}>
        <span className="mr-1.5 font-mono text-[11px] text-ink-3">{option.docCode}</span>
        {option.label}
        {option.disabled && " · N/A"}
      </button>
    ));
  }

  const accSections: AccordionSection[] = [
    { key: "rec", icon: Sparkles, title: t("assign.acc.rec"), count: recommendations.length, body: recommendations.length === 0 ? <p className="text-xs text-ink-3">{t("assign.acc.none")}</p> : recommendations.map(renderRecommendation) },
    { key: "near", icon: Locate, title: t("assign.acc.near"), count: nearLinks.length + nearPlaces.length, body: renderNearby() },
    { key: "all", icon: ListTree, title: t("assign.acc.all"), count: written.length + options.filter(isPlaceOption).length, body: <DestinationTree written={written} options={treeOptions} tobeHref={getNewDocumentsHref(bundleId)} onPickLink={pickNewSentence} onPickPlace={pickDestination} manage={placeManage} /> },
    {
      key: "move",
      icon: MoveRight,
      title: t("assign.acc.move"),
      body: (
        <>
          <button type="button" className="tree-leaf" aria-pressed={destination?.kind === "delete"} data-testid="assign-pick-delete" onClick={() => pickDestination({ kind: "delete" })}>
            {t("classify.deleted")}
          </button>
          <button type="button" className="tree-leaf" aria-pressed={destination?.kind === "move"} data-testid="assign-pick-move" onClick={() => pickDestination({ kind: "move" })}>
            {t("classify.moved")}
          </button>
        </>
      ),
    },
  ];

  /** 참조 줄의 새 문장이 EQUIS의 지금 번호·정식 이름과 다르면 작은 주의와 맞춘 글 - 누르면 그 글로 바꾼다(저장은 Confirm) */
  function renderRefAdvice(slotKey: string, lang: ViewUnit["lang"], sourceIds: readonly number[], text: string): ReactNode {
    if (lang !== "ref" || rowRefUnit === null || !sourceIds.includes(rowRefUnit.id)) return null;
    const advice = readRefAdvice(text, rowRefUnit.text, refInfo);
    if (advice === null) return null;
    return (
      <div className="ref-advice" data-testid={`assign-ref-advice-${slotKey}`}>
        <TriangleAlert size={12} strokeWidth={1.75} className="mt-0.5 flex-none" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="font-semibold">{t(advice.issue === "number" ? "assign.ref.adviceNumber" : "assign.ref.adviceTitle")}</span>
          <span className="block break-words text-ink-2">{advice.text}</span>
        </span>
        {canEdit && (
          <button type="button" className="btn ghost h-6 flex-none px-1.5 text-xs" data-testid={`assign-ref-advice-use-${slotKey}`} onClick={() => setDraft({ texts: { ...draft.texts, [slotKey]: advice.text }, changeTypes: { ...draft.changeTypes, [slotKey]: "rewritten" } })}>
            {t("assign.ref.useEquis")}
          </button>
        )}
      </div>
    );
  }

  /** 참조 줄을 이미 쓴 문서의 문장에 이을 때 - 그 문장이 EQUIS와 다르면 작은 주의와 맞춘 글. 이미 쓴 문서의 글은 여기서 고치지 않아 단추는 없다 */
  function renderRefLinkAdvice(written: WrittenSentence): ReactNode {
    if (rowRefUnit === null || rowRefUnit.lang !== "ref") return null;
    const advice = readRefAdvice(written.text, rowRefUnit.text, refInfo);
    if (advice === null) return null;
    return (
      <div className="ref-advice" data-testid={`assign-ref-link-advice-${written.target_id}`}>
        <TriangleAlert size={12} strokeWidth={1.75} className="mt-0.5 flex-none" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="font-semibold">{t(advice.issue === "number" ? "assign.ref.adviceNumber" : "assign.ref.adviceTitle")}</span>
          <span className="block break-words text-ink-2">{advice.text}</span>
        </span>
      </div>
    );
  }

  const newSentences = (
    <div className="grid gap-2" data-testid="assign-new-sentences">
      {rowUnits.some((unit) => unit.kind === "table" || unit.kind === "table_row" || unit.kind === "figure") ? (
        <p className="rounded-md border border-line-2 px-3 py-2 text-ink-2">{t(rowUnits.some((unit) => unit.kind === "figure") ? "classify.figureAsIs" : "classify.tableAsIs")}</p>
      ) : (
        slots.map((slot, index) => {
          const text = draft.texts[slot.key] ?? slot.text;
          // 나눔·합침·번역은 서버가 구조에서 정한다 - 글자 비교 종류는 출처 하나인 같은 언어 칸에서만 고른다
          const structural = readSlotKind(slot, slots);
          const changed = slot.sourceText !== null && text.trim() !== "" && text.trim() !== slot.sourceText.trim();
          const keptType = isTextChangeType(slot.target?.change_type) ? slot.target.change_type : null;
          const changeSelect = (
            <Select
              testId={`assign-slot-change-${slot.key}`}
              ariaLabel={t("classify.changeType")}
              size="sm"
              value={draft.changeTypes[slot.key] ?? keptType ?? "rewritten"}
              disabled={!canEdit}
              options={[
                { value: "tone", label: t("change.tone") },
                { value: "rewritten", label: t("change.rewritten") },
              ]}
              onChange={(next) => setDraft({ changeTypes: { ...draft.changeTypes, [slot.key]: next } })}
            />
          );
          const refAdvice = renderRefAdvice(slot.key, slot.lang, slot.sourceIds, text);
          // 읽기 보기는 문장마다 한 줄(언어 · 글 · 끝에 변경 종류) - 결정 칸을 낮게 두어 위 목록이 늘 보이게. 전체 글은 올리면 툴팁, 고치기는 Edit and confirm
          if (!editing) {
            return (
              <Fragment key={slot.key}>
                <div className="chosen-line">
                  <LangToken lang={slot.lang} />
                  <span className="min-w-0 flex-1 text-[13px] leading-5 text-ink" style={{ fontFamily: slot.lang === "en" ? "var(--font-source-en)" : "var(--font-source)" }}>
                    <Truncate text={text || "_"} lang={slot.lang === "neutral" ? undefined : slot.lang} testId={`assign-text-${slot.key}`} />
                  </span>
                  {structural ? (
                    <span className="flex-none text-xs text-ink-2" data-testid={`assign-slot-kind-${slot.key}`}>
                      {t(`change.${structural}`)}
                    </span>
                  ) : (
                    changed && <span className="flex-none">{changeSelect}</span>
                  )}
                </div>
                {refAdvice}
              </Fragment>
            );
          }
          return (
            <div key={slot.key} className="grid gap-1">
              <div className="grid min-h-[60px] grid-cols-[minmax(0,1fr)] rounded-md border border-focus bg-surface px-2.5 py-2">
                <textarea
                  ref={index === 0 ? firstTextRef : undefined}
                  lang={slot.lang === "neutral" ? undefined : slot.lang}
                  className="min-h-[48px] w-full resize-y bg-transparent text-[14px] leading-[24px] outline-none focus-visible:outline-none"
                  style={{ fontFamily: slot.lang === "en" ? "var(--font-source-en)" : "var(--font-source)" }}
                  data-testid={`assign-text-${slot.key}`}
                  value={text}
                  onChange={(event) => setDraft({ texts: { ...draft.texts, [slot.key]: event.target.value } }, true)}
                />
              </div>
              {/* 고쳐 쓰는 동안은 변경 종류 줄의 자리를 미리 잡는다 - 글이 원문과 달라지는 순간 아래가 밀리지 않게(To-Be 사유 칸과 같은 방식) */}
              {structural ? (
                <span className="text-xs text-ink-2" data-testid={`assign-slot-kind-${slot.key}`}>
                  {t("classify.changeType")} · {t(`change.${structural}`)}
                </span>
              ) : (
                <span className="flex h-7 items-center gap-2 text-xs text-ink-2">
                  {changed && (
                    <>
                      {t("classify.changeType")}
                      {changeSelect}
                    </>
                  )}
                </span>
              )}
              {refAdvice}
            </div>
          );
        })
      )}
    </div>
  );

  function renderChosen() {
    if (!destination) {
      return (
        <div className="chosen-box is-empty" data-testid="assign-chosen">
          {t("assign.chosen.empty")}
        </div>
      );
    }
    const placeLabel = isPlace ? renderPlaceLabel(destination) : null;
    const isConfirmedView = row?.status === "confirmed" && draft.destination === null;
    const pickedRows = linkIds.map((id) => writtenMap.get(id)).filter((item): item is WrittenSentence => item !== undefined);
    // 줄에 없는 언어의 문장은 번역이다 - 종류를 고르지 않고, 나눔도 같은 언어 문장끼리만 센다(제품 명세 §6.7)
    const translatedIds = new Set(pickedRows.filter((item) => isTranslationOf(item.lang, rowLangs)).map((item) => item.target_id));
    const byLang = new Map<string, number>();
    for (const item of pickedRows) if (!translatedIds.has(item.target_id)) byLang.set(item.lang, (byLang.get(item.lang) ?? 0) + 1);
    const mergedWith = [...new Set(pickedRows.flatMap((item) => item.source_unit_ids).filter((id) => !row?.unitIds.includes(id)))].map((id) => unitMap.get(id)?.display_id ?? String(id));
    const auto = [...byLang.values()].some((count) => count > 1) ? "split" : mergedWith.length > 0 ? "merged" : null;
    // 잇지 않는 언어의 짝 조각은 판단이 있으면 지금 그대로 함께 저장된다 - 줄이 아니라 함께 확정되는 쪽으로 보인다.
    // 판단이 없으면 저장에서 빠지고 서버가 같은 저장 안에서 짝을 풀어 제 줄로 남긴다(아래 알림)
    const linkedLangs = new Set(pickedRows.map((item) => item.lang));
    const savedRowIds = destination.kind === "link" ? pickLinkUnits(rowUnits, linkedLangs).map((unit) => unit.unit_id) : (row?.unitIds ?? []);
    const leftovers = pickedGroups.isLoading ? [] : listLinkLeftovers(destination, { units: saveUnits, group: saveGroupData });
    const coConfirmed = saveGroupData ? listCoConfirmed(saveGroupData, [...savedRowIds, ...leftovers], linkIds) : [];
    const spansDocs = new Set(pickedRows.map((item) => item.target_doc_id)).size > 1;
    return (
      <div className="chosen-box" data-testid="assign-chosen">
        <span className="chosen-label">
          {isConfirmedView && <Check size={13} strokeWidth={2} className="flex-none" aria-hidden />}
          <Truncate
            text={`${isConfirmedView ? `${t("assign.chosen.confirmed")} · ` : ""}${destination.kind === "link" ? `${t("assign.chosen.link")} · ${[...new Set(pickedRows.map((item) => item.doc_code))].join(", ")}` : destination.kind === "slot_heading" ? t("assign.slotHeading") : isPlace ? t("assign.chosen.place") : t("assign.acc.move")}`}
          />
        </span>
        {(destination.kind === "delete" || destination.kind === "move") && (
          <span className="flex items-center gap-1.5 text-sm font-semibold text-ink">
            {destination.kind === "delete" ? <Trash2 size={14} strokeWidth={1.75} className="flex-none text-danger" aria-hidden /> : <MoveRight size={14} strokeWidth={1.75} className="flex-none text-danger" aria-hidden />}
            {t(destination.kind === "delete" ? "classify.deleted" : "classify.moved")}
          </span>
        )}
        {destination.kind === "link" && (
          <LinkChoice
            rows={pickedRows}
            changeTypes={draft.linkChangeTypes ?? {}}
            aiPending={aiPending}
            translatedIds={translatedIds}
            defaults={Object.fromEntries(pickedRows.map((item) => [item.target_id, readLinkDefault({ lang: item.lang, confirmed_text: item.text, change_type: item.change_type, status: item.status }, rowUnits)]))}
            auto={auto}
            mergedWith={mergedWith}
            onChange={(targetId, value) => setDraft({ linkChangeTypes: { ...(draft.linkChangeTypes ?? {}), [targetId]: value } })}
            renderNote={renderRefLinkAdvice}
          />
        )}
        {placeLabel && (
          <>
            <span className="flex min-w-0 items-baseline gap-1.5 text-[13px] font-semibold text-ink">
              <b className="flex-none font-mono text-[11px]">{placeLabel.title}</b>
              <Truncate text={placeLabel.text} />
            </span>
            {newSentences}
          </>
        )}
        {destination.kind === "slot_heading" && (
          <p className="text-[13px] text-ink" data-testid="assign-chosen-heading">
            <b className="mr-1 font-mono text-[11px]">{renderPlaceLabel(destination).title}</b>
            {renderPlaceLabel(destination).text}
          </p>
        )}
        {spansDocs && <p className="text-xs text-ink-2">{t("assign.duplicateReason")}</p>}
        {leftovers.length > 0 && (
          <p className="text-xs text-ink-2" data-testid="assign-link-leftover">
            {t("assign.leftover.note", { ids: leftovers.map((id) => unitMap.get(id)?.display_id ?? String(id)).join(", ") })}
          </p>
        )}
        {coConfirmed.length > 0 && (
          <div className="grid gap-0.5" data-testid="assign-co-confirmed">
            <span className="text-[11px] font-semibold text-ink-3">{t("assign.coConfirmed")}</span>
            {coConfirmed.map((item) => (
              <span key={`${item.kind}-${item.id}`} className="truncate text-xs text-ink-2">
                {item.kind === "unit" ? <span className="font-mono">{item.label}</span> : item.label}
              </span>
            ))}
          </div>
        )}
        {otherLang && destination.kind !== "link" && canEdit && (
          <div className="flex flex-wrap gap-1.5">
            {aiOn && (
              <button type="button" className="btn h-7" data-testid="assign-make-other" disabled={busy} onClick={() => row && void askAiScope("translate", { unit_ids: row.unitIds, direction: otherLang === "en" ? "ko_to_en" : "en_to_ko" })}>
                <Sparkles size={14} strokeWidth={1.5} aria-hidden />
                {t(otherLang === "en" ? "assign.makeEn" : "assign.makeKo")}
              </button>
            )}
            {/* AI가 꺼져 있어도 빠진 언어를 채울 수 있게 */}
            {writeOtherUnit !== null && (
              <button type="button" className="btn h-7" data-testid="assign-write-other" disabled={busy} onClick={() => startWriteOther(otherLang, writeOtherUnit)}>
                <FilePen size={14} strokeWidth={1.5} aria-hidden />
                {t(otherLang === "en" ? "assign.writeEn" : "assign.writeKo")}
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  // 확정 단추 - 결정 칸 맨 아래 늘 같은 자리의 가장 큰 단추. 고른 곳이 없으면 흐리게 꺼지고 까닭은 툴팁(↵는 위 목록의 첫 후보로 간다)
  const confirmButton = (
    <Tooltip label={t(destination !== null && isRefGate ? "assign.ref.checkFirst" : "assign.why.pickFirst")} suppressed={(destination !== null && !isRefGate) || !row}>
      <button type="button" className="btn pri assign-confirm" data-testid="assign-primary" data-state={primaryState} disabled={!canEdit || !row || busy || !destination || isRefGate} onClick={handlePrimary}>
        <span className="stack">
          <span data-on={primaryState !== "save" ? "" : undefined}>
            {t("classify.confirm")} <kbd>↵</kbd>
          </span>
          <span data-on={primaryState === "save" ? "" : undefined}>
            {t("classify.saveConfirm")} <kbd>↵</kbd>
          </span>
        </span>
      </button>
    </Tooltip>
  );

  const canClear = row !== null && row.status !== "unassigned";
  // 확정 말고 다른 길 셋 - 결정 칸 머리에 조용히 두어 고른 곳·Remark·확정 사이에 끼지 않게(확정 위에 Clear가 있으면 넘쳐 누르기 쉽다).
  // 칸 폭은 Edit and confirm이 라벨만큼, 나머지 둘이 남은 폭을 나눈다. 셋이 글쇠 표시까지 들어가지 않는 폭에서는 글쇠 표시를 뺀다 - 단축키는 Help에 있다
  const actions = (
    <div className="@container grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] gap-1.5" data-testid="assign-actions">
      <Tooltip label={t("assign.why.editPlace")} suppressed={isPlace || !row}>
        <button type="button" className="btn assign-alt" data-testid="assign-edit" disabled={!canEdit || !isPlace || editing || busy} onClick={startEdit}>
          <FilePen size={13} strokeWidth={1.5} aria-hidden />
          {t("classify.editConfirm")} <kbd className="@max-[290px]:hidden">E</kbd>
        </button>
      </Tooltip>
      <button type="button" className="btn assign-alt" data-testid="assign-hold" disabled={!canEdit || !row || busy} onClick={() => void runSave("hold")}>
        {t("classify.hold")} <kbd className="@max-[290px]:hidden">H</kbd>
      </button>
      <Tooltip label={canClear ? t("classify.clear") : t("assign.why.nothingToClear")}>
        <button type="button" className="btn assign-alt" aria-label={t("classify.clear")} data-testid="assign-clear" disabled={!canEdit || !canClear || busy} onClick={() => void runClear()}>
          {t("assign.clearShort")} <kbd className="@max-[290px]:hidden">U</kbd>
        </button>
      </Tooltip>
    </div>
  );

  // 지금 고른 곳에 꼭 필요한 Remark(지우기·옮기기·두 문서) - 비어 있으면 Remark 줄이 경고 색이 되고 쓰기 단추가 다음 할 일로 강조된다
  const remarkNeed = row && destination ? readReasonNeed("confirm") : null;
  const isRemarkMissing = remarkNeed !== null && !reasonNow.trim();
  // Remark 한 줄 - 이름 · 지금 글(한 줄, 넘치면 올렸을 때 전체) · 쓰기 단추. 글은 창에서 쓴다.
  // 꼭 필요한데 비었으면 이름 자리에 경고 아이콘과 "…에는 필수"(좁은 패널에서도 한 줄에 들어가게 이름은 뺀다 - 옆 단추가 Write remark)
  const remarkRow = (
    <div className="assign-remark" data-need={isRemarkMissing ? "" : undefined}>
      {isRemarkMissing ? (
        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-xs font-semibold text-st-hold" data-testid="assign-reason">
          <TriangleAlert size={13} strokeWidth={1.75} className="flex-none" aria-hidden />
          <Truncate text={t(`remark.need.${remarkNeed}`)} />
        </span>
      ) : (
        <>
          <span className="flex-none text-xs text-ink-3">{t("classify.reason")}</span>
          <span className="min-w-0 flex-1">
            {reasonNow ? (
              <Truncate text={reasonNow} className="text-[13px] leading-5 text-ink" testId="assign-reason" />
            ) : (
              <span className="block text-xs leading-5 text-ink-3" data-testid="assign-reason">
                –
              </span>
            )}
          </span>
        </>
      )}
      {canEdit && (
        <button type="button" className={`btn h-7 flex-none gap-1 px-2 text-xs ${isRemarkMissing ? "is-warn" : "font-normal"}`} data-testid="assign-reason-edit" disabled={!row} onClick={() => setRemarkEdit({ kind: "row", need: isRemarkMissing ? remarkNeed : null, then: null })}>
          <FilePen size={13} strokeWidth={1.5} aria-hidden />
          {t(reasonNow ? "remark.edit" : "remark.write")}
        </button>
      )}
    </div>
  );

  // 머리 아래 한 줄 - 결정 전에 볼 것(검사 결과·확정한 사람)
  const checks = groupData?.targets.flatMap((target) => target.warnings) ?? [];
  // 고른 줄의 첫 문장이 원문에서 놓인 쪽 - 종이 문서와 견줄 때 찾는 자리다(PDF가 아니면 어림한 쪽이라 ≈를 붙인다)
  const rowBlock = mode === "old" && rowViewUnits.length > 0 ? (shapeView?.blocks.find((block) => block.id === rowViewUnits[0].block_id) ?? null) : null;
  const meta = (
    <div className="assign-meta">
      {rowBlock !== null && rowBlock.page !== null && (
        <span className="assign-meta-item tabular-nums text-ink-3" data-testid="assign-row-page">
          {rowBlock.page_basis === "estimated" ? "≈ " : ""}p.{rowBlock.page}
        </span>
      )}
      <span className="assign-meta-item">
        <span className="text-ink-3">{t("classify.checks")}</span>
        <span className="flex flex-wrap gap-1 text-ink-2" data-testid="assign-checks">
          {checks.map((warning, index) => (
            <span key={index} className="pill warn">
              {t(readCheckKey(warning))}
            </span>
          ))}
          {checks.length === 0 && "–"}
        </span>
      </span>
      <span className="assign-meta-item min-w-0">
        <span className="flex-none text-ink-3">{t("classify.confirmedBy")}</span>
        <Truncate className="text-ink-2" text={firstDecision?.confirmed_by ? `${firstDecision.confirmed_by} · ${formatKst(firstDecision.confirmed_at)}` : "–"} testId="assign-confirmed-by" />
      </span>
      {systemHold !== null && (
        <span className="assign-meta-item">
          <span className="text-ink-3">{t("classify.systemHold")}</span>
          <span data-testid="assign-system-hold">
            <span className="pill warn">{t(SYSTEM_HOLDS.includes(systemHold) ? `hold.system.${systemHold}` : "hold.system.other")}</span>
          </span>
        </span>
      )}
    </div>
  );

  function renderStep(n: number, label: string) {
    return (
      <h3 className="assign-step">
        <span className="assign-step-n" aria-hidden>
          {n}
        </span>
        {label}
      </h3>
    );
  }

  const aiNote = (
    <section className="flex items-start gap-2 rounded-md border border-dashed px-3 py-2 text-xs text-ink-2" style={{ borderColor: "var(--st-ai-line)" }} data-testid="assign-ai">
      <Sparkles size={14} strokeWidth={1.5} className="mt-0.5 shrink-0 text-st-ai" aria-hidden />
      <span className="flex-1">
        {aiOn ? t("classify.aiNone") : t("classify.aiLater")}
        {aiOn && canEdit && row?.status === "unassigned" && (
          <button type="button" className="btn mt-1.5 h-7" data-testid="assign-ai-request" disabled={busy} onClick={() => void askAiScope("classify", { unit_ids: row.unitIds })}>
            {t("classify.aiAsk")}
          </button>
        )}
        {aiBusy > 0 && (
          <span className="mt-0.5 block text-st-ai" data-testid="assign-ai-running">
            {t("classify.aiRunning", { n: aiBusy })}
          </span>
        )}
        {aiJobs.error !== null && (
          <span className="mt-0.5 block text-st-hold" role="status" data-testid="assign-ai-stale">
            {t("ai.statusStale")}
          </span>
        )}
      </span>
    </section>
  );

  /** 다듬기 걸음과 그 줄에 걸린 카드(참조 줄 확인·AI 나누기 제안) - Old 줄과 한 단의 New 문장이 같은 것을 쓴다 */
  function renderShapeCards(n: number) {
    return (
      <>
        {shapeLines.length > 0 && (
          <>
            {renderStep(n, t("assign.step.shape"))}
            <ShapeTools lines={shapeLines} cutUnitId={cutLine.at !== null ? cutUnitId : null} busy={busy} onAction={(unit, action, lang) => runUnitAction(unit, action, lang)} mode={shapeMode} onMode={switchShapeMode} />
          </>
        )}
        {rowRefUnit && shapeView && (
          <RefCard
            key={`${rowRefUnit.id}:${rowRefUnit.ref?.state ?? "new"}:${rowRefUnit.ref?.number ?? ""}`}
            unit={rowRefUnit}
            equis={refInfo?.equis ?? null}
            onReloadEquis={refDetail.reload}
            canEdit={canEdit}
            busy={busy}
            blockedReason={refBlocked}
            left={refPendingIds.length}
            onConfirm={(number) => void runUnitEdit({ type: "set_ref", unit_id: rowRefUnit.id, number }, t("assign.ref.didConfirm"), rowRefUnit.id)}
            onReject={() => void runUnitEdit({ type: "clear_ref", unit_id: rowRefUnit.id }, t("assign.ref.didReject"), rowRefUnit.id)}
            onClose={() => setRefEntryId(null)}
            onNext={selectNextRef}
          />
        )}
        {rowSplitUnit && rowSplit && (
          <SplitSuggestionCard
            unit={rowSplitUnit}
            suggestion={rowSplit}
            canEdit={canEdit}
            busy={busy}
            blockedReason={splitBlocked}
            left={splitByUnit.size}
            onApply={() => void applySplitSuggestion(rowSplitUnit, rowSplit)}
            onDismiss={() => void dismissSplitSuggestion(rowSplit)}
            onNext={selectNextSplit}
          />
        )}
      </>
    );
  }

  function renderSideBody() {
    if (mode === "unsourced") {
      const target = writtenMap.get(focusNew ?? -1);
      return (
        <div className="assign-side-body">
          {target ? (
            <>
              <div className="assign-side-head">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-semibold">
                    {target.doc_code} {target.section_path}
                  </span>
                  <span className="pill warn">{t("assign.unsourced.title")}</span>
                </div>
                <div lang={target.lang === "neutral" ? undefined : target.lang}>
                  <ClampText text={target.text} className="text-[13px] leading-5 text-ink" tabbable={false} />
                </div>
              </div>
              {/* 출처 없는 New도 같은 순서 - 위는 출처를 고르는 길(왼쪽 Old 조각), 아래 붙은 결정 칸에 Remark와 신규 표시 */}
              <div className="assign-pick" data-testid="assign-pick">
                {renderStep(1, t("assign.step.source"))}
                <p className="chosen-box is-empty mx-[var(--pad)] mb-[var(--pad)]">{t("assign.unsourced.body")}</p>
              </div>
              <div className="assign-decide" data-testid="assign-decide">
                <div className="assign-decide-body">
                  {renderStep(2, t("assign.step.decide"))}
                  <div className="assign-remark">
                    <span className="flex-none text-xs text-ink-3">{t("classify.reason")}</span>
                    <span className="min-w-0 flex-1">
                      {(newRemarks[target.target_id] ?? target.remark) ? (
                        <Truncate text={newRemarks[target.target_id] ?? target.remark} className="text-[13px] leading-5 text-ink" testId="assign-new-remark" />
                      ) : (
                        <span className="block truncate text-xs leading-5 text-ink-3" data-testid="assign-new-remark">
                          {t("assign.optional")}
                        </span>
                      )}
                    </span>
                    {canEdit && (
                      <button type="button" className="btn h-7 flex-none gap-1 px-2 text-xs font-normal" data-testid="assign-new-remark-edit" onClick={() => setRemarkEdit({ kind: "new", targetId: target.target_id })}>
                        <FilePen size={13} strokeWidth={1.5} aria-hidden />
                        {t((newRemarks[target.target_id] ?? target.remark) ? "remark.edit" : "remark.write")}
                      </button>
                    )}
                  </div>
                </div>
                <button type="button" className="btn pri assign-confirm" data-testid="assign-mark-new" disabled={!canEdit || busy} onClick={markNew}>
                  {t("assign.markNew")}
                </button>
              </div>
            </>
          ) : (
            <EmptyState icon={Check} testId="assign-unsourced-done" title={t("assign.unsourced.title")} body={t("assign.unsourced.done")} compact />
          )}
        </div>
      );
    }
    if (hasSolo) {
      return (
        <div className="assign-side-body" data-testid="assign-solo">
          <div className="assign-side-head">
            <div className="flex items-center gap-2">
              <Truncate className="min-w-0 flex-1 font-mono text-sm font-semibold" text={soloUnits.map((unit) => unit.display_id).join(" · ") || (shapeView?.document.doc_code ?? "–")} testId="assign-row-id" />
              <span className="tag flex-none">{t("assign.writtenTag")}</span>
              <span className="flex flex-none gap-0.5">
                <Tooltip label={t("assign.rowPrev")} align="end">
                  <button type="button" className="btn ghost icon h-6 w-6" aria-label={t("assign.rowPrev")} data-testid="assign-row-prev" onClick={() => moveRow(-1)}>
                    <ArrowUp size={13} strokeWidth={1.6} aria-hidden />
                  </button>
                </Tooltip>
                <Tooltip label={t("assign.rowNext")} align="end">
                  <button type="button" className="btn ghost icon h-6 w-6" aria-label={t("assign.rowNext")} data-testid="assign-row-next" onClick={() => moveRow(1)}>
                    <ArrowDown size={13} strokeWidth={1.6} aria-hidden />
                  </button>
                </Tooltip>
              </span>
            </div>
            {rowBlock !== null && rowBlock.page !== null && (
              <div className="assign-meta">
                <span className="assign-meta-item tabular-nums text-ink-3" data-testid="assign-row-page">
                  {rowBlock.page_basis === "estimated" ? "≈ " : ""}p.{rowBlock.page}
                </span>
              </div>
            )}
          </div>
          {/* 이 문서의 문장은 배정하지 않는다 - 다듬기(1번)뿐이고, 왜 보낼 곳이 없는지 한 줄로 알린다 */}
          <div className="assign-pick" data-testid="assign-pick">
            {renderShapeCards(1)}
            <p className="chosen-box is-empty mx-[var(--pad)] my-[var(--pad)]" data-testid="assign-solo-note">
              {soloUnits.length === 0 ? t("assign.solo.pick") : t(isNewEdit ? "assign.solo.noteInPlace" : "assign.solo.note")}
            </p>
          </div>
        </div>
      );
    }
    if (!row) {
      return (
        <div className="assign-side-body">
          <div className="grid gap-1 rounded-md bg-sunken p-3 text-[13px] text-ink-2" style={{ margin: "var(--pad)" }} data-testid="assign-pick-prompt">
            <b className="text-ink">{t("assign.pickTitle")}</b>
            {t("assign.pickBody")}
          </div>
        </div>
      );
    }
    return (
      <div className="assign-side-body">
        <div className="assign-side-head">
          <div className="flex items-center gap-2">
            <Truncate className="min-w-0 flex-1 font-mono text-sm font-semibold" text={rowUnits.map((unit) => unit.display_id).join(" · ") || "–"} testId="assign-row-id" />
            <span className="flex-none">
              <UnitStatusChip status={row.status} testId="assign-row-status" />
            </span>
            {/* 앞·다음 줄 - 손이 오른쪽 칸에 있을 때 원문까지 가지 않고 넘긴다(글쇠 K·J와 같다) */}
            <span className="flex flex-none gap-0.5">
              <Tooltip label={t("assign.rowPrev")} align="end">
                <button type="button" className="btn ghost icon h-6 w-6" aria-label={t("assign.rowPrev")} data-testid="assign-row-prev" onClick={() => moveRow(-1)}>
                  <ArrowUp size={13} strokeWidth={1.6} aria-hidden />
                </button>
              </Tooltip>
              <Tooltip label={t("assign.rowNext")} align="end">
                <button type="button" className="btn ghost icon h-6 w-6" aria-label={t("assign.rowNext")} data-testid="assign-row-next" onClick={() => moveRow(1)}>
                  <ArrowDown size={13} strokeWidth={1.6} aria-hidden />
                </button>
              </Tooltip>
            </span>
            {(units.error ?? suggestions.error) !== null && (
              <button type="button" className="btn h-6 gap-1 px-1.5 text-xs font-normal text-st-hold" data-testid="assign-refresh-error" onClick={() => setUnitsKey((key) => key + 1)}>
                <RefreshCw size={12} strokeWidth={1.5} aria-hidden />
                {t("classify.refreshFailed")}
              </button>
            )}
          </div>
          {meta}
          {/* 머리는 스크롤되지 않으니 긴 AI 사유는 두 줄까지(전체는 올리거나 포커스하면 툴팁) */}
          {rowSuggestion && row.status === "ai_suggested" && aiWhy && (
            <div className="flex items-start gap-1.5 text-xs text-st-ai" data-testid="assign-ai-reason">
              <Sparkles size={13} strokeWidth={1.5} className="mt-0.5 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1">
                <ClampText text={aiWhy} />
              </span>
            </div>
          )}
        </div>
        {/* ① 다듬기 → ② 보낼 곳 - 패널에서 이곳만 스크롤된다. 바로 아래 결정 칸(③)이 붙어 있어 고른 곳에서 확정까지 손이 짧다 */}
        <div className="assign-pick" data-testid="assign-pick" onClickCapture={handlePickClickCapture}>
          {renderShapeCards(1)}
          {renderStep(stepBase + 1, t("assign.step.pick"))}
          <DestinationAccordion sections={accSections} open={accOpen} onToggle={toggleAcc} />
          {/* 한 단에서는 New 칸이 없어 이미 쓴 문장을 직접 눌러 고르지 못한다 - 까닭과 양 단으로 넘어가는 길을 그 자리에(추천 카드로 잇는 것은 된다) */}
          {view.single && writtenDocs.length > 0 && (
            <p className="mx-[var(--pad)] mt-1 grid justify-items-start gap-1 rounded-md bg-sunken px-2.5 py-2 text-xs text-ink-2" data-testid="assign-single-hint">
              <span>{t("assign.single.linkHint")}</span>
              <button type="button" className="btn ghost -ml-2 h-7" data-testid="assign-single-hint-two" onClick={() => changeView({ single: false })}>
                <Columns2 size={14} strokeWidth={1.5} aria-hidden />
                {t("assign.view.two")}
              </button>
            </p>
          )}
          <div className="px-[var(--pad)] pb-[var(--pad)] pt-1">{aiNote}</div>
        </div>
        {/* ② 결정 칸 - 패널 아래에 붙는다. 다른 길 셋 · 고른 곳(높이 상한 안에서 이 부분만 스크롤) · 대상 문서 · Remark · 맨 아래 확정 */}
        <div className="assign-decide" data-testid="assign-decide">
          <div className="assign-decide-body">
            {renderStep(stepBase + 2, t("assign.step.decide"))}
            {actions}
            {renderChosen()}
          </div>
          {destination?.kind === "move" && (
            <div className="flex min-w-0 items-center gap-2">
              <span className="flex-none text-xs text-ink-3">{t("classify.moveTo")}</span>
              <span className="block h-8 min-w-0 flex-1">
                <MoveTargetField key={activeKey ?? ""} bundleId={bundleId} value={moveCode} disabled={!canEdit} testId="assign-move-code" onChange={(code) => setDraft({ moveCode: code })} />
              </span>
            </div>
          )}
          {remarkRow}
          {confirmButton}
        </div>
      </div>
    );
  }

  // 그 자리 메뉴 - 메뉴를 연 줄이 지금 고른 줄이고 그 줄의 묶음을 받은 뒤에만(받기 전에는 이음을 모른다)
  const menuItems: LinkMenuItem[] =
    menu && row && menu.rowKey === row.key && !groupPending
      ? listLinkMenuItems({
          picked: draft.destination !== null && (menu.targetId === null || linkIds.includes(menu.targetId)),
          linked: menu.targetId !== null && savedDestination?.kind === "link" && savedDestination.targetIds.includes(menu.targetId),
          confirmed: row.status === "confirmed",
          hasTarget: menu.targetId !== null,
          canEdit,
        })
      : [];

  function runMenu(item: LinkMenuItem) {
    const targetId = menu?.targetId ?? null;
    if (item === "close") setMenu(null);
    else if (item === "confirm") {
      setMenu(null);
      void runSave("confirm");
    } else if (item === "cancel") {
      // 고름을 되돌린다 - 저장된 곳(없으면 빈 고름)으로
      setDraft({ destination: null, linkChangeTypes: {} });
      setMenu(null);
    } else if (item === "link" && targetId !== null) {
      // 고른 뒤 같은 메뉴가 확정·취소로 바뀐다
      if (!pickNewSentence(targetId, false)) setMenu(null);
    } else if (item === "unlink" && targetId !== null) {
      const remainder = listUnlinkRemainder(savedDestination?.kind === "link" ? savedDestination.targetIds : [], targetId, writtenMap);
      // 다른 문장이 남으면 그것만 고른 상태로(확정해야 저장된다), 하나뿐이면 배정을 지운다
      if (remainder.length > 0) pickDestination({ kind: "link", targetIds: remainder });
      else {
        setMenu(null);
        void runClear();
      }
    }
  }

  const error = docs.error ?? views.error ?? units.error ?? tobe.error ?? writtenList.error;
  const reloadAll = () => {
    for (const source of [docs, views, units, tobe, writtenList]) if (source.error !== null) source.reload();
  };
  if (!ready) {
    return error !== null ? (
      <BundleLoadError error={error} onRetry={reloadAll} testId="assign" />
    ) : (
      <div className="p-4" data-testid="assign-loading">
        {showSkeleton && <span className="sk h-[480px] w-full" />}
      </div>
    );
  }

  const done = countDone(rows);
  const identicalCount = identical.data?.length ?? 0;
  const bar = (
    <div ref={setBarEl} className="assign-bar" data-testid="assign-bar">
      <div className="flex flex-wrap gap-1" role="tablist" data-testid="assign-filters">
        {FILTERS.filter((item) => item !== "ai_suggested" || counts.ai_suggested > 0).map((item) => {
          return (
            <FilterChip
              key={item}
              tone={item}
              label={item === "all" ? t("assign.acc.all") : t(`status.unit.${item}`)}
              count={counts[item]}
              selected={mode === "old" && filter === item}
              onClick={() => applyFilter(item)}
              testId={`assign-filter-${item}`}
              icon={FILTER_ICON[item]}
            />
          );
        })}
        {written.length > 0 && (
          <FilterChip
            tone="danger"
            label={t("assign.filterUnsourced")}
            count={unsourced.length}
            selected={mode === "unsourced"}
            onClick={() => {
              // 출처 없는 New 문장은 New 칸에서 본다
              if (view.single) changeView({ single: false });
              setMode("unsourced");
            }}
            testId="assign-filter-unsourced"
            icon={TriangleAlert}
          />
        )}
      </div>
      <span className="text-xs tabular-nums text-ink-3" data-testid="assign-progress">
        {t("assign.progress", { done, total: rows.length })}
      </span>
      <ReadOnlyNote bundle={bundle} testId="assign" />
      {/* 오른쪽 묶음은 한 요소로 - 줄이 넘치면 통째로 다음 줄 오른쪽 끝으로 간다 */}
      <div className="assign-bar-end" data-testid="assign-bar-end">
        {/* 한 단 · 양 단 - 문서 하나만 넓게 보거나 두 문서를 나란히(글쇠 V). 읽기만 하는 사람에게도 보인다 */}
        <span className="view-toggle" role="group" aria-label={t("assign.view.group")} data-testid="assign-view">
          <Tooltip label={t("assign.view.oneTip")}>
            <button type="button" aria-pressed={view.single} aria-label={t("assign.view.one")} data-testid="assign-view-one" onClick={() => changeView({ single: true })}>
              <Square size={14} strokeWidth={1.5} aria-hidden />
            </button>
          </Tooltip>
          <Tooltip label={t("assign.view.twoTip")}>
            <button type="button" aria-pressed={!view.single} aria-label={t("assign.view.two")} data-testid="assign-view-two" onClick={() => changeView({ single: false })}>
              <Columns2 size={14} strokeWidth={1.5} aria-hidden />
            </button>
          </Tooltip>
        </span>
        {/* 그다음 - 오른쪽 묶음이 줄을 넘겨도 늘 같은 자리 */}
        {canEdit && (
          <span className="flex items-center gap-1">
            <Tooltip label={t("assign.undo")}>
              <button type="button" className="btn icon h-7 w-7" aria-label={t("assign.undo")} data-testid="assign-undo" disabled={busy || !undoState.canUndo} onClick={() => void runUndoStep("undo")}>
                <Undo2 size={14} strokeWidth={1.5} aria-hidden />
              </button>
            </Tooltip>
            <Tooltip label={t("assign.redo")}>
              <button type="button" className="btn icon h-7 w-7" aria-label={t("assign.redo")} data-testid="assign-redo" disabled={busy || !undoState.canRedo} onClick={() => void runUndoStep("redo")}>
                <Redo2 size={14} strokeWidth={1.5} aria-hidden />
              </button>
            </Tooltip>
          </span>
        )}
        {checked.size > 0 && canEdit && (
          <span className="flex items-center gap-1.5 text-xs" data-testid="assign-bulk">
            <span className="text-ink-2">{t("classify.pickedCount", { n: checked.size })}</span>
            <button type="button" className="btn h-7" data-testid="assign-bulk-delete" onClick={() => setBulk("delete")}>
              <Trash2 size={14} strokeWidth={1.5} aria-hidden />
              {t("classify.deleted")}
            </button>
            <button type="button" className="btn h-7" data-testid="assign-bulk-move" onClick={() => setBulk("move")}>
              <ExternalLink size={14} strokeWidth={1.5} aria-hidden />
              {t("classify.moved")}
            </button>
          </span>
        )}
        {canEdit && (identical.data?.length ?? 0) > 0 && (
          <Tooltip label={t("assign.identical", { n: identicalCount })} suppressed={!isBarCompact}>
            <button type="button" className="btn h-7" data-testid="assign-identical" aria-label={isBarCompact ? t("assign.identical", { n: identicalCount }) : undefined} disabled={busy} onClick={() => setConfirmingIdentical(true)}>
              <Link2 size={14} strokeWidth={1.5} aria-hidden />
              {isBarCompact ? identicalCount : t("assign.identical", { n: identicalCount })}
            </button>
          </Tooltip>
        )}
        {canEdit && <ResetMenu compact={isBarCompact} document={oldView ? { id: oldView.document.id, label: oldView.document.doc_code || oldView.document.file_name } : null} disabled={busy} onPick={setResetScope} />}
        {aiOn && canEdit && <AiAskMenu compact={isBarCompact} items={aiMenuItems} label={t("ai.more")} testId="assign-ai-menu" disabled={busy} />}
        {/* 정하지 않은 AI 나누기 제안 수 - 누르면 다음 제안이 붙은 줄로 간다(오른쪽 칸에서 적용·거절) */}
        {aiOn && splitByUnit.size > 0 && (
          <Tooltip label={t("ai.nextSuggestion")}>
            <button type="button" className="pill ai h-7 cursor-pointer whitespace-nowrap" aria-label={isBarCompact ? t("ai.pendingCount", { n: splitByUnit.size }) : undefined} data-testid="assign-split-pending" onClick={selectNextSplit}>
              <WandSparkles size={13} strokeWidth={1.6} aria-hidden />
              {isBarCompact ? splitByUnit.size : t("ai.pendingCount", { n: splitByUnit.size })}
            </button>
          </Tooltip>
        )}
        {/* 확인이 남은 참조 줄 수 - 누르면 다음 줄로 간다(오른쪽 칸 카드에서 번호를 확인하거나 물린다) */}
        {canEdit && refPendingIds.length > 0 && (
          <Tooltip label={t("assign.ref.next")}>
            <button type="button" className="pill ref h-7 cursor-pointer whitespace-nowrap" aria-label={isBarCompact ? t("assign.ref.pendingCount", { n: refPendingIds.length }) : undefined} data-testid="assign-ref-pending" onClick={selectNextRef}>
              <BookMarked size={13} strokeWidth={1.6} aria-hidden />
              {isBarCompact ? refPendingIds.length : t("assign.ref.pendingCount", { n: refPendingIds.length })}
            </button>
          </Tooltip>
        )}
        {/* 누락 의심 경고 - 확인이 남아 있을 때만 보인다(검토 요청 조건). 원문 자리를 보거나 그 자리에서 확인한다 */}
        <MissingWarnings
          bundleId={bundleId}
          docs={docs.data ?? []}
          canEdit={canEdit}
          compact={isBarCompact}
          onShow={(item) => {
            const unit = item.warning.block_id === null ? undefined : viewOf(item.docId)?.units.find((candidate) => candidate.block_id === item.warning.block_id);
            const key = unit ? rowOfUnit.get(unit.id) : undefined;
            if (key === undefined) {
              // 그 자리에 단위가 없으면(통째로 빠진 글) 문서만 연다
              if (!oldDocIds.includes(item.docId)) return false;
              setManualOldDoc(item.docId);
              return true;
            }
            selectRow(key);
            return true;
          }}
          onChanged={() => {
            docs.reload();
            void loadBundle(bundleId);
          }}
        />
        <SourceFontMenu />
      </div>
    </div>
  );

  const oldDocOptions = oldDocs.map((doc) => ({ value: String(doc.id), label: doc.doc_code || doc.file_name }));
  // 한 단에서는 이미 쓴 New 문서도 같은 칸에서 고른다(그 파일의 문서 id) - 아직 쓰지 않은 New 문서는 엮은 미리 보기라 고칠 원문이 없다
  const writtenFiles = writtenDocs.flatMap(([targetDocId, code]) => {
    const fileId = (tobeData?.docs ?? []).find((doc) => doc.id === targetDocId)?.document_id ?? null;
    return fileId === null ? [] : [{ fileId, code }];
  });
  const paperDocOptions: SelectOption<string>[] = view.single
    ? [
        ...oldDocOptions,
        ...writtenFiles.map((file) => ({
          value: String(file.fileId),
          label: (
            <span>
              {file.code} <span className="text-ink-3">· {t("assign.solo.option")}</span>
            </span>
          ),
          triggerLabel: file.code,
          tip: file.code,
        })),
      ]
    : oldDocOptions;
  const newDocOptions: SelectOption<string>[] = [
    ...writtenDocs.map(([docId, code]) => ({ value: String(docId), label: code })),
    ...composedDocs.map((doc) => ({
      value: String(doc.id),
      label: (
        <span>
          {doc.code} <span className="text-ink-3">· {t("assign.composedOption")}</span>
        </span>
      ),
      triggerLabel: doc.code,
      tip: doc.code,
    })),
  ];
  const highlightIds = new Set(isSolo ? soloUnits.map((unit) => unit.id) : (row?.unitIds ?? []));
  // 양 단에서 다듬으려고 고른 New 문장의 줄, 그리고 나눌 선이 놓인 줄
  const editTargetId = isNewEdit && soloUnit !== null ? (written.find((item) => item.new_unit_id === soloUnit.id)?.target_id ?? null) : null;
  const cutTargetId = isNewEdit && cutUnit !== null ? (written.find((item) => item.new_unit_id === cutUnit.id)?.target_id ?? null) : null;
  const pickedNew = new Set(linkIds);
  // 확인이 남은 누락 의심 경고의 문단 - 용지의 그 줄에 표시한다. 위쪽 줄의 목록에서 확인하면(문서 목록을 다시 받아) 사라진다
  const warnBlockIds = new Set(listAckWarnings(docs.data ?? []).flatMap((item) => (item.docId === oldDocId && item.warning.acked_by === null && item.warning.block_id !== null ? [item.warning.block_id] : [])));
  // Shift로 고른 줄, 그리고 짝 고르기에서 모은 문장
  const pickedOld = new Set([...[...checked].flatMap((key) => rowMap.get(key)?.unitIds ?? []), ...(pairSource && pairFrom ? pairFrom.picked : [])]);
  const placeOf = (unitIds: number[]) => {
    const decided = unitIds.map((id) => unitMap.get(id)).find((unit) => unit?.status === "confirmed");
    if (!decided) return null;
    // 글 앞 아이콘이 간 곳의 종류를 말한다 - 글이 함께 있어 아이콘은 장식이다
    if (decided.decision.disposition === "delete") {
      return (
        <span className="strip-note is-delete">
          <Trash2 size={11} strokeWidth={1.75} aria-hidden />
          <span className="strip-note-text">{t("classify.deleted")}</span>
        </span>
      );
    }
    if (decided.decision.disposition === "move_external") {
      return (
        <span className="strip-note">
          <FolderOutput size={11} strokeWidth={1.75} aria-hidden />
          <span className="strip-note-text">{decided.decision.move_target_code}</span>
        </span>
      );
    }
    const linked = written.filter((item) => item.source_unit_ids.some((id) => unitIds.includes(id)));
    if (linked.length > 0) {
      // 지금 열린 New 문서의 문장이 있으면 그리로 - 없으면 첫 문장의 문서를 연다
      const goal = linked.find((item) => item.target_doc_id === newDocId) ?? linked[0];
      const sourceId = goal.source_unit_ids.find((id) => unitIds.includes(id)) ?? unitIds[0];
      return (
        <button type="button" className="strip-note" aria-label={`${t("assign.jumpNew")}: ${linked[0].doc_code}`} data-testid={`assign-note-${unitIds[0]}`} onClick={() => jumpToNew(sourceId, goal.target_id)}>
          <FileCheck2 size={11} strokeWidth={1.75} aria-hidden />
          <span className="strip-note-text">
            {linked[0].doc_code} {linked.map((item) => item.section_path || item.order_index).join(" + ")}
          </span>
        </button>
      );
    }
    return (
      <span className="strip-note">
        <Inbox size={11} strokeWidth={1.75} aria-hidden />
        <span className="strip-note-text">{t("classify.assigned")}</span>
      </span>
    );
  };

  return (
    <>
      <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_clamp(280px,24vw,420px)]" data-testid="assign">
        <div className="assign-desk">
          {bar}
          {rows.length === 0 ? (
            <EmptyState
              icon={Inbox}
              testId="assign-empty"
              title={t("classify.emptyTitle")}
              body={t("classify.noUnits")}
              action={
                <Link href={getStageHref(bundleId, "documents")} className="btn" data-testid="assign-empty-documents">
                  <FileUp size={16} strokeWidth={1.5} aria-hidden />
                  {t("assign.openDocuments")}
                </Link>
              }
            />
          ) : (
            <div ref={panesRef} className="assign-panes" data-single={view.single ? "" : undefined} style={{ "--split": `${view.split * 100}%` }}>
              <OldPane
                docOptions={paperDocOptions}
                docId={String(oldView?.document.id ?? solo?.docId ?? "")}
                docTitle={oldView?.document.title ?? ""}
                docTag={isSolo ? t("assign.writtenTag") : "Old"}
                onDocChange={(value) => {
                  if (writtenFiles.some((file) => file.fileId === Number(value))) {
                    openSolo(Number(value));
                    return;
                  }
                  setSolo(null);
                  setManualOldDoc(Number(value));
                  setSelectedKey(null);
                }}
                model={paperModel}
                fold={foldMatch && !isSolo ? { matchIds: foldMatch, open: foldOpen, onOpenChange: setFoldOpen } : undefined}
                foldEmpty={
                  isFoldEmpty
                    ? foldElsewhere.map((place) => ({ ...place, label: `${oldDocOptions.find((option) => option.value === String(place.docId))?.label ?? place.docId} · ${t(`split.tab.${place.part}`)} · ${place.count}` }))
                    : null
                }
                onFoldGo={(docId, part) => {
                  setManualOldDoc(docId);
                  setSelectedKey(null);
                  setManualPart({ key: "", part });
                }}
                placeholder={<span className="sk h-[480px] w-full" />}
                selectedId={mode === "old" && !isNewEdit ? (cutUnit?.id ?? row?.unitIds[0] ?? soloUnit?.id ?? null) : null}
                highlightIds={mode === "old" ? highlightIds : NO_NUMBERS}
                pickedIds={pickedOld}
                warnBlockIds={warnBlockIds}
                statusOf={(unitId) => unitMap.get(unitId)?.status}
                renderNote={placeOf}
                renderPills={(unitId) => {
                  const targets = linkedTargets.get(unitId);
                  return targets ? <LinkBadge unitId={unitId} targets={targets} currentDocId={newDocId} onJump={(_unitId, targetId) => showInNew(targetId)} /> : null;
                }}
                partKeys={partKeys}
                activePart={activePart}
                sheets={oldView && paperModel && activePart !== "body" ? listPartSheets(oldView, paperModel, activePart) : null}
                onPartChange={(part) => setManualPart({ key: activeKey ?? "", part })}
                onUnitClick={handleOldClick}
                onUnitContextMenu={(unitId, at, caret) => openCtxMenu(unitId, at, caret)}
                onUnitDoubleClick={canEdit ? handleOldDoubleClick : undefined}
                onRangeSelect={canEdit && mode === "old" && oldView ? (range) => setCarvePick({ docId: oldView.document.id, ...range }) : undefined}
                banner={
                  pairSource ? (
                    <div className="flex items-center gap-2 border-b border-line bg-accent-tint px-3 py-1.5 text-xs" role="status" data-testid="assign-pair-pick">
                      <Link2 size={14} strokeWidth={1.5} className="flex-none text-ink-2" aria-hidden />
                      <span className="min-w-0 flex-1 text-ink" data-testid="assign-pair-pick-text">
                        {pairFrom && pairFrom.picked.length > 0 ? t("assign.pairPicked", { id: pairSource.display_id, n: pairFrom.picked.length }) : t("assign.pairPick", { id: pairSource.display_id })}
                      </span>
                      {pairFrom && pairFrom.picked.length > 0 && (
                        <button type="button" className="btn pri h-7 flex-none" data-testid="assign-pair-pick-run" disabled={busy} onClick={() => finishPairPick(pairFrom.picked)}>
                          {t("assign.pairPickRun", { n: pairFrom.picked.length + 1 })} <kbd>↵</kbd>
                        </button>
                      )}
                      <button type="button" className="btn ghost h-7 flex-none" data-testid="assign-pair-pick-cancel" onClick={() => setPairFrom(null)}>
                        {t("common.cancel")} <kbd>Esc</kbd>
                      </button>
                    </div>
                  ) : carve && (
                    <div className="flex items-center gap-2 border-b border-line bg-accent-tint px-3 py-1.5 text-xs" role="status" data-testid="assign-carve">
                      <span className="flex-none font-semibold text-ink">{t("split.carve")}</span>
                      <Truncate className="min-w-0 flex-1 text-ink-2" text={carveText} testId="assign-carve-text" />
                      <button
                        type="button"
                        className="btn h-7 flex-none"
                        data-testid="assign-carve-run"
                        disabled={busy}
                        onClick={() => {
                          const op: EditOp = { type: "carve", block_id: carve.blockId, start: carve.start, end: carve.end };
                          clearCarve();
                          void runUnitEdit(op, t("split.didCarve"), null);
                        }}
                      >
                        <SquarePlus size={14} strokeWidth={1.5} aria-hidden />
                        {t("split.carveRun")}
                      </button>
                      <button type="button" className="btn ghost icon h-7 w-7 flex-none" aria-label={t("common.cancel")} data-testid="assign-carve-cancel" onClick={clearCarve}>
                        <X size={14} strokeWidth={1.5} aria-hidden />
                      </button>
                    </div>
                  )
                }
                cut={isNewEdit ? null : cutLine.cut}
                onCutDrag={canEdit ? cutLine.drag : undefined}
                onCutNudge={canEdit ? cutLine.nudge : undefined}
                renderAtCut={() => <CutPop busy={busy} onRun={splitAtCut} onCancel={cutLine.clear} testIdPrefix="assign" />}
                join={canEdit && mode === "old" ? { busy, plan: planOldJoin, onJoin: joinOld } : undefined}
                renderUnitActions={renderOldActions}
                figureSource={oldView ? { bundleId, docId: oldView.document.id } : undefined}
                zoom={view.zoomOld}
                onZoom={(dir) => zoomPane("old", dir)}
              />
              {!view.single && (
              <>
              <PaneDivider value={view.split} onCommit={(ratio) => changeView({ split: ratio })} onCollapse={() => changeView({ single: true })} />
              {newDocId === null ? (
                <NewPaneEmpty zoom={view.zoomNew} onGoToBe={() => navigate(getNewDocumentsHref(bundleId))} />
              ) : (
                <>
                  <NewPane
                    docOptions={newDocOptions}
                    docId={String(newDocId)}
                    onDocChange={(value) => setManualNewDoc({ key: toggleKey, docId: Number(value) })}
                    rows={newRows}
                    headingNotes={headingNotes}
                    rowsKey={isComposedDoc && !composedDoc ? `${newDocId}:loading` : String(newDocId)}
                    tag={isComposedDoc ? t("assign.composedTag") : t("assign.writtenTag")}
                    onEditOriginal={!isComposedDoc && newFileId !== null ? () => openSolo(newFileId) : undefined}
                    readOnly={isComposedDoc}
                    live={liveDoc && liveDoc.docId === newDocId ? { seq: liveDoc.seq, targetIds: liveDoc.targetIds } : null}
                    onReveal={(el, flash) => {
                      revealElement(el);
                      if (flash) flashElement(el);
                    }}
                    candidateIds={candidateIds}
                    pickedIds={pickedNew}
                    focusId={focusNew}
                    shapeId={editTargetId}
                    onShape={canEdit && mode === "old" && !isComposedDoc ? openNewCtxMenu : undefined}
                    cut={isNewEdit && cutUnit !== null && cutLine.at !== null && cutTargetId !== null ? { targetId: cutTargetId, at: cutLine.at } : null}
                    cutPop={<CutPop busy={busy} onRun={splitAtCut} onCancel={cutLine.clear} testIdPrefix="assign" />}
                    sourceLabel={(unitId) => (unitMap.get(unitId)?.display_id ?? String(unitId)).replace(/^OLD-/, "")}
                    onPick={handleNewPick}
                    onJumpSource={jumpToOld}
                    zoom={view.zoomNew}
                    onZoom={(dir) => zoomPane("new", dir)}
                    linesOn={view.lines}
                    onToggleLines={() => changeView({ lines: !view.lines })}
                  />
                  <LinkLines pairs={linkPairs} focusUnits={highlightIds} focusTargets={liveDoc ? new Set([...pickedNew, ...liveDoc.targetIds]) : pickedNew} visible={view.lines} />
                </>
              )}
              </>
              )}
            </div>
          )}
        </div>
        <aside className="assign-side" data-testid="assign-inspector">
          {renderSideBody()}
          <AssignHelp />
        </aside>
      </div>
      {menu && menuItems.length > 0 && (
        <LinkMenu key={menu.seq} anchor={menu.anchor} cover={readMenuCover(menu.anchor, rowMap.get(menu.rowKey)?.unitIds ?? [])} offset={menu.offset} items={menuItems} isUnsaved={menuItems.includes("cancel")} busy={busy} onAction={runMenu} onClose={() => setMenu(null)} />
      )}
      {ctxMenu && ctxGroups && (
        <AssignContextMenu
          key={ctxMenu.seq}
          anchor={ctxMenu.anchor}
          cover={(rowMap.get(ctxMenu.rowKey)?.unitIds ?? []).flatMap((id) => [...document.querySelectorAll<HTMLElement>(`[data-testid="assign-paper-piece-${id}"]`)])}
          click={ctxMenu.click}
          groups={ctxGroups}
          destinationLabel={destination ? readDestinationLabel(destination) : ""}
          onPick={runCtx}
          onClose={() => setCtxMenu(null)}
        />
      )}
      {confirmingIdentical && (
        <ConfirmModal
          title={t("assign.identicalTitle")}
          summary={t("assign.identicalBody", { n: identical.data?.length ?? 0 })}
          confirmLabel={t("assign.identicalConfirm")}
          confirmIcon={Link2}
          busy={busy}
          testId="assign-identical-modal"
          onConfirm={() => void confirmIdenticalAll()}
          onClose={() => setConfirmingIdentical(false)}
        />
      )}
      {editConfirm && (
        <ConfirmModal
          title={t("split.confirmTitle")}
          summary={t("split.confirmBody", { n: editConfirm.count })}
          confirmLabel={t("split.confirmRun")}
          busy={busy}
          testId="assign-edit-confirm"
          onConfirm={() => {
            const { retry } = editConfirm;
            setEditConfirm(null);
            if (retry.kind === "edit") void runUnitEdit(retry.op, retry.okText, retry.followId, true);
            else if (retry.kind === "to_pair") void switchToPair(retry.unit, true);
            else void applySplitSuggestion(retry.unit, retry.suggestion, true);
          }}
          onClose={() => setEditConfirm(null)}
        />
      )}
      {resetScope && bundle && (
        <ResetModal
          bundleId={bundleId}
          scope={resetScope}
          revision={bundle.revision}
          undo={buildUndo(resetScope.kind === "document" ? { scope_label: resetScope.label } : {})}
          onDone={() => {
            markRecorded();
            // 지운 범위의 저장 전 초안은 낡은 판단 위의 고름이라 버린다
            const scope = resetScope;
            setDrafts((prev) => Object.fromEntries(Object.entries(prev).filter(([key]) => scope.kind === "document" && rowMap.get(key)?.documentId !== scope.documentId)));
            setResetScope(null);
            setMenu(null);
            setUnitsKey((key) => key + 1);
            void loadBundle(bundleId);
          }}
          onClose={() => setResetScope(null)}
        />
      )}
      {remarkEdit?.kind === "row" && row && (
        <RemarkModal
          key={row.key}
          title={t("remark.title")}
          initial={reasonNow}
          requiredMessage={remarkEdit.need ? t(`remark.need.${remarkEdit.need}`) : null}
          confirmLabel={t(remarkEdit.then === "hold" ? "remark.saveHold" : remarkEdit.then === "confirm" ? "remark.saveConfirm" : "common.save")}
          testId="assign-remark-modal"
          onClose={() => {
            focusAfterRef.current = "assign-primary";
            setRemarkEdit(null);
          }}
          onConfirm={(text) => {
            const then = remarkEdit.then;
            focusAfterRef.current = "assign-primary";
            setRemarkEdit(null);
            // 글을 바꾸지 않고 확인하면 초안을 만들지 않는다 - 저장 안 한 변경으로 잡혀 나가기 확인·고치기 막힘이 생기지 않게
            if (text !== reasonNow) setDraft({ reason: text });
            if (then) void runSave(then, text);
          }}
        />
      )}
      {remarkEdit?.kind === "new" && (
        <RemarkModal
          title={t("remark.title")}
          initial={newRemarks[remarkEdit.targetId] ?? writtenMap.get(remarkEdit.targetId)?.remark ?? ""}
          requiredMessage={null}
          confirmLabel={t("common.save")}
          testId="assign-remark-modal"
          onClose={() => {
            focusAfterRef.current = "assign-mark-new";
            setRemarkEdit(null);
          }}
          onConfirm={(text) => {
            const targetId = remarkEdit.targetId;
            focusAfterRef.current = "assign-mark-new";
            setRemarkEdit(null);
            setNewRemarks((prev) => ({ ...prev, [targetId]: text }));
          }}
        />
      )}
      {leaveTo !== null && (
        <ConfirmModal
          title={t("assign.leaveTitle")}
          summary={t("assign.leaveBody", { n: unsavedCount })}
          confirmLabel={t("assign.leaveConfirm")}
          danger
          testId="assign-leave"
          onConfirm={() => {
            const href = leaveTo;
            setLeaveTo(null);
            setDrafts({});
            navigate(href, { immediate: true });
          }}
          onClose={() => setLeaveTo(null)}
        />
      )}
      {bulk && (
        <BulkModal
          bundleId={bundleId}
          action={bulk}
          count={pickedOld.size}
          onClose={() => setBulk(null)}
          onConfirm={async (bulkReason, code) => {
            const unitRows = [...pickedOld].map((id) => unitMap.get(id)).filter((unit): unit is UnitRow => unit !== undefined);
            try {
              await bulkDecide(bundleId, {
                action: bulk === "delete" ? "delete" : "move_external",
                reason: bulkReason,
                move_target_code: code,
                units: unitRows.map((unit) => ({ unit_id: unit.unit_id, revision: unit.decision.revision })),
              }, buildUndo());
              markRecorded();
              showToast(t("classify.bulkDone", { n: unitRows.length }));
              setBulk(null);
              setChecked(new Set());
              // 한 번에 삭제·이동도 서버가 짝을 정리하지만 어느 짝인지 알려 주지 않는다 - 짝 모양·문서 revision을 다시 받는다
              views.reload();
              setUnitsKey((key) => key + 1);
              void loadBundle(bundleId);
            } catch (err) {
              showToast(humanizeApiError(err, t), "error");
              // revision이 낡아 거절됐을 수 있다 - 다시 불러와야 다음 시도가 같은 이유로 실패하지 않는다
              setUnitsKey((key) => key + 1);
            }
          }}
        />
      )}
    </>
  );
}

/** 끝낸 Old 줄 수 - 확정만 센다(보류는 아직 끝나지 않았다) */
function countDone(rows: ClassifyRow[]): number {
  return rows.filter((row) => row.status === "confirmed").length;
}

interface BulkModalProps {
  bundleId: number;
  action: "delete" | "move";
  count: number;
  onClose: () => void;
  onConfirm: (reason: string, code: string) => Promise<void>;
}

function BulkModal({ bundleId, action, count, onClose, onConfirm }: BulkModalProps) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = reason.trim() !== "" && (action === "delete" || code.trim() !== "");
  return (
    <Modal
      title={action === "delete" ? t("classify.bulkDeleteTitle") : t("classify.bulkMoveTitle")}
      onClose={onClose}
      isBusy={busy}
      testId="assign-bulk-modal"
      footer={
        <>
          <button type="button" className="btn" data-testid="assign-bulk-cancel" onClick={onClose}>
            <X size={16} strokeWidth={1.5} aria-hidden />
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className={`btn ${action === "delete" ? "danger" : "pri"}`}
            data-testid="assign-bulk-confirm"
            disabled={!ready || busy}
            onClick={async () => {
              setBusy(true);
              await onConfirm(reason.trim(), code.trim());
              setBusy(false);
            }}
          >
            {action === "delete" ? <Trash2 size={16} strokeWidth={1.5} aria-hidden /> : <ExternalLink size={16} strokeWidth={1.5} aria-hidden />}
            {t("classify.bulkRun", { n: count })}
          </button>
        </>
      }
    >
      <div className="grid gap-1.5 rounded-md bg-sunken px-3 py-2.5 text-[13px] leading-5 text-ink-2">{t("classify.bulkBody", { n: count })}</div>
      {/* 하나씩 저장할 때의 Remark 창과 같은 칸·최근 사유 - 이 창 안에서 바로 쓴다(창 위에 창을 열지 않는다) */}
      <label className="grid gap-1">
        <span className="text-xs text-ink-2">{t("classify.reason")}</span>
        <textarea
          rows={3}
          className="block w-full resize-y rounded-md border border-line-2 bg-surface px-2 py-[5px] text-[13px] leading-[19px] text-ink focus:border-accent focus:outline-none"
          data-testid="assign-bulk-reason"
          value={reason}
          maxLength={REMARK_MAX_LENGTH}
          autoFocus
          onChange={(event) => setReason(event.target.value)}
        />
      </label>
      <RecentRemarks testId="assign-bulk-recent" onPick={setReason} />
      {action === "move" && (
        <div className="grid gap-1">
          <span className="text-xs text-ink-2">{t("classify.moveTo")}</span>
          <MoveTargetField bundleId={bundleId} value={code} testId="assign-bulk-code" onChange={setCode} />
        </div>
      )}
    </Modal>
  );
}
