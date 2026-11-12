// Split(원문 대조) - 왼쪽 문서 목록과 도움말(단축키·표시), 가운데 용지(본문·머리말·꼬리말 탭), 오른쪽 고른 단위 정보와 편집(명세 §12-4, 2026-11-10 개편).
// 단위 하나가 종이 한 조각이다. 누르면 고르고 끝에 확인 단추가 나온다. 두 번 누르면 그 자리에 나눌 선이 놓이고 끌어 옮길 수 있다(S로 나눈다).
// 합치기는 조각 사이의 단추 하나뿐이다. 끌어 고르면 새 단위로 만들 수 있다.
"use client";

import { ArrowDown, ArrowUp, Check, CheckCheck, Circle, CircleCheck, FileText, Link2, Redo2, Scissors, SquarePlus, TriangleAlert, Undo2, Unlink, Upload, WandSparkles, X } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useEffectEvent, useMemo, useState, type ReactNode } from "react";

import { SplitAiTabs } from "@/components/manage/split-ai";
import { SplitAiBar } from "@/components/manage/split-ai-bar";
import { SplitAiResult } from "@/components/manage/split-ai-result";
import { PartTabs } from "@/components/paper/part-tabs";
import { Paper, type CutDragPos, type PaperCut } from "@/components/paper/paper";
import { SourceFontMenu } from "@/components/paper/source-font-menu";
import { Modal } from "@/components/modal";
import { ReadOnlyNote } from "@/components/read-only-note";
import { SplitContextMenu } from "@/components/split/split-context-menu";
import { SplitUnitActions } from "@/components/split/split-unit-actions";
import { SplitHelp } from "@/components/split/split-help";
import { LoadError } from "@/components/ui/load-error";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { getStageHref } from "@/lib/stages";
import { InfoTip } from "@/components/ui/info-tip";
import { BusyLabel, Truncate } from "@/components/ui/motion";
import { showToast } from "@/components/ui/toast";
import { Tooltip } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/ui/empty-state";
import { ApiError } from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import {
  ackWarning,
  confirmAllBoundaries,
  confirmPair,
  createPair,
  deletePair,
  editUnits,
  getDocumentView,
  getGroupByUnit,
  listDocuments,
  redoEdit,
  saveGroup,
  setBoundaryConfirmed,
  undoEdit,
  type DocumentView,
  type EditOp,
  type EditResult,
  type PartRef,
  type ViewUnit,
} from "@/lib/api-sop";
import { loadBundle, useBundle } from "@/lib/bundle-store";
import { buildGroupSave } from "@/lib/classify-model";
import { useI18n } from "@/lib/i18n";
import { buildPaperModel, buildPaperTabs, canSplitAt, countUnchecked, readWarningText, resolveCutDrag, shouldRecenter, toBlockOffset, toUnitOffset, type PaperSheet, type PaperTabKey } from "@/lib/paper-model";
import { findLangMismatch } from "@/lib/lang-mismatch-model";
import { getSplitKeyAction } from "@/lib/split-keys";
import { buildSplitMenu, canPair, getAiSplitReason, isAiSplitKind, isUnitDecided, type SplitMenuAction } from "@/lib/split-menu-model";
import { useDelayedFlag } from "@/lib/use-delayed-flag";
import { useLoaded } from "@/lib/use-loaded";
import { buildAiTabs } from "@/lib/split-ai-tabs-model";
import { useSplitAi } from "@/lib/use-split-ai";

/** Paper의 testid 앞말 - 단위·조각 testid와 Shift+F10이 같은 값을 쓴다 */
const PAPER_TEST_ID = "split-paper";

interface PendingConfirm {
  count: number;
  run: () => Promise<EditResult>;
  /** 새 단위가 없는 편집(언어 바꾸기) 뒤에도 고른 채로 둘 단위 */
  keepId?: number;
}

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

function Section({ title, info, children, testId }: { title: string; info?: string; children: ReactNode; testId?: string }) {
  return (
    <section className="grid min-w-0 gap-2" data-testid={testId}>
      <h2 className="insp-h">
        {title}
        {info && <InfoTip text={info} testId={`${testId ?? "split-section"}-info`} />}
      </h2>
      {children}
    </section>
  );
}

export default function SplitPage() {
  const { t } = useI18n();
  const router = useRouter();
  const bundleId = Number(useParams<{ id: string }>().id);
  const searchParams = useSearchParams();
  const { bundle } = useBundle(bundleId);
  const canEdit = bundle?.my_role === "author" && bundle.status === "in_progress";

  const docs = useLoaded(() => listDocuments(bundleId), String(bundleId));
  const readyDocs = (docs.data ?? []).filter((doc) => doc.status === "ready");
  const docId = Number(searchParams.get("doc")) || readyDocs[0]?.id || null;

  const [viewKey, setViewKey] = useState(0);
  const view = useLoaded<DocumentView | null>(
    () => (docId === null ? Promise.resolve(null) : getDocumentView(bundleId, docId)),
    `${docId}:${viewKey}`,
  );
  // 문서를 바꾸는 동안 이전 문서의 보기는 쓰지 않는다 - 새 docId에 이전 문서의 revision·단위를 실어 보내게 된다
  const data = view.data !== null && view.data.document.id === docId ? view.data : null;
  const showSkeleton = useDelayedFlag(data === null && docId !== null);
  const model = useMemo(() => (data ? buildPaperModel(data) : null), [data]);
  // 본문·머리말·꼬리말 탭과 쪽 - 내용이 같은 머리말·꼬리말은 한 번만 보이고(숨긴 쪽은 mirrors로 함께 확인한다)
  const tabs = useMemo(() => (data && model ? buildPaperTabs(data, model) : null), [data, model]);
  const [tabKey, setTabKey] = useState<PaperTabKey>("body");
  const activeTab = tabs?.tabs.find((tab) => tab.key === tabKey) ?? tabs?.tabs[0] ?? null;

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [cutAt, setCutAt] = useState<{ unitId: number; at: number } | null>(null);
  const [range, setRange] = useState<{ blockId: number; start: number; end: number } | null>(null);
  // 짝 맞추기 - 다른 언어 문장을 눌러 고르는 중
  const [isPairPicking, setIsPairPicking] = useState(false);
  const [picked, setPicked] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  // 보낼 곳 없는 보류(명세 §6.8) - 판단을 받는 단위 id와 사유
  const [holdFor, setHoldFor] = useState<{ unitId: number; reason: string } | null>(null);
  // 경계 확인은 바로 보이게 먼저 칠한다 - 지금 보기 데이터에 묶여 있어 새 데이터가 오면 저절로 버려진다
  const [localChecks, setLocalChecks] = useState<{ base: DocumentView | null; values: Record<number, boolean> }>({ base: null, values: {} });
  const checkOverrides = localChecks.base === data ? localChecks.values : {};
  // 보이는 단위는 숨긴 같은 내용 단위까지 모두 확인돼야 확인된 것이다
  const isChecked = (unit: ViewUnit) =>
    checkOverrides[unit.id] ?? (unit.boundary_confirmed && (tabs?.mirrors.get(unit.id) ?? []).every((id) => model?.units.get(id)?.boundary_confirmed !== false));
  const hiddenIds = new Set([...(tabs?.mirrors.values() ?? [])].flat());
  const shownUnits = (data?.units ?? []).filter((unit) => !hiddenIds.has(unit.id));
  // 지금 문서는 방금 누른 확인까지 센다 - 다른 문서는 목록이 준 수를 쓴다
  const uncheckedLeft = countUnchecked(shownUnits, isChecked);
  const countTabLeft = (key: PaperTabKey) => countUnchecked(shownUnits.filter((unit) => tabs?.tabOf.get(unit.id) === key), isChecked);
  const checkableTotal = countUnchecked(shownUnits, () => false);
  const [isCheckRestOpen, setIsCheckRestOpen] = useState(false);
  // 우클릭 메뉴 - 뜬 자리와 누른 문장
  const [menu, setMenu] = useState<{ x: number; y: number; targetId: number } | null>(null);

  const selected: ViewUnit | null = (selectedId !== null && model?.units.get(selectedId)) || null;
  const cut: PaperCut | null = (() => {
    if (!cutAt || !selected || cutAt.unitId !== selected.id) return null;
    const pos = toBlockOffset(selected.spans, cutAt.at);
    return pos ? { blockId: pos.blockId, offset: pos.offset } : null;
  })();
  const warnings = data?.extraction?.warnings ?? [];
  const warnBlockIds = new Set(warnings.flatMap((w) => (w.block_id !== null && w.needs_ack && !w.acked_by ? [w.block_id] : [])));
  const pair = selected?.pair_id ? data?.pairs.find((item) => item.id === selected.pair_id) ?? null : null;
  const partnerIds = selected && pair ? new Set(pair.unit_ids.filter((id) => id !== selected.id)) : undefined;
  const ai = useSplitAi(bundleId, docId, data?.document.revision ?? null, (result) => (result ? handleChangeDone(result, t("split.didSplit")) : refresh()));
  const suggestion = ai.findSuggestion(selected);
  const suggestedIds = (tabs?.order ?? []).filter((id) => model?.units.get(id)?.split_suggestion_id != null);
  // AI 제안 탭 - 연 적 있는 문장은 점을 뗀다(지금 고른 문장은 열어 본 것으로 친다)
  const [seenAi, setSeenAi] = useState<ReadonlySet<number>>(new Set());
  const aiTabs = buildAiTabs(
    suggestedIds.map((id, position) => ({ unitId: id, label: model?.units.get(id)?.display_id ?? String(id), position, origin: ai.getOrigin(id) })),
    selectedId === null ? seenAi : new Set(seenAi).add(selectedId),
  );
  const aiUnitKey = selected ? getAiSplitReason({ aiEnabled: ai.isOn, isText: true, hasSuggestion: suggestion !== null, isWaiting: ai.isWaiting(selected.id) }) : null;
  const aiUnitReason = aiUnitKey === null ? null : t(aiUnitKey);
  const sentenceCount = (data?.units ?? []).filter((unit) => unit.kind === "sentence" && unit.split_suggestion_id === null).length;

  function selectDoc(nextId: number) {
    setSelectedId(null);
    setTabKey("body");
    clearTransient();
    router.replace(`/bundles/${bundleId}/split?doc=${nextId}`);
  }

  function clearTransient() {
    setCutAt(null);
    setRange(null);
    setIsPairPicking(false);
    setPicked([]);
    window.getSelection()?.removeAllRanges();
  }

  function refresh() {
    setViewKey((key) => key + 1);
    // 문서 목록의 남은 경계 수도 같이 맞춘다
    docs.reload();
    void loadBundle(bundleId);
  }

  function selectUnit(unitId: number | null, scroll = false) {
    setSelectedId(unitId);
    if (unitId !== null) setSeenAi((prev) => new Set(prev).add(unitId));
    setCutAt(null);
    setRange(null);
    // 다른 탭의 단위(짝·다음 확인 안 된 단위)를 고르면 그 탭으로 간다
    const nextTab = unitId === null ? undefined : tabs?.tabOf.get(unitId);
    if (nextTab !== undefined) setTabKey(nextTab);
    if (scroll && unitId !== null) {
      // 화면 아래 끝에 붙지 않게 - 위아래 가장자리 쪽이면 가운데쯤으로 옮긴다
      requestAnimationFrame(() => {
        const target = document.querySelector(`[data-testid="split-paper-unit-${unitId}"]`);
        const desk = document.querySelector('[data-testid="split-desk"]');
        if (!target || !desk) return;
        const box = target.getBoundingClientRect();
        const view = desk.getBoundingClientRect();
        if (shouldRecenter(box.top, box.bottom, view.top, view.bottom)) target.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      });
    }
  }

  function moveSelection(step: 1 | -1) {
    const order = tabs?.order ?? [];
    if (order.length === 0) return;
    // 고른 것이 없으면 지금 탭의 처음에서 시작한다
    const index = selectedId === null ? order.indexOf(activeTab?.unitIds[0] ?? order[0]) - step : order.indexOf(selectedId);
    selectUnit(order[Math.min(Math.max(index + step, 0), order.length - 1)], true);
  }

  // 편집 한 번 - 판단이 걸린 단위를 은퇴시키면 서버가 409로 먼저 묻는다
  async function runChange(run: (confirm: boolean) => Promise<EditResult>, okText: string, keepId?: number) {
    if (busy) return;
    setBusy(true);
    try {
      const result = await run(false);
      handleChangeDone(result, okText, keepId);
    } catch (err) {
      const unitIds = err instanceof ApiError && err.rule?.code === "confirm_required" ? err.rule.unit_ids : null;
      if (Array.isArray(unitIds)) {
        setPending({ count: unitIds.length, run: () => run(true), keepId });
      } else {
        showToast(humanizeApiError(err, t), "error");
        refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  /** 고른 단위(칸 문장이면 묶인 표·행 단위)를 보낼 곳 없이 보류한다 - 아직 판단이 없는 단위만 */
  function startHold() {
    if (!selected || !model) return;
    const unitId = selected.group_unit_id ?? selected.id;
    if (isUnitDecided(selected, model.units)) {
      showToast(t("split.holdDecided"), "error");
      return;
    }
    setHoldFor({ unitId, reason: "" });
  }

  async function runHold() {
    if (!holdFor || !holdFor.reason.trim() || busy) return;
    setBusy(true);
    try {
      // 관계 묶음 저장은 닫혀야 한다 - 그 단위의 묶음을 읽어 함께 보낸다
      const group = await getGroupByUnit(bundleId, holdFor.unitId);
      const units = group.units.map((unit) => ({ id: unit.unit_id, kind: unit.kind, lang: unit.lang, text: unit.text, revision: unit.decision.revision }));
      const draft = { destination: null, texts: {}, changeTypes: {}, reason: "", moveCode: "" };
      await saveGroup(bundleId, buildGroupSave(draft, { units, group, tables: new Map() }, "hold", holdFor.reason.trim()));
      setHoldFor(null);
      showToast(t("split.held"));
      refresh();
    } catch (err) {
      showToast(humanizeApiError(err, t), "error");
      refresh();
    } finally {
      setBusy(false);
    }
  }

  function handleChangeDone(result: EditResult, okText: string, keepId?: number) {
    clearTransient();
    selectUnit(result.created_unit_ids[0] ?? keepId ?? null);
    showToast(okText);
    refresh();
  }

  function runEdit(op: EditOp, okText: string, keepId?: number) {
    if (!data || docId === null) return;
    const revision = data.document.revision;
    void runChange((confirm) => editUnits(bundleId, docId, revision, op, confirm), okText, keepId);
  }

  function runStep(kind: "undo" | "redo") {
    if (!data || docId === null) return;
    const revision = data.document.revision;
    const call = kind === "undo" ? undoEdit : redoEdit;
    void runChange((confirm) => call(bundleId, docId, revision, confirm), t(kind === "undo" ? "split.undone" : "split.redone"));
  }

  async function runSimple(action: () => Promise<unknown>, okText: string | null, after?: () => void) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      if (okText) showToast(okText);
      after?.();
      refresh();
    } catch (err) {
      showToast(humanizeApiError(err, t), "error");
      refresh();
    } finally {
      setBusy(false);
    }
  }

  function setBoundary(unit: ViewUnit, confirmed: boolean) {
    // 다른 요청이 도는 중이면 보내지 않으니 먼저 칠하지도 않는다
    if (docId === null || busy) return;
    setLocalChecks({ base: data, values: { ...checkOverrides, [unit.id]: confirmed } });
    void runSimple(() => setBoundaryConfirmed(bundleId, docId, [unit.id, ...(tabs?.mirrors.get(unit.id) ?? [])], confirmed), null, () => {
      // Enter는 확인하고 다음 확인 안 된 단위로 간다 - 탭이 끝나면 다음 탭으로 넘어간다
      if (confirmed && model && tabs) {
        const index = tabs.order.indexOf(unit.id);
        const next = tabs.order.slice(index + 1).find((id) => {
          const candidate = model.units.get(id);
          return candidate !== undefined && !isChecked(candidate);
        });
        if (next !== undefined) selectUnit(next, true);
      }
    });
  }

  /** 틈의 짝 짓기 - 우클릭 메뉴와 같은 규칙(canPair) */
  function canPairIds(firstId: number, secondId: number): boolean {
    const first = model?.units.get(firstId);
    const second = model?.units.get(secondId);
    return first !== undefined && second !== undefined && canPair(first, second);
  }

  function pairIds(firstId: number, secondId: number) {
    if (!data || docId === null) return;
    const revision = data.document.revision;
    void runSimple(() => createPair(bundleId, docId, revision, [firstId, secondId]), t("split.pairConfirmed"), clearTransient);
  }

  function splitAtCut() {
    if (!selected || !cutAt || cutAt.unitId !== selected.id) return;
    runEdit({ type: "split", unit_id: selected.id, at: cutAt.at }, t("split.didSplit"));
  }

  function handleUnitClick(unitId: number) {
    if (isPairPicking && unitId !== selectedId) {
      setPicked((prev) => (prev.includes(unitId) ? prev.filter((id) => id !== unitId) : [...prev, unitId]));
      return;
    }
    // 고른 문장을 다시 한 번 눌러서는 나누지 않는다 - 나누기는 두 번 누르기로(실수로 선이 생기지 않게)
    if (unitId !== selectedId) selectUnit(unitId);
  }

  /** 두 번 누른 자리에 나눌 선 - 다른 문장이면 먼저 고른다 */
  function handleUnitDoubleClick(unitId: number, at: { blockId: number; offset: number } | null) {
    if (isPairPicking) return;
    const unit = model?.units.get(unitId);
    if (!unit || !at || !canEdit) return;
    if (unitId !== selectedId) selectUnit(unitId);
    const unitOffset = toUnitOffset(unit.spans, at.blockId, at.offset);
    if (unitOffset !== null && canSplitAt(unit, unitOffset)) setCutAt({ unitId, at: unitOffset });
  }

  /** 나눌 선을 끄는 동안 - 고른 단위 안의 나눌 수 있는 자리로만 옮긴다(밖으로 끌면 처음·끝에 멈춘다) */
  function dragCut(pos: CutDragPos) {
    if (!selected) return;
    const at = resolveCutDrag(selected, pos);
    if (at !== null && at !== cutAt?.at) setCutAt({ unitId: selected.id, at });
  }

  function nudgeCut(step: 1 | -1) {
    if (!selected || !cutAt) return;
    for (let at = cutAt.at + step; at > 0 && at < selected.text.length; at += step) {
      if (canSplitAt(selected, at) && toBlockOffset(selected.spans, at) !== null) {
        setCutAt({ unitId: selected.id, at });
        return;
      }
    }
  }

  function selectNextSuggestion() {
    if (suggestedIds.length === 0) return;
    const order = tabs?.order ?? [];
    const from = selectedId === null ? -1 : order.indexOf(selectedId);
    selectUnit(suggestedIds.find((id) => order.indexOf(id) > from) ?? suggestedIds[0], true);
  }

  /** 문장 우클릭·메뉴 글쇠 - 고른 것이 없으면 그 문장을 먼저 고른다(한 문장 메뉴가 그 문장의 것이 되게) */
  function openMenu(unitId: number, at: { x: number; y: number }) {
    if (!model?.units.has(unitId) || isPairPicking) return;
    if (selectedId === null) selectUnit(unitId);
    setMenu({ ...at, targetId: unitId });
  }

  const menuTarget = menu ? model?.units.get(menu.targetId) ?? null : null;
  const menuItems = (() => {
    if (!menuTarget || !model || !tabs) return null;
    const order = tabs.order;
    const adjacent = selected !== null && Math.abs(order.indexOf(selected.id) - order.indexOf(menuTarget.id)) === 1;
    return buildSplitMenu({
      selected,
      target: menuTarget,
      adjacent,
      readOnly: !canEdit,
      aiEnabled: ai.isOn,
      isChecked,
      hasCut: cutAt?.unitId === menuTarget.id,
      hasSuggestion: menuTarget.split_suggestion_id !== null,
      isAiWaiting: ai.isWaiting(menuTarget.id),
      isDecided: isUnitDecided(menuTarget, model.units),
    });
  })();

  function runMenuAction(action: SplitMenuAction) {
    const target = menuTarget;
    setMenu(null);
    if (!target || !data || docId === null || !model || !tabs) return;
    const revision = data.document.revision;
    const isTwo = selected !== null && selected.id !== target.id;
    const pairId = isTwo ? selected.pair_id : target.pair_id;
    if (action === "pair" && selected) void runSimple(() => createPair(bundleId, docId, revision, [selected.id, target.id]), t("split.pairConfirmed"), clearTransient);
    else if (action === "unpair" && pairId !== null) void runSimple(() => deletePair(bundleId, docId, pairId, revision), t("split.pairRemoved"));
    else if (action === "merge" && selected) {
      const [first, second] = tabs.order.indexOf(selected.id) < tabs.order.indexOf(target.id) ? [selected, target] : [target, selected];
      runEdit({ type: "merge", unit_ids: [first.id, second.id] }, t("split.didMerge"));
    } else if (action === "check_both" && selected) {
      const ids = [selected, target].flatMap((unit) => [unit.id, ...(tabs.mirrors.get(unit.id) ?? [])]);
      void runSimple(() => setBoundaryConfirmed(bundleId, docId, ids, true), null);
    } else if (action === "check") setBoundary(target, !isChecked(target));
    else if (action === "split") splitAtCut();
    else if (action === "ai_split") void ai.askUnit(target.id);
    else if (action === "hold") startHold();
    else if (action === "lang_ko" || action === "lang_en") {
      runEdit({ type: "set_language", unit_ids: [target.id], lang: action === "lang_ko" ? "ko" : "en" }, t("common.saved"), target.id);
    }
  }

  function describeSheet(sheet: PaperSheet, index: number): string {
    if (sheet.refs.length === 0) return t("split.sheetOrdinal", { name: t(`split.part.${sheet.part}`), n: index + 1 });
    return sheet.refs.map((ref: PartRef) => t("split.sheetRef", { n: ref.section, type: t(`split.refType.${ref.type}`) })).join(", ");
  }

  const handleKey = useEffectEvent((event: KeyboardEvent) => {
    if (pending) return;
    // 메뉴 글쇠·Shift+F10 - 고른 문장 줄에서 메뉴를 연다
    if ((event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) && selected && !isTypingTarget(event.target) && document.querySelector('[role="dialog"],[role="menu"],[role="listbox"]') === null) {
      const strip = document.querySelector(`[data-testid="${PAPER_TEST_ID}-piece-${selected.id}"]`);
      if (!strip) return;
      const box = strip.getBoundingClientRect();
      event.preventDefault();
      openMenu(selected.id, { x: box.left + 40, y: box.top + Math.min(box.height, 40) / 2 });
      return;
    }
    const action = getSplitKeyAction(event, {
      typing: isTypingTarget(event.target),
      // 용지의 단위 손잡이(data-unit)는 단추여도 화면 단축키를 그대로 받는다
      onControl: event.target instanceof HTMLElement && event.target.closest("button, a, [role='option']") !== null && event.target.closest("[data-unit]") === null,
      layerOpen: document.querySelector('[role="dialog"],[role="menu"],[role="listbox"]') !== null,
      hasCut: cut !== null,
      checked: selected !== null && isChecked(selected),
      canEdit,
    });
    if (action === null) return;
    if (action === "undo" || action === "redo") {
      event.preventDefault();
      if (action === "redo" ? data?.edits.can_redo : data?.edits.can_undo) runStep(action);
      return;
    }
    if (action === "next" || action === "prev") moveSelection(action === "next" ? 1 : -1);
    else if (action === "escape") clearTransient();
    else if (!selected) return;
    else if (action === "check") setBoundary(selected, true);
    else if (action === "uncheck") setBoundary(selected, false);
    else if (action === "split") splitAtCut();
    else if (action === "hold") startHold();
    event.preventDefault();
  });

  useEffect(() => {
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  const orderedUnits = (tabs?.order ?? []).map((id) => model?.units.get(id)).filter((unit): unit is ViewUnit => unit !== undefined);
  const langMismatch = data && selected ? findLangMismatch(data.document.language_layout, selected, orderedUnits) : null;
  const pickedUnits = picked.map((id) => model?.units.get(id)).filter((unit): unit is ViewUnit => unit !== undefined);
  const document_ = data?.document;
  const page = selected ? data?.blocks.find((block) => block.id === selected.block_id) : null;

  return (
    <div className="grid h-full min-h-0 grid-cols-[232px_minmax(0,1fr)_clamp(280px,26vw,420px)]" data-testid="split">
      {/* 왼쪽: 문서 */}
      <nav className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto] border-r border-line bg-surface" aria-label={t("split.documents")} data-testid="split-docs">
        <div className="grid content-start gap-0.5 overflow-y-auto p-2">
        {readyDocs.map((doc) => (
          <button
            key={doc.id}
            type="button"
            className={`grid gap-0.5 rounded-md p-2 text-left transition-colors hover:bg-hover ${doc.id === docId ? "bg-sel" : ""}`}
            aria-current={doc.id === docId ? "true" : undefined}
            data-testid={`split-doc-${doc.id}`}
            onClick={() => selectDoc(doc.id)}
          >
            <span className="flex items-start gap-1.5">
              <b className="min-w-0 flex-1 font-mono text-xs font-semibold leading-[18px] [overflow-wrap:anywhere]">{doc.doc_code || doc.file_name}</b>
              <DocBoundaryMark docId={doc.id} left={doc.id === docId && data ? uncheckedLeft : doc.unchecked_boundaries} />
            </span>
            <Truncate className="text-xs leading-[18px] text-ink-3" text={doc.title} />
          </button>
        ))}
        </div>
        <SplitHelp />
      </nav>

      {/* 가운데: 용지 */}
      {/* 열을 minmax(0,1fr)로 못 박는다 - 암묵 열(auto)은 위 줄의 한 줄 글자만큼 넓어져, 1280보다 좁은 창에서 용지가 오른쪽 패널 밑으로 들어갔다 */}
      <div className="flex min-h-0 min-w-0 flex-col">
        <div className="flex h-11 flex-none items-center gap-2.5 border-b border-line bg-surface px-[var(--pad)]">
          <span className="whitespace-nowrap font-mono text-[13px] font-semibold">{document_?.doc_code ?? ""}</span>
          <span className="min-w-0 flex-1 truncate text-ink-2">{document_?.title ?? ""}</span>
          {bundle?.is_synthetic && <span className="tag">Synthetic data</span>}
          <ReadOnlyNote bundle={bundle} testId="split" />
          {page?.page != null && (
            <span className="tabular-nums text-xs text-ink-3" data-testid="split-page">
              {page.page_basis === "estimated" ? "≈ " : ""}p.{page.page}
            </span>
          )}
          {data && <SplitAiBar ai={ai} layout={data.document.language_layout} canEdit={canEdit} busy={busy} pending={suggestedIds.length} sentenceCount={sentenceCount} onNext={selectNextSuggestion} />}
          <SourceFontMenu />
        </div>
        {tabs && tabs.tabs.length > 1 && (
          <div className="flex flex-none items-center border-b border-line bg-surface px-[var(--pad)] py-1.5">
            <PartTabs
              keys={tabs.tabs.map((tab) => tab.key)}
              active={activeTab?.key ?? "body"}
              testIdPrefix="split-tab"
              onChange={(key) => {
                setTabKey(key);
                clearTransient();
              }}
              renderBadge={(key) => {
                const left = countTabLeft(key);
                return left > 0 ? (
                  <span className="tab-left" aria-label={t("split.uncheckedLeft", { n: left })} data-testid={`split-tab-left-${key}`}>
                    {left}
                  </span>
                ) : (
                  <CircleCheck size={13} strokeWidth={2} className="pmark checked" aria-label={t("split.allChecked")} />
                );
              }}
            />
          </div>
        )}
        {ai.lastRequest && <SplitAiResult result={ai.lastRequest} onClose={ai.clearLastRequest} />}
        <div className="desk split-desk min-h-0 flex-1" data-testid="split-desk">
          {model && activeTab ? (
            <div className="sheets" data-testid="split-paper">
            {activeTab.sheets.map((sheet, sheetIndex) => (
            <div key={sheet.key} className="sheet-set">
            {activeTab.key !== "body" && (
              <p className="sheet-cap" data-testid={`split-sheet-cap-${sheet.key}`}>
                {describeSheet(sheet, sheetIndex)}
              </p>
            )}
            <Paper
              model={model}
              items={sheet.items}
              selectedId={selectedId}
              partnerIds={partnerIds}
              pickedIds={new Set(picked)}
              cut={cut}
              warnBlockIds={warnBlockIds}
              onUnitClick={handleUnitClick}
              onUnitDoubleClick={canEdit ? handleUnitDoubleClick : undefined}
              onUnitContextMenu={openMenu}
              onRangeSelect={canEdit ? (next) => setRange(next) : undefined}
              onCutDrag={canEdit ? dragCut : undefined}
              onCutNudge={canEdit ? nudgeCut : undefined}
              figureSource={docId !== null ? { bundleId, docId } : undefined}
              testId={PAPER_TEST_ID}
              sheetTestId={`split-sheet-${sheet.key}`}
              contour
              strips={{
                isChecked,
                merge: canEdit ? { busy, onMerge: (firstId, secondId) => runEdit({ type: "merge", unit_ids: [firstId, secondId] }, t("split.didMerge")) } : undefined,
                pair: canEdit ? { canPair: canPairIds, onPair: pairIds } : undefined,
              }}
              renderUnitActions={(unitId) => {
                const unit = model.units.get(unitId);
                // 표·행처럼 글자 범위가 없는 단위는 경계를 세지 않는다 - 단추 줄이 없다
                if (!canEdit || !unit || unit.spans.length === 0) return null;
                const pairId = unit.pair_id;
                return (
                  <SplitUnitActions
                    key={unit.id}
                    unitId={unit.id}
                    isChecked={isChecked(unit)}
                    canUnpair={pairId !== null}
                    canUnmerge={unit.can_unmerge}
                    busy={busy}
                    onCheck={() => setBoundary(unit, true)}
                    onUncheck={() => setBoundary(unit, false)}
                    onUnpair={() => pairId !== null && docId !== null && data && void runSimple(() => deletePair(bundleId, docId, pairId, data.document.revision), t("split.pairRemoved"))}
                    onUnmerge={() => runEdit({ type: "unmerge", unit_id: unit.id }, t("split.didUnmerge"))}
                  />
                );
              }}
              renderAtCut={() => (
                <span className="cut-pop" role="group" aria-label={t("split.split")} onClick={(event) => event.stopPropagation()}>
                  <button type="button" className="btn pri h-7" data-testid="split-cut-run" disabled={busy} onClick={splitAtCut}>
                    <Scissors size={14} strokeWidth={1.5} aria-hidden />
                    {t("split.cutHere")} <kbd>S</kbd>
                  </button>
                  <button type="button" className="btn h-7" data-testid="split-cut-cancel" onClick={() => setCutAt(null)}>
                    <X size={14} strokeWidth={1.5} aria-hidden />
                    {t("common.cancel")} <kbd>Esc</kbd>
                  </button>
                </span>
              )}
            />
            </div>
            ))}
            </div>
          ) : view.error !== null ? (
            <LoadError error={view.error} onRetry={view.reload} testId="split" />
          ) : docs.error !== null && docs.data === null ? (
            <LoadError error={docs.error} onRetry={docs.reload} testId="split-docs" />
          ) : docs.data !== null && readyDocs.length === 0 ? (
            <EmptyState
              icon={FileText}
              testId="split-empty"
              title={t("documents.emptyTitle")}
              body={t("split.noDocuments")}
              action={
                <Link href={getStageHref(bundleId, "documents")} className="btn pri" data-testid="split-empty-documents">
                  <Upload size={16} strokeWidth={1.5} aria-hidden />
                  {t("documents.upload")}
                </Link>
              }
            />
          ) : (
            showSkeleton && <span className="sk mx-auto block h-[640px] w-full max-w-[720px]" />
          )}
        </div>
      </div>

      {/* 오른쪽: 고른 단위 */}
      <aside className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] border-l border-line bg-surface" data-testid="split-inspector">
        <div className="grid gap-2 border-b border-line p-[var(--pad)]">
          {/* 고른 Unit이 없으면 눌러 볼 수 없는 단추 묶음 대신 진행 요약만 둔다 */}
          {selected && (<>
          {/* ID와 확인 상태는 각각 한 줄 - 좁은 패널에서 접히지 않게 */}
          <div className="flex h-7 items-center gap-1">
            <Truncate className="min-w-0 flex-1 font-mono text-sm font-semibold" text={selected.display_id} testId="split-unit-id" />
            <Tooltip label={t("split.prev")}>
              <button type="button" className="btn ghost icon h-7 w-7 flex-none" aria-label={t("split.prev")} data-testid="split-prev" onClick={() => moveSelection(-1)}>
                <ArrowUp size={14} strokeWidth={1.5} aria-hidden />
              </button>
            </Tooltip>
            <Tooltip label={t("split.next")}>
              <button type="button" className="btn ghost icon h-7 w-7 flex-none" aria-label={t("split.next")} data-testid="split-next" onClick={() => moveSelection(1)}>
                <ArrowDown size={14} strokeWidth={1.5} aria-hidden />
              </button>
            </Tooltip>
          </div>
            <div className="flex items-center gap-2 whitespace-nowrap" data-testid="split-unit-state">
              <span className="lg">{selected.lang === "neutral" ? "–" : selected.lang.toUpperCase()}</span>
              <span className={`check-chip ${isChecked(selected) ? "yes" : "no"}`} data-testid="split-boundary-state">
                {isChecked(selected) ? <Check size={12} strokeWidth={2.6} aria-hidden /> : <Circle size={11} strokeWidth={2.2} aria-hidden />}
                {isChecked(selected) ? "Checked" : "Not checked"}
              </span>
            </div>
          {/* 주 버튼 자리는 단위가 바뀌어도 같다 - 라벨만 같은 칸에서 바뀐다 */}
          <button
            type="button"
            className="btn pri wide h-[38px]"
            data-testid="split-primary"
            disabled={!canEdit || !selected || busy}
            onClick={() => selected && setBoundary(selected, !isChecked(selected))}
          >
            <span className="stack">
              <span data-on={(selected !== null && isChecked(selected)) ? undefined : ""}>
                {t("split.checkBoundary")} <kbd>↵</kbd>
              </span>
              <span data-on={(selected !== null && isChecked(selected)) ? "" : undefined}>
                {t("split.uncheckBoundary")} <kbd>U</kbd>
              </span>
            </span>
          </button>
          <div className="grid grid-cols-3 gap-1.5">
            <button type="button" className="btn" data-testid="split-split" disabled={!canEdit || !cut || busy} onClick={splitAtCut}>
              <Scissors size={14} strokeWidth={1.5} aria-hidden />
              {t("split.split")} <kbd>S</kbd>
            </button>
            <Tooltip label={t("split.holdHint")}>
              <button type="button" className="btn w-full" data-testid="split-hold" disabled={!canEdit || !selected || busy} onClick={startHold}>
                {t("split.hold")} <kbd>H</kbd>
              </button>
            </Tooltip>
            <div className="grid grid-cols-2 gap-1">
              <Tooltip label={t("split.undo")}>
                <button type="button" className="btn icon w-full" aria-label={t("split.undo")} data-testid="split-undo" disabled={!canEdit || !data?.edits.can_undo || busy} onClick={() => runStep("undo")}>
                  <Undo2 size={14} strokeWidth={1.5} aria-hidden />
                </button>
              </Tooltip>
              <Tooltip label={t("split.redo")}>
                <button type="button" className="btn icon w-full" aria-label={t("split.redo")} data-testid="split-redo" disabled={!canEdit || !data?.edits.can_redo || busy} onClick={() => runStep("redo")}>
                  <Redo2 size={14} strokeWidth={1.5} aria-hidden />
                </button>
              </Tooltip>
            </div>
          </div>
          </>)}
          {/* 남은 경계 - 모두 확인해야 검토를 요청할 수 있다 */}
          {data && (
            <div className="flex min-h-7 items-center gap-1.5 text-xs leading-[18px] text-ink-2">
              {uncheckedLeft > 0 ? (
                <Circle size={13} strokeWidth={2} className="pmark" aria-hidden />
              ) : (
                <CircleCheck size={14} strokeWidth={2} className="pmark checked" aria-hidden />
              )}
              <span data-testid="split-unchecked-count">
                {uncheckedLeft === 0 ? t("split.allChecked") : selected ? t("split.uncheckedLeft", { n: uncheckedLeft }) : t("split.progress", { n: checkableTotal - uncheckedLeft, total: checkableTotal })}
              </span>
              <span className="flex-1" />
              {canEdit && uncheckedLeft > 0 && (
                <button type="button" className="btn ghost h-7" data-testid="split-check-rest" disabled={busy} onClick={() => setIsCheckRestOpen(true)}>
                  <CheckCheck size={14} strokeWidth={1.5} aria-hidden />
                  {t("split.checkRest")}
                </button>
              )}
            </div>
          )}
        </div>

        <div className="grid content-start gap-4 overflow-y-auto p-[var(--pad)]">
          <SplitAiTabs ai={ai} tabs={aiTabs} selected={selected} suggestion={suggestion} canEdit={canEdit} busy={busy} onPick={(id) => selectUnit(id, true)} onNext={selectNextSuggestion} />
          {!selected ? (
            <p className="text-ink-3" data-testid="split-hint">
              {t("split.hint")}
            </p>
          ) : (
            <>
              <Section title={t("split.text")}>
                <p className="whitespace-pre-wrap rounded-md bg-sunken px-3 py-2 text-ink [font-size:var(--fs-read)] [line-height:var(--lh-read)]" data-testid="split-unit-text">
                  {selected.kind === "table" ? t("split.tableUnit") : selected.text}
                </p>
                {cut && <p className="text-xs text-ink-3">{t("split.cutHint")}</p>}
                {canEdit && isAiSplitKind(selected.kind) && (
                  <Tooltip label={aiUnitReason ?? t("ai.askUnit")} suppressed={aiUnitReason === null}>
                    <button
                      type="button"
                      className="btn h-7 w-full"
                      data-testid="split-ai-unit"
                      disabled={aiUnitReason !== null || busy || ai.working !== null}
                      onClick={() => void ai.askUnit(selected.id)}
                    >
                      <BusyLabel busy={ai.working === "split"} icon={<WandSparkles size={14} strokeWidth={1.5} aria-hidden />} label={t("ai.askUnit")} />
                    </button>
                  </Tooltip>
                )}
              </Section>

              {canEdit && (selected.kind === "sentence" || selected.kind === "heading" || selected.kind === "cell_sentence") && (
                <Section title={t("split.language")} testId="split-language">
                  <div className="grid grid-cols-2 gap-1.5">
                    {(["ko", "en"] as const).map((lang) => (
                      <button
                        key={lang}
                        type="button"
                        className={`btn h-7 ${selected.lang === lang ? "pri" : ""}`}
                        aria-pressed={selected.lang === lang}
                        data-testid={`split-lang-${lang}`}
                        // disabled를 쓰지 않는다 - 누른 단추가 꺼지면 포커스가 문서로 떨어져 이어서 글쇠를 쓸 수 없다
                        aria-disabled={busy ? "true" : undefined}
                        onClick={() => selected.lang !== lang && runEdit({ type: "set_language", unit_ids: [selected.id], lang }, t("common.saved"), selected.id)}
                      >
                        {lang.toUpperCase()}
                      </button>
                    ))}
                  </div>
                  {langMismatch && (
                    <p className="lang-warn" role="note" data-testid="split-lang-mismatch">
                      <TriangleAlert size={14} strokeWidth={1.5} aria-hidden />
                      <span>
                        {t(`split.lang.mismatch.${langMismatch.reason}`)}{" "}
                        <Link href={getStageHref(bundleId, "documents")} className="underline" data-testid="split-lang-mismatch-link">
                          {t("split.lang.mismatch.fix")}
                        </Link>
                      </span>
                    </p>
                  )}
                </Section>
              )}

              {selected.lang !== "neutral" && (
                <Section title={t("split.pair")} info={t("split.pairInfo")} testId="split-pair">
                  {pair ? (
                    <>
                      <span className="flex items-center gap-2">
                        <span className={`pill ${pair.status === "confirmed" ? "ok" : "dash"}`} data-testid="split-pair-status">
                          {t(pair.status === "confirmed" ? "status.pair.confirmed" : "status.pair.suggested")}
                        </span>
                      </span>
                      <ul className="grid gap-1">
                        {pair.unit_ids
                          .filter((id) => id !== selected.id)
                          .map((id) => model?.units.get(id))
                          .map(
                            (unit) =>
                              unit && (
                                <li key={unit.id}>
                                  <button type="button" className="grid w-full gap-0.5 rounded-md border border-line px-2 py-1.5 text-left hover:bg-hover" data-testid={`split-pair-unit-${unit.id}`} onClick={() => selectUnit(unit.id, true)}>
                                    <span className="flex items-center gap-1.5 font-mono text-[11px] text-ink-3">
                                      <span className="lg">{unit.lang.toUpperCase()}</span>
                                      {unit.display_id}
                                    </span>
                                    <span className="line-clamp-2 text-[13px] leading-5">{unit.text}</span>
                                  </button>
                                </li>
                              ),
                          )}
                      </ul>
                      {canEdit && (
                        <div className="grid grid-flow-col auto-cols-fr gap-1.5">
                          {pair.status === "suggested" && (
                            <button
                              type="button"
                              className="btn h-7"
                              data-testid="split-pair-confirm"
                              disabled={busy}
                              onClick={() => docId !== null && data && void runSimple(() => confirmPair(bundleId, docId, pair.id, data.document.revision), t("split.pairConfirmed"))}
                            >
                              <Link2 size={14} strokeWidth={1.5} aria-hidden />
                              {t("split.confirmPair")}
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn ghost h-7"
                            data-testid="split-pair-remove"
                            disabled={busy}
                            onClick={() => docId !== null && data && void runSimple(() => deletePair(bundleId, docId, pair.id, data.document.revision), t("split.pairRemoved"))}
                          >
                            <Unlink size={14} strokeWidth={1.5} aria-hidden />
                            {t("split.removePair")}
                          </button>
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="text-ink-3">{t("split.noPair")}</p>
                  )}
                  {canEdit && !pair && (
                    <button
                      type="button"
                      className={`btn h-7 justify-self-start ${isPairPicking ? "pri" : ""}`}
                      aria-pressed={isPairPicking}
                      data-testid="split-pair-pick"
                      onClick={() => {
                        setIsPairPicking(!isPairPicking);
                        setPicked([]);
                      }}
                    >
                      {isPairPicking ? t("split.pickingPair") : t("split.pairWith")}
                    </button>
                  )}
                  {canEdit && !pair && isPairPicking && (
                    <>
                      <p className="text-xs text-ink-3">{t("split.pairPickHint")}</p>
                      {pickedUnits.length > 0 && (
                        <ol className="grid gap-1" data-testid="split-picked">
                          {pickedUnits.map((unit, index) => (
                            <li key={unit.id} className="flex items-center gap-1.5 text-[13px]">
                              <span className="lg">{index + 1}</span>
                              <span className="flex-none font-mono text-[11px] text-ink-3">{unit.display_id}</span>
                              <span className="min-w-0 truncate">{unit.text}</span>
                            </li>
                          ))}
                        </ol>
                      )}
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          className="btn h-7"
                          data-testid="split-pair-create"
                          disabled={busy || picked.length === 0}
                          onClick={() =>
                            docId !== null && data && void runSimple(() => createPair(bundleId, docId, data.document.revision, [selected.id, ...picked]), t("split.pairConfirmed"), clearTransient)
                          }
                        >
                          <Link2 size={14} strokeWidth={1.5} aria-hidden />
                          {t("split.makePair")}
                        </button>
                        <button type="button" className="btn ghost h-7" data-testid="split-pick-clear" onClick={clearTransient}>
                          {t("common.cancel")} <kbd>Esc</kbd>
                        </button>
                      </div>
                    </>
                  )}
                </Section>
              )}

              {canEdit && (selected.kind === "table" || selected.kind === "table_row") && selected.table_id !== null && (
                <Section title={t("split.table")} testId="split-table">
                  <div className="flex flex-wrap gap-1.5">
                    {selected.kind === "table" ? (
                      <button type="button" className="btn h-7" data-testid="split-table-rows" disabled={busy} onClick={() => runEdit({ type: "split_table_rows", table_unit_id: selected.id }, t("split.didSplit"))}>
                        {t("split.splitRows")}
                      </button>
                    ) : (
                      <button type="button" className="btn h-7" data-testid="split-table-merge" disabled={busy} onClick={() => selected.table_id !== null && runEdit({ type: "merge_table_rows", table_id: selected.table_id }, t("split.didMerge"))}>
                        {t("split.mergeRows")}
                      </button>
                    )}
                    <button type="button" className="btn h-7" data-testid="split-table-layout" disabled={busy} onClick={() => selected.table_id !== null && runEdit({ type: "set_layout_table", table_id: selected.table_id, is_layout: true }, t("common.saved"))}>
                      {t("split.layoutTable")}
                    </button>
                  </div>
                </Section>
              )}
            </>
          )}

          {canEdit && range && (
            <Section title={t("split.carve")} testId="split-carve">
              <p className="rounded-md bg-sunken px-3 py-2 text-[13px] leading-5">{data?.blocks.find((block) => block.id === range.blockId)?.text.slice(range.start, range.end)}</p>
              <button type="button" className="btn h-7 justify-self-start" data-testid="split-carve-run" disabled={busy} onClick={() => runEdit({ type: "carve", block_id: range.blockId, start: range.start, end: range.end }, t("split.didCarve"))}>
                <SquarePlus size={14} strokeWidth={1.5} aria-hidden />
                {t("split.carveRun")}
              </button>
            </Section>
          )}

          {warnings.some((w) => w.needs_ack) && (
            <Section title={t("split.warnings")} info={t("split.warningsInfo")} testId="split-warnings">
              <ul className="grid gap-1.5">
                {warnings
                  .filter((w) => w.needs_ack)
                  .map((warning) => (
                    <li key={warning.id} className="flex items-center gap-2 text-[13px]" data-testid={`split-warning-${warning.id}`}>
                      <span className={`pill ${warning.acked_by ? "quiet" : "warn"}`}>{warning.acked_by ? t("status.warning.checked") : t(`warn.${warning.kind}`)}</span>
                      <Truncate className="flex-1 text-ink-2" text={readWarningText(warning.detail)} />
                      {!warning.acked_by && canEdit && (
                        <button type="button" className="btn h-7" data-testid={`split-warning-ack-${warning.id}`} disabled={busy} onClick={() => void runSimple(() => ackWarning(bundleId, warning.id), t("split.warningChecked"))}>
                          {t("split.markChecked")}
                        </button>
                      )}
                    </li>
                  ))}
              </ul>
            </Section>
          )}

        </div>
      </aside>

      {menu && menuTarget && menuItems && (
        <SplitContextMenu at={menu} items={menuItems} isTargetChecked={isChecked(menuTarget)} onPick={runMenuAction} onClose={() => setMenu(null)} />
      )}
      {holdFor && (
        <Modal
          title={t("split.holdTitle")}
          testId="split-hold-modal"
          onClose={() => setHoldFor(null)}
          isBusy={busy}
          footer={
            <>
              <button type="button" className="btn" data-testid="split-hold-modal-cancel" onClick={() => setHoldFor(null)}>
                <X size={16} strokeWidth={1.5} aria-hidden />
                {t("common.cancel")}
              </button>
              <button type="submit" form="split-hold-form" className="btn pri" data-testid="split-hold-modal-confirm" disabled={!holdFor.reason.trim() || busy}>
                {t("split.holdRun")}
              </button>
            </>
          }
        >
          <form
            id="split-hold-form"
            className="grid gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void runHold();
            }}
          >
            <p className="text-[13px] text-ink-2">{t("split.holdBody")}</p>
            <input
              autoFocus
              className="h-8 rounded-md border border-line-2 bg-surface px-2 text-[13px] text-ink focus:border-accent focus:outline-none"
              data-testid="split-hold-reason"
              placeholder={t("split.holdReason")}
              value={holdFor.reason}
              maxLength={2000}
              onChange={(event) => setHoldFor({ ...holdFor, reason: event.target.value })}
            />
          </form>
        </Modal>
      )}
      {isCheckRestOpen && docId !== null && (
        <ConfirmModal
          title={t("split.checkRestTitle")}
          summary={<span>{t("split.checkRestBody", { n: uncheckedLeft })}</span>}
          confirmLabel={t("split.checkRestRun", { n: uncheckedLeft })}
          confirmIcon={CheckCheck}
          busy={busy}
          testId="split-check-rest-modal"
          onClose={() => setIsCheckRestOpen(false)}
          onConfirm={() => {
            setIsCheckRestOpen(false);
            void runSimple(async () => {
              const result = await confirmAllBoundaries(bundleId, docId);
              showToast(t("split.checkedRest", { n: result.confirmed_count }));
            }, null);
          }}
        />
      )}
      {pending && (
        <ConfirmModal
          title={t("split.confirmTitle")}
          summary={<span>{t("split.confirmBody", { n: pending.count })}</span>}
          confirmLabel={t("split.confirmRun")}
          busy={busy}
          testId="split-confirm"
          onClose={() => setPending(null)}
          onConfirm={async () => {
            const run = pending.run;
            setPending(null);
            setBusy(true);
            try {
              handleChangeDone(await run(), t("common.saved"), pending.keepId);
            } catch (err) {
              showToast(humanizeApiError(err, t), "error");
              refresh();
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </div>
  );
}

/** 문서 목록 한 줄의 경계 표시 - 남았으면 수, 다 했으면 확인 표시 */
function DocBoundaryMark({ docId, left }: { docId: number; left: number }) {
  const { t } = useI18n();
  const label = left > 0 ? t("split.uncheckedLeft", { n: left }) : t("split.allChecked");
  return (
    <Tooltip label={label}>
      <span className="flex h-[18px] flex-none items-center gap-1 font-mono text-[11px] font-semibold text-ink-3" aria-label={label} data-testid={`split-doc-left-${docId}`}>
        {left > 0 ? (
          <>
            <Circle size={11} strokeWidth={2.2} aria-hidden />
            {left}
          </>
        ) : (
          <CircleCheck size={13} strokeWidth={2} className="pmark checked" aria-hidden />
        )}
      </span>
    </Tooltip>
  );
}
