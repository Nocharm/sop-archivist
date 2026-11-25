// Assign Old 칸 문서 고르기 옆 단추 - 올리거나 누르면 그 문서의 진행(상태·간 곳·받는 New 문서)과 문단 Excel 내려받기가 뜬다(1.2.0 피드백 6번).
// 올리면 잠깐 뒤 뜨고 상자 안으로 옮겨도 그대로다. 누르면 고정되어 바깥을 누르거나 Esc로 닫는다. 내려받기는 표를 넣을지 고른 뒤 받는다.
"use client";

import { Download, Gauge, X } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { isTopEscLayer, placeBelow, popEscLayer, pushEscLayer, type FloatingPos } from "@/components/ui/floating";
import { showToast } from "@/components/ui/toast";
import { humanizeApiError } from "@/lib/api-errors";
import { downloadParagraphs, type CoverStatus, type Disposition } from "@/lib/api-sop";
import type { DocDashboard as DocDashboardData } from "@/lib/doc-dashboard-model";
import { useI18n } from "@/lib/i18n";
import { saveBlob } from "@/lib/save-file";

const OPEN_DELAY_MS = 150; // 지나가기만 할 때 뜨지 않게
const CLOSE_DELAY_MS = 200; // 단추에서 상자로 옮기는 사이에 닫히지 않게
const STATUS_ORDER: CoverStatus[] = ["confirmed", "on_hold", "ai_suggested", "unassigned"];
const STATUS_COLOR: Record<CoverStatus, string> = {
  confirmed: "var(--st-ok-fill)",
  on_hold: "var(--st-hold-ink)",
  ai_suggested: "var(--st-ai-ink)",
  unassigned: "var(--line-2)",
};
const WHERE_ORDER: Disposition[] = ["assigned", "delete", "move_external", "unassigned"];

interface DocDashboardProps {
  bundleId: number;
  docId: number;
  /** 문서 번호(OLD-1) */
  docLabel: string;
  docTitle: string;
  /** 이 문서의 줄 수 - 배정 줄이 없는 문서(Old 칸에 연 이미 쓴 New 문서)면 null, 내려받기만 보인다 */
  stats: DocDashboardData | null;
  bundleLine: { done: number; total: number; refs: number; captions: number };
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
  // 고르던 내려받기 - 문서를 바꾸면 그 문서의 것이 아니므로 접힌 것으로 본다
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
    setPick(null);
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
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
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

  async function handleDownload(tables: boolean) {
    if (pick === null) return;
    setBusy(true);
    try {
      const { blob, fileName } = await downloadParagraphs(bundleId, pick === "doc" ? docId : null, tables);
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
    if (pick !== kind) {
      return (
        <button type="button" className={kind === "doc" ? "btn h-8" : "btn ghost h-7 text-xs"} disabled={busy} data-testid={`assign-dash-download-${kind}`} onClick={() => setPick(kind)}>
          <Download size={14} strokeWidth={1.5} aria-hidden />
          {label}
        </button>
      );
    }
    return (
      <span className="doc-dash-pick" role="group" aria-label={label} data-testid={`assign-dash-pick-${kind}`}>
        <button type="button" className="btn pri h-8" disabled={busy} data-testid={`assign-dash-tables-${kind}`} onClick={() => void handleDownload(true)}>
          {t("assign.dash.withTables")}
        </button>
        <button type="button" className="btn h-8" disabled={busy} data-testid={`assign-dash-no-tables-${kind}`} onClick={() => void handleDownload(false)}>
          {t("assign.dash.withoutTables")}
        </button>
        <button type="button" className="btn icon h-8 w-8" aria-label={t("common.cancel")} disabled={busy} onClick={() => setPick(null)}>
          <X size={14} strokeWidth={1.5} aria-hidden />
        </button>
      </span>
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
            role="dialog"
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
                  <b>{stats.status.confirmed}</b>
                  <span>{t("assign.dash.confirmed", { total: stats.total })}</span>
                </div>
                <div className="doc-dash-bar" aria-hidden>
                  {STATUS_ORDER.map((status) => (stats.status[status] > 0 ? <span key={status} style={{ flex: stats.status[status], background: STATUS_COLOR[status] }} /> : null))}
                </div>
                <div className="doc-dash-legend">
                  {STATUS_ORDER.map((status) => (
                    <span key={status} data-testid={`assign-dash-status-${status}`}>
                      <i style={{ background: STATUS_COLOR[status] }} />
                      {t(`status.unit.${status}`)} {stats.status[status]}
                    </span>
                  ))}
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
    </>
  );
}
