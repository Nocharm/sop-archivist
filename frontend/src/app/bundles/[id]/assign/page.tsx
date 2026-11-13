// 3단계 Assign - Old 조각을 한 줄씩(한/영 짝은 함께) 보낼 곳을 정한다. 보낼 곳은 이미 쓴 New 문서의 문장(옛 짝 맞추기)이거나
// 아직 안 쓴 To-Be 문서의 칸(옛 분류), 또는 삭제·외부 이동이다. 가운데는 Old 원문(Split 조각이 곧 목록) ‖ New 원문,
// 오른쪽은 고른 곳·확정·우선순위 아코디언이다(설계 docs/superpowers/specs/2026-11-09-assign-unified-design.md).
"use client";

import { Check, Circle, CircleCheck, CircleDashed, CirclePause, ExternalLink, FileCheck2, FilePen, FileUp, FolderOutput, Inbox, Link2, ListFilter, ListTree, Locate, MapPin, MoveRight, Redo2, RefreshCw, Sparkles, Trash2, TriangleAlert, Undo2, X, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useEffectEvent, useMemo, useRef, useState, type MouseEvent } from "react";

import { AssignContextMenu } from "@/components/assign/assign-context-menu";
import { AssignHelp } from "@/components/assign/assign-help";
import { DestCard } from "@/components/assign/dest-card";
import { DestinationAccordion, type AccordionSection } from "@/components/assign/destination-accordion";
import { DestinationTree } from "@/components/assign/destination-tree";
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
import { listAppliedSuggestions, requestAi, type AiKind, type AiScope } from "@/lib/api-manage";
import {
  bulkDecide,
  editUnits,
  clearDecisions,
  confirmMatchesInBulk,
  getComposedDoc,
  getDocumentView,
  getGroupByTarget,
  getGroupByUnit,
  getToBe,
  listAllUnits,
  listDocuments,
  listIdenticalCandidates,
  listNewCandidates,
  listSuggestions,
  listWrittenSentences,
  redoDecision,
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
  type UndoMeta,
  type UnitRow,
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
import { buildAssignMenu, type AssignMenuAction } from "@/lib/assign-context-menu-model";
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
import { buildPaperModel, buildPaperTabs, findNearestCut, shouldRecenter, type PaperTabKey } from "@/lib/paper-model";
import { SLOT_LABELS } from "@/lib/slot-labels";
import { getStageHref } from "@/lib/stages";
import { useAiJobs } from "@/lib/use-ai-jobs";
import { useDelayedFlag } from "@/lib/use-delayed-flag";
import { useCutLine } from "@/lib/use-cut-line";
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
  const tobe = useLoaded(() => getToBe(bundleId), String(bundleId));
  const writtenList = useLoaded(() => listWrittenSentences(bundleId), dataKey);
  const identical = useLoaded(() => listIdenticalCandidates(bundleId), dataKey);
  // AI 작업이 끝나면 단위·제안·New 문장을 다시 불러온다 - 제안이 보이고 다음 저장이 낡은 revision으로 409가 나지 않는다
  const aiJobs = useAiJobs(bundleId, () => {
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
  const writtenMap = useMemo(() => new Map(written.map((row) => [row.target_id, row])), [written]);
  const viewList = views.data;
  const rows = useMemo(() => (viewList ? buildRows(viewList, unitMap) : []), [viewList, unitMap]);
  const rowMap = new Map(rows.map((row) => [row.key, row]));
  const rowOfUnit = new Map(rows.flatMap((row) => row.unitIds.map((id) => [id, row.key] as const)));
  const options = useMemo(() => (tobe.data ? buildDestinationOptions(tobe.data, SLOT_LABELS) : []), [tobe.data]);
  const ready = viewList !== null && units.data !== null && tobe.data !== null && writtenList.data !== null;
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
  if (ctxMenu !== null && ctxMenu.rowKey !== activeKey) setCtxMenu(null);
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
  const oldView = viewOf(row?.documentId ?? manualOldDoc ?? oldDocIds[0]);
  const paperModel = useMemo(() => (oldView ? buildPaperModel(oldView) : null), [oldView]);
  // 본문·머리말·꼬리말 탭 - 고른 조각이 다른 탭에 있으면 그 탭으로 가고, 사람이 고른 탭은 그 줄에서 그대로 둔다
  const partKeys = useMemo(() => (paperModel ? (["body", "header", "footer"] as const).filter((key) => paperModel[key].length > 0) : []), [paperModel]);
  const paperTabs = useMemo(() => (oldView && paperModel ? buildPaperTabs(oldView, paperModel) : null), [oldView, paperModel]);
  const partOf = paperTabs?.tabOf ?? null;
  const cutUnit = cutUnitId !== null && row?.unitIds.includes(cutUnitId) ? (paperModel?.units.get(cutUnitId) ?? null) : null;
  const cutLine = useCutLine(cutUnit);
  // Old 조각 → 그 조각을 출처로 쓴 New 문장들(연결 배지)
  const linkedTargets = useMemo(() => {
    const map = new Map<number, WrittenSentence[]>();
    for (const item of written) for (const unitId of item.source_unit_ids) map.set(unitId, [...(map.get(unitId) ?? []), item]);
    return map;
  }, [written]);
  const [manualPart, setManualPart] = useState<{ key: string; part: PaperTabKey } | null>(null);
  const wantedPart = (manualPart?.key === (activeKey ?? "") ? manualPart.part : null) ?? partOf?.get(row?.unitIds[0] ?? -1) ?? "body";
  const activePart = partKeys.includes(wantedPart) ? wantedPart : (partKeys[0] ?? "body");
  // 필터 접기 - 지금 문서·부분에 맞는(또는 고른) Unit이 없으면 용지 대신 빈 상태와 맞는 곳 바로 가기(저절로 옮기지 않는다)
  const isInPart = (unitId: number) => partKeys.length <= 1 || partOf?.get(unitId) === activePart;
  const isFoldEmpty = foldMatch !== null && oldView !== null && !oldView.units.some((unit) => isInPart(unit.id) && (foldMatch.has(unit.id) || (row?.unitIds.includes(unit.id) ?? false)));
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
  const composedDocs = (tobe.data?.docs ?? []).filter((doc) => doc.entrance === "assign");
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

  function selectRow(key: string, scroll = true) {
    setMode("old");
    setSelectedKey(key);
    setMenu(null);
    setCtxMenu(null);
    if (key !== activeKey) setCutUnitId(null);
    const first = rowMap.get(key)?.unitIds[0];
    if (scroll && first !== undefined) scrollToUnit(first);
  }

  function moveRow(step: 1 | -1) {
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

  const ctxTarget = ctxMenu ? (paperModel?.units.get(ctxMenu.unitId) ?? null) : null;
  const ctxGroups = (() => {
    if (!ctxTarget || !paperTabs || !paperModel) return null;
    const order = paperTabs.order;
    const at = order.indexOf(ctxTarget.id);
    const neighbor = (step: number) => (at < 0 ? null : (paperModel.units.get(order[at + step]) ?? null));
    return buildAssignMenu({
      target: ctxTarget,
      prev: neighbor(-1),
      next: neighbor(1),
      readOnly: !canEdit,
      rowStatus: row?.status ?? "unassigned",
      hasDestination: destination !== null,
      isConfirmedAsIs: row?.status === "confirmed" && !hasDraftChange(draft),
      isDecided: isUnitDecided,
      hasDraft: hasUnitDraft,
      canSplit: findNearestCut(ctxTarget, Math.floor(ctxTarget.text.length / 2)) !== null,
    });
  })();
  // 메뉴를 연 뒤 편집으로 그 문장이 사라졌으면 닫는다(렌더 중 상태 맞추기)
  if (ctxMenu !== null && paperModel !== null && ctxTarget === null) setCtxMenu(null);

  /** 우클릭(또는 메뉴 글쇠) - 그 문장의 줄을 고르고 줄 상자 옆에 메뉴를 연다 */
  function openCtxMenu(unitId: number, click: { x: number; y: number } | null, caret: { blockId: number; offset: number } | null) {
    if (mode !== "old") return;
    const key = findRowKey(unitId);
    const anchor = document.querySelector<HTMLElement>(`[data-testid="assign-paper-piece-${unitId}"]`) ?? document.querySelector<HTMLElement>(`[data-testid="assign-paper-unit-${unitId}"]`);
    if (!key || !anchor) return;
    if (key !== activeKey) selectRow(key, false);
    setChecked(new Set());
    setMenu(null);
    menuSeq.current += 1;
    setCtxMenu({ seq: menuSeq.current, unitId, rowKey: key, anchor, click, caret });
  }

  /** 편집 한 번 - 끝나면 원문 보기·단위를 다시 받고 followId(없으면 새로 생긴 첫 단위)의 줄을 고른다 */
  async function runUnitEdit(op: EditOp, okText: string, followId: number | null) {
    if (!oldView || busy) return;
    setBusy(true);
    try {
      // 자르기·합치기·언어 바꾸기 모두 Assign 기록에 넣는다(설계 §4.4) - 서버는 Split 편집 기록 번호만 가리킨다
      const undo = buildUndo({ focus_unit_id: op.type === "split" ? op.unit_id : (followId ?? undefined) });
      const result = await editUnits(bundleId, oldView.document.id, oldView.document.revision, op, false, undo);
      markRecorded();
      cutLine.clear();
      setCutUnitId(null);
      // 고친 줄의 Unit은 은퇴했을 수 있다 - 다시 받는 동안 그 Unit의 묶음·후보를 부르지 않게 고름을 비우고, 새 줄이 생기면 follow가 고른다
      setSelectedKey(null);
      showToast(okText);
      const next = result.created_unit_ids[0] ?? followId;
      if (next !== null && next !== undefined) setFollow({ unitId: next, staleViews: viewList, staleUnits: units.data });
    } catch (err) {
      // 판단이 걸린 단위(다른 문장의 출처 등)는 Split처럼 확인하고 떼어 내지 않는다 - 배정 화면에서는 먼저 배정을 취소하게 한다
      const isLinked = err instanceof ApiError && err.rule?.code === "confirm_required";
      showToast(isLinked ? t("assign.ctx.why.assigned") : humanizeApiError(err, t), "error");
    } finally {
      views.reload();
      setUnitsKey((key) => key + 1);
      void loadBundle(bundleId);
      setBusy(false);
    }
  }

  function splitAtCut() {
    if (!cutUnit || cutLine.at === null) return;
    void runUnitEdit({ type: "split", unit_id: cutUnit.id, at: cutLine.at }, t("split.didSplit"), null);
  }

  /** 두 번 누른 자리에 나눌 선 - 메뉴의 "Split here"를 쓸 수 있는 문장만 */
  function handleOldDoubleClick(unitId: number, caret: { blockId: number; offset: number } | null) {
    const unit = paperModel?.units.get(unitId);
    if (!unit || !canEdit || mode !== "old" || isUnitDecided(unit) || hasUnitDraft(unit) || !["sentence", "heading", "cell_sentence"].includes(unit.kind)) return;
    if (cutLine.placeAtCaret(unit, caret)) setCutUnitId(unit.id);
  }

  function runCtx(action: AssignMenuAction, lang?: "ko" | "en") {
    const target = ctxTarget;
    const caret = ctxMenu?.caret ?? null;
    setCtxMenu(null);
    if (!target) return;
    if (action === "confirm") void runSave("confirm");
    else if (action === "clear") void runClear();
    else if (action === "split") {
      // 이미 그 문장에 선이 있으면 바로 나누고, 없으면 누른 자리(키보드면 가운데) 가까이에 선을 놓는다 - 끌거나 ←→로 옮긴 뒤 Split here
      if (cutUnit?.id === target.id && cutLine.at !== null) splitAtCut();
      else if (cutLine.placeNear(target, caret)) setCutUnitId(target.id);
    } else if ((action === "merge_prev" || action === "merge_next") && paperTabs) {
      const order = paperTabs.order;
      const other = order[order.indexOf(target.id) + (action === "merge_prev" ? -1 : 1)];
      const ids = action === "merge_prev" ? [other, target.id] : [target.id, other];
      void runUnitEdit({ type: "merge", unit_ids: ids }, t("split.didMerge"), null);
    } else if (action === "lang" && lang) void runUnitEdit({ type: "set_language", unit_ids: [target.id], lang }, t("common.saved"), target.id);
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
      // 자르기를 거꾸로 하면 Unit이 은퇴할 수 있다 - 다시 받는 동안 그 줄의 묶음·후보를 부르지 않게 고름을 비운다
      if (result.op === "cut") {
        cutLine.clear();
        setCutUnitId(null);
        setSelectedKey(null);
      }
      if (mode === "unsourced" && result.focus_target_id !== null) setSelNew(result.focus_target_id);
      else if (result.focus_unit_id !== null) setFollow({ unitId: result.focus_unit_id, staleViews: viewList, staleUnits: units.data });
      else if (result.focus_target_id !== null) showInNew(result.focus_target_id);
      showToast(formatDecisionStep(result, kind));
    } catch (err) {
      const code = err instanceof ApiError ? err.rule?.code : undefined;
      if (code === "nothing_to_undo") setUndoState((prev) => ({ ...prev, canUndo: false }));
      else if (code === "nothing_to_redo") setUndoState((prev) => ({ ...prev, canRedo: false }));
      // 자르기를 거꾸로 할 조각에 그 사이 판단이 걸렸다 - 묻지 않고 거절한다(설계 §4.4)
      showToast(code === "confirm_required" ? t("assign.ctx.why.assigned") : humanizeApiError(err, t), "error");
    } finally {
      // 거절도 그 사이 바뀐 것이 있다는 뜻이라 다시 받는다 - 짝 모양이 바뀌었을 수 있어 원문 보기도
      views.reload();
      setUnitsKey((key) => key + 1);
      void loadBundle(bundleId);
      setBusy(false);
    }
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
    setJump({ side: "new", id: targetId, targetId, rowKey: key });
  }

  /** Old 조각의 연결 배지를 누름 - 고름·메뉴는 그대로 두고 오른쪽 칸을 그 문장으로 보내 번쩍이게만 한다 */
  function showInNew(targetId: number) {
    const docId = writtenMap.get(targetId)?.target_doc_id;
    if (docId !== undefined) setManualNewDoc({ key: toggleKey, docId });
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

  function handleOldClick(unitId: number, keys: { shiftKey: boolean }) {
    if (mode === "unsourced") {
      void linkAsSource(unitId);
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
      else setChecked(new Set());
    } else if (!canEdit || !row) return;
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
    { key: "all", icon: ListTree, title: t("assign.acc.all"), count: written.length + options.filter(isPlaceOption).length, body: <DestinationTree written={written} options={treeOptions} tobeHref={getStageHref(bundleId, "tobe")} onPickLink={pickNewSentence} onPickPlace={pickDestination} /> },
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
          // 읽기 보기는 문장마다 한 줄(언어 · 글 · 끝에 변경 종류) - 결정 칸을 낮게 두어 위 목록이 늘 보이게. 전체 글은 올리면 툴팁, 고치기는 Edit and confirm
          if (!editing) {
            return (
              <div key={slot.key} className="chosen-line">
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
    <Tooltip label={t("assign.why.pickFirst")} suppressed={destination !== null || !row}>
      <button type="button" className="btn pri assign-confirm" data-testid="assign-primary" data-state={primaryState} disabled={!canEdit || !row || busy || !destination} onClick={handlePrimary}>
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
  const meta = (
    <div className="assign-meta">
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
        {/* ① 보낼 곳 - 패널에서 이곳만 스크롤된다. 바로 아래 결정 칸이 붙어 있어 고른 곳에서 확정까지 손이 짧다 */}
        <div className="assign-pick" data-testid="assign-pick" onClickCapture={handlePickClickCapture}>
          {renderStep(1, t("assign.step.pick"))}
          <DestinationAccordion sections={accSections} open={accOpen} onToggle={toggleAcc} />
          <div className="px-[var(--pad)] pb-[var(--pad)] pt-1">{aiNote}</div>
        </div>
        {/* ② 결정 칸 - 패널 아래에 붙는다. 다른 길 셋 · 고른 곳(높이 상한 안에서 이 부분만 스크롤) · 대상 문서 · Remark · 맨 아래 확정 */}
        <div className="assign-decide" data-testid="assign-decide">
          <div className="assign-decide-body">
            {renderStep(2, t("assign.step.decide"))}
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
            onClick={() => setMode("unsourced")}
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
        {/* 맨 앞 - 오른쪽 묶음이 줄을 넘겨도 늘 같은 자리 */}
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
        <SourceFontMenu />
      </div>
    </div>
  );

  const oldDocOptions = oldDocs.map((doc) => ({ value: String(doc.id), label: doc.doc_code || doc.file_name }));
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
  const highlightIds = new Set(row?.unitIds ?? []);
  const pickedNew = new Set(linkIds);
  const pickedOld = new Set([...checked].flatMap((key) => rowMap.get(key)?.unitIds ?? []));
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
            <div ref={panesRef} className="assign-panes" style={{ "--split": `${view.split * 100}%` }}>
              <OldPane
                docOptions={oldDocOptions}
                docId={String(oldView?.document.id ?? "")}
                docTitle={oldView?.document.title ?? ""}
                onDocChange={(value) => {
                  setManualOldDoc(Number(value));
                  setSelectedKey(null);
                }}
                model={paperModel}
                fold={foldMatch ? { matchIds: foldMatch, open: foldOpen, onOpenChange: setFoldOpen } : undefined}
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
                selectedId={mode === "old" ? (cutUnit?.id ?? row?.unitIds[0] ?? null) : null}
                highlightIds={mode === "old" ? highlightIds : NO_NUMBERS}
                pickedIds={pickedOld}
                statusOf={(unitId) => unitMap.get(unitId)?.status}
                renderNote={placeOf}
                renderPills={(unitId) => {
                  const targets = linkedTargets.get(unitId);
                  return targets ? <LinkBadge unitId={unitId} targets={targets} currentDocId={newDocId} onJump={(_unitId, targetId) => showInNew(targetId)} /> : null;
                }}
                partKeys={partKeys}
                activePart={activePart}
                onPartChange={(part) => setManualPart({ key: activeKey ?? "", part })}
                onUnitClick={handleOldClick}
                onUnitContextMenu={(unitId, at, caret) => openCtxMenu(unitId, at, caret)}
                onUnitDoubleClick={canEdit ? handleOldDoubleClick : undefined}
                cut={cutLine.cut}
                onCutDrag={canEdit ? cutLine.drag : undefined}
                onCutNudge={canEdit ? cutLine.nudge : undefined}
                renderAtCut={() => <CutPop busy={busy} onRun={splitAtCut} onCancel={cutLine.clear} testIdPrefix="assign" />}
                figureSource={oldView ? { bundleId, docId: oldView.document.id } : undefined}
                zoom={view.zoomOld}
                onZoom={(dir) => zoomPane("old", dir)}
              />
              <PaneDivider value={view.split} onCommit={(ratio) => changeView({ split: ratio })} />
              {newDocId === null ? (
                <NewPaneEmpty zoom={view.zoomNew} onGoToBe={() => navigate(getStageHref(bundleId, "tobe"))} />
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
                    readOnly={isComposedDoc}
                    live={liveDoc && liveDoc.docId === newDocId ? { seq: liveDoc.seq, targetIds: liveDoc.targetIds } : null}
                    onReveal={(el, flash) => {
                      revealElement(el);
                      if (flash) flashElement(el);
                    }}
                    candidateIds={candidateIds}
                    pickedIds={pickedNew}
                    focusId={focusNew}
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
