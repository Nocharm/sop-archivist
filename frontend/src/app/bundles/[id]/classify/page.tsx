// 분류(입구 1) 사람 경로 - 목록 한 줄은 한/영 짝 하나. 보낼 곳을 고르면 원문이 새 문장에 그대로 들어가고(점선), Enter로 확정해 다음 줄로 간다(디자인 문서 9절).
// 배치는 사람마다: 원문 3단(232 / 가변 / 392, 기본) 또는 목록 + 상세(318 / 가변). AI 자리는 안내만 둔다.
"use client";

import { ArrowDown, ArrowUp, Check, ExternalLink, Inbox, Sparkles, Trash2, X } from "lucide-react";
import { useParams } from "next/navigation";
import { useEffect, useEffectEvent, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";

import { DestinationPicker, describeDestination, type DestinationPickerHandle } from "@/components/classify/destination-picker";
import { AiAskMenu, type AiAskItem } from "@/components/manage/ai-ask-menu";
import { Modal } from "@/components/modal";
import { Paper } from "@/components/paper/paper";
import { SourceFontMenu } from "@/components/paper/source-font-menu";
import { UnitStatusIcon, UnitStatusPill } from "@/components/status";
import { LoadMoreBlock } from "@/components/ui/load-more";
import { Refresh } from "@/components/ui/motion";
import { Select } from "@/components/ui/select";
import { showToast } from "@/components/ui/toast";
import { Tooltip } from "@/components/ui/tooltip";
import { humanizeApiError } from "@/lib/api-errors";
import {
  bulkDecide,
  clearDecisions,
  getDocumentView,
  getGroupByUnit,
  getToBe,
  listAllUnits,
  listDocuments,
  listSuggestions,
  requestClassify,
  saveGroup,
  type AiSuggestion,
  type DocumentView,
  type Group,
  type UnitRow,
} from "@/lib/api-sop";
import { requestAi, type AiKind, type AiScope } from "@/lib/api-manage";
import { loadBundle, useBundle } from "@/lib/bundle-store";
import {
  buildDestinationOptions,
  buildGroupSave,
  buildRows,
  buildSentenceSlots,
  buildViewsKey,
  findNextOpen,
  getRowStep,
  findSystemHold,
  isTextChangeType,
  pickFirstFilter,
  readCheckKey,
  readDestination,
  readHumanReason,
  type CellSource,
  type ClassifyFilter,
  type ClassifyRow,
  type Destination,
  type RowDraft,
} from "@/lib/classify-model";
import { formatKst } from "@/lib/datetime";
import { useI18n } from "@/lib/i18n";
import { buildPaperModel } from "@/lib/paper-model";
import { SLOT_LABELS } from "@/lib/slot-labels";
import { useAiJobs } from "@/lib/use-ai-jobs";
import { useDelayedFlag } from "@/lib/use-delayed-flag";
import { useLoaded } from "@/lib/use-loaded";
import { useProgressiveList } from "@/lib/use-progressive-list";
import { useUiPref } from "@/lib/use-ui-pref";
import { EmptyState } from "@/components/ui/empty-state";

type Filter = ClassifyFilter;
const FILTERS: Filter[] = ["unassigned", "ai_suggested", "on_hold", "confirmed", "all"];

// backend constants.SYSTEM_HOLD_* - 모르는 코드는 "시스템 보류"로 보인다
const SYSTEM_HOLDS = ["related_unit_changed", "ai_invalid_response"];

/** 화면의 줄 초안 - 사유·이동 코드는 null이면 손대지 않은 것(저장된 값을 보인다), ""이면 사람이 비운 것 */
interface PageDraft extends Omit<RowDraft, "reason" | "moveCode"> {
  reason: string | null;
  moveCode: string | null;
  editing: boolean;
}

const EMPTY_DRAFT: PageDraft = { destination: null, texts: {}, changeTypes: {}, reason: null, moveCode: null, editing: false };

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

/** 줄의 단위마다 그룹을 불러 합친다 - 짝의 두 쪽이 서로 다른 관계 묶음일 수 있다 */
async function loadRowGroup(bundleId: number, unitIds: number[]): Promise<Group> {
  const groups = await Promise.all(unitIds.map((id) => getGroupByUnit(bundleId, id)));
  const units = new Map<number, Group["units"][number]>();
  const targets = new Map<number, Group["targets"][number]>();
  for (const group of groups) {
    for (const unit of group.units) units.set(unit.unit_id, unit);
    for (const target of group.targets) targets.set(target.id, target);
  }
  return { units: [...units.values()], targets: [...targets.values()] };
}

export default function ClassifyPage() {
  const { t } = useI18n();
  const bundleId = Number(useParams<{ id: string }>().id);
  const { bundle } = useBundle(bundleId);
  const canEdit = bundle?.my_role === "author" && bundle.status === "in_progress";
  const layout = useUiPref("classifyLayout");

  // --- 데이터 ---
  const docs = useLoaded(() => listDocuments(bundleId), String(bundleId));
  const oldDocIds = (docs.data ?? []).filter((doc) => doc.side === "old" && doc.status === "ready").map((doc) => doc.id);
  const views = useLoaded<DocumentView[] | null>(
    () => (docs.data === null ? Promise.resolve(null) : Promise.all(oldDocIds.map((id) => getDocumentView(bundleId, id)))),
    buildViewsKey(docs.data === null ? null : oldDocIds),
  );
  const [unitsKey, setUnitsKey] = useState(0);
  const units = useLoaded(() => listAllUnits(bundleId), `${bundleId}:${unitsKey}`);
  const tobe = useLoaded(() => getToBe(bundleId), String(bundleId));
  // AI 작업이 끝나면 단위·제안·묶음을 다시 불러온다 - 제안이 보이고 다음 저장이 낡은 revision으로 409가 나지 않는다
  const aiJobs = useAiJobs(bundleId, () => {
    setUnitsKey((key) => key + 1);
    void loadBundle(bundleId);
  });
  const aiBusy = (aiJobs.status?.jobs.queued ?? 0) + (aiJobs.status?.jobs.running ?? 0);
  const suggestions = useLoaded(() => listSuggestions(bundleId, "classify"), `${bundleId}:${unitsKey}`);
  // 단위마다 가장 최근의 적용된 분류 제안 - 사람이 확정하면 제안은 이력으로만 남는다
  const suggestionOf = useMemo(() => {
    const map = new Map<number, AiSuggestion>();
    for (const item of suggestions.data ?? []) for (const id of item.content.unit_ids ?? []) if ((map.get(id)?.id ?? 0) < item.id) map.set(id, item);
    return map;
  }, [suggestions.data]);

  const unitMap = useMemo(() => new Map((units.data ?? []).map((row) => [row.unit_id, row])), [units.data]);
  const viewList = views.data;
  const rows = useMemo(() => (viewList ? buildRows(viewList, unitMap) : []), [viewList, unitMap]);
  const rowMap = new Map(rows.map((row) => [row.key, row]));
  const rowOfUnit = new Map(rows.flatMap((row) => row.unitIds.map((id) => [id, row.key] as const)));
  const options = useMemo(() => (tobe.data ? buildDestinationOptions(tobe.data, SLOT_LABELS) : []), [tobe.data]);
  const ready = viewList !== null && units.data !== null && tobe.data !== null;
  const showSkeleton = useDelayedFlag(!ready && docs.error === null);

  // --- 목록: 필터를 누를 때만 다시 줄 세운다(확정한 줄은 그 자리에 남는다) ---
  const [filter, setFilter] = useState<Filter>("unassigned");
  const [snapshot, setSnapshot] = useState<{ filter: Filter; keys: string[] } | null>(null);
  const counts: Record<Filter, number> = { unassigned: 0, ai_suggested: 0, on_hold: 0, confirmed: 0, all: rows.length };
  for (const row of rows) counts[row.status] += 1;
  const listKeys = snapshot && snapshot.filter === filter ? snapshot.keys.filter((key) => rowMap.has(key)) : rows.filter((row) => filter === "all" || row.status === filter).map((row) => row.key);

  // 처음 불러온 순간의 목록을 붙잡는다 - 그래야 확정한 줄이 필터에서 바로 빠지지 않는다(렌더 중 상태 맞추기)
  if (snapshot === null && rows.length > 0 && units.data !== null) {
    // AI 제안이 있으면 그것부터 본다(명세 §12-6), 없으면 줄이 있는 첫 상태 - 빈 목록으로 열지 않는다
    const first = pickFirstFilter(counts);
    setFilter(first);
    setSnapshot({ filter: first, keys: rows.filter((item) => first === "all" || item.status === first).map((item) => item.key) });
  }

  function applyFilter(next: Filter) {
    setFilter(next);
    setSnapshot({ filter: next, keys: rows.filter((row) => next === "all" || row.status === next).map((row) => row.key) });
  }

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const activeKey = selectedKey && rowMap.has(selectedKey) ? selectedKey : (listKeys[0] ?? null);
  // 긴 목록은 묶음씩 그린다 - 키보드로 고른 줄까지는 늘 그려 둔다
  const progressive = useProgressiveList(listKeys, `${filter}:${snapshot?.filter ?? ""}`, { minVisible: activeKey ? listKeys.indexOf(activeKey) + 1 : 0 });
  const row: ClassifyRow | null = activeKey ? (rowMap.get(activeKey) ?? null) : null;
  const [checked, setChecked] = useState<Set<string>>(new Set());

  // --- 고른 줄의 관계 묶음과 초안 ---
  const group = useLoaded<Group | null>(() => (row ? loadRowGroup(bundleId, row.unitIds) : Promise.resolve(null)), `${activeKey}:${unitsKey}`);
  const groupData = group.data;
  // 초안은 줄마다 따로 둔다 - 묶음을 불러오는 동안 쓴 글이나 다른 줄을 보고 돌아왔을 때의 편집이 남는다. 저장·지우기하면 그 줄 초안을 버린다
  const [drafts, setDrafts] = useState<Record<string, PageDraft>>({});
  const draft = (activeKey && drafts[activeKey]) || EMPTY_DRAFT;
  const editing = draft.editing;
  // 고른 줄의 묶음이 아직 오지 않았으면 저장하지 않는다(이전 줄의 묶음으로 요청을 만들게 된다)
  const groupPending = group.isLoading || (row !== null && groupData === null);
  const savedDestination = readDestination(groupData, row?.unitIds ?? []);
  const destination: Destination | null = draft.destination ?? savedDestination;
  const isDraftDest = draft.destination !== null || row?.status !== "confirmed";
  const rowUnits: UnitRow[] = (row?.unitIds ?? []).map((id) => unitMap.get(id)).filter((unit): unit is UnitRow => unit !== undefined);
  const firstDecision = rowUnits[0]?.decision;
  // system: 코드는 사람 사유가 아니다 - 사유 칸에 넣지 않고 아래에 사람 말로 보인다(넣으면 삭제가 실제 사유 없이 통과한다)
  const savedReason = rowUnits.map((unit) => readHumanReason(unit.decision)).find(Boolean) ?? "";
  const systemHold = rowUnits.map((unit) => findSystemHold(unit.decision)).find((code) => code !== null) ?? null;
  const reason = draft.reason ?? savedReason;
  const moveCode = draft.moveCode ?? firstDecision?.move_target_code ?? "";

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

  const rowSuggestion = row ? (row.unitIds.map((id) => suggestionOf.get(id)).find(Boolean) ?? null) : null;

  async function askAi() {
    if (!row) return;
    try {
      const result = await requestClassify(bundleId, row.unitIds);
      showToast(result.queued > 0 ? t("classify.aiQueued") : t("classify.aiSkipped"));
      aiJobs.watch();
    } catch (err) {
      showToast(humanizeApiError(err, t), "error");
    }
  }

  const pickerRef = useRef<DestinationPickerHandle>(null);
  const reasonRef = useRef<HTMLInputElement>(null);
  const firstTextRef = useRef<HTMLTextAreaElement>(null);
  const [busy, setBusy] = useState(false);
  const [bulk, setBulk] = useState<"delete" | "move" | null>(null);

  // --- 원문 ---
  const viewOfRow = row && viewList ? (viewList.find((view) => view.document.id === row.documentId) ?? null) : null;
  /** 줄 하나를 넘는 AI 요청 - 이 문서 전체 분류, 확정·배정된 줄의 다른 언어 번역 */
  async function askAiScope(kind: AiKind, body: AiScope & { direction?: "ko_to_en" | "en_to_ko" }) {
    try {
      const result = await requestAi(bundleId, kind, body);
      showToast(result.queued > 0 ? t("ai.queuedCount", { n: result.queued }) : t("ai.nothingQueued", { n: result.skipped_total }));
      aiJobs.watch();
    } catch (err) {
      showToast(humanizeApiError(err, t), "error");
    }
  }
  const rowLangs = new Set(rowUnits.map((unit) => unit.lang));
  const aiMenuItems: AiAskItem[] = [];
  if (viewOfRow) aiMenuItems.push({ key: "document", label: t("ai.classifyDocument"), run: () => askAiScope("classify", { document_id: viewOfRow.document.id }) });
  if (row && row.status !== "unassigned" && rowLangs.has("ko")) aiMenuItems.push({ key: "to-en", label: t("ai.translateToEn"), run: () => askAiScope("translate", { unit_ids: row.unitIds, direction: "ko_to_en" }) });
  if (row && row.status !== "unassigned" && rowLangs.has("en")) aiMenuItems.push({ key: "to-ko", label: t("ai.translateToKo"), run: () => askAiScope("translate", { unit_ids: row.unitIds, direction: "en_to_ko" }) });
  if (row) aiMenuItems.push({ key: "split", label: t("ai.splitRow"), run: () => askAiScope("split", { unit_ids: row.unitIds }) });

  const paperModel = useMemo(() => (viewOfRow ? buildPaperModel(viewOfRow) : null), [viewOfRow]);

  const saveUnits = rowUnits.map((unit) => ({ id: unit.unit_id, kind: unit.kind, lang: unit.lang, text: unit.text, revision: unit.decision.revision }));
  // 새 문장 칸 - AI가 나눈 문장은 칸 여럿, 합친 문장은 칸 하나다
  const slots = buildSentenceSlots(groupData, saveUnits);

  function selectRow(key: string, scroll = true) {
    setSelectedKey(key);
    // 목록은 키보드로 옮길 때만 따라간다(용지는 아래 이펙트가 늘 맞춘다)
    if (scroll) requestAnimationFrame(() => document.querySelector(`[data-testid="classify-row-${key}"]`)?.scrollIntoView({ block: "nearest" }));
  }

  function moveRow(step: 1 | -1) {
    if (listKeys.length === 0) return;
    const index = activeKey ? listKeys.indexOf(activeKey) : -1;
    selectRow(listKeys[Math.min(Math.max(index + step, 0), listKeys.length - 1)]);
  }

  function buildTables(): Map<number, { rows: number; cols: number; cells: CellSource[] }> {
    const tables = new Map<number, { rows: number; cols: number; cells: CellSource[] }>();
    if (!viewOfRow || !row) return tables;
    for (const unitId of row.unitIds) {
      const unit = viewOfRow.units.find((item) => item.id === unitId);
      if (!unit || (unit.kind !== "table" && unit.kind !== "table_row") || unit.table_id === null) continue;
      const table = viewOfRow.tables.find((item) => item.id === unit.table_id);
      // 행 단위("행으로 나누기")는 그 행 하나짜리 표이고 칸 자리는 그 행 기준이다 - 서버 칸 자리 검사(원문 칸 블록 좌표)와 같다
      const isRow = unit.kind === "table_row";
      const firstRow = isRow ? (unit.row_index ?? 0) : 0;
      const cells = viewOfRow.units
        .filter((item) => item.group_unit_id === unit.id && item.kind === "cell_sentence")
        .map((item) => {
          const block = viewOfRow.blocks.find((candidate) => candidate.id === item.block_id);
          return { id: item.id, lang: item.lang, text: item.text, row: (block?.row_index ?? item.row_index ?? 0) - firstRow, col: block?.col_index ?? 0 };
        });
      tables.set(unit.id, { rows: isRow ? 1 : (table?.n_rows ?? 1), cols: table?.n_cols ?? 1, cells });
    }
    return tables;
  }

  async function runSave(action: "confirm" | "hold") {
    // 보낼 곳 없이는 보류만 된다(처분 unassigned + hold, 사유는 hold_reason)
    if (!row || busy || groupPending || (!destination && action !== "hold")) return;
    const needsReason = action === "hold" || destination?.kind === "delete" || destination?.kind === "move";
    if (needsReason && !reason.trim()) {
      showToast(t(action === "hold" ? "classify.holdReasonNeeded" : "classify.reasonNeeded"), "error");
      reasonRef.current?.focus();
      return;
    }
    if (destination?.kind === "move" && !moveCode.trim()) {
      showToast(t("classify.moveCodeNeeded"), "error");
      return;
    }
    // 고친 칸만 글을 보낸다 - 손대지 않은 AI 제안은 글·종류를 비워 보내 제안 그대로 받는다
    const body = buildGroupSave(
      { ...draft, destination, reason, moveCode },
      { units: saveUnits, group: groupData, tables: buildTables() },
      action,
      action === "hold" ? reason.trim() : "",
    );
    setBusy(true);
    try {
      await saveGroup(bundleId, body);
      showToast(action === "hold" ? t("classify.held") : t("classify.confirmed"));
      // 다음 미확정 줄로 - 지금 줄은 목록 자리에 남는다
      const next = action === "confirm" ? findNextOpen(listKeys, rowMap, row.key) : null;
      dropDraft(row.key);
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

  function handlePrimary() {
    if (!destination) {
      pickerRef.current?.open();
      return;
    }
    void runSave("confirm");
  }

  function startEdit() {
    if (!destination || destination.kind === "delete" || destination.kind === "move") return;
    setDraft({}, true);
    requestAnimationFrame(() => firstTextRef.current?.focus());
  }

  function handleRowClick(key: string, event: ReactMouseEvent) {
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      setChecked((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        if (activeKey && !next.has(activeKey) && prev.size === 0) next.add(activeKey);
        return next;
      });
      return;
    }
    setChecked(new Set());
    selectRow(key, false);
  }

  function handlePaperClick(unitId: number) {
    const key = rowOfUnit.get(unitId);
    if (!key) return;
    if (!listKeys.includes(key)) applyFilter("all");
    selectRow(key);
  }

  const handleKey = useEffectEvent((event: KeyboardEvent) => {
    if (bulk || isTypingTarget(event.target) || document.querySelector('[role="dialog"],[role="menu"],[role="listbox"]')) {
      if (event.key === "Escape" && editing) setDraft({}, false);
      // 고치는 중에는 Enter가 줄바꿈이라 Ctrl+Enter로 저장한다
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && editing && isTypingTarget(event.target)) {
        event.preventDefault();
        void runSave("confirm");
      }
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
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

  // 용지는 늘 고른 문장이 보이게 - 처음 열 때와 줄을 바꿀 때
  const firstUnitId = row?.unitIds[0] ?? null;
  const paperReady = paperModel !== null;
  useEffect(() => {
    if (firstUnitId === null || !paperReady) return;
    const frame = requestAnimationFrame(() => document.querySelector(`[data-testid="classify-paper-unit-${firstUnitId}"]`)?.scrollIntoView({ block: "center" }));
    return () => cancelAnimationFrame(frame);
  }, [firstUnitId, paperReady]);

  useEffect(() => {
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  // --- 그리기 ---
  const primaryState = !destination ? "choose" : editing ? "save" : "confirm";
  const disposed = destination?.kind === "delete" || destination?.kind === "move";

  const listRows = (
    <ul className="min-h-0 overflow-y-auto" data-testid="classify-list">
      {progressive.visible.map((key) => {
        const item = rowMap.get(key);
        if (!item) return null;
        const first = unitMap.get(item.unitIds[0]);
        const decision = first?.decision;
        const destText = decision?.disposition === "delete" ? t("classify.deleted") : decision?.disposition === "move_external" ? t("classify.moved") : decision?.disposition === "assigned" ? t("classify.assigned") : "";
        return (
          <li key={key}>
            <button
              type="button"
              className={`grid w-full grid-cols-[16px_minmax(0,1fr)] gap-x-2 gap-y-px border-b border-line py-[var(--row-y)] pl-2.5 pr-2 text-left transition-colors hover:bg-hover ${layout === "list" ? "min-h-[97px]" : "min-h-[58px]"}`}
              style={key === activeKey ? { background: "var(--sel-bg)", boxShadow: "inset 3px 0 0 var(--accent)" } : undefined}
              aria-current={key === activeKey ? "true" : undefined}
              data-testid={`classify-row-${key}`}
              data-status={item.status}
              onClick={(event) => handleRowClick(key, event)}
            >
              <span className="row-span-3 pt-0.5">
                {checked.has(key) ? <span className="cbx" role="img" aria-label={t("classify.picked")}><span className="cbx-box is-on"><Check size={12} strokeWidth={2.5} aria-hidden /></span></span> : <UnitStatusIcon status={item.status} />}
              </span>
              <span className="flex items-center gap-1.5 font-mono text-[11px] leading-4 text-ink-3">
                {item.unitIds.map((id) => unitMap.get(id)?.display_id).join(" · ")}
              </span>
              <span className={`${layout === "list" ? "line-clamp-2" : "truncate"} text-[13px] leading-5 ${item.status === "confirmed" ? "text-ink-3" : "text-ink"}`}>{first?.kind === "table" || first?.kind === "table_row" ? t("classify.tableUnit") : first?.text}</span>
              {layout === "list" && <span className="truncate text-xs text-ink-3">{destText}</span>}
            </button>
          </li>
        );
      })}
      {progressive.hasMore && (
        <li>
          <LoadMoreBlock sentinelRef={progressive.sentinelRef} rowHeight={layout === "list" ? 97 : 58} testId="classify-more" />
        </li>
      )}
    </ul>
  );

  const filterTabs = (
    <div className="flex flex-wrap gap-0.5 border-b border-line p-2" role="tablist" data-testid="classify-filters">
      {FILTERS.filter((item) => item !== "ai_suggested" || counts.ai_suggested > 0).map((item) => (
        <button
          key={item}
          type="button"
          role="tab"
          aria-selected={filter === item}
          className={`inline-flex h-[26px] items-center gap-1.5 rounded-md px-2 text-xs transition-colors hover:bg-hover ${filter === item ? "bg-accent-tint text-ink" : "text-ink-2"}`}
          data-testid={`classify-filter-${item}`}
          onClick={() => applyFilter(item)}
        >
          {item === "all" ? "All" : t(`status.unit.${item}`)}
          <span className="tabular-nums text-ink-3">{counts[item]}</span>
        </button>
      ))}
    </div>
  );

  const listFoot = checked.size > 0 && canEdit && (
    <div className="flex items-center gap-1.5 border-t border-line p-2 text-xs" data-testid="classify-bulk">
      <span className="flex-1 text-ink-2">{t("classify.pickedCount", { n: checked.size })}</span>
      <button type="button" className="btn h-7" data-testid="classify-bulk-delete" onClick={() => setBulk("delete")}>
        <Trash2 size={14} strokeWidth={1.5} aria-hidden />
        {t("classify.deleted")}
      </button>
      <button type="button" className="btn h-7" data-testid="classify-bulk-move" onClick={() => setBulk("move")}>
        <ExternalLink size={14} strokeWidth={1.5} aria-hidden />
        {t("classify.moved")}
      </button>
    </div>
  );

  const header = (
    <div className="flex h-7 items-center gap-2">
      <span className="min-w-0 truncate font-mono text-sm font-semibold" data-testid="classify-row-id">
        {rowUnits.map((unit) => unit.display_id).join(" · ") || "–"}
      </span>
      {row && <UnitStatusPill status={row.status} testId="classify-row-status" />}
      {/* 저장 뒤 다시 불러오기가 실패해도 화면은 남기고 다시 시도할 수 있게 한다 */}
      {(units.error ?? suggestions.error) !== null && (
        <button type="button" className="pill warn" data-testid="classify-refresh-error" onClick={() => setUnitsKey((key) => key + 1)}>
          {t("classify.refreshFailed")}
        </button>
      )}
      <span className="flex-1" />
      <Tooltip label={t("classify.prev")}>
        <button type="button" className="btn ghost icon h-7 w-7" aria-label={t("classify.prev")} data-testid="classify-prev" onClick={() => moveRow(-1)}>
          <ArrowUp size={14} strokeWidth={1.5} aria-hidden />
        </button>
      </Tooltip>
      <Tooltip label={t("classify.next")}>
        <button type="button" className="btn ghost icon h-7 w-7" aria-label={t("classify.next")} data-testid="classify-next" onClick={() => moveRow(1)}>
          <ArrowDown size={14} strokeWidth={1.5} aria-hidden />
        </button>
      </Tooltip>
    </div>
  );

  const picker = (
    <DestinationPicker
      ref={pickerRef}
      options={options}
      value={destination}
      isDraft={isDraftDest}
      isAi={row?.status === "ai_suggested" && draft.destination === null}
      disabled={!canEdit || !row || busy}
      onChange={(next) => setDraft({ destination: next })}
    />
  );

  // 주 버튼 - 세 라벨이 같은 칸에 겹쳐 폭과 자리가 변하지 않는다
  const primary = (
    <button type="button" className="btn pri h-[38px] w-full" data-testid="classify-primary" data-state={primaryState} disabled={!canEdit || !row || busy} onClick={handlePrimary}>
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
  );

  const secondary = (
    <div className="grid grid-cols-[1.15fr_0.7fr_1.15fr] gap-1.5">
      <button type="button" className="btn h-8 gap-1 px-1 text-xs font-normal" data-testid="classify-edit" disabled={!canEdit || !destination || disposed || editing || busy} onClick={startEdit}>
        {t("classify.editConfirm")} <kbd>E</kbd>
      </button>
      <Tooltip label={t("classify.holdHint")}>
        <button type="button" className="btn h-8 w-full gap-1 px-1 text-xs font-normal" data-testid="classify-hold" disabled={!canEdit || !row || busy} onClick={() => void runSave("hold")}>
          {t("classify.hold")} <kbd>H</kbd>
        </button>
      </Tooltip>
      <button type="button" className="btn h-8 gap-1 px-1 text-xs font-normal" data-testid="classify-clear" disabled={!canEdit || !row || row.status === "unassigned" || busy} onClick={() => void runClear()}>
        {t("classify.clear")} <kbd>U</kbd>
      </button>
    </div>
  );

  const isTableRow = rowUnits.some((unit) => unit.kind === "table" || unit.kind === "table_row");
  const newSentences = (
    <section className="grid gap-2" data-testid="classify-new">
      <h2 className="text-xs font-semibold text-ink-3">{t("classify.newSentence")}</h2>
      {disposed ? (
        <p className="rounded-md border border-dashed border-line-2 px-3 py-2 text-ink-3">{t("classify.noNewSentence")}</p>
      ) : isTableRow || rowUnits.some((unit) => unit.kind === "figure") ? (
        <p className="rounded-md border border-line-2 px-3 py-2 text-ink-2">{t(isTableRow ? "classify.tableAsIs" : "classify.figureAsIs")}</p>
      ) : (
        slots.map((slot, index) => {
          const text = destination ? (draft.texts[slot.key] ?? slot.text) : "";
          // 나눔·합침은 서버가 구조에서 정한다 - 글자 비교 종류는 출처 하나인 칸에서만 고른다
          const structural = slot.target?.change_type === "split" || slot.target?.change_type === "merged" || slot.sourceIds.length > 1 || slots.filter((other) => other.sourceIds.includes(slot.sourceIds[0])).length > 1;
          const changed = destination !== null && slot.sourceText !== null && text.trim() !== "" && text.trim() !== slot.sourceText.trim();
          const keptType = isTextChangeType(slot.target?.change_type) ? slot.target.change_type : null;
          return (
            <div key={slot.key} className="grid gap-1">
              <div className={`grid min-h-[70px] grid-cols-[22px_minmax(0,1fr)] gap-2 rounded-md px-2.5 py-2 ${!destination ? "border border-dashed border-line-2 text-ink-4" : editing ? "border border-focus" : row?.status === "confirmed" && !draft.destination ? "border border-line-2" : "border border-dashed border-line-2"}`}>
                <span className="lg">{slot.lang === "neutral" ? "–" : slot.lang.toUpperCase()}</span>
                {editing ? (
                  <textarea
                    ref={index === 0 ? firstTextRef : undefined}
                    lang={slot.lang === "neutral" ? undefined : slot.lang}
                    className="min-h-[52px] w-full resize-y bg-transparent text-[15px] leading-[26px] outline-none focus-visible:outline-none"
                    style={{ fontFamily: slot.lang === "en" ? "var(--font-source-en)" : "var(--font-source)" }}
                    data-testid={`classify-text-${slot.key}`}
                    value={text}
                    onChange={(event) => setDraft({ texts: { ...draft.texts, [slot.key]: event.target.value } }, true)}
                  />
                ) : (
                  <p lang={slot.lang === "neutral" ? undefined : slot.lang} className="whitespace-pre-wrap text-[15px] leading-[26px]" style={{ fontFamily: slot.lang === "en" ? "var(--font-source-en)" : "var(--font-source)" }} data-testid={`classify-text-${slot.key}`}>
                    {text || "_"}
                  </p>
                )}
              </div>
              {destination !== null && structural ? (
                <span className="text-xs text-ink-2" data-testid={`classify-change-${slot.key}`}>
                  {t("classify.changeType")} · {t(slot.sourceIds.length > 1 ? "change.merged" : "change.split")}
                </span>
              ) : (
                changed && (
                  <span className="flex items-center gap-2 text-xs text-ink-2">
                    {t("classify.changeType")}
                    <Select
                      testId={`classify-change-${slot.key}`}
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
    </section>
  );

  const renderDetails = (withNewSentences: boolean) => (
    <>
      {rowSuggestion && row?.status === "ai_suggested" ? (
        <section className="grid gap-1.5 rounded-md border border-dashed bg-st-ai-tint px-3 py-2 text-[13px] text-ink" style={{ borderColor: "var(--st-ai-line)" }} data-testid="classify-ai">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-st-ai">
            <Sparkles size={14} strokeWidth={1.5} aria-hidden />
            AI suggested
            {(rowSuggestion.content.rule_ids ?? []).map((rule) => (
              <span key={rule} className="tag font-mono" data-testid={`classify-ai-rule-${rule}`}>
                {rule}
              </span>
            ))}
          </span>
          {rowSuggestion.content.reason && <p data-testid="classify-ai-reason">{rowSuggestion.content.reason}</p>}
          {(rowSuggestion.content.evidence ?? []).length > 0 && (
            <ul className="grid gap-0.5 text-xs text-ink-2">
              {(rowSuggestion.content.evidence ?? []).map((item, index) => (
                <li key={index} className="truncate">
                  <span className="font-mono text-ink-3">{unitMap.get(item.unit_id)?.display_id} </span>“{item.quote}”
                </li>
              ))}
            </ul>
          )}
          <span className="text-[11px] text-ink-3">{t("classify.aiCheck")}</span>
        </section>
      ) : (
        <section className="flex items-start gap-2 rounded-md border border-dashed px-3 py-2 text-xs text-ink-2" style={{ borderColor: "var(--st-ai-line)" }} data-testid="classify-ai">
          <Sparkles size={14} strokeWidth={1.5} className="mt-0.5 shrink-0 text-st-ai" aria-hidden />
          <span className="flex-1">
            {aiJobs.status?.ai_enabled ? t("classify.aiNone") : t("classify.aiLater")}
            {aiBusy > 0 && (
              <span className="mt-0.5 block text-st-ai" data-testid="classify-ai-running">
                {t("classify.aiRunning", { n: aiBusy })}
              </span>
            )}
          </span>
          <span className="flex shrink-0 flex-col items-end gap-1">
            {aiJobs.status?.ai_enabled && canEdit && row && row.status === "unassigned" && (
              <button type="button" className="btn h-7" data-testid="classify-ai-request" disabled={busy} onClick={() => void askAi()}>
                {t("classify.aiAsk")}
              </button>
            )}
            {aiJobs.status?.ai_enabled && canEdit && row && <AiAskMenu items={aiMenuItems} label={t("ai.more")} testId="classify-ai-more" disabled={busy} />}
          </span>
        </section>
      )}
      {withNewSentences && newSentences}
      <section className="grid grid-cols-[96px_minmax(0,1fr)] items-baseline gap-x-3 gap-y-2">
        <span className="text-xs text-ink-3">{t("classify.reason")}</span>
        {canEdit ? (
          <input
            ref={reasonRef}
            className="h-8 rounded-md border border-line-2 bg-surface px-2 text-[13px] text-ink focus:border-accent focus:outline-none"
            data-testid="classify-reason"
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
              data-testid="classify-move-code"
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
            <span className="text-ink-2" data-testid="classify-system-hold">
              <span className="pill warn">{t(SYSTEM_HOLDS.includes(systemHold) ? `hold.system.${systemHold}` : "hold.system.other")}</span>
            </span>
          </>
        )}
        <span className="text-xs text-ink-3">{t("classify.checks")}</span>
        <span className="text-ink-2" data-testid="classify-checks">
          {(groupData?.targets.flatMap((target) => target.warnings) ?? []).map((warning, index) => (
            <span key={index} className="pill warn mr-1">
              {t(readCheckKey(warning))}
            </span>
          ))}
          {(groupData?.targets.flatMap((target) => target.warnings).length ?? 0) === 0 && "–"}
        </span>
        <span className="text-xs text-ink-3">{t("classify.confirmedBy")}</span>
        <span className="text-ink-2" data-testid="classify-confirmed-by">
          {firstDecision?.confirmed_by ? `${firstDecision.confirmed_by} · ${formatKst(firstDecision.confirmed_at)}` : "–"}
        </span>
      </section>
    </>
  );

  const loading = (
    <div className="p-4" data-testid="classify-loading">
      {showSkeleton && <span className="sk h-[480px] w-full" />}
    </div>
  );

  const error = docs.error ?? views.error ?? units.error ?? tobe.error;
  if (!ready) {
    return error !== null ? (
      <p className="p-6 text-ink-2" data-testid="classify-error">
        {humanizeApiError(error, t)}
      </p>
    ) : (
      loading
    );
  }

  const paperPane = (
    <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)]">
      <div className="flex h-11 items-center gap-2.5 border-b border-line bg-surface px-[var(--pad)]">
        <span className="font-mono text-[13px] font-semibold">{viewOfRow?.document.doc_code ?? ""}</span>
        <span className="min-w-0 flex-1 truncate text-ink-2">{viewOfRow?.document.title ?? ""}</span>
        {bundle?.is_synthetic && <span className="tag">Synthetic data</span>}
        <SourceFontMenu />
      </div>
      <div className="desk" data-testid="classify-desk">
        {paperModel && row ? (
          <Paper
            model={paperModel}
            selectedId={row.unitIds[0]}
            highlightIds={new Set(row.unitIds)}
            isDone={(unitId) => unitMap.get(unitId)?.status === "confirmed" && !row.unitIds.includes(unitId)}
            onUnitClick={(unitId) => handlePaperClick(unitId)}
            figureSource={viewOfRow ? { bundleId, docId: viewOfRow.document.id } : undefined}
            testId="classify-paper"
          />
        ) : (
          rows.length === 0 ? <EmptyState icon={Inbox} testId="classify-empty" title={t("classify.emptyTitle")} body={t("classify.noUnits")} /> : <p />
        )}
      </div>
    </div>
  );

  const body =
    layout === "list" ? (
      <div className="grid h-full min-h-0 grid-cols-[318px_minmax(0,1fr)]" data-testid="classify" data-layout="list">
        <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] border-r border-line bg-surface">
          {filterTabs}
          {listRows}
          {listFoot}
        </div>
        <div className="grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] bg-surface">
          <div className="border-b border-line px-[var(--pad)] py-2.5">{header}</div>
          <div className="grid grid-cols-[minmax(0,1fr)_200px_auto] items-center gap-2 border-b border-line px-[var(--pad)] py-2.5">
            {picker}
            {primary}
            {secondary}
          </div>
          <Refresh token={activeKey ?? ""} className="grid min-h-0 content-start gap-4 overflow-y-auto p-[var(--pad)]">
            <div className="grid grid-cols-2 gap-3">
              <section className="grid content-start gap-2">
                <h2 className="text-xs font-semibold text-ink-3">{t("classify.source")}</h2>
                {rowUnits.map((unit) => (
                  <div key={unit.unit_id} className="grid min-h-[70px] grid-cols-[22px_minmax(0,1fr)] gap-2 rounded-md border border-line bg-paper px-2.5 py-2">
                    <span className="lg">{unit.lang === "neutral" ? "–" : unit.lang.toUpperCase()}</span>
                    <p lang={unit.lang === "neutral" ? undefined : unit.lang} className="whitespace-pre-wrap text-[15px] leading-[26px]" style={{ fontFamily: unit.lang === "en" ? "var(--font-source-en)" : "var(--font-source)" }}>
                      {unit.kind === "table" ? t("classify.tableUnit") : unit.text}
                    </p>
                  </div>
                ))}
              </section>
              {newSentences}
            </div>
            {renderDetails(false)}
          </Refresh>
        </div>
      </div>
    ) : (
      <div className="grid h-full min-h-0 grid-cols-[232px_minmax(0,1fr)_392px]" data-testid="classify" data-layout="paper">
        <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] border-r border-line bg-surface">
          {filterTabs}
          {listRows}
          {listFoot}
        </div>
        {paperPane}
        <aside className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] border-l border-line bg-surface" data-testid="classify-inspector">
          <div className="grid gap-2 border-b border-line p-[var(--pad)]">
            {header}
            {picker}
            {primary}
            {secondary}
          </div>
          <Refresh token={activeKey ?? ""} className="grid min-h-0 content-start gap-4 overflow-y-auto p-[var(--pad)]">
            {renderDetails(true)}
          </Refresh>
        </aside>
      </div>
    );

  return (
    <>
      {body}
      {bulk && (
        <BulkModal
          action={bulk}
          count={[...checked].flatMap((key) => rowMap.get(key)?.unitIds ?? []).length}
          onClose={() => setBulk(null)}
          onConfirm={async (bulkReason, code) => {
            const unitRows = [...checked].flatMap((key) => rowMap.get(key)?.unitIds ?? []).map((id) => unitMap.get(id)).filter((unit): unit is UnitRow => unit !== undefined);
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
      <span className="sr-only" aria-live="polite">
        {row ? describeDestination(destination, options, t)?.label ?? "" : ""}
      </span>
    </>
  );
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
      testId="classify-bulk-modal"
      footer={
        <>
          <button type="button" className="btn" data-testid="classify-bulk-cancel" onClick={onClose}>
            <X size={16} strokeWidth={1.5} aria-hidden />
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className={`btn ${action === "delete" ? "danger" : "pri"}`}
            data-testid="classify-bulk-confirm"
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
        <input className="h-8 rounded-md border border-line-2 bg-surface px-2 text-[13px]" data-testid="classify-bulk-reason" value={reason} maxLength={2000} autoFocus onChange={(event) => setReason(event.target.value)} />
      </label>
      {action === "move" && (
        <label className="grid gap-1">
          <span className="text-xs text-ink-2">{t("classify.moveTo")}</span>
          <input className="h-8 rounded-md border border-line-2 bg-surface px-2 font-mono text-[13px]" data-testid="classify-bulk-code" value={code} maxLength={100} onChange={(event) => setCode(event.target.value)} />
        </label>
      )}
    </Modal>
  );
}
