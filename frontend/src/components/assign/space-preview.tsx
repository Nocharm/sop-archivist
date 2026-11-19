// Assign Space 미리보기 - Space를 누르고 있는 동안 아래에서 올라오는 시트에 지금 Old 문서의 Excel A를 보인다(1.2.0 피드백 7번, MD 2 §3 S2).
// 짧게 탁 누르면 열어 두고(Space 탁 · Esc로 닫음), 끌었으면 떼는 순간 닫는다. 읽기만 하고, 시트 보기는 결과물 Export 미리보기와 같은 SheetView다.
// 상태 기계 · 셈은 lib/space-preview-model.ts. role="dialog"를 쓰지 않는다 - 열어 둔 동안에도 Assign 단축키(↵ 확정 등)가 그대로 돈다.
"use client";

import { Download } from "lucide-react";
import { useEffect, useEffectEvent, useMemo, useState } from "react";

import { SheetView } from "@/components/outputs/sheet-view";
import { LoadError } from "@/components/ui/load-error";
import { showToast } from "@/components/ui/toast";
import { humanizeApiError } from "@/lib/api-errors";
import { downloadExport, getAssignSheetPreview } from "@/lib/api-sop";
import { readSpacePreviewOpens, writeSpacePreviewOpens } from "@/lib/assign-view-prefs";
import { useI18n } from "@/lib/i18n";
import { saveBlob } from "@/lib/save-file";
import { isDragMove, type SheetDraft } from "@/lib/sheet-view-model";
import {
  countDataRows,
  findSheetUnit,
  getWindowRest,
  HINT_OPENS,
  isOwnSpaceTarget,
  isSpaceKept,
  isSpaceOpen,
  SPACE_CLOSED,
  stepSpace,
  type SpaceEvent,
  type SpaceState,
} from "@/lib/space-preview-model";
import { useLoaded } from "@/lib/use-loaded";

// 화면의 층(창 · 메뉴 · 고르기 목록)이 떠 있으면 Space · Esc는 그 층의 것이다 - Assign 단축키와 같은 고르개
const LAYER_SELECTOR = '[role="dialog"],[role="menu"]:not([data-link-menu]),[role="listbox"]';

function isLayerOpen(): boolean {
  return document.querySelector(LAYER_SELECTOR) !== null;
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

interface SheetRequest {
  docId: number;
  around: number | null;
  reloadKey: string;
}

export interface SpacePreviewProps {
  bundleId: number;
  /** Old 문서를 보고 있을 때만(New 문서를 한 단으로 고치는 중이 아님) */
  enabled: boolean;
  docId: number | null;
  docCode: string;
  /** 판단 저장이나 그 문서 편집(보기 revision)이 일어나면 바뀐다 - 연 동안이면 다시 불러온다 */
  reloadKey: string;
  /** 고른 줄의 단위들 */
  unitIds: readonly number[];
  /** 시트에 가려지는 고른 줄을 머리에 글로 */
  picked: { id: string; text: string } | null;
  /** 확정 전에 고른 곳 - 고른 줄에 점선 글로 덮어 그린다 */
  draft?: SheetDraft;
}

export function SpacePreview({ bundleId, enabled, docId, docCode, reloadKey, unitIds, picked, draft }: SpacePreviewProps) {
  const { t } = useI18n();
  const [space, setSpace] = useState<SpaceState>(SPACE_CLOSED);
  const [opens, setOpens] = useState(readSpacePreviewOpens);
  const [request, setRequest] = useState<SheetRequest | null>(null);
  const [press, setPress] = useState<{ x: number; y: number } | null>(null);
  const [downloading, setDownloading] = useState(false);

  // 보낼 곳이 없어지면(New 문서 한 단 고치기 · 문서 없음) 닫는다 - 렌더 중 상태 맞추기
  if (!enabled && space.phase !== "closed") setSpace(SPACE_CLOSED);
  const isOpen = enabled && isSpaceOpen(space);
  const isKept = isSpaceKept(space);

  const preview = useLoaded(
    () => (request ? getAssignSheetPreview(bundleId, request.docId, request.around) : Promise.resolve(null)),
    request ? `${bundleId}:${request.docId}:${request.around ?? ""}:${request.reloadKey}` : "",
  );
  const data = preview.data;
  const pickedInSheet = data !== null && unitIds.some((id) => data.rows.some((row) => row.unit_id === id));
  // 연 동안만 부른다 - 문서 · 저장이 바뀌었거나, 긴 문서의 창 밖 줄을 골랐으면 그 줄을 가운데로 다시. 닫혀 있는 동안의 저장은 다음에 열 때 부른다
  if (isOpen && docId !== null) {
    const around = unitIds[0] ?? null;
    const isStale = request === null || request.docId !== docId || request.reloadKey !== reloadKey;
    const isOutside = !isStale && !preview.isLoading && data !== null && data.truncated && around !== null && around !== request.around && !pickedInSheet;
    if (isStale || isOutside) setRequest({ docId, around, reloadKey });
  }

  // 시트 보기에는 잘림 안내를 끄고 넘긴다 - 이 창은 위 · 아래로 잘린 수를 바닥에 따로 적는다(같은 객체를 넘겨 고른 줄 가운데 맞추기가 렌더마다 돌지 않게)
  const sheet = useMemo(() => (data ? { ...data, truncated: false } : null), [data]);
  const selectedUnitId = data ? findSheetUnit(data, unitIds) : null;
  const rest = data ? getWindowRest(data) : null;

  function dispatch(event: SpaceEvent) {
    setSpace((previous) => stepSpace(previous, event));
  }

  const handleKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === " ") {
      if (!enabled) return;
      // 누르는 동안의 키 반복은 무시하고 기본 스크롤만 막는다
      if (space.phase === "held" || space.phase === "keptHeld") {
        event.preventDefault();
        return;
      }
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      if (isOwnSpaceTarget(event.target) || isLayerOpen()) return;
      event.preventDefault();
      if (space.phase === "closed" && opens < HINT_OPENS) {
        setOpens(opens + 1);
        writeSpacePreviewOpens(opens + 1);
      }
      dispatch({ type: "down", at: event.timeStamp });
      return;
    }
    // 열어 둔 시트의 Esc는 시트만 닫는다 - 고른 체크 · 나눌 선을 거두는 화면 Esc보다 먼저(창 위 capture)
    if (event.key === "Escape" && isOpen && !isTyping(event.target) && !isLayerOpen()) {
      event.preventDefault();
      event.stopPropagation();
      dispatch({ type: "escape" });
    }
  });

  const handleKeyUp = useEffectEvent((event: KeyboardEvent) => {
    if (event.key !== " " || (space.phase !== "held" && space.phase !== "keptHeld")) return;
    event.preventDefault();
    dispatch({ type: "up", at: event.timeStamp });
  });

  useEffect(() => {
    const onBlur = () => dispatch({ type: "blur" });
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("keyup", handleKeyUp, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("keyup", handleKeyUp, true);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  async function handleDownload() {
    setDownloading(true);
    try {
      const { blob, fileName } = await downloadExport(bundleId);
      saveBlob(blob, fileName ?? `BND-${String(bundleId).padStart(4, "0")}.xlsx`);
      showToast(t("outputs.fileCreated"));
    } catch (err) {
      showToast(`${t("outputs.exportFailed")} ${humanizeApiError(err, t)}`, "error");
    } finally {
      setDownloading(false);
    }
  }

  if (!isOpen) {
    // 처음 몇 번만 - 설명서에는 늘 있다
    return enabled && opens < HINT_OPENS ? (
      <p className="space-hint" data-testid="assign-space-hint">
        <kbd>Space</kbd> {t("assign.spacePreview.hint")}
      </p>
    ) : null;
  }

  return (
    <section
      className="space-sheet"
      data-testid="assign-space-preview"
      data-state={isKept ? "kept" : "held"}
      aria-label={t("outputs.preview.title")}
      // 시트 안 글쇠(↑ ↓ · PageUp …)는 시트를 옮긴다 - 같은 키가 화면에서 줄을 옮기지 않게 여기서 멈춘다
      onKeyDown={(event) => {
        if (event.defaultPrevented) event.stopPropagation();
      }}
    >
      <span className="space-sheet-grip" aria-hidden />
      <header className="space-sheet-head">
        <b className="text-[14px] text-ink">{t("outputs.preview.title")}</b>
        <span className="space-sheet-tab">{data?.name ?? "A Comparison"}</span>
        <span className="flex-none" data-testid="assign-space-preview-scope">
          {t("assign.spacePreview.scope", { doc: docCode, n: data ? countDataRows(data) : "…" })}
        </span>
        {picked && (
          <span className="min-w-0 truncate text-ink" data-testid="assign-space-preview-picked">
            {t("assign.spacePreview.picked")} <span className="font-mono font-semibold text-accent">{picked.id}</span> {picked.text}
          </span>
        )}
        <span className="space-sheet-state" data-kept={isKept ? "" : undefined} data-testid="assign-space-preview-state">
          {isKept ? t("assign.spacePreview.kept") : t("assign.spacePreview.holding")}
        </span>
        <button
          type="button"
          className="btn h-7 flex-none"
          data-testid="assign-space-preview-download"
          disabled={downloading}
          // 누르기로 포커스를 가져가지 않는다 - 단추에 포커스가 남으면 다음 Space 탁이 시트를 닫지 않고 또 받는다
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => void handleDownload()}
        >
          <Download size={14} strokeWidth={1.5} aria-hidden />
          {downloading ? t("outputs.exporting") : t("outputs.preview.download")}
        </button>
      </header>
      <div
        className="space-sheet-body"
        // 누르는 동안 시트를 끌었으면 떼는 순간 닫는다(열어 두지 않는다) - 옮기기 자체는 시트 보기가 한다
        onPointerDown={(event) => setPress({ x: event.clientX, y: event.clientY })}
        onPointerMove={(event) => {
          if (press && event.buttons !== 0 && isDragMove(event.clientX - press.x, event.clientY - press.y)) {
            setPress(null);
            dispatch({ type: "drag" });
          }
        }}
        onPointerUp={() => setPress(null)}
      >
        {sheet ? (
          <SheetView sheet={sheet} selectedUnitId={selectedUnitId} draft={draft} testId="assign-space-preview" />
        ) : preview.error != null ? (
          <LoadError error={preview.error} onRetry={preview.reload} testId="assign-space-preview" />
        ) : (
          <div className="grid gap-2" aria-busy="true" data-testid="assign-space-preview-loading">
            <span className="sk h-5 w-1/2" />
            <span className="sk h-40 w-full" />
          </div>
        )}
      </div>
      <footer className="space-sheet-foot" data-testid="assign-space-preview-legend">
        <span>
          <i className="space-key" data-mark="picked" aria-hidden />
          {t("assign.spacePreview.legendPicked")}
        </span>
        <span>
          <i className="space-key" data-mark="group" aria-hidden />
          {t("assign.spacePreview.legendGroup")}
        </span>
        <span>
          <span className="sv-draft">{t("assign.spacePreview.legendDraftSample")}</span> {t("assign.spacePreview.legendDraft")}
        </span>
        <span>{t("outputs.sheet.legend")}</span>
        {rest && (
          <span data-testid="assign-space-preview-rest">{t("assign.spacePreview.rest", { above: rest.above, below: rest.below })}</span>
        )}
        <span className="ml-auto">{t("assign.spacePreview.sameFile")}</span>
      </footer>
    </section>
  );
}
