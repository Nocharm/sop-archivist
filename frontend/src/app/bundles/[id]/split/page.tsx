// 쪼개기(원문 대조) - 왼쪽 문서 목록, 가운데 용지, 오른쪽 고른 단위 정보와 편집(디자인 문서 8절, 명세 §12-4).
// 문장을 처음 누르면 고르고, 다시 누르면 누른 자리에 나눌 선이 생긴다(S로 나눈다). 끌어 고르면 새 단위로 만들 수 있다.
"use client";

import { ArrowDown, ArrowUp, Link2, Merge, Redo2, Scissors, SquarePlus, Undo2, Unlink } from "lucide-react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useEffectEvent, useMemo, useState, type ReactNode } from "react";

import { Paper, type PaperCut } from "@/components/paper/paper";
import { SourceFontMenu } from "@/components/paper/source-font-menu";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { showToast } from "@/components/ui/toast";
import { Tooltip } from "@/components/ui/tooltip";
import { ApiError } from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import {
  ackWarning,
  confirmPair,
  createPair,
  deletePair,
  editUnits,
  getDocumentView,
  listDocuments,
  redoEdit,
  setBoundaryConfirmed,
  undoEdit,
  type DocumentView,
  type EditOp,
  type EditResult,
  type ViewUnit,
} from "@/lib/api-sop";
import { loadBundle, useBundle } from "@/lib/bundle-store";
import { useI18n } from "@/lib/i18n";
import { buildPaperModel, canSplitAt, toBlockOffset, toUnitOffset } from "@/lib/paper-model";
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

function Section({ title, children, testId }: { title: string; children: ReactNode; testId?: string }) {
  return (
    <section className="grid gap-2" data-testid={testId}>
      <h2 className="text-xs font-semibold text-ink-3">{title}</h2>
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
  const showSkeleton = useDelayedFlag(view.data === null && docId !== null);
  const data = view.data;
  const model = useMemo(() => (data ? buildPaperModel(data) : null), [data]);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [cutAt, setCutAt] = useState<{ unitId: number; at: number } | null>(null);
  const [range, setRange] = useState<{ blockId: number; start: number; end: number } | null>(null);
  const [pickMode, setPickMode] = useState<PickMode>(null);
  const [picked, setPicked] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  // 경계 확인은 바로 보이게 먼저 칠한다 - 지금 보기 데이터에 묶여 있어 새 데이터가 오면 저절로 버려진다
  const [localChecks, setLocalChecks] = useState<{ base: DocumentView | null; values: Record<number, boolean> }>({ base: null, values: {} });
  const checkOverrides = localChecks.base === data ? localChecks.values : {};
  const isChecked = (unit: ViewUnit) => checkOverrides[unit.id] ?? unit.boundary_confirmed;

  const selected: ViewUnit | null = (selectedId !== null && model?.units.get(selectedId)) || null;
  const cut: PaperCut | null = (() => {
    if (!cutAt || !selected || cutAt.unitId !== selected.id) return null;
    const pos = toBlockOffset(selected.spans, cutAt.at);
    return pos ? { blockId: pos.blockId, offset: pos.offset } : null;
  })();
  const warnings = data?.extraction?.warnings ?? [];
  const warnBlockIds = new Set(warnings.filter((w) => w.block_id !== null && w.needs_ack && !w.acked_by).map((w) => w.block_id as number));
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
    void loadBundle(bundleId);
  }

  function selectUnit(unitId: number | null, scroll = false) {
    setSelectedId(unitId);
    setCutAt(null);
    setRange(null);
    if (scroll && unitId !== null) {
      requestAnimationFrame(() => document.querySelector(`[data-testid="split-paper-unit-${unitId}"]`)?.scrollIntoView({ block: "nearest" }));
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
      afterChange(result, okText);
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

  function afterChange(result: EditResult, okText: string) {
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
    if (docId === null) return;
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
    if (unitId !== selectedId) {
      selectUnit(unitId);
      return;
    }
    // 고른 문장을 다시 누르면 그 자리에 나눌 선
    const unit = model?.units.get(unitId);
    if (!unit || !at || !canEdit) return;
    const unitOffset = toUnitOffset(unit.spans, at.blockId, at.offset);
    if (unitOffset !== null && canSplitAt(unit, unitOffset)) setCutAt({ unitId, at: unitOffset });
  }

  const handleKey = useEffectEvent((event: KeyboardEvent) => {
    if (pending || isTypingTarget(event.target) || document.querySelector('[role="dialog"],[role="menu"]')) return;
    const key = event.key.toLowerCase();
    const mod = event.metaKey || event.ctrlKey;
    if (mod && key === "z") {
      if (!canEdit) return;
      event.preventDefault();
      if (event.shiftKey ? data?.edits.can_redo : data?.edits.can_undo) runStep(event.shiftKey ? "redo" : "undo");
      return;
    }
    if (mod || event.altKey) return;
    if (key === "j") moveSelection(1);
    else if (key === "k") moveSelection(-1);
    else if (key === "escape") clearTransient();
    else if (!canEdit || !selected) return;
    else if (key === "enter" && !isChecked(selected)) setBoundary(selected, true);
    else if (key === "u" && isChecked(selected)) setBoundary(selected, false);
    else if (key === "s" && cut) splitAtCut();
    else if (key === "h") showToast(t("split.holdLater"));
    else return;
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
      <nav className="grid content-start gap-0.5 overflow-y-auto border-r border-line bg-surface p-2" aria-label={t("split.documents")} data-testid="split-docs">
        {readyDocs.map((doc) => (
          <button
            key={doc.id}
            type="button"
            className={`grid gap-0.5 rounded-md p-2 text-left transition-colors hover:bg-hover ${doc.id === docId ? "bg-sel" : ""}`}
            aria-current={doc.id === docId ? "true" : undefined}
            data-testid={`split-doc-${doc.id}`}
            onClick={() => selectDoc(doc.id)}
          >
            <b className="font-mono text-xs font-semibold leading-[18px]">{doc.doc_code || doc.file_name}</b>
            <span className="truncate text-xs leading-[18px] text-ink-3">{doc.title}</span>
          </button>
        ))}
      </nav>

      {/* 가운데: 용지 */}
      <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)]">
        <div className="flex h-11 items-center gap-2.5 border-b border-line bg-surface px-[var(--pad)]">
          <span className="font-mono text-[13px] font-semibold">{document_?.doc_code ?? ""}</span>
          <span className="min-w-0 flex-1 truncate text-ink-2">{document_?.title ?? ""}</span>
          {bundle?.is_synthetic && <span className="tag">Synthetic data</span>}
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
              onRangeSelect={canEdit ? (next) => setRange(next) : undefined}
              figureSource={docId !== null ? { bundleId, docId } : undefined}
              testId="split-paper"
            />
          ) : view.error !== null ? (
            <p className="text-ink-2" data-testid="split-error">
              {humanizeApiError(view.error, t)}
            </p>
          ) : docs.data !== null && readyDocs.length === 0 ? (
            <p className="text-ink-3" data-testid="split-empty">
              {t("split.noDocuments")}
            </p>
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
              <span className={`pill ${isChecked(selected) ? "quiet" : "none"}`} data-testid="split-boundary-state">
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
            <Tooltip label={t("split.holdLater")}>
              <button type="button" className="btn w-full" data-testid="split-hold" disabled>
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
                <Section title={t("split.pair")} testId="split-pair">
                  {pair ? (
                    <>
                      <span className="flex items-center gap-2">
                        <span className={`pill ${pair.status === "confirmed" ? "ok" : "dash"}`} data-testid="split-pair-status">
                          {pair.status === "confirmed" ? "Confirmed" : "Suggested"}
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
                                  <button type="button" className="grid w-full gap-0.5 rounded-md border border-line px-2 py-1.5 text-left hover:bg-hover" onClick={() => selectUnit(unit.id, true)}>
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
                <Section title={t("split.merge")} testId="split-merge">
                  <p className="text-xs text-ink-3">{pickMode === "pair" ? t("split.pairPickHint") : t("split.mergeHint")}</p>
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
            <Section title={t("split.warnings")} testId="split-warnings">
              <ul className="grid gap-1.5">
                {warnings
                  .filter((w) => w.needs_ack)
                  .map((warning) => (
                    <li key={warning.id} className="flex items-center gap-2 text-[13px]" data-testid={`split-warning-${warning.id}`}>
                      <span className={`pill ${warning.acked_by ? "quiet" : "warn"}`}>{warning.acked_by ? "Checked" : t(`warn.${warning.kind}`)}</span>
                      <span className="min-w-0 flex-1 truncate text-ink-2">{typeof warning.detail.text === "string" ? warning.detail.text : ""}</span>
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
                  ["split.keyMove", "J K"],
                  ["split.keySplit", "S"],
                  ["split.keyUncheck", "U"],
                  ["split.keyPick", "Ctrl"],
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
              afterChange(await run(), t("common.saved"));
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
