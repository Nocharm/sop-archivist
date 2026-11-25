// Assign Old 칸 문서 고르기 옆 단추 - 올리거나 누르면 그 문서의 진행(처분별 칸·간 곳·받는 New 문서·AI 제안 대기)과 문단 Excel 내려받기가 뜬다(1.2.0 피드백 6번).
// 올리면 잠깐 뒤 뜨고 상자 안으로 옮겨도 그대로다. 누르면 고정되어 바깥을 누르거나 Esc로 닫는다. 내려받기는 넣을 것을 묻는 창(paragraph-download-dialog)에서 고른 뒤 받는다.
"use client";

import { Download, Gauge } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { ParagraphDownloadDialog } from "@/components/assign/paragraph-download-dialog";
import { isTopEscLayer, placeBelow, popEscLayer, pushEscLayer, type FloatingPos } from "@/components/ui/floating";
import { showToast } from "@/components/ui/toast";
import { humanizeApiError } from "@/lib/api-errors";
import { downloadParagraphs, type Disposition, type ParagraphInclude } from "@/lib/api-sop";
import type { DocDashboard as DocDashboardData } from "@/lib/doc-dashboard-model";
import { useI18n } from "@/lib/i18n";
import { countDecided, PROGRESS_PART_FILL, type AssignProgress } from "@/lib/progress-model";
import { saveBlob } from "@/lib/save-file";

const OPEN_DELAY_MS = 150; // 지나가기만 할 때 뜨지 않게
const CLOSE_DELAY_MS = 200; // 단추에서 상자로 옮기는 사이에 닫히지 않게
const WHERE_ORDER: Disposition[] = ["assigned", "delete", "move_external", "unassigned"];

interface DocDashboardProps {
  bundleId: number;
  docId: number;
  /** 문서 번호(OLD-1) */
  docLabel: string;
  docTitle: string;
  /** 이 문서의 줄 수 - 배정 줄이 없는 문서(Old 칸에 연 이미 쓴 New 문서)면 null, 내려받기만 보인다 */
  stats: DocDashboardData | null;
  bundleLine: AssignProgress & { refs: number; captions: number };
  /** 받는 New 문서를 New 칸에 연다 */
  onOpenDoc: (targetDocId: number) => void;
  /** New 칸에 열 수 있는 문서인가 - 아직 쓰지 않은 문서를 숨긴 동안 그 문서의 단추는 꺼진다 */
  isDocOpen: (targetDocId: number) => boolean;
}

type DownloadKind = "doc" | "all";

export function DocDashboard({ bundleId, docId, docLabel, docTitle, stats, bundleLine, onOpenDoc, isDocOpen }: DocDashboardProps) {
  const { t } = useI18n();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState<FloatingPos | null>(null);
  // 묻는 중인 내려받기 - 문서를 바꾸면 그 문서의 것이 아니므로 닫힌 것으로 본다. 상자가 닫혀도(바깥 누름 · 포인터가 떠남) 창은 남는다
  const [picked, setPicked] = useState<{ kind: DownloadKind; docId: number } | null>(null);
  const pick = picked?.docId === docId ? picked.kind : null;
  const setPick = (kind: DownloadKind | null) => setPicked(kind === null ? null : { kind, docId });
  const [busy, setBusy] = useState(false);

  function clearTimer() {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }

  function close() {
    clearTimer();
    setOpen(false);
    setPinned(false);
    setPos(null);
  }

  const requestClose = useEffectEvent(() => close());

  function handleEnter() {
    clearTimer();
    if (!open) timerRef.current = window.setTimeout(() => setOpen(true), OPEN_DELAY_MS);
  }

  function handleLeave() {
    clearTimer();
    if (!pinned && !busy) timerRef.current = window.setTimeout(close, CLOSE_DELAY_MS);
  }

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);

  // 열린 동안 - 크기를 잰 뒤 단추 아래에 놓고, 고정했으면 바깥 누름·Esc로 닫는다
  useEffect(() => {
    if (!open) return;
    const layer = pushEscLayer();
    const frame = requestAnimationFrame(() => {
      const trigger = triggerRef.current;
      const panel = panelRef.current;
      if (trigger && panel) setPos(placeBelow(trigger.getBoundingClientRect(), panel.getBoundingClientRect(), "start"));
    });
    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      // 받기 창은 body에 따로 떠 있다 - 그 안을 누르는 것은 바깥이 아니다
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target) || (target instanceof Element && target.closest('[data-testid="space-download-dialog"]'))) return;
      requestClose();
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && isTopEscLayer(layer)) {
        event.stopPropagation();
        requestClose();
        triggerRef.current?.focus({ preventScroll: true });
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      cancelAnimationFrame(frame);
      popEscLayer(layer);
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  async function handleDownload(include: ParagraphInclude) {
    if (pick === null) return;
    setBusy(true);
    try {
      const { blob, fileName } = await downloadParagraphs(bundleId, pick === "doc" ? docId : null, include);
      saveBlob(blob, fileName ?? `${pick === "doc" ? docLabel : "Old"}_paragraphs.xlsx`);
      showToast(t("outputs.fileCreated"));
      setPick(null);
    } catch (err) {
      showToast(`${t("outputs.exportFailed")} ${humanizeApiError(err, t)}`, "error");
    } finally {
      setBusy(false);
    }
  }

  function renderDownload(kind: DownloadKind, label: string) {
    return (
      <button type="button" className={kind === "doc" ? "btn h-8" : "btn ghost h-7 text-xs"} disabled={busy} data-testid={`assign-dash-download-${kind}`} onClick={() => setPick(kind)}>
        <Download size={14} strokeWidth={1.5} aria-hidden />
        {label}
      </button>
    );
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="btn icon h-7 w-7"
        aria-label={t("assign.dash.open")}
        aria-expanded={open}
        data-on={open ? "" : undefined}
        data-testid="assign-dash"
        onPointerEnter={handleEnter}
        onPointerLeave={handleLeave}
        onClick={() => {
          clearTimer();
          if (pinned) close();
          else {
            setOpen(true);
            setPinned(true);
          }
        }}
      >
        <Gauge size={14} strokeWidth={1.5} aria-hidden />
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            // 모달이 아니다 - 올려 둔 채 화면 단축키가 그대로 돈다(B1-R6)
            role="group"
            aria-label={t("assign.dash.title", { code: docLabel })}
            className="doc-dash"
            data-testid="assign-dash-panel"
            style={pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0, visibility: "hidden" }}
            onPointerEnter={handleEnter}
            onPointerLeave={handleLeave}
            onPointerDown={() => setPinned(true)}
          >
            <h4 className="doc-dash-title">{t("assign.dash.title", { code: docLabel })}</h4>
            <div className="doc-dash-sub">{docTitle}</div>
            {stats && (
              <>
                <div className="doc-dash-big" data-testid="assign-dash-confirmed">
                  <b>{countDecided(stats.parts)}</b>
                  <span>{t("assign.dash.confirmed", { total: stats.total })}</span>
                </div>
                <div className="doc-dash-bar" aria-hidden>
                  {stats.parts.map((part) => (part.count > 0 ? <span key={part.key} style={{ flex: part.count, background: PROGRESS_PART_FILL[part.key] }} /> : null))}
                </div>
                <div className="doc-dash-legend">
                  {stats.parts.map((part) => (
                    <span key={part.key} data-testid={`assign-dash-status-${part.key}`}>
                      <i style={{ background: PROGRESS_PART_FILL[part.key] }} />
                      {t(`progress.part.${part.key}`)} {part.count}
                    </span>
                  ))}
                </div>
                <div className="doc-dash-notes">
                  {stats.figures.total > 0 && <span data-testid="assign-dash-figures">{t("progress.figures", { m: stats.figures.done, n: stats.figures.total })}</span>}
                  {stats.aiWaiting > 0 && (
                    <span data-testid="assign-dash-ai-waiting">
                      {t("progress.aiWaiting")} {stats.aiWaiting}
                    </span>
                  )}
                </div>
                <div className="doc-dash-sec">
                  <div className="doc-dash-k">{t("assign.dash.where")}</div>
                  <div className="doc-dash-kv">
                    {WHERE_ORDER.map((where) => (
                      <span key={where} data-testid={`assign-dash-where-${where}`}>
                        {t(`assign.dash.where.${where}`)}
                        <b>{stats.where[where]}</b>
                      </span>
                    ))}
                  </div>
                </div>
                <div className="doc-dash-sec">
                  <div className="doc-dash-k">{t("assign.dash.targets", { n: stats.targets.length })}</div>
                  {stats.targets.length === 0 ? (
                    <div className="text-xs text-ink-3">{t("assign.dash.noTargets")}</div>
                  ) : (
                    <div className="doc-dash-chips">
                      {stats.targets.map((target) => (
                        <button
                          key={target.docId}
                          type="button"
                          className="doc-dash-chip"
                          disabled={!isDocOpen(target.docId)}
                          data-testid={`assign-dash-target-${target.docId}`}
                          onClick={() => {
                            close();
                            onOpenDoc(target.docId);
                          }}
                        >
                          {target.docCode} · {target.rows}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
            <div className="doc-dash-sec">
              <div className="doc-dash-k">{t("assign.dash.bundle")}</div>
              <div className="doc-dash-kv">
                <span>
                  {t("assign.dash.bundleDone")}
                  <b>
                    {bundleLine.done} / {bundleLine.total}
                  </b>
                </span>
                {bundleLine.figuresTotal > 0 && <span>{t("progress.figures", { m: bundleLine.figuresDone, n: bundleLine.figuresTotal })}</span>}
                {bundleLine.refs + bundleLine.captions > 0 && <span>{t("assign.dash.bundleCheck", { refs: bundleLine.refs, captions: bundleLine.captions })}</span>}
              </div>
            </div>
            <div className="doc-dash-dl">
              {renderDownload("doc", t("assign.dash.download"))}
              <small>{t("assign.dash.downloadNote", { code: docLabel })}</small>
              {renderDownload("all", t("assign.dash.downloadAll"))}
            </div>
          </div>,
          document.body,
        )}
      {pick !== null && <ParagraphDownloadDialog busy={busy} onConfirm={(include) => void handleDownload(include)} onClose={() => setPick(null)} />}
    </>
  );
}
