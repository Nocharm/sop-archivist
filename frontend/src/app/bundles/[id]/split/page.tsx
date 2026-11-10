// Split(원문 대조) - 왼쪽 문서 목록과 표시 범례, 가운데 용지, 오른쪽 고른 단위 정보와 편집(명세 §12-4, 2026-11-09 개편).
// 문장을 누르면 고르고 끝에 확인 단추가 나온다. 두 번 누르면 그 자리에 나눌 선과 나누기 팝업이 뜬다(S). 끌어 고르면 새 단위로 만들 수 있다.
"use client";

import { ArrowDown, ArrowUp, Check, CheckCheck, Circle, CircleCheck, FileText, FolderCheck, Link2, Merge, Redo2, Scissors, Sparkles, SquarePlus, Undo2, Unlink, Upload, X } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useEffectEvent, useMemo, useState, type ReactNode } from "react";

import { SplitAiSection } from "@/components/manage/split-ai";
import { Paper, type PaperCut } from "@/components/paper/paper";
import { SourceFontMenu } from "@/components/paper/source-font-menu";
import { Modal } from "@/components/modal";
import { ReadOnlyNote } from "@/components/read-only-note";
import { LoadError } from "@/components/ui/load-error";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { getStageHref } from "@/lib/stages";
import { InfoTip } from "@/components/ui/info-tip";
import { Truncate } from "@/components/ui/motion";
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
  type ViewUnit,
} from "@/lib/api-sop";
import { loadBundle, useBundle } from "@/lib/bundle-store";
import { buildGroupSave } from "@/lib/classify-model";
import { useI18n } from "@/lib/i18n";
import { buildPaperModel, canSplitAt, countUnchecked, readWarningText, shouldRecenter, toBlockOffset, toUnitOffset } from "@/lib/paper-model";
import { getSplitKeyAction } from "@/lib/split-keys";
import { useDelayedFlag } from "@/lib/use-delayed-flag";
import { useLoaded } from "@/lib/use-loaded";

type PickMode = "merge" | "pair" | null;

interface PendingConfirm {
  count: number;
  run: () => Promise<EditResult>;
}

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

function Section({ title, info, children, testId }: { title: string; info?: string; children: ReactNode; testId?: string }) {
  return (
    <section className="grid min-w-0 gap-2" data-testid={testId}>
      <h2 className="flex items-center gap-1 text-xs font-semibold text-ink-3">
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

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [cutAt, setCutAt] = useState<{ unitId: number; at: number } | null>(null);
  const [range, setRange] = useState<{ blockId: number; start: number; end: number } | null>(null);
  const [pickMode, setPickMode] = useState<PickMode>(null);
  const [picked, setPicked] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  // 보낼 곳 없는 보류(명세 §6.8) - 판단을 받는 단위 id와 사유
  const [holdFor, setHoldFor] = useState<{ unitId: number; reason: string } | null>(null);
  // 경계 확인은 바로 보이게 먼저 칠한다 - 지금 보기 데이터에 묶여 있어 새 데이터가 오면 저절로 버려진다
  const [localChecks, setLocalChecks] = useState<{ base: DocumentView | null; values: Record<number, boolean> }>({ base: null, values: {} });
  const checkOverrides = localChecks.base === data ? localChecks.values : {};
  const isChecked = (unit: ViewUnit) => checkOverrides[unit.id] ?? unit.boundary_confirmed;
  // 지금 문서는 방금 누른 확인까지 센다 - 다른 문서는 목록이 준 수를 쓴다
  const uncheckedLeft = data ? countUnchecked(data.units, isChecked) : 0;
  const [isCheckRestOpen, setIsCheckRestOpen] = useState(false);

  const selected: ViewUnit | null = (selectedId !== null && model?.units.get(selectedId)) || null;
  const cut: PaperCut | null = (() => {
    if (!cutAt || !selected || cutAt.unitId !== selected.id) return null;
    const pos = toBlockOffset(selected.spans, cutAt.at);
    return pos ? { blockId: pos.blockId, offset: pos.offset } : null;
  })();
  const warnings = data?.extraction?.warnings ?? [];
  const warnBlockIds = new Set(warnings.flatMap((w) => (w.block_id !== null && w.needs_ack && !w.acked_by ? [w.block_id] : [])));
  const pair = selected?.pair_id ? data?.pairs.find((item) => item.id === selected.pair_id) ?? null : null;

  function selectDoc(nextId: number) {
    setSelectedId(null);
    clearTransient();
    router.replace(`/bundles/${bundleId}/split?doc=${nextId}`);
  }

  function clearTransient() {
    setCutAt(null);
    setRange(null);
    setPickMode(null);
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
    setCutAt(null);
    setRange(null);
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
    if (!model || model.order.length === 0) return;
    const index = selectedId === null ? -1 : model.order.indexOf(selectedId);
    const next = model.order[Math.min(Math.max(index + step, 0), model.order.length - 1)];
    selectUnit(next, true);
  }

  // 편집 한 번 - 판단이 걸린 단위를 은퇴시키면 서버가 409로 먼저 묻는다
  async function runChange(run: (confirm: boolean) => Promise<EditResult>, okText: string) {
    if (busy) return;
    setBusy(true);
    try {
      const result = await run(false);
      handleChangeDone(result, okText);
    } catch (err) {
      const unitIds = err instanceof ApiError && err.rule?.code === "confirm_required" ? err.rule.unit_ids : null;
      if (Array.isArray(unitIds)) {
        setPending({ count: unitIds.length, run: () => run(true) });
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
    if (model.units.get(unitId)?.status !== "unassigned") {
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

  function handleChangeDone(result: EditResult, okText: string) {
    clearTransient();
    selectUnit(result.created_unit_ids[0] ?? null);
    showToast(okText);
    refresh();
  }

  function runEdit(op: EditOp, okText: string) {
    if (!data || docId === null) return;
    const revision = data.document.revision;
    void runChange((confirm) => editUnits(bundleId, docId, revision, op, confirm), okText);
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
    void runSimple(() => setBoundaryConfirmed(bundleId, docId, [unit.id], confirmed), null, () => {
      // Enter는 확인하고 다음 확인 안 된 단위로 간다
      if (confirmed && model) {
        const index = model.order.indexOf(unit.id);
        const next = model.order.slice(index + 1).find((id) => {
          const candidate = model.units.get(id);
          return candidate !== undefined && !isChecked(candidate);
        });
        if (next !== undefined) selectUnit(next, true);
      }
    });
  }

  function splitAtCut() {
    if (!selected || !cutAt || cutAt.unitId !== selected.id) return;
    runEdit({ type: "split", unit_id: selected.id, at: cutAt.at }, t("split.didSplit"));
  }

  function handleUnitClick(unitId: number, at: { blockId: number; offset: number } | null, event: { metaKey: boolean; ctrlKey: boolean }) {
    if (pickMode !== null && unitId !== selectedId) {
      setPicked((prev) => (prev.includes(unitId) ? prev.filter((id) => id !== unitId) : [...prev, unitId]));
      return;
    }
    if (event.metaKey || event.ctrlKey) {
      setPickMode("merge");
      setPicked((prev) => (prev.includes(unitId) ? prev : [...prev, unitId]));
      return;
    }
    // 고른 문장을 다시 한 번 눌러서는 나누지 않는다 - 나누기는 두 번 누르기로(실수로 선이 생기지 않게)
    if (unitId !== selectedId) selectUnit(unitId);
    void at;
  }

  /** 두 번 누른 자리에 나눌 선 - 다른 문장이면 먼저 고른다 */
  function handleUnitDoubleClick(unitId: number, at: { blockId: number; offset: number } | null) {
    if (pickMode !== null) return;
    const unit = model?.units.get(unitId);
    if (!unit || !at || !canEdit) return;
    if (unitId !== selectedId) selectUnit(unitId);
    const unitOffset = toUnitOffset(unit.spans, at.blockId, at.offset);
    if (unitOffset !== null && canSplitAt(unit, unitOffset)) setCutAt({ unitId, at: unitOffset });
  }

  const handleKey = useEffectEvent((event: KeyboardEvent) => {
    if (pending) return;
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

  const pickedUnits = picked.map((id) => model?.units.get(id)).filter((unit): unit is ViewUnit => unit !== undefined);
  const document_ = data?.document;
  const page = selected ? data?.blocks.find((block) => block.id === selected.block_id) : null;

  return (
    <div className="grid h-full min-h-0 grid-cols-[232px_minmax(0,1fr)_392px]" data-testid="split">
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
        {/* 용지 표시의 뜻 - 앞은 글자 태그, 끝은 아이콘 */}
        <div className="split-legend" data-testid="split-legend">
          <span className="split-legend-title">{t("split.legendTags")}</span>
          <span className="split-legend-row">
            <span className="ptag duo ko">
              <span>KO</span>
              <span>H</span>
            </span>
            {t("split.legendLangHold")}
          </span>
          <span className="split-legend-title">{t("split.legendMarks")}</span>
          <span className="split-legend-row">
            <CircleCheck size={14} strokeWidth={2} className="pmark checked" aria-hidden />
            {t("split.legendChecked")}
          </span>
          <span className="split-legend-row">
            <Link2 size={14} strokeWidth={1.6} className="pmark pair" aria-hidden />
            {t("split.legendPair")}
          </span>
          <span className="split-legend-row">
            <FolderCheck size={14} strokeWidth={1.6} className="pmark classified" aria-hidden />
            {t("split.legendClassified")}
          </span>
          <span className="split-legend-row">
            <Sparkles size={14} strokeWidth={1.6} className="pmark ai" aria-hidden />
            {t("split.legendAi")}
          </span>
          <span className="split-legend-row">
            <Scissors size={14} strokeWidth={1.6} className="pmark edited" aria-hidden />
            {t("split.legendEdited")}
          </span>
          <span className="split-legend-row">
            <span className="w-[14px] text-center text-[11px] text-ink-4" aria-hidden>
              Aa
            </span>
            {t("split.legendDim")}
          </span>
        </div>
      </nav>

      {/* 가운데: 용지 */}
      {/* 열을 minmax(0,1fr)로 못 박는다 - 암묵 열(auto)은 위 줄의 한 줄 글자만큼 넓어져, 1280보다 좁은 창에서 용지가 오른쪽 패널 밑으로 들어갔다 */}
      <div className="grid min-h-0 grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)]">
        <div className="flex h-11 items-center gap-2.5 border-b border-line bg-surface px-[var(--pad)]">
          <span className="font-mono text-[13px] font-semibold">{document_?.doc_code ?? ""}</span>
          <span className="min-w-0 flex-1 truncate text-ink-2">{document_?.title ?? ""}</span>
          {bundle?.is_synthetic && <span className="tag">Synthetic data</span>}
          <ReadOnlyNote bundle={bundle} testId="split" />
          {page?.page != null && (
            <span className="tabular-nums text-xs text-ink-3" data-testid="split-page">
              {page.page_basis === "estimated" ? "≈ " : ""}p.{page.page}
            </span>
          )}
          <SourceFontMenu />
        </div>
        <div className="desk" data-testid="split-desk">
          {model ? (
            <Paper
              model={model}
              selectedId={selectedId}
              pickedIds={new Set(picked)}
              cut={cut}
              warnBlockIds={warnBlockIds}
              onUnitClick={handleUnitClick}
              onUnitDoubleClick={canEdit ? handleUnitDoubleClick : undefined}
              onRangeSelect={canEdit ? (next) => setRange(next) : undefined}
              figureSource={docId !== null ? { bundleId, docId } : undefined}
              testId="split-paper"
              contour
              strips={{
                isChecked,
                canMerge: canEdit && !busy,
                mergeLabel: t("split.mergeAdjacent"),
                onGapMerge: (firstId, secondId) => runEdit({ type: "merge", unit_ids: [firstId, secondId] }, t("split.didMerge")),
              }}
              renderUnitEnd={(unitId) => {
                const unit = model.units.get(unitId);
                if (!canEdit || !unit || isChecked(unit) || cut) return null;
                return (
                  <button
                    type="button"
                    className="inline-check"
                    data-testid="split-inline-check"
                    aria-label={t("split.checkBoundary")}
                    disabled={busy}
                    onClick={(event) => {
                      event.stopPropagation();
                      setBoundary(unit, true);
                    }}
                  >
                    <Check size={11} strokeWidth={3} aria-hidden />
                    <span className="inline-check-label">{t("split.checkBoundary")}</span>
                  </button>
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
            showSkeleton && <span className="sk mx-auto block h-[640px] w-full max-w-[600px]" />
          )}
        </div>
      </div>

      {/* 오른쪽: 고른 단위 */}
      <aside className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] border-l border-line bg-surface" data-testid="split-inspector">
        <div className="grid gap-2 border-b border-line p-[var(--pad)]">
          <div className="flex h-7 items-center gap-2">
            <span className="font-mono text-sm font-semibold" data-testid="split-unit-id">
              {selected?.display_id ?? "–"}
            </span>
            {selected && <span className="lg">{selected.lang === "neutral" ? "–" : selected.lang.toUpperCase()}</span>}
            {selected && (
              <span className={`check-chip ${isChecked(selected) ? "yes" : "no"}`} data-testid="split-boundary-state">
                {isChecked(selected) ? <Check size={12} strokeWidth={2.6} aria-hidden /> : <Circle size={11} strokeWidth={2.2} aria-hidden />}
                {isChecked(selected) ? "Checked" : "Not checked"}
              </span>
            )}
            <span className="flex-1" />
            <button type="button" className="btn ghost icon h-7 w-7" aria-label={t("split.prev")} data-testid="split-prev" onClick={() => moveSelection(-1)}>
              <ArrowUp size={14} strokeWidth={1.5} aria-hidden />
            </button>
            <button type="button" className="btn ghost icon h-7 w-7" aria-label={t("split.next")} data-testid="split-next" onClick={() => moveSelection(1)}>
              <ArrowDown size={14} strokeWidth={1.5} aria-hidden />
            </button>
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
          {/* 남은 경계 - 모두 확인해야 검토를 요청할 수 있다 */}
          {data && (
            <div className="flex min-h-7 items-center gap-1.5 text-xs leading-[18px] text-ink-2">
              {uncheckedLeft > 0 ? (
                <Circle size={13} strokeWidth={2} className="pmark" aria-hidden />
              ) : (
                <CircleCheck size={14} strokeWidth={2} className="pmark checked" aria-hidden />
              )}
              <span data-testid="split-unchecked-count">{uncheckedLeft > 0 ? t("split.uncheckedLeft", { n: uncheckedLeft }) : t("split.allChecked")}</span>
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
          {!selected ? (
            <p className="text-ink-3" data-testid="split-hint">
              {t("split.hint")}
            </p>
          ) : (
            <>
              <Section title={t("split.text")}>
                <p className="whitespace-pre-wrap rounded-md bg-sunken px-3 py-2 text-[13px] leading-5 text-ink" data-testid="split-unit-text">
                  {selected.kind === "table" ? t("split.tableUnit") : selected.text}
                </p>
                {cut && <p className="text-xs text-ink-3">{t("split.cutHint")}</p>}
              </Section>

              {data && docId !== null && (
                <SplitAiSection
                  bundleId={bundleId}
                  docId={docId}
                  layout={data.document.language_layout}
                  revision={data.document.revision}
                  selected={selected}
                  canEdit={canEdit}
                  busy={busy}
                  onChanged={(result) => (result ? handleChangeDone(result, t("split.didSplit")) : refresh())}
                />
              )}

              {canEdit && (selected.kind === "sentence" || selected.kind === "heading" || selected.kind === "cell_sentence") && (
                <Section title={t("split.language")} testId="split-language">
                  <div className="flex gap-1.5">
                    {(["ko", "en"] as const).map((lang) => (
                      <button
                        key={lang}
                        type="button"
                        className={`btn h-7 ${selected.lang === lang ? "pri" : ""}`}
                        aria-pressed={selected.lang === lang}
                        data-testid={`split-lang-${lang}`}
                        disabled={busy || selected.lang === lang}
                        onClick={() => runEdit({ type: "set_language", unit_ids: [selected.id], lang }, t("common.saved"))}
                      >
                        {lang.toUpperCase()}
                      </button>
                    ))}
                  </div>
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
                        <div className="flex gap-1.5">
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
                      className={`btn h-7 justify-self-start ${pickMode === "pair" ? "pri" : ""}`}
                      data-testid="split-pair-pick"
                      onClick={() => {
                        setPickMode(pickMode === "pair" ? null : "pair");
                        setPicked([]);
                      }}
                    >
                      {pickMode === "pair" ? t("split.pickingPair") : t("split.pairWith")}
                    </button>
                  )}
                </Section>
              )}

              {canEdit && (
                <Section title={t("split.merge")} info={pickMode === "pair" ? t("split.pairPickHint") : t("split.mergeHint")} testId="split-merge">
                  {pickedUnits.length > 0 && (
                    <ol className="grid gap-1" data-testid="split-picked">
                      {pickedUnits.map((unit, index) => (
                        <li key={unit.id} className="flex items-center gap-1.5 text-[13px]">
                          <span className="lg">{index + 1}</span>
                          <span className="font-mono text-[11px] text-ink-3">{unit.display_id}</span>
                          <span className="min-w-0 truncate">{unit.text}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                  <div className="flex gap-1.5">
                    {pickMode === "pair" ? (
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
                    ) : (
                      <button
                        type="button"
                        className="btn h-7"
                        data-testid="split-merge-run"
                        disabled={busy || picked.length === 0}
                        onClick={() => runEdit({ type: "merge", unit_ids: [selected.id, ...picked.filter((id) => id !== selected.id)] }, t("split.didMerge"))}
                      >
                        <Merge size={14} strokeWidth={1.5} aria-hidden />
                        {picked.length > 0 ? t("split.mergeCount", { n: picked.filter((id) => id !== selected.id).length + 1 }) : t("split.merge")}
                      </button>
                    )}
                    {(pickMode !== null || picked.length > 0) && (
                      <button type="button" className="btn ghost h-7" data-testid="split-pick-clear" onClick={clearTransient}>
                        {t("common.cancel")} <kbd>Esc</kbd>
                      </button>
                    )}
                  </div>
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

          <Section title={t("split.keys")}>
            <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-xs text-ink-2">
              {(
                [
                  ["split.keyCheck", "↵"],
                  ["split.keyMove", "↑ ↓ · J K"],
                  ["split.keyCut", t("split.doubleClick")],
                  ["split.keySplit", "S"],
                  ["split.keyUncheck", "U"],
                  ["split.keyPick", "Ctrl"],
                  ["split.keyHold", "H"],
                  ["split.keyUndo", "Ctrl Z"],
                ] as const
              ).map(([label, keys]) => (
                <div key={label} className="contents">
                  <dt>{t(label)}</dt>
                  <dd>
                    <kbd>{keys}</kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </Section>
        </div>
      </aside>

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
              handleChangeDone(await run(), t("common.saved"));
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
