// 3단계 Assign - Old 조각을 한 줄씩(한/영 짝은 함께) 보낼 곳을 정한다. 보낼 곳은 이미 쓴 New 문서의 문장(옛 짝 맞추기)이거나
// 아직 안 쓴 To-Be 문서의 칸(옛 분류), 또는 삭제·외부 이동이다. 가운데는 Old 원문(Split 조각이 곧 목록) ‖ New 원문,
// 오른쪽은 고른 곳·확정·우선순위 아코디언이다(설계 2026-11-09-assign-unified, docs/architecture/decisions.md).
// 보기는 둘이다 - 양 단(Old ‖ New)과 한 단(Old 문서 하나만 넓게, 설계 2026-11-15-assign-merge-documents-design.md §3.1). 한 단에서는 New 칸·세로선·연결선을 그리지 않는다.
// 상태 · 데이터 · 동작은 use-assign-page.tsx의 useAssignPage()에 있고, 이 파일은 그리기만 한다(쪼개기 1단계).
"use client";

import { FileCheck2, FileUp, FolderOutput, Inbox, Link2, MousePointerClick, Sparkles, SquarePlus, Trash2, TriangleAlert, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useEffectEvent, useMemo, useRef, useState, type ReactNode } from "react";
import { AssignContextMenu } from "@/components/assign/assign-context-menu";
import { AssignHelp } from "@/components/assign/assign-help";
import { LinkLines } from "@/components/assign/link-lines";
import { JoinMenu } from "@/components/assign/join-menu";
import { getSpotAttrs, PlaceGap, type PlaceSpotView, type SpotAttrs } from "@/components/assign/place-spot";
import { LinkMenu } from "@/components/assign/link-menu";
import { LinkBadge } from "@/components/assign/link-badge";
import { NewBundle } from "@/components/assign/new-bundle";
import { NewPane, NewPaneEmpty, type NewPlaceSpots } from "@/components/assign/new-pane";
import { DocDashboard } from "@/components/assign/doc-dashboard";
import { OldPane } from "@/components/assign/old-pane";
import { PairColumn, PairViewToggle } from "@/components/assign/pair-column";
import { PairLines } from "@/components/assign/pair-lines";
import { PaneDivider } from "@/components/assign/pane-divider";
import { RecentRemarks, REMARK_MAX_LENGTH, RemarkModal } from "@/components/assign/remark-modal";
import { SideFloat } from "@/components/assign/side-float";
import { SpacePreview } from "@/components/assign/space-preview";
import { ResetModal } from "@/components/assign/reset-modal";
import { Modal } from "@/components/modal";
import { TemplateView, type TemplateSpot } from "@/components/template/template-view";
import { CutPop } from "@/components/paper/cut-pop";
import type { ComposedStyleChoice } from "@/components/paper/number-cell";
import { FilterChip } from "@/components/status";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { LeftoverTranslations } from "@/components/assign/leftover-translations";
import { AcceptSuggestionsModal } from "@/components/assign/accept-suggestions-modal";
import { EmptyState } from "@/components/ui/empty-state";
import { BundleLoadError } from "@/components/bundle-load-error";
import { flashElement, Truncate } from "@/components/ui/motion";
import { formatGapLabel, PLACE_REFUSAL_KEYS, readGapKey, type Placement, type PlaceSpot } from "@/lib/place-spot-model";
import { listAckWarnings } from "@/lib/missing-warnings-model";
import { type ChangeType, type EditOp } from "@/lib/api-sop";
import { isBundleCaptionNeeded } from "@/lib/caption-model";
import { countJoinedLines } from "@/lib/join-sentence-model";
import { listLinkMenuItems, listUnlinkRemainder, type LinkMenuItem } from "@/lib/assign-model";
import type { CEdit } from "@/lib/c-edit-model";
import { getDestinationId, previewSlotChange, readSlotKind } from "@/lib/classify-model";
import { buildComposedRows, buildComposedStrips } from "@/lib/composed-model";
import { useI18n } from "@/lib/i18n";
import { useComposedOrder } from "@/lib/use-composed-order";
import { navigate } from "@/lib/nav-buffer";
import { buildNewAiFilter, listNewAiLinks, readNewAiPill } from "@/lib/new-ai-filter-model";
import { buildSheetDraft, isSpaceEnabled, pickSpaceSheet } from "@/lib/space-preview-model";
import { buildDeletedFolds } from "@/lib/deleted-fold-model";
import type { IndentChange } from "@/lib/indent-model";
import { hasTocLineIn, listPartSheets } from "@/lib/paper-model";
import { getNewDocumentsHref, getStageHref } from "@/lib/stages";
import { toggleTocOpen } from "@/lib/toc-block-model";
import { type SelectOption } from "@/components/ui/select";
import { AssignSidePanel } from "./assign-side-panel";

import { AssignBar } from "./assign-bar";
import { QueueFailure } from "./queue-failure";
import { useAssignPage, NO_NUMBERS, findDestinationDoc, readMenuCover, revealElement } from "./use-assign-page";

export default function AssignPage() {
  const state = useAssignPage();
  // 엮은 문서 순서 저장 응답의 라벨 언어 - 엮은 문서를 받는 언어와 같게(화면 언어)
  const { lang: uiLang } = useI18n();
  const {
    t, bundleId, bundle, canEdit, docs, oldDocs, docViews, unitsKey, tobe, tobeData, writtenList, identical,
    readMarkStatus, readAiPlace, suggestedTargetUnits, unitMap, written, writtenMap, rows, rowMap, rowOfUnit, labelOptions, ready, showSkeleton, unsourced,
    mode, setMode, foldOpen, setFoldOpen, foldMatch, clearRowPick, activeKey, row, pickedId, spaceUnitIds, spacePickSeq, solo, setSolo, isSolo, isNewEdit, tocOpen, setTocOpen,
    tocPick, checked, newRemarks, setNewRemarks, menu, setMenu, joinMenu, setJoinMenu, ctxMenu, setCtxMenu, focusNew,
    setDrafts, draft, groupPending, savedDestination, destination, rowUnits, reasonNow, setDraft, unsavedCount, leaveTo, setLeaveTo,
    aiDest, isAiRow, recommendations, linkIds, candidateIds, setManualOldDoc, oldView, acceptKind, setAcceptKind, acceptDoc, paperModel,
    canPairView, isPairView, pairColumns, pairLinks, partKeys, oldDocId, soloUnit, soloUnits, cutUnit, cutLine, linkedTargets,
    registerNumberHandle, setManualPart, activePart, isFoldEmpty, foldElsewhere, writtenDocs, composedDocs, setManualNewDoc, toggleKey, liveDoc, isNewDocOpen,
    newDocId, newAiReturn, setNewAiReturn, isComposedDoc, newFileId, composedDoc, newRows, headingNotes, sectionMarks, joinableIds,
    templateTitles, linkPairs, view, changeView, zoomPane, setPanes, remarkEdit, setRemarkEdit, focusAfterRef, busy, isAnyPending, isGlobalPending, paperPending, pendingDeletes, expectedNumbers, editConfirm,
    oldPaneRef, bulk, setBulk, confirmingIdentical,
    setConfirmingIdentical, resetScope, setResetScope, slots, newDraft, draftSlotKey, placeResolved, canPlaceClick, pickedSpotKey,
    setCarvePick, carve, carveText, clearCarve, togglePairViewByButton, pairFrom, setPairFrom, pairSource, captionPickBundle, setCaptionPick, selectToc, openNewCtxMenu,
    openSolo, goToUnit, ctxGroups, confirmBlockKey, refPendingIds, isLinkedToWritten, captionPendingKeys, docDashboard, openCtxMenu, runUnitEdit,
    rewrapTable, unwrapAi, describeEditConfirm, pairGrip, clearNoise, openNoiseReason, splitAtCut, handleOldDoubleClick,
    runCtx, revertHeadings, planOldJoin, joinOld, renderOldActions, runSave, runClear, confirmIdenticalAll, acceptAll, pickDestination,
    pickNewSentence, handleNewPick, handleJoinPick, readJoinAfter, pickJoinMenu, handleSidePress, pickPlaceSpot, pickOwnAiLine, jumpToNew, openNewDoc,
    showInNew, jumpToOld, pickTemplateLine, fillTemplateMissing, isOldDrag, finishPairPick, handleOldClick, markRecHover, revealPick,
    setRevealPick, done, renderPlaceLabel, listDestinationEls, error,
  } = state;



  // New 문장에 포인터를 올리면 그 문장을 가리키는 추천 카드를 밝힌다. 카드에서 붙인 표시는 카드가 뗀다(그 사이 여기서 지우지 않게)
  const newHoverMarked = useRef(false);
  const markNewHover = useEffectEvent((target: EventTarget | null) => {
    const el = target instanceof Element ? target.closest<HTMLElement>('[data-pane="new"] :is(.new-line[data-target], .new-block, .new-slot-empty)') : null;
    if (!el) {
      if (newHoverMarked.current) markRecHover([]);
      newHoverMarked.current = false;
      return;
    }
    newHoverMarked.current = true;
    const cards = recommendations.flatMap((rec, index) => {
      const els = listDestinationEls(rec.destination);
      return els.includes(el) ? [...els, document.querySelector<HTMLElement>(`[data-testid="assign-rec-${index}"]`)] : [];
    });
    markRecHover(cards.filter((item): item is HTMLElement => item !== null && item !== el));
  });
  useEffect(() => {
    const onOver = (event: PointerEvent) => markNewHover(event.target);
    document.addEventListener("pointerover", onOver);
    return () => document.removeEventListener("pointerover", onOver);
  }, []);
  if (revealPick !== null && revealPick.rowKey !== activeKey) setRevealPick(null);
  const showPicked = useEffectEvent(() => {
    const el = revealPick ? listDestinationEls(revealPick.destination)[0] : undefined;
    if (!el) return;
    revealElement(el);
    flashElement(el);
    setRevealPick(null);
  });
  useEffect(() => {
    if (!revealPick) return;
    const frame = requestAnimationFrame(() => showPicked());
    return () => cancelAnimationFrame(frame);
  }, [revealPick, newDocId, composedDoc, written]);

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
      runSave("confirm");
    } else if (item === "cancel") {
      // 고름을 되돌린다 - 저장된 곳(없으면 빈 고름)으로
      setDraft({ destination: null, position: null });
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
        runClear();
      }
    }
  }

  // 그 자리 메뉴를 New 칸의 문단을 눌러 열었으면 떠 있지 않고 그 문단 상자 안에 단추 줄로 펼친다 - 눈이 누른 문단에 머문다(사용자 결정 2026-11-19).
  // 추천 카드·Old 조각·끌어 놓은 초안에서 연 메뉴는 그대로 떠 있다
  const readInlineTarget = (anchor: HTMLElement): number | null => (anchor.matches('[data-pane="new"] .new-line') ? Number(anchor.dataset.target) : null);
  const menuLineId = menu && menuItems.length > 0 ? readInlineTarget(menu.anchor) : null;
  const joinLineId = joinMenu && composedDoc ? readInlineTarget(joinMenu.anchor) : null;
  function renderLinkMenu(inline: boolean): ReactNode {
    if (!menu || menuItems.length === 0) return null;
    const unitIds = rowMap.get(menu.rowKey)?.unitIds ?? [];
    return <LinkMenu key={menu.seq} anchor={menu.anchor} cover={readMenuCover(menu.anchor, unitIds)} offset={menu.offset} lineUnits={unitIds} items={menuItems} isUnsaved={menuItems.includes("cancel")} confirmBlock={confirmBlockKey ? t(confirmBlockKey) : null} busy={busy} onAction={runMenu} onClose={() => setMenu(null)} inline={inline} />;
  }
  function renderJoinMenu(inline: boolean): ReactNode {
    if (!joinMenu || !composedDoc) return null;
    const sources = composedDoc.sections.flatMap((section) => section.items).find((item) => item.target_id === joinMenu.targetId)?.source_unit_ids ?? [];
    return (
      <JoinMenu
        key={joinMenu.seq}
        anchor={joinMenu.anchor}
        offset={joinMenu.offset}
        lineCount={countJoinedLines(sources, joinMenu.rowKey, (unitId) => rowOfUnit.get(unitId))}
        canPlaceAfter={readJoinAfter(joinMenu.targetId).kind === "gap"}
        onPick={pickJoinMenu}
        onClose={() => setJoinMenu(null)}
        inline={inline}
      />
    );
  }
  const reloadAll = () => {
    for (const source of [docs, tobe, writtenList]) if (source.error !== null) source.reload();
    if (docViews.error !== null) docViews.retry();
  };
  // 삭제로 확정한 줄과 방금 삭제를 누른 줄은 흐린 한 줄로 접는다(설계 D6) - 펼침은 용지가 고름으로 정한다(고른 동안만, 떠나면 다시 접힘)
  const deletedFolds = useMemo(() => buildDeletedFolds(rows, unitMap, { filter: state.filter, pendingDeletes }), [rows, unitMap, state.filter, pendingDeletes]);
  // 빈 템플릿(엮은 문서) 기본 보기의 순서 · 칸 옮기기 · 번호 표시(시안 2 D6) - Order 화면과 같은 저장 길, 화면 문서에 먼저 얹고 두 보기가 같은 문서를 그린다
  const composedOrder = useComposedOrder({ bundleId, doc: isComposedDoc ? composedDoc : null, labelLang: uiLang });
  const shownComposed = composedOrder.doc;
  const composedStrips = useMemo(() => (shownComposed ? buildComposedStrips(shownComposed) : null), [shownComposed]);
  if (!ready) {
    return error !== null ? (
      <BundleLoadError error={error} onRetry={reloadAll} testId="assign" />
    ) : (
      <div className="p-4" data-testid="assign-loading">
        {showSkeleton && <span className="sk h-[480px] w-full" />}
      </div>
    );
  }

  // 출처 없는 New 문장 거르기 - New 문서에 거는 거르기라 New 칸 머리에 둔다(1.2.0 피드백, 한 단·Pair view에서는 New 칸이 없어 보이지 않는다). Old 거르기 칩을 누르면 풀린다
  const unsourcedChip =
    written.length > 0 ? (
      <span role="tablist" aria-label={t("assign.filterUnsourced")} className="flex new-unsourced">
        <FilterChip
          tone="danger"
          label={t("assign.filterUnsourced")}
          count={unsourced.length}
          selected={mode === "unsourced"}
          onClick={() => setMode("unsourced")}
          testId="assign-filter-unsourced"
          icon={TriangleAlert}
          shrinks
        />
      </span>
    ) : null;
  // 고른 줄의 AI 제안만 New 칸에 남기는 거르기 - New 칸 머리의 칩으로 켜고 브라우저에 기억한다(규칙은 lib/new-ai-filter-model). 출처 없는 New 모드는 고른 Old 줄이 없는 것으로 본다
  const newAiUnitIds = mode === "old" ? (row?.unitIds ?? null) : null;
  const newAiFilter = buildNewAiFilter(view.newAiOnly, newAiUnitIds, newRows, suggestedTargetUnits);
  // 그 줄의 확정 전 AI 제안이 다른 New 문서에 있으면 New 칸은 그대로 두고 칸 머리 아래 알약으로 연다 - 연 뒤에는 보던 문서로 돌아가기
  const newAiDest = newAiUnitIds !== null && isAiRow ? aiDest : null;
  const newAiDocId = findDestinationDoc(newAiDest, writtenMap);
  const newAiPill = readNewAiPill({ isOn: view.newAiOnly, suggestionDocId: isNewDocOpen(newAiDocId) ? newAiDocId : null, openDocId: newDocId, returnDocId: newAiReturn?.key === toggleKey ? newAiReturn.docId : null });
  const newAiLinked = newAiDest?.kind === "link" ? writtenMap.get(newAiDest.targetIds[0]) : undefined;
  const newAiPlace = newAiDest === null ? null : newAiLinked ? { title: newAiLinked.doc_code, text: newAiLinked.section_path } : renderPlaceLabel(newAiDest);
  const newAiChip = (
    <>
      <button type="button" className="schip schip-btn new-ai-chip" data-tone="ai_suggested" aria-pressed={view.newAiOnly} data-testid="assign-new-ai-only" onClick={() => changeView({ newAiOnly: !view.newAiOnly })}>
        <Sparkles size={13} strokeWidth={1.75} className="flex-none" aria-hidden />
        <Truncate text={t("assign.newAi.only")} revealOnFocus />
      </button>
      {view.newAiOnly && newAiFilter === null && (
        <span className="pane-sub new-ai-hint" data-testid="assign-new-ai-hint">
          {t("assign.newAi.pick")}
        </span>
      )}
    </>
  );
  const newAiBanner = newAiPill ? (
    <div className="new-ai-row">
      <button
        type="button"
        className="new-ai-pill"
        data-kind={newAiPill.kind}
        data-testid="assign-new-ai-open"
        onClick={() => {
          setNewAiReturn(newAiPill.kind === "open" && newDocId !== null ? { key: toggleKey, docId: newDocId } : null);
          setManualNewDoc({ key: toggleKey, docId: newAiPill.docId });
        }}
      >
        {newAiPill.kind === "open" ? (
          <>
            <Truncate text={t("assign.newAi.elsewhere", { doc: newAiPlace?.title ?? "", place: newAiPlace?.text ?? "" })} revealOnFocus />
            <span className="flex-none">→ {t("assign.newAi.open")}</span>
          </>
        ) : (
          <Truncate text={t("assign.newAi.back", { doc: writtenDocs.find(([docId]) => docId === newAiPill.docId)?.[1] ?? composedDocs.find((doc) => doc.id === newAiPill.docId)?.code ?? "" })} revealOnFocus />
        )}
      </button>
    </div>
  ) : null;

  const oldDocOptions = oldDocs.map((doc) => ({ value: String(doc.id), label: doc.doc_code || doc.file_name }));
  // 한 단에서는 이미 쓴 New 문서도 같은 칸에서 고른다(그 파일의 문서 id) - 아직 쓰지 않은 New 문서는 엮은 미리 보기라 고칠 원문이 없다
  const writtenFiles = writtenDocs.flatMap(([targetDocId, code]) => {
    const fileId = (tobeData?.docs ?? []).find((doc) => doc.id === targetDocId)?.document_id ?? null;
    return fileId === null ? [] : [{ fileId, code }];
  });
  const paperDocOptions: SelectOption<string>[] = view.single
    ? [
        ...oldDocOptions,
        ...writtenFiles.map((file) => ({
          value: String(file.fileId),
          label: (
            <span>
              {file.code} <span className="text-ink-3">· {t("assign.solo.option")}</span>
            </span>
          ),
          triggerLabel: file.code,
          tip: file.code,
        })),
      ]
    : oldDocOptions;
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
  const highlightIds = new Set(isSolo ? soloUnits.map((unit) => unit.id) : (row?.unitIds ?? []));
  // 템플릿 보기에서 칠할 줄 - 고른 Old 줄에서 온 새 문장(짝이면 두 절반 모두)
  const templateSelected = new Set((composedDoc?.sections ?? []).flatMap((section) => section.items.filter((item) => item.source_unit_ids.some((id) => highlightIds.has(id))).map((item) => item.target_id)));
  const shownNewRows = isComposedDoc && shownComposed && shownComposed !== composedDoc ? buildComposedRows(shownComposed) : newRows;
  /** 엮은 문서 번호 칸의 C 번호 표시 - 글머리 기호는 깊이도(• 0 · ○ 1 · ▪ 2) */
  function pickComposedStyle(targetId: number, choice: ComposedStyleChoice) {
    const edits: CEdit[] = [...(choice.depth === null ? [] : [{ kind: "indent" as const, targetId, depth: choice.depth }]), { kind: "style", targetId, style: choice.style }];
    composedOrder.apply(edits);
  }
  // 클릭 배치의 자리 보기(MD 2 S3) - 기본 보기와 템플릿 보기가 같은 보기를 쓴다(두 절반의 같은 자리는 같은 보기라 함께 골라진 모양이 된다)
  let newPlace: NewPlaceSpots | null = null;
  const placeBySection = new Map<string, PlaceSpotView>();
  if (canPlaceClick && placeResolved && composedDoc && row) {
    const toView = (key: string, placement: Placement, spot: PlaceSpot, label: string): PlaceSpotView => ({
      key,
      open: placement.kind === "place",
      label: placement.kind === "refused" ? t(PLACE_REFUSAL_KEYS[placement.reason]) : label,
      picked: key === pickedSpotKey,
      onPick: (isMouse) => pickPlaceSpot(spot, key, isMouse),
    });
    const heads = new Map<string, PlaceSpotView>();
    for (const head of placeResolved.heads) {
      if (head.placement.kind === "none") continue;
      // 선언한 부록이 없는 9장은 놓을 수 있되 알린다(사용자 결정 C, 2026-11-18)
      const hint = head.placement.kind === "place" && head.placement.hint === "declare_appendix" ? t("template.drop.declareAppendix") : "";
      const view = toView(`s:${head.sectionKey}`, head.placement, { kind: "section", sectionKey: head.sectionKey }, hint);
      heads.set(head.rowKey, view);
      placeBySection.set(head.sectionKey, view);
    }
    const gaps = new Map<string, PlaceSpotView>();
    for (const gap of placeResolved.gaps) {
      if (gap.placement.kind === "none") continue;
      gaps.set(gap.key, toView(`g:${gap.key}`, gap.placement, gap.spot, gap.placement.kind === "place" ? formatGapLabel(gap.placement, t) : ""));
    }
    // 확정 전 AI 제안 줄 - 고른 줄의 것(mine)은 그 추천을 고르는 길, 다른 줄의 것은 누를 수 없다
    const aiLines = new Map<number, "mine" | "other">();
    for (const section of composedDoc.sections)
      for (const item of section.items) if (item.status === "ai_suggested") aiLines.set(item.target_id, item.source_unit_ids.some((id) => row.unitIds.includes(id)) ? "mine" : "other");
    newPlace = { heads, gaps, aiLines, aiOtherTip: t("assign.place.aiOther"), onPickAi: pickOwnAiLine };
  }
  /** 템플릿 보기의 자리 속성 - 칸 자리는 기본 보기와 같은 보기(WI 장은 그 단계의 instruction 칸), 앱이 만드는 것은 까닭, 다른 줄의 AI 제안 줄은 알림 */
  function readTemplateSpotProps(spot: TemplateSpot): SpotAttrs | undefined {
    if (!newPlace) return undefined;
    if (spot.kind === "line") return newPlace.aiLines.get(spot.targetId) === "other" ? { "data-place-tip": newPlace.aiOtherTip } : undefined;
    if (spot.kind === "fixed") return getSpotAttrs({ key: `f:${spot.what}`, open: false, label: t(PLACE_REFUSAL_KEYS[spot.what]), picked: false, onPick: () => undefined });
    const view = placeBySection.get(spot.sectionKey) ?? placeBySection.get(`${spot.sectionKey}:instruction`);
    return view ? getSpotAttrs(view) : undefined;
  }
  /** 템플릿 보기의 번호 줄 사이 틈 - 두 절반의 같은 자리(같은 의미 묶음 경계)는 기본 보기와 같은 틈 보기 */
  function renderTemplateGap(_sectionKey: string, prevId: number | null, nextId: number | null, lang: string): ReactNode {
    const key = newPlace && placeResolved ? readGapKey(placeResolved.blocks, prevId, nextId) : null;
    const view = key === null ? undefined : newPlace?.gaps.get(key);
    return view ? <PlaceGap view={view} testId={`assign-tpl-place-${lang}-${view.key}`} /> : null;
  }
  // 양 단에서 다듬으려고 고른 New 문장의 줄, 그리고 나눌 선이 놓인 줄
  const editTargetId = isNewEdit && soloUnit !== null ? (written.find((item) => item.new_unit_id === soloUnit.id)?.target_id ?? null) : null;
  const cutTargetId = isNewEdit && cutUnit !== null ? (written.find((item) => item.new_unit_id === cutUnit.id)?.target_id ?? null) : null;
  // 고른 New 문장 - 이을 문장, 또는 양 단에서 New 문장의 짝을 고르는 중이면 모은 문장
  const isNewPairPick = isNewEdit && pairSource !== null && pairFrom !== null;
  const pickedNew = new Set(isNewPairPick ? pairFrom.picked.flatMap((unitId) => written.find((item) => item.new_unit_id === unitId)?.target_id ?? []) : [...linkIds, ...(destination?.kind === "join" ? [destination.targetId] : [])]);
  // 확인이 남은 누락 의심 경고의 문단 - 용지의 그 줄에 표시한다. 위쪽 줄의 목록에서 확인하면(문서 목록을 다시 받아) 사라진다
  const warnBlockIds = new Set(listAckWarnings(docs.data ?? []).flatMap((item) => (item.docId === oldDocId && item.warning.acked_by === null && item.warning.block_id !== null ? [item.warning.block_id] : [])));
  // Shift로 고른 줄, 그리고 짝 고르기에서 모은 문장
  const pickedOld = new Set([...[...checked].flatMap((key) => rowMap.get(key)?.unitIds ?? []), ...(pairSource && pairFrom && !isNewEdit ? pairFrom.picked : [])]);
  // 짝 고르는 중의 안내 한 줄 - 고르는 문장이 있는 칸의 머리 아래에 둔다(Old 용지, 또는 양 단에서 New 문장을 다듬는 중이면 New 칸)
  const pairBanner = pairSource ? (
    <div className="flex items-center gap-2 border-b border-line bg-accent-tint px-3 py-1.5 text-xs" role="status" data-testid="assign-pair-pick">
      <Link2 size={14} strokeWidth={1.5} className="flex-none text-ink-2" aria-hidden />
      <span className="min-w-0 flex-1 text-ink" data-testid="assign-pair-pick-text">
        {pairFrom && pairFrom.picked.length > 0 ? t("assign.pairPicked", { id: pairSource.display_id, n: pairFrom.picked.length }) : t("assign.pairPick", { id: pairSource.display_id })}
      </span>
      {pairFrom && pairFrom.picked.length > 0 && (
        <button type="button" className="btn pri h-7 flex-none" data-testid="assign-pair-pick-run" disabled={busy} onClick={() => finishPairPick(pairFrom.picked)}>
          {t("assign.pairPickRun", { n: pairFrom.picked.length + 1 })} <kbd>↵</kbd>
        </button>
      )}
      <button type="button" className="btn ghost h-7 flex-none" data-testid="assign-pair-pick-cancel" onClick={() => setPairFrom(null)}>
        {t("common.cancel")} <kbd>Esc</kbd>
      </button>
    </div>
  ) : null;
  // 캡션 줄 고르는 중의 안내 한 줄 - Old 용지 머리 아래(짝 고르기 안내와 같은 자리, 함께 열리지 않는다)
  const captionBanner = captionPickBundle ? (
    <div className="flex items-center gap-2 border-b border-line bg-accent-tint px-3 py-1.5 text-xs" role="status" data-testid="assign-caption-pick">
      <MousePointerClick size={14} strokeWidth={1.5} className="flex-none text-ink-2" aria-hidden />
      <span className="min-w-0 flex-1 text-ink" data-testid="assign-caption-pick-text">{t("assign.captionPick", { id: captionPickBundle.display_id })}</span>
      <button type="button" className="btn ghost h-7 flex-none" data-testid="assign-caption-pick-cancel" onClick={() => setCaptionPick(null)}>
        {t("common.cancel")} <kbd>Esc</kbd>
      </button>
    </div>
  ) : null;
  const oldBanner = pairBanner ?? captionBanner;
  const placeOf = (unitIds: number[]) => {
    const decided = unitIds.map((id) => unitMap.get(id)).find((unit) => unit?.status === "confirmed");
    if (!decided) {
      // 아직 정하지 않은 줄의 AI 추천 - 확정 줄과 같은 자리, 보라 점선으로 갈린다
      const aiPlace = readAiPlace(unitIds);
      return aiPlace === null ? null : (
        <span className="strip-note is-ai" data-testid={`assign-ai-note-${unitIds[0]}`}>
          <Sparkles size={11} strokeWidth={1.75} aria-hidden />
          <span className="strip-note-text">{t("assign.aiNote", { place: aiPlace })}</span>
        </span>
      );
    }
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

  // Space 미리보기에 덮어 그릴 확정 전 고른 곳 - 새 SOP 칸 · WI 자리를 골랐고 아직 저장하지 않았을 때만(값은 서버에 보내지 않는다)
  const pendingPlace = draft.destination?.kind === "slot" || draft.destination?.kind === "slot_heading" || draft.destination?.kind === "step" ? draft.destination : null;
  const pendingDoc = pendingPlace ? (tobeData?.docs ?? []).find((doc) => doc.id === pendingPlace.docId) : undefined;
  const pendingOption = pendingPlace ? labelOptions.find((option) => option.id === getDestinationId(pendingPlace)) : undefined;
  // 문장마다의 변경 종류 - 결정 칸의 표시와 같은 규칙(구조 종류가 먼저, 아니면 글 비교 "=" / "수정")
  const readPendingChange = (slot: (typeof slots)[number]): ChangeType => readSlotKind(slot, slots) ?? previewSlotChange(slot, draft.texts[slot.key]);
  const isHeadingPick = pendingPlace?.kind === "slot_heading" || slots.length === 0;
  const spaceDraft =
    pendingDoc && pendingOption
      ? buildSheetDraft({
          docType: pendingDoc.doc_type,
          docCode: pendingDoc.code,
          docTitle: pendingDoc.title,
          place: pendingOption.label,
          // MD 1 브랜치 3 전에는 지금 글(번호 포함)을 쓴다
          texts: isHeadingPick ? rowUnits.map((unit) => unit.text) : slots.map((slot) => draft.texts[slot.key] ?? slot.text),
          changes: pendingPlace?.kind === "slot_heading" ? ["heading"] : slots.length === 0 ? ["as_is"] : slots.map(readPendingChange),
        })
      : undefined;



  return (
    <>
      <div className="assign-frame relative grid h-full min-h-0" data-testid="assign">
        {/* 절대 위치라 격자 칸을 차지하지 않는다 - 작업 화면 바닥에서 올라온다 */}
        <SpacePreview
          bundleId={bundleId}
          sheet={pickSpaceSheet(view.single)}
          enabled={isSpaceEnabled(pickSpaceSheet(view.single), { hasDoc: oldView !== null, unitCount: oldView?.units.length ?? 0, isNewEdit, rowCount: rows.length })}
          docId={oldDocId}
          docCode={oldView?.document.doc_code || oldView?.document.file_name || ""}
          reloadKey={`${unitsKey}:${oldView?.document.revision ?? ""}`}
          unitIds={spaceUnitIds}
          pickSeq={spacePickSeq}
          picked={row && rowUnits.length > 0 ? { id: rowUnits[0].display_id, text: rowUnits.map((unit) => unit.text).join(" ") } : null}
          draft={spaceDraft}
        />
        <div className="assign-desk">
          <AssignBar state={state} />
          {state.queueFailure !== null && <QueueFailure text={state.queueFailure} onRetry={state.retryCommand} onDiscard={state.discardCommands} />}
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
            <div ref={setPanes} className="assign-panes" data-single={view.single && !isPairView ? "" : undefined} data-pair-view={isPairView ? "" : undefined} style={{ "--split": `${view.split * 100}%` }}>
              {pairColumns ? (
              // Pair view - Old 칸·New 칸·이음 선 자리에 KO 칸 | 세로선 | EN 칸 | 짝 선. 세로선(폭)과 확대(왼쪽 Old 값, 오른쪽 New 값)는 그대로 쓴다
              <>
              <PairColumn
                side="ko"
                items={pairColumns.ko}
                docLabel={oldDocOptions.find((option) => option.value === String(oldView?.document.id))?.label}
                toggle={<PairViewToggle on onToggle={togglePairViewByButton} />}
                banner={oldBanner !== null && !isNewEdit ? oldBanner : null}
                selectedIds={highlightIds}
                pickedIds={pickedOld}
                statusOf={readMarkStatus}
                canDrag={isOldDrag}
                onUnitClick={handleOldClick}
                zoom={view.zoomOld}
                onZoom={(dir) => zoomPane("old", dir)}
              />
              <PaneDivider value={view.split} onCommit={(ratio) => changeView({ split: ratio })} onCollapse={() => changeView({ single: true })} />
              <PairColumn
                side="en"
                items={pairColumns.en}
                selectedIds={highlightIds}
                pickedIds={pickedOld}
                statusOf={readMarkStatus}
                canDrag={isOldDrag}
                onUnitClick={handleOldClick}
                zoom={view.zoomNew}
                onZoom={(dir) => zoomPane("new", dir)}
              />
              <PairLines links={pairLinks} focusIds={highlightIds} />
              </>
              ) : (
              <>
              <OldPane
                docOptions={paperDocOptions}
                docId={String(oldView?.document.id ?? solo?.docId ?? "")}
                docTitle={oldView?.document.title ?? ""}
                docTag={isSolo ? t("assign.writtenTag") : "Old"}
                docDash={
                  oldView ? (
                    <DocDashboard
                      bundleId={bundleId}
                      docId={oldView.document.id}
                      docLabel={oldView.document.doc_code || oldView.document.file_name}
                      docTitle={oldView.document.title}
                      stats={docDashboard}
                      bundleLine={{ done, total: rows.length, refs: refPendingIds.length, captions: captionPendingKeys.length }}
                      onOpenDoc={openNewDoc}
                      isDocOpen={isNewDocOpen}
                    />
                  ) : undefined
                }
                onDocChange={(value) => {
                  if (writtenFiles.some((file) => file.fileId === Number(value))) {
                    openSolo(Number(value));
                    return;
                  }
                  setSolo(null);
                  setManualOldDoc(Number(value));
                  clearRowPick();
                }}
                model={paperModel}
                fold={foldMatch && !isSolo ? { matchIds: foldMatch, open: foldOpen, onOpenChange: setFoldOpen } : undefined}
                foldEmpty={
                  isFoldEmpty
                    ? foldElsewhere.map((place) => ({ ...place, label: `${oldDocOptions.find((option) => option.value === String(place.docId))?.label ?? place.docId} · ${t(`split.tab.${place.part}`)} · ${place.count}` }))
                    : null
                }
                onFoldGo={(docId, part) => {
                  setManualOldDoc(docId);
                  clearRowPick();
                  setManualPart({ key: "", part });
                }}
                placeholder={<span className="sk h-[480px] w-full" />}
                selectedId={mode === "old" && !isNewEdit ? (cutUnit?.id ?? pickedId ?? soloUnit?.id ?? null) : null}
                highlightIds={mode === "old" ? highlightIds : NO_NUMBERS}
                // 떨어진 짝 안내 줄 - 누르면 짝의 원래 자리로 가 그 박스를 고른다(설계 D3)
                pairHint={mode === "old" && !isNewEdit ? { onGo: goToUnit } : undefined}
                single={view.single}
                // 짝 카드 안 순서 손잡이 - 고른 박스가 짝 전부가 이어 붙은 카드 안이면(설계 D8)
                pairGrip={pairGrip}
                // 삭제로 확정한 줄의 접힌 한 줄 - 한 단으로 연 New 문서에는 줄이 없다
                deleted={isSolo ? undefined : { folds: deletedFolds }}
                pickedIds={pickedOld}
                warnBlockIds={warnBlockIds}
                statusOf={readMarkStatus}
                renderNote={placeOf}
                // 삭제·이동한 묶음, 이미 쓴 New 문서(혼자 연 문서)의 묶음과 그 문서에 이은 묶음(입구 2 - 캡션을 그 문서가 정한다)은 캡션이 필요 없다
                isCaptionNeeded={(unitId, hasCaption) => isBundleCaptionNeeded(unitMap.get(unitId), hasCaption, isLinkedToWritten(unitId))}
                // 저절로 삭제된 줄(목차 · 본문 앞부분 · 개정 이력)은 Old 문서에서만 흐린 블록으로 접는다(MD 1 F6 · 쪼개기 먼저 §7 R3). 사유 쓰기 · 삭제 취소는
                // 다듬는 원문이 그 Old 문서일 때만 - New 문장을 고치는 동안은 접고 펴기만
                noise={
                  isSolo
                    ? undefined
                    : {
                        canEdit: canEdit && !isNewEdit,
                        // 처리 중인 블록만 꺼진다(용지가 잠긴 Unit으로 본다) - 묶음 전체 일 동안은 모두
                        busy: isGlobalPending,
                        onClear: (unitIds) => {
                          if (oldView) clearNoise(oldView.document.id, unitIds);
                        },
                        onReason: (unitIds) => {
                          if (oldView) openNoiseReason(oldView.document.id, unitIds);
                        },
                        open: tocOpen,
                        selected: tocPick !== null && tocPick.docId === oldView?.document.id ? tocPick : null,
                        onToggle: (key) => setTocOpen((open) => toggleTocOpen(open, key)),
                        onPick: (key, unitId) => {
                          if (oldView) selectToc(oldView.document.id, key, unitId, false);
                        },
                      }
                }
                // 제목에서 바꾼 조항 묶음 머리(F8b) - 되돌리기는 다듬는 원문이 그 Old 문서일 때만
                headingShift={isSolo ? undefined : { canRevert: canEdit && !isNewEdit, busy: isGlobalPending, onRevert: revertHeadings }}
                // 벗긴 표의 줄 묶음 머리 "↺ 다시 표로"(F1) - 다듬는 원문이 그 Old 문서일 때만
                unwrap={isSolo ? undefined : { canRewrap: canEdit && !isNewEdit, busy: isGlobalPending, onRewrap: rewrapTable, ai: canEdit && !isNewEdit ? unwrapAi : undefined }}
                // 처리 중인 일 - 누르는 즉시 그 자리 알약과 박스 쉬머, 그 박스만 잠근다(설계 D4)
                pending={mode === "old" ? paperPending : undefined}
                paneRef={oldPaneRef}
                renderPills={(unitId) => {
                  const targets = linkedTargets.get(unitId);
                  return targets ? <LinkBadge unitId={unitId} targets={targets} currentDocId={newDocId} onJump={(_unitId, targetId) => showInNew(targetId)} /> : null;
                }}
                partKeys={partKeys}
                activePart={activePart}
                sheets={oldView && paperModel && activePart !== "body" ? listPartSheets(oldView, paperModel, activePart) : null}
                onPartChange={(part) => setManualPart({ key: activeKey ?? "", part })}
                // 묶음째 고르는 것은 배정 때만 - 짝 고르기(칸 문장끼리도 짝을 맺는다)와 쓴 New 문서 다듬기(배정이 없다)는 칸 문장을 그대로 고른다
                pickWholeBundle={!isSolo && !(pairSource && pairFrom && !isNewEdit)}
                onUnitClick={handleOldClick}
                onUnitContextMenu={(unitId, at, caret) => openCtxMenu(unitId, at, caret)}
                onUnitDoubleClick={canEdit ? handleOldDoubleClick : undefined}
                // 번호 칸 - 원문 글자는 그대로 두고 번호 범위만 바꾸는 쪼개기 편집이라 줄의 배정은 그대로다
                numberCell={
                  canEdit && mode === "old" && !isNewEdit && !isSolo
                    ? {
                        // 그 줄이 처리 중이면 용지가 그 번호 칸만 끈다
                        busy: isGlobalPending,
                        expected: expectedNumbers,
                        handleRef: registerNumberHandle,
                        onSave: (unitId, number, follow, indentShift) =>
                          runUnitEdit({ type: "set_number", unit_id: unitId, number, follow, ...(indentShift === undefined ? {} : { indent_shift: indentShift }) }, number === null ? t("assign.number.didClear") : t("assign.number.didSet", { n: number }), unitId),
                        // 들여쓰기는 두 번 저장한다(B8 7-a) - 누른 줄, 이어져 함께 바뀐 줄. Ctrl+Z 한 번이 함께 바뀐 줄만 되돌린다(같은 문서 쓰기는 차례로 간다)
                        onIndent: (plan, delta, label) => {
                          const toItem = (change: IndentChange) => ({ unit_id: change.unitId, indent_shift: change.indentShift });
                          const unitId = plan.clicked.unitId;
                          runUnitEdit({ type: "set_indents", units: [toItem(plan.clicked)] }, t(delta < 0 ? "assign.number.didOutdent" : "assign.number.didIndent", { id: label }), unitId);
                          if (plan.batch.length > 0) {
                            const done = t(delta < 0 ? "assign.number.didOutdentMore" : "assign.number.didIndentMore", { id: label, n: plan.batch.length });
                            runUnitEdit({ type: "set_indents", units: plan.batch.map(toItem) }, done, unitId);
                          }
                        },
                      }
                    : undefined
                }
                onRangeSelect={
                  canEdit && mode === "old" && oldView
                    ? (range) => {
                        // 저절로 삭제된 줄의 글자는 떼어 내지 않는다(서버 toc_line_locked) - 먼저 삭제 취소
                        if (!hasTocLineIn(oldView.units, range.blockId)) setCarvePick({ docId: oldView.document.id, ...range });
                      }
                    : undefined
                }
                banner={
                  oldBanner !== null && !isNewEdit ? (
                    oldBanner
                  ) : carve && (
                    <div className="flex items-center gap-2 border-b border-line bg-accent-tint px-3 py-1.5 text-xs" role="status" data-testid="assign-carve">
                      <span className="flex-none font-semibold text-ink">{t("split.carve")}</span>
                      <Truncate className="min-w-0 flex-1 text-ink-2" text={carveText} testId="assign-carve-text" />
                      <button
                        type="button"
                        className="btn h-7 flex-none"
                        data-testid="assign-carve-run"
                        disabled={busy}
                        onClick={() => {
                          const op: EditOp = { type: "carve", block_id: carve.blockId, start: carve.start, end: carve.end };
                          clearCarve();
                          runUnitEdit(op, t("split.didCarve"), null);
                        }}
                      >
                        <SquarePlus size={14} strokeWidth={1.5} aria-hidden />
                        {t("split.carveRun")}
                      </button>
                      <button type="button" className="btn ghost icon h-7 w-7 flex-none" aria-label={t("common.cancel")} data-testid="assign-carve-cancel" onClick={clearCarve}>
                        <X size={14} strokeWidth={1.5} aria-hidden />
                      </button>
                    </div>
                  )
                }
                cut={isNewEdit ? null : cutLine.cut}
                onCutDrag={canEdit ? cutLine.drag : undefined}
                onCutNudge={canEdit ? cutLine.nudge : undefined}
                renderAtCut={() => <CutPop busy={busy} onRun={splitAtCut} onCancel={cutLine.clear} testIdPrefix="assign" />}
                join={canEdit && mode === "old" ? { busy: isGlobalPending, plan: planOldJoin, onJoin: joinOld } : undefined}
                renderUnitActions={renderOldActions}
                figureSource={oldView ? { bundleId, docId: oldView.document.id } : undefined}
                zoom={view.zoomOld}
                onZoom={(dir) => zoomPane("old", dir)}
                dragBoxes={isOldDrag}
                headExtra={canPairView ? <PairViewToggle on={false} onToggle={togglePairViewByButton} /> : undefined}
                figures={state.figureTab}
              />
              {!view.single && (
              <>
              <PaneDivider value={view.split} onCommit={(ratio) => changeView({ split: ratio })} onCollapse={() => changeView({ single: true })} />
              {newDocId === null ? (
                <NewPaneEmpty zoom={view.zoomNew} onGoToBe={() => navigate(getNewDocumentsHref(bundleId))} />
              ) : (
                <>
                  <NewPane
                    lineActions={menuLineId !== null ? { targetId: menuLineId, node: renderLinkMenu(true) } : joinLineId !== null ? { targetId: joinLineId, node: renderJoinMenu(true) } : null}
                    bundleId={bundleId}
                    docOptions={newDocOptions}
                    docId={String(newDocId)}
                    onDocChange={(value) => setManualNewDoc({ key: toggleKey, docId: Number(value) })}
                    rows={shownNewRows}
                    headingNotes={headingNotes}
                    sectionMarks={sectionMarks}
                    rowsKey={isComposedDoc && !composedDoc ? `${newDocId}:loading` : String(newDocId)}
                    tag={isComposedDoc ? t("assign.composedTag") : t("assign.writtenTag")}
                    onEditOriginal={!isComposedDoc && newFileId !== null ? () => openSolo(newFileId) : undefined}
                    readOnly={isComposedDoc}
                    joinableIds={joinableIds}
                    onJoinPick={handleJoinPick}
                    live={liveDoc && liveDoc.docId === newDocId ? { seq: liveDoc.seq, targetIds: liveDoc.targetIds } : null}
                    onReveal={(el, flash) => {
                      revealElement(el);
                      if (flash) flashElement(el);
                    }}
                    candidateIds={candidateIds}
                    pickedIds={pickedNew}
                    focusId={focusNew}
                    shapeId={editTargetId}
                    onShape={canEdit && mode === "old" && !isComposedDoc ? openNewCtxMenu : undefined}
                    cut={isNewEdit && cutUnit !== null && cutLine.at !== null && cutTargetId !== null ? { targetId: cutTargetId, at: cutLine.at } : null}
                    cutPop={<CutPop busy={busy} onRun={splitAtCut} onCancel={cutLine.clear} testIdPrefix="assign" />}
                    onCutDrag={canEdit && isNewEdit ? cutLine.dragTo : undefined}
                    banner={isNewEdit ? pairBanner : newAiBanner}
                    sourceLabel={(unitId) => (unitMap.get(unitId)?.display_id ?? String(unitId)).replace(/^OLD-/, "")}
                    onPick={handleNewPick}
                    onJumpSource={jumpToOld}
                    zoom={view.zoomNew}
                    onZoom={(dir) => zoomPane("new", dir)}
                    linesOn={view.lines}
                    onToggleLines={() => changeView({ lines: !view.lines })}
                    draft={newDraft}
                    draftSlotKey={draftSlotKey}
                    headExtra={
                      <>
                        {unsourcedChip}
                        {newAiChip}
                      </>
                    }
                    aiFilter={newAiFilter}
                    place={newPlace}
                    cellLink={isComposedDoc ? null : { pickable: canEdit && mode === "old" && row !== null, droppable: isOldDrag, onUnlink: canEdit && mode === "old" ? (cellId, unitId) => state.unlinkCell(cellId, unitId) : undefined }}
                    composed={
                      isComposedDoc && composedStrips
                        ? {
                            strips: composedStrips,
                            selectedIds: templateSelected,
                            order:
                              canEdit && shownComposed
                                ? {
                                    doc: shownComposed,
                                    busy: composedOrder.busy,
                                    pendingIds: composedOrder.pendingIds,
                                    onPlace: (edit, note) => void composedOrder.place(edit, t("assign.composedOrder.moved", { place: note })),
                                    onStyle: pickComposedStyle,
                                  }
                                : null,
                            ops:
                              canEdit && mode === "old"
                                ? {
                                    cut: state.composedCut,
                                    cutPop: <CutPop busy={busy} onRun={state.splitComposedAtCut} onCancel={() => state.setComposedCutAt(null)} testIdPrefix="assign" />,
                                    onDoubleClick: state.handleComposedDoubleClick,
                                    onCutDrag: state.dragComposedCut,
                                    plan: state.planComposedGap,
                                    onJoin: state.joinComposed,
                                    busy: isAnyPending,
                                  }
                                : null,
                          }
                        : null
                    }
                    viewSwitch={
                      isComposedDoc && composedDoc && templateTitles
                        ? {
                            template: view.newTemplate,
                            onChange: (template) => changeView({ newTemplate: template }),
                            body: (
                              <TemplateView
                                doc={shownComposed ?? composedDoc}
                                titles={templateTitles}
                                selectedIds={templateSelected}
                                onPickLine={pickTemplateLine}
                                onMissing={canEdit ? fillTemplateMissing : undefined}
                                spotProps={newPlace ? readTemplateSpotProps : undefined}
                                renderGap={newPlace ? renderTemplateGap : undefined}
                                renderBlock={(item) => (
                                  <NewBundle kind={item.kind === "figure" ? "figure" : "table"} table={item.table} figure={item.figure} caption={item.caption} renumber={item.renumber ?? null} captionRequired bundleId={bundleId} testId={`assign-new-tpl-block-${item.target_id}`} />
                                )}
                                testId="assign-new-tpl"
                              />
                            ),
                          }
                        : null
                    }
                  />
                  <LinkLines pairs={listNewAiLinks(linkPairs, newAiFilter, row?.unitIds ?? [])} focusUnits={highlightIds} focusTargets={liveDoc ? new Set([...pickedNew, ...liveDoc.targetIds]) : pickedNew} visible={view.lines} />
                </>
              )}
              </>
              )}
              </>
              )}
            </div>
          )}
        </div>
        <SideFloat prefs={view} onChange={changeView} onPress={handleSidePress}>
          {(headEnd) => (
            <>
              <AssignSidePanel state={state} headEnd={headEnd} />
              <AssignHelp />
            </>
          )}
        </SideFloat>
      </div>
      {joinLineId === null && renderJoinMenu(false)}
      {menuLineId === null && renderLinkMenu(false)}
      {ctxMenu && ctxGroups && (
        <AssignContextMenu
          key={ctxMenu.seq}
          anchor={ctxMenu.anchor}
          readCover={() => (rowMap.get(ctxMenu.rowKey)?.unitIds ?? []).flatMap((id) => [...document.querySelectorAll<HTMLElement>(`[data-testid="assign-paper-piece-${id}"]`)])}
          click={ctxMenu.click}
          groups={ctxGroups}
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
          testId="assign-identical-modal"
          onConfirm={() => confirmIdenticalAll()}
          onClose={() => setConfirmingIdentical(false)}
        />
      )}
      {state.isLeftoverOpen && (
        <LeftoverTranslations
          items={state.leftovers}
          busy={isAnyPending}
          onSettle={(item, action) => state.settleTranslations([item], action)}
          onGo={state.goToTranslation}
          onClose={() => state.setLeftoverSheet(false)}
        />
      )}
      {acceptKind && (
        <AcceptSuggestionsModal
          bundleId={bundleId}
          kind={acceptKind}
          document={acceptDoc}
          onAccept={(ids, reason) => acceptAll(acceptKind, ids, reason)}
          onClose={() => setAcceptKind(null)}
        />
      )}
      {editConfirm && (
        <ConfirmModal
          {...describeEditConfirm(editConfirm)}
          testId="assign-edit-confirm"
          onConfirm={state.answerEditConfirm}
          onClose={state.cancelEditConfirm}
        />
      )}
      {resetScope && bundle && (
        <ResetModal
          bundleId={bundleId}
          scope={resetScope}
          revision={bundle.revision}
          onRun={(revision) => state.runReset(resetScope, revision)}
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
          onClose={state.closeRemark}
          onConfirm={state.confirmRemark}
        />
      )}
      {remarkEdit?.kind === "noise" && (
        <RemarkModal
          title={t("assign.noise.modalTitle")}
          initial={remarkEdit.initial}
          requiredMessage={null}
          intro={<p className="text-xs text-ink-2">{t(remarkEdit.isMixed ? "assign.noise.modalMixed" : "assign.noise.modalIntro", { n: remarkEdit.unitIds.length })}</p>}
          confirmLabel={t("common.save")}
          testId="assign-noise-modal"
          onClose={state.closeNoiseReason}
          onConfirm={state.confirmNoiseReason}
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
            // 이미 누른 판단은 버리지 않는다 - 큐가 떠난 뒤에도 마저 보낸다
            navigate(href, { immediate: true });
          }}
          onClose={() => setLeaveTo(null)}
        />
      )}
      {bulk && (
        <BulkModal
          count={pickedOld.size}
          onClose={() => setBulk(null)}
          onConfirm={(bulkReason) => state.runBulkDelete([...pickedOld], bulkReason)}
        />
      )}
    </>
  );
}




interface BulkModalProps {
  count: number;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}

function BulkModal({ count, onClose, onConfirm }: BulkModalProps) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  return (
    <Modal
      title={t("classify.bulkDeleteTitle")}
      onClose={onClose}
      testId="assign-bulk-modal"
      footer={
        <>
          <button type="button" className="btn" data-testid="assign-bulk-cancel" onClick={onClose}>
            <X size={16} strokeWidth={1.5} aria-hidden />
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="btn danger"
            data-testid="assign-bulk-confirm"
            onClick={() => onConfirm(reason.trim())}
          >
            <Trash2 size={16} strokeWidth={1.5} aria-hidden />
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
          placeholder={t("remark.blankDelete")}
          value={reason}
          maxLength={REMARK_MAX_LENGTH}
          autoFocus
          onChange={(event) => setReason(event.target.value)}
        />
      </label>
      <RecentRemarks testId="assign-bulk-recent" onPick={setReason} />
    </Modal>
  );
}