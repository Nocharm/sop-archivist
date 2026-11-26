// Assign Space 미리보기 - Space를 누르고 있는 동안 아래에서 올라오는 시트에 양 단 보기면 지금 Old 문서의 Excel A, 한 단 보기면 그 문서의 문단 Excel을 보인다
// (1.2.0 피드백 7번, MD 2 §3 S2, 시안 2 D4).
// 짧게 탁 누르면 열어 두고(Space 탁 · Esc로 닫음), 끌었으면 떼는 순간 닫는다. 읽기만 하고, 시트 보기는 결과물 Export 미리보기와 같은 SheetView다.
// 상태 기계 · 셈은 lib/space-preview-model.ts. role="dialog"를 쓰지 않는다 - 열어 둔 동안에도 Assign 단축키(↵ 확정 등)가 그대로 돈다.
// 머리의 탭 둘(D1) - 결과 미리보기(위 시트) · 원본 보기(components/assign/original-view.tsx, 양 단이면 Old · New 두 원본). 마지막 탭을 기억하고(D2),
// 열어 둔 시트의 탁은 0.3초 흐려지며 닫히고 그사이 다시 탁 하면 닫기를 거두고 탭을 바꾼다(D3). 원본은 탭을 처음 보일 때 그리고 <Activity>로 숨겨 둔다(다시 그리지 않는다).
// 설계: docs/superpowers/specs/2026-11-27-original-view-design.md §5.6
"use client";

import { Download } from "lucide-react";
import { Activity, useEffect, useEffectEvent, useMemo, useState, type AnimationEvent, type PointerEvent } from "react";

import { OriginalView } from "@/components/assign/original-view";
import { ParagraphDownloadDialog } from "@/components/assign/paragraph-download-dialog";
import { SheetView } from "@/components/outputs/sheet-view";
import { LoadError } from "@/components/ui/load-error";
import { showToast } from "@/components/ui/toast";
import { humanizeApiError } from "@/lib/api-errors";
import { downloadExport, downloadParagraphs, getAssignSheetPreview, getParagraphSheetPreview, type ParagraphInclude } from "@/lib/api-sop";
import { isTypingTarget, LAYER_SELECTOR } from "@/lib/assign-key-target";
import { readSpacePreviewOpens, readSpaceSheetHeight, readSpaceTab, writeSpacePreviewOpens, writeSpaceSheetHeight, writeSpaceTab, type SpaceTab } from "@/lib/assign-view-prefs";
import { useI18n } from "@/lib/i18n";
import { saveBlob } from "@/lib/save-file";
import { isDragMove, type SheetDraft } from "@/lib/sheet-view-model";
import {
  countDataRows,
  DOUBLE_TAP_MS,
  findSheetUnit,
  getWindowRest,
  HINT_OPENS,
  isOwnSpaceTarget,
  isSpaceKept,
  isSpaceOpen,
  isTabFlip,
  readDragHeight,
  SHEET_HEIGHT_MAX,
  SHEET_HEIGHT_MIN,
  SPACE_CLOSED,
  stepSpace,
  type SpaceEvent,
  type SpaceSheet,
  type SpaceState,
} from "@/lib/space-preview-model";
import { useLoaded } from "@/lib/use-loaded";

const SPACE_TABS: readonly SpaceTab[] = ["result", "original"];
// components.css .space-sheet.is-closing의 키프레임 이름(움직임 줄이기면 -fade) - 이름을 바꾸면 함께
const CLOSING_ANIMATIONS = new Set(["space-sheet-out", "space-sheet-out-fade"]);

// 화면의 층(창 · 메뉴 · 고르기 목록)이 떠 있으면 Space · Esc는 그 층의 것이다
function isLayerOpen(): boolean {
  return document.querySelector(LAYER_SELECTOR) !== null;
}

interface SheetRequest {
  sheet: SpaceSheet;
  docId: number;
  around: number | null;
  reloadKey: string;
}

export interface SpacePreviewProps {
  bundleId: number;
  /** paragraphs = 한 단 보기의 그 문서 문단 Excel, comparison = 양 단 보기의 Old 문서 Excel A(시안 2 D4) */
  sheet: SpaceSheet;
  /** 보낼 시트가 있을 때만(lib/space-preview-model.ts isSpaceEnabled) */
  enabled: boolean;
  docId: number | null;
  docCode: string;
  /** 판단 저장이나 그 문서 편집(보기 revision)이 일어나면 바뀐다 - 연 동안이면 다시 불러온다 */
  reloadKey: string;
  /** 고른 줄의 단위들 - 가운데 맞출 단위가 맨 앞(누른 박스, 시트에 없으면 가까운 위 단위) */
  unitIds: readonly number[];
  /** 박스를 누를 때마다 오른다 - 같은 박스를 다시 눌러도 그 행으로 다시 가운데 맞춘다 */
  pickSeq: number;
  /** 시트에 가려지는 고른 줄을 머리에 글로 */
  picked: { id: string; text: string } | null;
  /** 확정 전에 고른 곳 - 고른 줄에 점선 글로 덮어 그린다 */
  draft?: SheetDraft;
  /** 원본 보기가 따라갈 docId 문서의 Unit들 - 누른 박스가 맨 앞(unitIds와 달리 머리말 · 꼬리말 Unit을 본문 단위로 바꾸지 않는다) */
  originalUnitIds: readonly number[];
  /** 양 단 보기 원본 탭의 오른쪽 - New 칸 문서(docId null = 앱에서 만든 문서라 원본 파일이 없다)와 New 고름의 Unit들. New 문서가 없으면 null */
  newOriginal: { docId: number | null; unitIds: readonly number[] } | null;
  /** 양 단 원본 두 칸의 폭 비율 - 본 화면 세로선(D6), 시트 안 세로선은 없다 */
  split: number;
}

export function SpacePreview({ bundleId, sheet: sheetKind, enabled, docId, docCode, reloadKey, unitIds, pickSeq, picked, draft, originalUnitIds, newOriginal, split }: SpacePreviewProps) {
  const { t } = useI18n();
  const [space, setSpace] = useState<SpaceState>(SPACE_CLOSED);
  const [opens, setOpens] = useState(readSpacePreviewOpens);
  const [request, setRequest] = useState<SheetRequest | null>(null);
  const [press, setPress] = useState<{ x: number; y: number } | null>(null);
  // 시트 높이 비율 - 손잡이를 끌어 바꾸고 떼면 기억한다
  const [height, setHeight] = useState(readSpaceSheetHeight);
  const [resize, setResize] = useState<{ startY: number; moved: boolean } | null>(null);
  const [downloading, setDownloading] = useState(false);
  // 문단 Excel은 받기 전에 넣을 것을 묻는다 - 시트를 닫아도 창은 남는다
  const [isAsking, setIsAsking] = useState(false);
  // 마지막에 본 탭(D2) - 꾹 누르기도 이 탭으로 연다. 원본을 못 보이는 문서여도 바꾸지 않는다
  const [tab, setTab] = useState<SpaceTab>(readSpaceTab);
  // 이번에 연 동안 원본 탭을 보였다 - 처음 보일 때 그려야(숨긴 칸은 재는 것이 없다) 쪽을 나누고, 그 뒤로는 숨겨 둔다
  const [originalSeen, setOriginalSeen] = useState(false);
  // 닫히던 시트를 다시 눌러 탭을 바꿨다 - 시트가 다시 올라오지 않게
  const [reopened, setReopened] = useState(false);
  // J · K 같은 글쇠를 꾹 누른 반복 중 - 원본 따라가기가 움직임 없이 바로 간다(D8)
  const [repeating, setRepeating] = useState(false);

  // 보낼 곳이 없어지면(New 문서 한 단 고치기 · 문서 없음) 닫는다 - 렌더 중 상태 맞추기
  if (!enabled && space.phase !== "closed") setSpace(SPACE_CLOSED);
  const isOpen = enabled && isSpaceOpen(space);
  const isKept = isSpaceKept(space);
  const isClosing = space.phase === "closing";
  if (isOpen && tab === "original" && !originalSeen) setOriginalSeen(true);
  if (!isOpen && (originalSeen || reopened || repeating)) {
    setOriginalSeen(false);
    setReopened(false);
    setRepeating(false);
  }

  const preview = useLoaded(
    async () => {
      if (request === null) return null;
      const loaded = request.sheet === "paragraphs" ? getParagraphSheetPreview(bundleId, request.docId, request.around) : getAssignSheetPreview(bundleId, request.docId, request.around);
      return { kind: request.sheet, sheet: await loaded };
    },
    request ? `${bundleId}:${request.sheet}:${request.docId}:${request.around ?? ""}:${request.reloadKey}` : "",
  );
  // 다시 받는 동안 남은 시트는 같은 종류일 때만 - 한 단 ↔ 양 단을 바꾸면 새 시트가 올 때까지 다른 시트를 보이지 않는다
  const data = preview.data?.kind === sheetKind ? preview.data.sheet : null;
  const isParagraphs = sheetKind === "paragraphs";
  const pickedInSheet = data !== null && unitIds.some((id) => data.rows.some((row) => row.unit_id === id || row.unit_ids.includes(id)));
  // 연 동안만 부른다 - 문서 · 저장이 바뀌었거나, 긴 문서의 창 밖 줄을 골랐으면 그 줄을 가운데로 다시. 닫혀 있는 동안의 저장은 다음에 열 때 부른다
  if (isOpen && docId !== null) {
    const around = unitIds[0] ?? null;
    const isStale = request === null || request.sheet !== sheetKind || request.docId !== docId || request.reloadKey !== reloadKey;
    const isOutside = !isStale && !preview.isLoading && data !== null && data.truncated && around !== null && around !== request.around && !pickedInSheet;
    if (isStale || isOutside) setRequest({ sheet: sheetKind, docId, around, reloadKey });
  }

  // 시트 보기에는 잘림 안내를 끄고 넘긴다 - 이 창은 위 · 아래로 잘린 수를 바닥에 따로 적는다(같은 객체를 넘겨 고른 줄 가운데 맞추기가 렌더마다 돌지 않게)
  const sheet = useMemo(() => (data ? { ...data, truncated: false } : null), [data]);
  const selectedUnitId = data ? findSheetUnit(data, unitIds) : null;
  const rest = data ? getWindowRest(data) : null;

  function dispatch(event: SpaceEvent) {
    setSpace((previous) => stepSpace(previous, event));
  }

  function changeTab(next: SpaceTab) {
    setTab(next);
    writeSpaceTab(next);
  }

  // 닫힘 움직임의 끝 - 안의 칸(쪽 칩 · 번쩍임 · 탭 나타남)에서 올라온 animationend는 아니다
  function handleAnimationEnd(event: AnimationEvent<HTMLElement>) {
    if (event.target === event.currentTarget && CLOSING_ANIMATIONS.has(event.animationName)) dispatch({ type: "closed" });
  }

  const handleKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (isOpen && event.key !== " " && event.repeat !== repeating) setRepeating(event.repeat);
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
      const down: SpaceEvent = { type: "down", at: event.timeStamp };
      if (isTabFlip(space, stepSpace(space, down))) {
        changeTab(tab === "result" ? "original" : "result");
        setReopened(true);
      }
      dispatch(down);
      return;
    }
    // 열어 둔 시트의 Esc는 시트만 닫는다 - 고른 체크 · 나눌 선을 거두는 화면 Esc보다 먼저(창 위 capture)
    if (event.key === "Escape" && isOpen && !isTypingTarget(event.target) && !isLayerOpen()) {
      event.preventDefault();
      event.stopPropagation();
      dispatch({ type: "escape" });
    }
  });

  const handleKeyUp = useEffectEvent((event: KeyboardEvent) => {
    if (repeating && event.key !== " ") setRepeating(false);
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

  function handleGripMove(event: PointerEvent<HTMLElement>) {
    // 기준은 시트가 붙은 작업 화면 - 손잡이 자신의 offsetParent는 시트다(손잡이가 position: relative)
    const parent = event.currentTarget.parentElement?.offsetParent;
    if (!resize || !parent) return;
    // 손 떨림 몇 px는 끌기가 아니다 - 본문 끌기와 같은 문턱(isDragMove)을 넘어야 높이를 바꾼다
    if (!resize.moved && !isDragMove(0, event.clientY - resize.startY)) return;
    const rect = parent.getBoundingClientRect();
    setHeight(readDragHeight(event.clientY, rect.bottom, rect.height));
    // 누르는 동안 높이를 바꿨으면 본문 끌기와 같게 떼는 순간 닫는다 - 한 번만 알린다
    if (!resize.moved) {
      setResize({ ...resize, moved: true });
      dispatch({ type: "drag" });
    }
  }

  function handleGripEnd() {
    if (resize?.moved) writeSpaceSheetHeight(height);
    setResize(null);
  }

  async function handleDownload(include?: ParagraphInclude) {
    setDownloading(true);
    try {
      if (include && docId !== null) {
        const { blob, fileName } = await downloadParagraphs(bundleId, docId, include);
        saveBlob(blob, fileName ?? `${docCode || "Document"}_paragraphs.xlsx`);
      } else {
        const { blob, fileName } = await downloadExport(bundleId);
        saveBlob(blob, fileName ?? `BND-${String(bundleId).padStart(4, "0")}.xlsx`);
      }
      showToast(t("outputs.fileCreated"));
      setIsAsking(false);
    } catch (err) {
      showToast(`${t("outputs.exportFailed")} ${humanizeApiError(err, t)}`, "error");
    } finally {
      setDownloading(false);
    }
  }

  const dialog = isAsking && docId !== null ? <ParagraphDownloadDialog busy={downloading} onConfirm={(include) => void handleDownload(include)} onClose={() => setIsAsking(false)} /> : null;

  if (!isOpen) {
    // 처음 몇 번만 - 설명서에는 늘 있다
    return (
      <>
        {enabled && opens < HINT_OPENS && (
          <p className="space-hint" data-testid="assign-space-hint">
            <kbd>Space</kbd> {t("assign.spacePreview.hint")}
          </p>
        )}
        {dialog}
      </>
    );
  }

  return (
    <>
      <section
        className={isClosing ? "space-sheet is-closing" : "space-sheet"}
        // 닫힘 움직임 길이 = 두 번 탁 간격(DOUBLE_TAP_MS)
        style={{ height: `${height * 100}%`, "--space-double-tap": `${DOUBLE_TAP_MS}ms` }}
        data-testid="assign-space-preview"
        data-state={isClosing ? "closing" : isKept ? "kept" : "held"}
        data-sheet={sheetKind}
        data-tab={tab}
        data-reopened={reopened ? "" : undefined}
        onAnimationEnd={handleAnimationEnd}
        aria-label={isParagraphs ? t("assign.spacePreview.paragraphsTitle") : t("outputs.preview.title")}
        // 시트 안 글쇠(↑ ↓ · PageUp …)는 시트를 옮긴다 - 같은 키가 화면에서 줄을 옮기지 않게 여기서 멈춘다
        onKeyDown={(event) => {
          if (event.defaultPrevented) event.stopPropagation();
        }}
      >
        <div
          className="space-sheet-grip"
          role="separator"
          aria-orientation="horizontal"
          aria-label={t("assign.spacePreview.resize")}
          aria-valuemin={Math.round(SHEET_HEIGHT_MIN * 100)}
          aria-valuemax={Math.round(SHEET_HEIGHT_MAX * 100)}
          aria-valuenow={Math.round(height * 100)}
          data-testid="assign-space-preview-resize"
          data-active={resize ? "" : undefined}
          // 누르기로 포커스를 옮기지 않는다 - 포커스가 남으면 다음 Space 탁이 시트를 닫지 않는다(받기 단추와 같다)
          onPointerDown={(event) => {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            setResize({ startY: event.clientY, moved: false });
          }}
          onPointerMove={handleGripMove}
          onPointerUp={handleGripEnd}
          onPointerCancel={handleGripEnd}
        />
        <header className="space-sheet-head">
          <div className="flex flex-none gap-0.5 rounded-md bg-sunken p-0.5" role="tablist">
            {SPACE_TABS.map((item) => (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={tab === item}
                className={`h-[24px] rounded-sm px-2.5 text-xs ${tab === item ? "bg-surface font-semibold text-ink shadow-sm" : "text-ink-2"}`}
                data-testid={`space-tab-${item}`}
                // 누르기로 포커스를 가져가지 않는다 - 탭에 포커스가 남으면 다음 Space 탁이 시트를 닫지 않고 그 탭을 누른다(받기 단추와 같다)
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => changeTab(item)}
              >
                {t(item === "result" ? "assign.spacePreview.tabResult" : "assign.spacePreview.tabOriginal")}
              </button>
            ))}
          </div>
          {tab === "result" && (
            <>
              <span className="space-sheet-tab">{sheet?.name ?? (isParagraphs ? docCode : "A Comparison")}</span>
              <span className="flex-none" data-testid="assign-space-preview-scope">
                {t("assign.spacePreview.scope", { doc: docCode, n: sheet ? countDataRows(sheet) : "…" })}
              </span>
            </>
          )}
          {picked && (
            <span className="min-w-0 truncate text-ink" data-testid="assign-space-preview-picked">
              {t("assign.spacePreview.picked")} <span className="font-mono font-semibold text-accent">{picked.id}</span> {picked.text}
            </span>
          )}
          <span className="space-sheet-state" data-kept={isKept || isClosing ? "" : undefined} data-testid="assign-space-preview-state">
            {isKept || isClosing ? t("assign.spacePreview.kept") : t("assign.spacePreview.holding")}
          </span>
          {tab === "result" && (
          <button
            type="button"
            className="btn h-7 flex-none"
            data-testid="assign-space-preview-download"
            disabled={downloading}
            // 누르기로 포커스를 가져가지 않는다 - 단추에 포커스가 남으면 다음 Space 탁이 시트를 닫지 않고 또 받는다
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => (isParagraphs && docId !== null ? setIsAsking(true) : void handleDownload())}
          >
            <Download size={14} strokeWidth={1.5} aria-hidden />
            {downloading ? t("outputs.exporting") : isParagraphs ? t("assign.spacePreview.downloadParagraphs") : t("outputs.preview.download")}
          </button>
          )}
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
          {/* 두 탭 내용은 숨겨 둔다 - 탭을 바꿔도 시트 · 원본을 다시 그리지 않고, 다시 보이는 칸이 0.14초 나타난다 */}
          <Activity mode={tab === "result" ? "visible" : "hidden"}>
            <div className="space-tab-pane">
              {sheet ? (
                <SheetView sheet={sheet} selectedUnitId={selectedUnitId} centreKey={pickSeq} draft={isParagraphs ? undefined : draft} testId="assign-space-preview" />
              ) : preview.error != null ? (
                <LoadError error={preview.error} onRetry={preview.reload} testId="assign-space-preview" />
              ) : (
                <div className="grid gap-2" aria-busy="true" data-testid="assign-space-preview-loading">
                  <span className="sk h-5 w-1/2" />
                  <span className="sk h-40 w-full" />
                </div>
              )}
            </div>
          </Activity>
          <Activity mode={tab === "original" ? "visible" : "hidden"}>
            {originalSeen && docId !== null && (
              <div className="space-tab-pane">
                {isParagraphs ? (
                  <OriginalView bundleId={bundleId} docId={docId} pickedUnitIds={originalUnitIds} repeating={repeating} testId="space-original" />
                ) : (
                  <div className="space-originals" style={{ "--split": `${split * 100}%` }}>
                    <OriginalView bundleId={bundleId} docId={docId} pickedUnitIds={originalUnitIds} repeating={repeating} testId="space-original-old" />
                    {newOriginal?.docId == null ? (
                      // 그릴 원본이 없는 오른쪽 - 앱에서 만든 New 문서이거나 New 문서가 아직 없다(원본 칸과 같은 책상 · 안내 모양)
                      <div className="ov" data-testid="space-original-new" data-state={newOriginal === null ? "empty" : "none"}>
                        <div className="ov-empty" data-testid={newOriginal === null ? "space-original-new-empty" : "space-original-new-none"}>
                          {t(newOriginal === null ? "assign.newEmpty.title" : "assign.original.none")}
                        </div>
                      </div>
                    ) : (
                      <OriginalView bundleId={bundleId} docId={newOriginal.docId} pickedUnitIds={newOriginal.unitIds} repeating={repeating} testId="space-original-new" />
                    )}
                  </div>
                )}
              </div>
            )}
          </Activity>
        </div>
        {tab === "result" && (
        <footer className="space-sheet-foot" data-testid="assign-space-preview-legend">
          <span>
            <i className="space-key" data-mark="picked" aria-hidden />
            {t("assign.spacePreview.legendPicked")}
          </span>
          {isParagraphs && (
            <span>
              <i className="space-key" data-mark="deleted" aria-hidden />
              {t("assign.spacePreview.legendDeleted")}
            </span>
          )}
          {!isParagraphs && (
            <>
              <span>
                <i className="space-key" data-mark="group" aria-hidden />
                {t("assign.spacePreview.legendGroup")}
              </span>
              <span>
                <span className="sv-draft">{t("assign.spacePreview.legendDraftSample")}</span> {t("assign.spacePreview.legendDraft")}
              </span>
              <span>{t("outputs.sheet.legend")}</span>
            </>
          )}
          {rest && (
            <span data-testid="assign-space-preview-rest">
              {t(isParagraphs ? "assign.spacePreview.restParagraphs" : "assign.spacePreview.rest", { above: rest.above, below: rest.below })}
            </span>
          )}
          <span className="ml-auto">{isParagraphs ? t("assign.spacePreview.sameFileParagraphs") : t("assign.spacePreview.sameFile")}</span>
        </footer>
        )}
      </section>
    {dialog}
    </>
  );
}
