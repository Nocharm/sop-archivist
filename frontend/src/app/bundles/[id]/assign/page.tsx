// 3단계 Assign - Old 조각을 한 줄씩(한/영 짝은 함께) 보낼 곳을 정한다. 보낼 곳은 이미 쓴 New 문서의 문장(옛 짝 맞추기)이거나
// 아직 안 쓴 To-Be 문서의 칸(옛 분류), 또는 삭제·외부 이동이다. 가운데는 Old 원문(Split 조각이 곧 목록) ‖ New 원문,
// 오른쪽은 고른 곳·확정·우선순위 아코디언이다(설계 docs/superpowers/specs/2026-11-09-assign-unified-design.md).
"use client";

import { Check, Circle, CircleCheck, CircleDashed, CirclePause, ExternalLink, FilePen, FileText, FileUp, Inbox, Link2, ListChecks, ListFilter, RefreshCw, Sparkles, Trash2, TriangleAlert, X } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useEffectEvent, useMemo, useRef, useState, type MouseEvent } from "react";

import { AssignHelp } from "@/components/assign/assign-help";
import { DestCard } from "@/components/assign/dest-card";
import { DestinationAccordion, type AccordionSection } from "@/components/assign/destination-accordion";
import { DestinationTree } from "@/components/assign/destination-tree";
import { LinkChoice } from "@/components/assign/link-choice";
import { findNewLine, findOldStrip, LinkLines } from "@/components/assign/link-lines";
import { LinkMenu } from "@/components/assign/link-menu";
import { NewPane } from "@/components/assign/new-pane";
import { OldPane } from "@/components/assign/old-pane";
import { PaneDivider } from "@/components/assign/pane-divider";
import { AiAskMenu, type AiAskItem } from "@/components/manage/ai-ask-menu";
import { Modal } from "@/components/modal";
import { ReadOnlyNote } from "@/components/read-only-note";
import { SourceFontMenu } from "@/components/paper/source-font-menu";
import { UnitStatusPill } from "@/components/status";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadError } from "@/components/ui/load-error";
import { Truncate } from "@/components/ui/motion";
import { showToast } from "@/components/ui/toast";
import { humanizeApiError } from "@/lib/api-errors";
import { listAppliedSuggestions, requestAi, type AiKind, type AiScope } from "@/lib/api-manage";
import {
  bulkDecide,
  clearDecisions,
  confirmMatchesInBulk,
  deletePair,
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
  saveGroup,
  type AiSuggestion,
  type ChangeTypeInput,
  type DocumentView,
  type Group,
  type NewCandidate,
  type UnitRow,
  type WrittenSentence,
} from "@/lib/api-sop";
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
import { readAssignView, writeAssignView } from "@/lib/assign-view-prefs";
import { loadBundle, useBundle } from "@/lib/bundle-store";
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
  isTextChangeType,
  listLinkLeftovers,
  listUnpairedKeys,
  pickFirstFilter,
  readCheckKey,
  readDestination,
  readHumanReason,
  readLinkDefault,
  type CellSource,
  type ClassifyFilter,
  type ClassifyRow,
  type Destination,
  type DestinationOption,
  type RowDraft,
} from "@/lib/classify-model";
import { formatKst } from "@/lib/datetime";
import { useI18n } from "@/lib/i18n";
import { useLeaveGuard } from "@/lib/leave-guard";
import { buildIdenticalBatches } from "@/lib/match-model";
import { navigate } from "@/lib/nav-buffer";
import { buildPaperModel, shouldRecenter } from "@/lib/paper-model";
import { SLOT_LABELS } from "@/lib/slot-labels";
import { getStageHref } from "@/lib/stages";
import { useAiJobs } from "@/lib/use-ai-jobs";
import { useDelayedFlag } from "@/lib/use-delayed-flag";
import { useLoaded } from "@/lib/use-loaded";
import { usePaneZoom, type PaneKey, type ZoomDir } from "@/lib/use-pane-zoom";
import { Select } from "@/components/ui/select";

type Filter = ClassifyFilter;
const FILTERS: Filter[] = ["unassigned", "ai_suggested", "on_hold", "confirmed", "all"];
// 필터 필의 아이콘·색 - 상태 색은 status.tsx UNIT_STATUS와 같은 뜻(색 토큰은 components.css .fpill)
const FILTER_LOOK: Record<Filter, { tone: string; Icon: typeof Circle }> = {
  unassigned: { tone: "none", Icon: Circle },
  ai_suggested: { tone: "ai", Icon: CircleDashed },
  on_hold: { tone: "hold", Icon: CirclePause },
  confirmed: { tone: "ok", Icon: CircleCheck },
  all: { tone: "all", Icon: ListFilter },
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

export default function AssignPage() {
  const { t } = useI18n();
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
  const [filter, setFilter] = useState<Filter>("unassigned");
  const [snapshot, setSnapshot] = useState<{ filter: Filter; keys: string[] } | null>(null);
  const counts: Record<Filter, number> = { unassigned: 0, ai_suggested: 0, on_hold: 0, confirmed: 0, all: rows.length };
  for (const row of rows) counts[row.status] += 1;
  const listKeys = snapshot && snapshot.filter === filter ? snapshot.keys.filter((key) => rowMap.has(key)) : rows.filter((row) => filter === "all" || row.status === filter).map((row) => row.key);

  // 처음 불러온 순간의 목록을 붙잡는다 - 그래야 확정한 줄이 거르기에서 바로 빠지지 않는다(렌더 중 상태 맞추기)
  if (snapshot === null && rows.length > 0 && units.data !== null) {
    const first = pickFirstFilter(counts);
    setFilter(first);
    setSnapshot({ filter: first, keys: rows.filter((item) => first === "all" || item.status === first).map((item) => item.key) });
  }

  function applyFilter(next: Filter) {
    setMode("old");
    setFilter(next);
    setSnapshot({ filter: next, keys: rows.filter((row) => next === "all" || row.status === next).map((row) => row.key) });
  }

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
  // 그 자리 메뉴와 이동 - 이동은 고른 줄·열린 문서가 다시 그려진 뒤에 그 자리를 찾는다
  const [menu, setMenu] = useState<MenuState | null>(null);
  const menuSeq = useRef(0);
  function openMenu(anchor: HTMLElement, event: MouseEvent | null, rowKey: string, targetId: number | null) {
    menuSeq.current += 1;
    setMenu({ seq: menuSeq.current, anchor, offset: readMenuOffset(anchor, event), rowKey, targetId });
  }
  const [jump, setJump] = useState<{ side: "old" | "new"; id: number; targetId: number; rowKey: string } | null>(null);
  // 고른 줄이 어떤 길로든 바뀌면(↑↓·저장 뒤 다음 줄·짝 풀림·문서 바꾸기) 메뉴를 닫는다 - 다른 줄에서 낡은 메뉴가 되살아나지 않게(렌더 중 상태 맞추기)
  if (menu !== null && menu.rowKey !== activeKey) setMenu(null);
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
  const reason = draft.reason ?? savedReason;
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
      })
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
  const writtenDocs = [...new Map(written.map((item) => [item.target_doc_id, item.doc_code])).entries()];
  // New 원문은 고른 곳·맨 위 후보가 이미 쓴 문서일 때 자동으로 열린다. 사람이 그 줄에서 열고 닫으면 그 값을 따른다
  const [newToggle, setNewToggle] = useState<{ key: string; open: boolean } | null>(null);
  const [manualNewDoc, setManualNewDoc] = useState<{ key: string; docId: number } | null>(null);
  const toggleKey = mode === "unsourced" ? "unsourced" : (activeKey ?? "");
  const topLink = recommendations.find((rec) => rec.destination.kind === "link")?.destination ?? null;
  const autoNewOpen = mode === "unsourced" || destination?.kind === "link" || (!destination && topLink !== null);
  const newOpen = writtenDocs.length > 0 && (newToggle?.key === toggleKey ? newToggle.open : autoNewOpen);
  const autoNewDoc = mode === "unsourced" ? (writtenMap.get(focusNew ?? -1)?.target_doc_id ?? null) : (findLinkDoc(destination, writtenMap) ?? findLinkDoc(topLink, writtenMap));
  const newDocId = (manualNewDoc?.key === toggleKey ? manualNewDoc.docId : null) ?? autoNewDoc ?? writtenDocs[0]?.[0] ?? null;
  const newRows = written.filter((item) => item.target_doc_id === newDocId);
  // 두 문서 사이 이음 - 저장된 출처와 고른 줄의 저장 전 고름
  const oldUnitIds = useMemo(() => new Set(oldView?.units.map((unit) => unit.id) ?? []), [oldView]);
  const linkPairs = buildLinkPairs(newRows, oldUnitIds, draft.destination?.kind === "link" ? { units: rowUnits.map((unit) => ({ id: unit.unit_id, lang: unit.lang })), targetIds: draft.destination.targetIds } : null);

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

  const reasonRef = useRef<HTMLInputElement>(null);
  const firstTextRef = useRef<HTMLTextAreaElement>(null);
  const [busy, setBusy] = useState(false);
  const [bulk, setBulk] = useState<"delete" | "move" | null>(null);
  const [confirmingIdentical, setConfirmingIdentical] = useState(false);
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
  const slots = buildSentenceSlots(groupData, saveUnits);

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
    const first = rowMap.get(key)?.unitIds[0];
    if (scroll && first !== undefined) scrollToUnit(first);
  }

  function moveRow(step: 1 | -1) {
    if (listKeys.length === 0) return;
    const index = activeKey ? listKeys.indexOf(activeKey) : -1;
    selectRow(listKeys[Math.min(Math.max(index + step, 0), listKeys.length - 1)]);
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
   * 한 언어만 이어 확정한 짝 줄의 짝을 푼다 - 남은 언어 문장이 제 줄이 되어 사람이 따로 끝낸다(명세 §6.5).
   * 이음은 이미 저장됐으니 여기서 실패해도 되돌리지 않고 따로 알린다(Split에서 손으로 풀 수 있다).
   */
  async function splitPairRow(pairRow: ClassifyRow, leftovers: number[]): Promise<boolean> {
    if (pairRow.pairId === null) return false;
    const ids = leftovers.map((id) => unitMap.get(id)?.display_id ?? String(id)).join(", ");
    try {
      // 짝 풀기는 문서 revision을 본다 - 이 화면에 들어온 뒤 Split에서 고쳤을 수 있어 새로 읽는다
      const fresh = (await listDocuments(bundleId)).find((doc) => doc.id === pairRow.documentId);
      await deletePair(bundleId, pairRow.documentId, pairRow.pairId, fresh?.revision ?? 0);
    } catch (err) {
      showToast(`${t("assign.leftover.unpairFailed", { ids })} ${humanizeApiError(err, t)}`, "error");
      // 다른 곳에서 이미 풀었을 수도 있다 - 지금 짝 모양을 다시 받는다
      views.reload();
      return false;
    }
    // 거르기 자리의 짝 줄을 풀린 줄들로 바꾼다 - 남은 문장이 목록에서 사라지지 않게
    setSnapshot((prev) => prev && { ...prev, keys: prev.keys.flatMap((key) => (key === pairRow.key ? listUnpairedKeys(pairRow) : [key])) });
    views.reload();
    showToast(t("assign.leftover.split", { ids }));
    return true;
  }

  async function runSave(action: "confirm" | "hold") {
    // 보낼 곳 없이는 보류만 된다(처분 unassigned + hold, 사유는 hold_reason)
    if (!row || busy || groupPending || pickedGroups.isLoading || (!destination && action !== "hold")) return;
    const spansDocs = new Set(linkIds.map((id) => writtenMap.get(id)?.target_doc_id)).size > 1;
    const needsReason = action === "hold" || destination?.kind === "delete" || destination?.kind === "move" || spansDocs;
    if (needsReason && !reason.trim()) {
      showToast(t(action === "hold" ? "classify.holdReasonNeeded" : "classify.reasonNeeded"), "error");
      reasonRef.current?.focus();
      return;
    }
    if (destination?.kind === "move" && !moveCode.trim()) {
      showToast(t("classify.moveCodeNeeded"), "error");
      return;
    }
    setBusy(true);
    try {
      // 고친 칸만 글을 보낸다 - 손대지 않은 AI 제안은 글·종류를 비워 보내 제안 그대로 받는다
      const context = { units: saveUnits, group: saveGroupData, tables: buildTables() };
      const body = buildGroupSave({ ...draft, destination, reason, moveCode }, context, action, action === "hold" ? reason.trim() : "");
      const leftovers = action === "confirm" ? listLinkLeftovers(destination, context) : [];
      await saveGroup(bundleId, body);
      // 저장했으면 메뉴의 고름은 끝났다 - 다음 줄이 없거나 같은 줄에 남아도 닫는다
      setMenu(null);
      showToast(action === "hold" ? t("classify.held") : t("classify.confirmed"));
      const isSplit = leftovers.length > 0 && (await splitPairRow(row, leftovers));
      // 다음 미확정 줄로 - 지금 줄은 거르기 자리에 남는다. 짝을 풀었으면 남은 문장의 줄이 다음이다
      const next = action === "confirm" && !isSplit ? findNextOpen(listKeys, rowMap, row.key) : null;
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

  async function runClear() {
    if (!row || busy) return;
    const decided = rowUnits.filter((unit) => unit.decision.disposition !== "unassigned" || unit.status !== "unassigned");
    if (decided.length === 0) return;
    setBusy(true);
    try {
      await clearDecisions(bundleId, decided.map((unit) => ({ unit_id: unit.unit_id, revision: unit.decision.revision })));
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

  async function confirmIdenticalAll() {
    const items = identical.data ?? [];
    // 서버 상한(1000)씩 차례로 - revision은 후보 목록에 실려 온다
    if (items.length > 0) {
      await run(async () => {
        for (const batch of buildIdenticalBatches(items)) await confirmMatchesInBulk(bundleId, batch);
      }, t("match.identicalDone", { n: items.length }));
    }
    setConfirmingIdentical(false);
  }

  function markNew() {
    const target = writtenMap.get(focusNew ?? -1);
    if (!target) return;
    void run(() => confirmMatchesInBulk(bundleId, { identical: [], new: [{ target_id: target.target_id, revision: target.revision }] }), t("match.newDone"));
  }

  /** 출처 없는 New 모드에서 Old 조각을 누르면 그 줄을 이 문장의 출처로 잇는다(그 줄의 다른 곳은 바꾸기로 뗀다) */
  async function linkAsSource(unitId: number) {
    const key = rowOfUnit.get(unitId);
    const sourceRow = key ? rowMap.get(key) : undefined;
    const target = writtenMap.get(focusNew ?? -1);
    if (!sourceRow || !target || busy || !canEdit) return;
    const sourceUnits = sourceRow.unitIds.map((id) => unitMap.get(id)).filter((unit): unit is UnitRow => unit !== undefined);
    const targetIds = addPartnerTargets([target.target_id], sourceUnits.map((unit) => unit.lang), writtenMap);
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
      const leftovers = listLinkLeftovers(link, context);
      await saveGroup(bundleId, body);
      // 이 문장에 없는 언어의 Old 문장은 짝을 풀어 제 줄로 남긴다 - 출처 없는 New를 계속 보게 고른 줄은 옮기지 않는다
      if (leftovers.length > 0) await splitPairRow(sourceRow, leftovers);
    }, t("match.linked"));
  }

  function pickDestination(next: Destination) {
    const linkTypes: Record<number, ChangeTypeInput | null> = {};
    // AI가 이어 둔 문장을 다시 고르면 기본은 제안 그대로 받기
    if (next.kind === "link") for (const id of next.targetIds) if (writtenMap.get(id)?.status === "ai_suggested") linkTypes[id] = null;
    setDraft({ destination: next.kind === "link" ? { kind: "link", targetIds: addPartnerTargets(next.targetIds, rowLangs, writtenMap) } : next, linkChangeTypes: linkTypes });
  }

  /** New 문장 고르기 - 고른 곳이 바뀌었으면 true */
  function pickNewSentence(targetId: number, additive: boolean): boolean {
    if (mode === "unsourced") {
      setSelNew(targetId);
      return false;
    }
    if (!row || !canEdit) return false;
    // 짝 맞추기는 같은 언어끼리다(명세 §7.10) - 이 줄에 없는 언어의 New 문장은 이을 Old 조각이 없다
    const lang = writtenMap.get(targetId)?.lang;
    if (lang && !rowLangs.includes(lang)) {
      showToast(t("assign.langMismatch", { lang: lang.toUpperCase() }), "error");
      return false;
    }
    const current = destination?.kind === "link" ? destination.targetIds : [];
    const next = additive ? (current.includes(targetId) ? current.filter((id) => id !== targetId) : [...current, targetId]) : [targetId];
    if (next.length === 0) setDraft({ destination: null });
    else pickDestination({ kind: "link", targetIds: next });
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
    setNewToggle({ key, open: true });
    setManualNewDoc({ key, docId });
    setJump({ side: "new", id: targetId, targetId, rowKey: key });
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
    // 지금 보던 New 문서를 그대로 열어 둔다 - 줄이 바뀌어도 이 문장 옆에서 이어 보게
    setNewToggle({ key, open: true });
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
      openMenu(el, null, jump.rowKey, jump.targetId);
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
    selectRow(key, false);
  }

  function handlePrimary() {
    if (!destination) {
      document.querySelector<HTMLElement>(".dest-card")?.focus();
      return;
    }
    void runSave("confirm");
  }

  function startEdit() {
    if (!destination || destination.kind !== "slot" && destination.kind !== "step") return;
    setDraft({}, true);
    requestAnimationFrame(() => firstTextRef.current?.focus());
  }

  const handleKey = useEffectEvent((event: KeyboardEvent) => {
    // 그 자리 메뉴는 화면 단축키를 막지 않는다 - 메뉴가 떠 있어도 ↵가 확정이다(메뉴 안의 키는 메뉴가 먼저 받는다)
    if (bulk || isTypingTarget(event.target) || document.querySelector('[role="dialog"],[role="menu"]:not([data-link-menu]),[role="listbox"]')) {
      if (event.key === "Escape" && editing) setDraft({}, false);
      // 고치는 중에는 Enter가 줄바꿈이라 Ctrl+Enter로 저장한다
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && editing && isTypingTarget(event.target)) {
        event.preventDefault();
        void runSave("confirm");
      }
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
    else if (key === "escape") setChecked(new Set());
    else if (!canEdit || !row) return;
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
  const newFocusId = mode === "unsourced" ? focusNew : (linkIds[0] ?? [...candidateIds][0] ?? null);
  useEffect(() => {
    if (newFocusId === null || !newOpen) return;
    const frame = requestAnimationFrame(() => document.querySelector(`[data-testid="assign-new-${newFocusId}"]`)?.scrollIntoView({ block: "nearest" }));
    return () => cancelAnimationFrame(frame);
  }, [newFocusId, newOpen, newDocId]);

  // --- 그리기 ---
  const disposed = destination?.kind === "delete" || destination?.kind === "move";
  const isPlace = destination?.kind === "slot" || destination?.kind === "step";
  const primaryState = !destination ? "choose" : editing ? "save" : "confirm";
  const otherLang = canMakeOtherLanguage(rowLangs, savedDestination, row?.status === "confirmed");

  function renderPlaceLabel(dest: Destination): { title: string; text: string } {
    const option = options.find((item) => getDestinationId(item.destination) === getDestinationId(dest));
    return { title: option?.docCode ?? "", text: option?.label ?? "" };
  }

  /** 추천을 누름 - 고른 뒤 그 카드 옆에 확정 메뉴를 띄운다(고른 상자가 카드보다 위라 화면 밖일 수 있다) */
  function pickRecommendation(rec: Recommendation, event: MouseEvent<HTMLButtonElement>) {
    pickDestination(rec.destination);
    if (row) openMenu(event.currentTarget, event, row.key, null);
  }

  function renderRecommendation(rec: Recommendation, index: number) {
    const pressed = isRecommendationPicked(draft.destination, rec.destination, rowLangs, writtenMap);
    const pending = pressed ? t("assign.unsaved") : undefined;
    const sourceLabel = t(`assign.src.${rec.source}`);
    const note = [sourceLabel, rec.why].filter(Boolean).join(" · ");
    if (rec.destination.kind === "link") {
      const targets = rec.destination.targetIds.map((id) => writtenMap.get(id)).filter((item): item is WrittenSentence => item !== undefined);
      return (
        <DestCard
          key={rec.key}
          icon={FileText}
          tone="link"
          title={
            <>
              <b>{targets[0]?.doc_code}</b> · {t("assign.chosen.link")}
            </>
          }
          text={targets.map((item) => item.text).join(" / ")}
          note={note}
          pressed={pressed}
          pending={pending}
          testId={`assign-rec-${index}`}
          onClick={(event) => pickRecommendation(rec, event)}
        />
      );
    }
    if (rec.destination.kind === "delete" || rec.destination.kind === "move") {
      return (
        <DestCard
          key={rec.key}
          icon={Trash2}
          tone="danger"
          title={t("assign.acc.move")}
          text={t(rec.destination.kind === "delete" ? "classify.deleted" : "classify.moved")}
          note={note}
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
        icon={ListChecks}
        title={
          <>
            <b>{label.title}</b> · {t("assign.chosen.place")}
          </>
        }
        text={label.text}
        note={note}
        pressed={pressed}
        pending={pending}
        testId={`assign-rec-${index}`}
        onClick={(event) => pickRecommendation(rec, event)}
      />
    );
  }

  function renderNearby() {
    const anchor = destination ?? recommendations[0]?.destination ?? null;
    if (!anchor) return <p className="text-xs text-ink-3">{t("assign.acc.none")}</p>;
    if (anchor.kind === "link") {
      const near = pickNearby(written, anchor.targetIds);
      return near.length === 0 ? (
        <p className="text-xs text-ink-3">{t("assign.acc.none")}</p>
      ) : (
        near.map((item) => (
          <button key={item.target_id} type="button" className="tree-leaf" data-testid={`assign-near-${item.target_id}`} onClick={(event) => pickNewSentence(item.target_id, event.ctrlKey || event.metaKey)}>
            <span className={`ptag ${item.lang}`}>{item.lang.toUpperCase()}</span>
            {item.text}
          </button>
        ))
      );
    }
    const siblings: DestinationOption[] = listSiblingPlaces(options, anchor);
    return siblings.length === 0 ? (
      <p className="text-xs text-ink-3">{t("assign.acc.none")}</p>
    ) : (
      siblings.map((option) => (
        <button key={option.id} type="button" className="tree-leaf" disabled={option.disabled} data-testid={`assign-near-${option.id}`} onClick={() => pickDestination(option.destination)}>
          <span className="mr-1.5 font-mono text-[11px] text-ink-3">{option.docCode}</span>
          {option.label}
          {option.disabled && " · N/A"}
        </button>
      ))
    );
  }

  const accSections: AccordionSection[] = [
    { key: "rec", title: t("assign.acc.rec"), count: recommendations.length, body: recommendations.length === 0 ? <p className="text-xs text-ink-3">{t("assign.acc.none")}</p> : recommendations.map(renderRecommendation) },
    { key: "near", title: t("assign.acc.near"), body: renderNearby() },
    { key: "all", title: t("assign.acc.all"), body: <DestinationTree written={written} options={options} tobeHref={getStageHref(bundleId, "tobe")} onPickLink={pickNewSentence} onPickPlace={pickDestination} /> },
    {
      key: "move",
      title: t("assign.acc.move"),
      body: (
        <>
          <button type="button" className="tree-leaf" data-testid="assign-pick-delete" onClick={() => pickDestination({ kind: "delete" })}>
            {t("classify.deleted")}
          </button>
          <button type="button" className="tree-leaf" data-testid="assign-pick-move" onClick={() => pickDestination({ kind: "move" })}>
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
          // 나눔·합침은 서버가 구조에서 정한다 - 글자 비교 종류는 출처 하나인 칸에서만 고른다
          const structural = slot.target?.change_type === "split" || slot.target?.change_type === "merged" || slot.sourceIds.length > 1 || slots.filter((other) => other.sourceIds.includes(slot.sourceIds[0])).length > 1;
          const changed = slot.sourceText !== null && text.trim() !== "" && text.trim() !== slot.sourceText.trim();
          const keptType = isTextChangeType(slot.target?.change_type) ? slot.target.change_type : null;
          return (
            <div key={slot.key} className="grid gap-1">
              <div className={`grid min-h-[60px] grid-cols-[22px_minmax(0,1fr)] gap-2 rounded-md bg-surface px-2.5 py-2 ${editing ? "border border-focus" : "border border-dashed border-line-2"}`}>
                <span className="lg">{slot.lang === "neutral" ? "–" : slot.lang.toUpperCase()}</span>
                {editing ? (
                  <textarea
                    ref={index === 0 ? firstTextRef : undefined}
                    lang={slot.lang === "neutral" ? undefined : slot.lang}
                    className="min-h-[48px] w-full resize-y bg-transparent text-[14px] leading-[24px] outline-none focus-visible:outline-none"
                    style={{ fontFamily: slot.lang === "en" ? "var(--font-source-en)" : "var(--font-source)" }}
                    data-testid={`assign-text-${slot.key}`}
                    value={text}
                    onChange={(event) => setDraft({ texts: { ...draft.texts, [slot.key]: event.target.value } }, true)}
                  />
                ) : (
                  <p lang={slot.lang === "neutral" ? undefined : slot.lang} className="whitespace-pre-wrap text-[14px] leading-[24px]" style={{ fontFamily: slot.lang === "en" ? "var(--font-source-en)" : "var(--font-source)" }} data-testid={`assign-text-${slot.key}`}>
                    {text || "_"}
                  </p>
                )}
              </div>
              {structural ? (
                <span className="text-xs text-ink-2">
                  {t("classify.changeType")} · {t(slot.sourceIds.length > 1 ? "change.merged" : "change.split")}
                </span>
              ) : (
                changed && (
                  <span className="flex items-center gap-2 text-xs text-ink-2">
                    {t("classify.changeType")}
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
                  </span>
                )
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
    const isConfirmedView = row?.status === "confirmed" && draft.destination === null;
    const pickedRows = linkIds.map((id) => writtenMap.get(id)).filter((item): item is WrittenSentence => item !== undefined);
    const byLang = new Map<string, number>();
    for (const item of pickedRows) byLang.set(item.lang, (byLang.get(item.lang) ?? 0) + 1);
    const mergedWith = [...new Set(pickedRows.flatMap((item) => item.source_unit_ids).filter((id) => !row?.unitIds.includes(id)))].map((id) => unitMap.get(id)?.display_id ?? String(id));
    const auto = [...byLang.values()].some((count) => count > 1) ? "split" : mergedWith.length > 0 ? "merged" : null;
    // 잇지 않는 언어의 짝 조각은 판단이 있으면 지금 그대로 함께 저장된다 - 줄이 아니라 함께 확정되는 쪽으로 보인다.
    // 판단이 없으면 저장에서 빠지고 확정 뒤 짝이 풀려 제 줄로 남는다(아래 알림)
    const linkedLangs = new Set(pickedRows.map((item) => item.lang));
    const savedRowIds = destination.kind === "link" ? rowUnits.filter((unit) => linkedLangs.has(unit.lang)).map((unit) => unit.unit_id) : (row?.unitIds ?? []);
    const leftovers = pickedGroups.isLoading ? [] : listLinkLeftovers(destination, { units: saveUnits, group: saveGroupData });
    const coConfirmed = saveGroupData ? listCoConfirmed(saveGroupData, [...savedRowIds, ...leftovers], linkIds) : [];
    const spansDocs = new Set(pickedRows.map((item) => item.target_doc_id)).size > 1;
    return (
      <div className="chosen-box" data-testid="assign-chosen">
        <span className="chosen-label">
          {isConfirmedView && <Check size={13} strokeWidth={2} aria-hidden />}
          {isConfirmedView && `${t("assign.chosen.confirmed")} · `}
          {destination.kind === "link" ? t("assign.chosen.link") : isPlace ? t("assign.chosen.place") : t(destination.kind === "delete" ? "classify.deleted" : "classify.moved")}
        </span>
        {destination.kind === "link" && (
          <LinkChoice
            rows={pickedRows}
            changeTypes={draft.linkChangeTypes ?? {}}
            aiPending={aiPending}
            defaults={Object.fromEntries(pickedRows.map((item) => [item.target_id, readLinkDefault({ lang: item.lang, confirmed_text: item.text, change_type: item.change_type, status: item.status }, rowUnits)]))}
            auto={auto}
            mergedWith={mergedWith}
            onChange={(targetId, value) => setDraft({ linkChangeTypes: { ...(draft.linkChangeTypes ?? {}), [targetId]: value } })}
          />
        )}
        {isPlace && (
          <>
            <p className="text-[13px] text-ink">
              <b className="mr-1 font-mono text-[11px]">{renderPlaceLabel(destination).title}</b>
              {renderPlaceLabel(destination).text}
            </p>
            {newSentences}
          </>
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
        {otherLang && destination.kind !== "link" && aiOn && canEdit && (
          <button type="button" className="btn h-7 justify-self-start" data-testid="assign-make-other" disabled={busy} onClick={() => row && void askAiScope("translate", { unit_ids: row.unitIds, direction: otherLang === "en" ? "ko_to_en" : "en_to_ko" })}>
            <Sparkles size={14} strokeWidth={1.5} aria-hidden />
            {t(otherLang === "en" ? "assign.makeEn" : "assign.makeKo")}
          </button>
        )}
      </div>
    );
  }

  const actions = (
    <div className="grid gap-1.5">
      <button type="button" className="btn pri h-[38px] w-full" data-testid="assign-primary" data-state={primaryState} disabled={!canEdit || !row || busy} onClick={handlePrimary}>
        <span className="stack">
          <span data-on={primaryState === "choose" ? "" : undefined}>
            {t("classify.chooseDestination")} <kbd>↵</kbd>
          </span>
          <span data-on={primaryState === "confirm" ? "" : undefined}>
            {t("classify.confirm")} <kbd>↵</kbd>
          </span>
          <span data-on={primaryState === "save" ? "" : undefined}>
            {t("classify.saveConfirm")} <kbd>↵</kbd>
          </span>
        </span>
      </button>
      {/* 세 등분하면 긴 라벨(Edit and confirm)이 단추 밖으로 넘친다 - 글자 길이만큼 잡고 남는 폭을 나눈다 */}
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className="btn h-8 flex-auto gap-1 px-1 text-xs font-normal" data-testid="assign-edit" disabled={!canEdit || !isPlace || editing || busy} onClick={startEdit}>
          <FilePen size={13} strokeWidth={1.5} aria-hidden />
          {t("classify.editConfirm")} <kbd>E</kbd>
        </button>
        <button type="button" className="btn h-8 flex-auto gap-1 px-1 text-xs font-normal" data-testid="assign-hold" disabled={!canEdit || !row || busy} onClick={() => void runSave("hold")}>
          {t("classify.hold")} <kbd>H</kbd>
        </button>
        <button type="button" className="btn h-8 flex-auto gap-1 px-1 text-xs font-normal" data-testid="assign-clear" disabled={!canEdit || !row || row.status === "unassigned" || busy} onClick={() => void runClear()}>
          {t("classify.clear")} <kbd>U</kbd>
        </button>
      </div>
    </div>
  );

  const details = (
    <section className="grid grid-cols-[84px_minmax(0,1fr)] items-baseline gap-x-3 gap-y-2">
      <span className="text-xs text-ink-3">{t("classify.reason")}</span>
      {canEdit ? (
        <input
          ref={reasonRef}
          className="h-8 rounded-md border border-line-2 bg-surface px-2 text-[13px] text-ink focus:border-accent focus:outline-none"
          data-testid="assign-reason"
          placeholder={disposed ? t("classify.reasonRequired") : t("classify.reasonOptional")}
          value={reason}
          maxLength={2000}
          onChange={(event) => setDraft({ reason: event.target.value })}
        />
      ) : (
        <span>{reason || "–"}</span>
      )}
      {destination?.kind === "move" && (
        <>
          <span className="text-xs text-ink-3">{t("classify.moveTo")}</span>
          <input
            className="h-8 rounded-md border border-line-2 bg-surface px-2 font-mono text-[13px] text-ink focus:border-accent focus:outline-none"
            data-testid="assign-move-code"
            placeholder="SOP-XX-00000"
            value={moveCode}
            maxLength={100}
            disabled={!canEdit}
            onChange={(event) => setDraft({ moveCode: event.target.value })}
          />
        </>
      )}
      {systemHold !== null && (
        <>
          <span className="text-xs text-ink-3">{t("classify.systemHold")}</span>
          <span className="text-ink-2" data-testid="assign-system-hold">
            <span className="pill warn">{t(SYSTEM_HOLDS.includes(systemHold) ? `hold.system.${systemHold}` : "hold.system.other")}</span>
          </span>
        </>
      )}
      <span className="text-xs text-ink-3">{t("classify.checks")}</span>
      <span className="text-ink-2" data-testid="assign-checks">
        {(groupData?.targets.flatMap((target) => target.warnings) ?? []).map((warning, index) => (
          <span key={index} className="pill warn mr-1">
            {t(readCheckKey(warning))}
          </span>
        ))}
        {(groupData?.targets.flatMap((target) => target.warnings).length ?? 0) === 0 && "–"}
      </span>
      <span className="text-xs text-ink-3">{t("classify.confirmedBy")}</span>
      <span className="text-ink-2" data-testid="assign-confirmed-by">
        {firstDecision?.confirmed_by ? `${firstDecision.confirmed_by} · ${formatKst(firstDecision.confirmed_at)}` : "–"}
      </span>
    </section>
  );

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
                <p className="text-[13px] leading-5 text-ink" lang={target.lang === "neutral" ? undefined : target.lang}>
                  {target.text}
                </p>
              </div>
              <div className="grid gap-2 p-[var(--pad)]">
                <p className="chosen-box is-empty">{t("assign.unsourced.body")}</p>
                <button type="button" className="btn pri" data-testid="assign-mark-new" disabled={!canEdit || busy} onClick={markNew}>
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
              <UnitStatusPill status={row.status} testId="assign-row-status" />
            </span>
            {(units.error ?? suggestions.error) !== null && (
              <button type="button" className="btn h-6 gap-1 px-1.5 text-xs font-normal text-st-hold" data-testid="assign-refresh-error" onClick={() => setUnitsKey((key) => key + 1)}>
                <RefreshCw size={12} strokeWidth={1.5} aria-hidden />
                {t("classify.refreshFailed")}
              </button>
            )}
          </div>
          {rowSuggestion && row.status === "ai_suggested" && aiWhy && (
            <p className="flex items-start gap-1.5 text-xs text-st-ai" data-testid="assign-ai-reason">
              <Sparkles size={13} strokeWidth={1.5} className="mt-0.5 shrink-0" aria-hidden />
              {aiWhy}
            </p>
          )}
        </div>
        <div className="grid min-h-0 grid-cols-[minmax(0,1fr)] content-start gap-3 overflow-y-auto p-[var(--pad)]">
          {renderChosen()}
          {actions}
          {details}
        </div>
        <DestinationAccordion sections={accSections} open={accOpen} onToggle={toggleAcc} />
        <div className="p-[var(--pad)]">{aiNote}</div>
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
      <LoadError error={error} onRetry={reloadAll} testId="assign" />
    ) : (
      <div className="p-4" data-testid="assign-loading">
        {showSkeleton && <span className="sk h-[480px] w-full" />}
      </div>
    );
  }

  const done = countDone(rows);
  const bar = (
    <div className="assign-bar" data-testid="assign-bar">
      <div className="flex flex-wrap gap-1" role="tablist" data-testid="assign-filters">
        {FILTERS.filter((item) => item !== "ai_suggested" || counts.ai_suggested > 0).map((item) => {
          const { tone, Icon } = FILTER_LOOK[item];
          return (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={mode === "old" && filter === item}
              className="fpill"
              data-tone={tone}
              data-testid={`assign-filter-${item}`}
              onClick={() => applyFilter(item)}
            >
              <Icon size={13} strokeWidth={1.5} aria-hidden />
              {item === "all" ? t("assign.acc.all") : t(`status.unit.${item}`)}
              <span className="fpill-n">{counts[item]}</span>
            </button>
          );
        })}
        {written.length > 0 && (
          <button
            type="button"
            role="tab"
            aria-selected={mode === "unsourced"}
            className="fpill"
            data-tone="danger"
            data-testid="assign-filter-unsourced"
            onClick={() => setMode("unsourced")}
          >
            <TriangleAlert size={13} strokeWidth={1.5} aria-hidden />
            {t("assign.filterUnsourced")}
            <span className="fpill-n">{unsourced.length}</span>
          </button>
        )}
      </div>
      <span className="text-xs tabular-nums text-ink-3" data-testid="assign-progress">
        {t("assign.progress", { done, total: rows.length })}
      </span>
      <ReadOnlyNote bundle={bundle} testId="assign" />
      <span className="flex-1" />
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
        <button type="button" className="btn h-7" data-testid="assign-identical" disabled={busy} onClick={() => setConfirmingIdentical(true)}>
          <Link2 size={14} strokeWidth={1.5} aria-hidden />
          {t("assign.identical", { n: identical.data?.length ?? 0 })}
        </button>
      )}
      {aiOn && canEdit && <AiAskMenu items={aiMenuItems} label={t("ai.more")} testId="assign-ai-menu" disabled={busy} />}
      {bundle?.is_synthetic && <span className="tag">Synthetic data</span>}
      <SourceFontMenu />
      {writtenDocs.length > 0 && mode === "old" && (
        <button type="button" className="btn h-7" data-testid="assign-toggle-new" onClick={() => setNewToggle({ key: toggleKey, open: !newOpen })}>
          {newOpen ? <X size={14} strokeWidth={1.5} aria-hidden /> : <FileText size={14} strokeWidth={1.5} aria-hidden />}
          {t(newOpen ? "assign.closeNew" : "assign.openNew")}
        </button>
      )}
    </div>
  );

  const oldDocOptions = oldDocs.map((doc) => ({ value: String(doc.id), label: doc.doc_code || doc.file_name }));
  const newDocOptions = writtenDocs.map(([docId, code]) => ({ value: String(docId), label: code }));
  const highlightIds = new Set(row?.unitIds ?? []);
  const pickedNew = new Set(linkIds);
  const pickedOld = new Set([...checked].flatMap((key) => rowMap.get(key)?.unitIds ?? []));
  const placeOf = (unitIds: number[]) => {
    const decided = unitIds.map((id) => unitMap.get(id)).find((unit) => unit?.status === "confirmed");
    if (!decided) return null;
    if (decided.decision.disposition === "delete") return <span className="strip-note is-delete">→ {t("classify.deleted")}</span>;
    if (decided.decision.disposition === "move_external") return <span className="strip-note">→ {decided.decision.move_target_code}</span>;
    const linked = written.filter((item) => item.source_unit_ids.some((id) => unitIds.includes(id)));
    if (linked.length > 0) {
      // 지금 열린 New 문서의 문장이 있으면 그리로 - 없으면 첫 문장의 문서를 연다
      const goal = linked.find((item) => item.target_doc_id === newDocId) ?? linked[0];
      const sourceId = goal.source_unit_ids.find((id) => unitIds.includes(id)) ?? unitIds[0];
      return (
        <button type="button" className="strip-note" aria-label={`${t("assign.jumpNew")}: ${linked[0].doc_code}`} data-testid={`assign-note-${unitIds[0]}`} onClick={() => jumpToNew(sourceId, goal.target_id)}>
          → {linked[0].doc_code} {linked.map((item) => item.section_path || item.order_index).join(" + ")}
        </button>
      );
    }
    return <span className="strip-note">→ {t("classify.assigned")}</span>;
  };

  return (
    <>
      <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_320px]" data-testid="assign">
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
            <div ref={panesRef} className="assign-panes" data-single={newOpen ? undefined : ""} style={{ "--split": `${view.split * 100}%` }}>
              <OldPane
                docOptions={oldDocOptions}
                docId={String(oldView?.document.id ?? "")}
                docTitle={oldView?.document.title ?? ""}
                onDocChange={(value) => {
                  setManualOldDoc(Number(value));
                  setSelectedKey(null);
                }}
                model={paperModel}
                placeholder={<span className="sk h-[480px] w-full" />}
                selectedId={mode === "old" ? (row?.unitIds[0] ?? null) : null}
                highlightIds={mode === "old" ? highlightIds : NO_NUMBERS}
                pickedIds={pickedOld}
                statusOf={(unitId) => unitMap.get(unitId)?.status}
                renderNote={placeOf}
                onUnitClick={handleOldClick}
                figureSource={oldView ? { bundleId, docId: oldView.document.id } : undefined}
                zoom={view.zoomOld}
                onZoom={(dir) => zoomPane("old", dir)}
              />
              {newOpen && newDocId !== null && (
                <>
                  <PaneDivider value={view.split} onCommit={(ratio) => changeView({ split: ratio })} />
                  <NewPane
                    docOptions={newDocOptions}
                    docId={String(newDocId)}
                    onDocChange={(value) => setManualNewDoc({ key: toggleKey, docId: Number(value) })}
                    rows={newRows}
                    candidateIds={candidateIds}
                    pickedIds={pickedNew}
                    focusId={focusNew}
                    sourceLabel={(unitId) => (unitMap.get(unitId)?.display_id ?? String(unitId)).replace(/^OLD-/, "")}
                    onPick={handleNewPick}
                    onJumpSource={jumpToOld}
                    zoom={view.zoomNew}
                    onZoom={(dir) => zoomPane("new", dir)}
                  />
                  <LinkLines pairs={linkPairs} focusUnits={highlightIds} focusTargets={pickedNew} />
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
        <LinkMenu key={menu.seq} anchor={menu.anchor} offset={menu.offset} items={menuItems} isUnsaved={menuItems.includes("cancel")} busy={busy} onAction={runMenu} onClose={() => setMenu(null)} />
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
              });
              showToast(t("classify.bulkDone", { n: unitRows.length }));
              setBulk(null);
              setChecked(new Set());
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

function BulkModal({ action, count, onClose, onConfirm }: { action: "delete" | "move"; count: number; onClose: () => void; onConfirm: (reason: string, code: string) => Promise<void> }) {
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
      <label className="grid gap-1">
        <span className="text-xs text-ink-2">{t("classify.reason")}</span>
        <input className="h-8 rounded-md border border-line-2 bg-surface px-2 text-[13px]" data-testid="assign-bulk-reason" value={reason} maxLength={2000} autoFocus onChange={(event) => setReason(event.target.value)} />
      </label>
      {action === "move" && (
        <label className="grid gap-1">
          <span className="text-xs text-ink-2">{t("classify.moveTo")}</span>
          <input className="h-8 rounded-md border border-line-2 bg-surface px-2 font-mono text-[13px]" data-testid="assign-bulk-code" value={code} maxLength={100} onChange={(event) => setCode(event.target.value)} />
        </label>
      )}
    </Modal>
  );
}
