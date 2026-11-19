// 3단계 Assign - Old 조각을 한 줄씩(한/영 짝은 함께) 보낼 곳을 정한다. 보낼 곳은 이미 쓴 New 문서의 문장(옛 짝 맞추기)이거나
// 아직 안 쓴 To-Be 문서의 칸(옛 분류), 또는 삭제·외부 이동이다. 가운데는 Old 원문(Split 조각이 곧 목록) ‖ New 원문,
// 오른쪽은 고른 곳·확정·우선순위 아코디언이다(설계 docs/superpowers/specs/2026-11-09-assign-unified-design.md).
// 보기는 둘이다 - 양 단(Old ‖ New)과 한 단(Old 문서 하나만 넓게, 설계 2026-11-15-assign-merge-documents-design.md §3.1). 한 단에서는 New 칸·세로선·연결선을 그리지 않는다.
// 상태 · 데이터 · 동작은 use-assign-page.tsx의 useAssignPage()에 있고, 이 파일은 그리기만 한다(쪼개기 1단계).
"use client";

import { ArrowDown, ArrowUp, BookMarked, Captions, Check, Columns2, ExternalLink, FileCheck2, FilePen, FileUp, FolderOutput, Inbox, Link2, ListTree, Locate, MapPin, MoveRight, Redo2, RefreshCw, Sparkles, Square, SquarePlus, Trash2, TriangleAlert, Undo2, WandSparkles, X } from "lucide-react";
import Link from "next/link";
import { Fragment, useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";
import { AssignContextMenu } from "@/components/assign/assign-context-menu";
import { AssignHelp } from "@/components/assign/assign-help";
import { DestCard } from "@/components/assign/dest-card";
import { DestinationAccordion, type AccordionSection } from "@/components/assign/destination-accordion";
import { DestinationTree } from "@/components/assign/destination-tree";
import { MissingWarnings } from "@/components/assign/missing-warnings";
import { CaptionRefList } from "@/components/assign/caption-ref-list";
import { CaptionSlot } from "@/components/assign/caption-slot";
import { RefCard } from "@/components/assign/ref-card";
import { ShapeTools } from "@/components/assign/shape-tools";
import { SplitSuggestionCard } from "@/components/assign/split-suggestion";
import { ChangeKindChip, ChangeKindToggle } from "@/components/assign/change-kind-toggle";
import { LinkChoice } from "@/components/assign/link-choice";
import { AssignMoreMenu } from "@/components/assign/more-menu";
import { PendingCount } from "@/components/assign/pending-count";
import { LinkLines } from "@/components/assign/link-lines";
import { JoinMenu } from "@/components/assign/join-menu";
import { getSpotAttrs, PlaceGap, type PlaceSpotView, type SpotAttrs } from "@/components/assign/place-spot";
import { LinkMenu } from "@/components/assign/link-menu";
import { LinkBadge } from "@/components/assign/link-badge";
import { MoveTargetField } from "@/components/assign/move-target-field";
import { NewBundle } from "@/components/assign/new-bundle";
import { NewPane, NewPaneEmpty, type NewPlaceSpots } from "@/components/assign/new-pane";
import { DocDashboard } from "@/components/assign/doc-dashboard";
import { OldPane } from "@/components/assign/old-pane";
import { PairColumn, PairViewToggle } from "@/components/assign/pair-column";
import { PairLines } from "@/components/assign/pair-lines";
import { PaneDivider } from "@/components/assign/pane-divider";
import { RecentRemarks, REMARK_MAX_LENGTH, RemarkLine, RemarkModal } from "@/components/assign/remark-modal";
import { SpacePreview } from "@/components/assign/space-preview";
import { ResetModal } from "@/components/assign/reset-modal";
import { Modal } from "@/components/modal";
import { ReadOnlyNote } from "@/components/read-only-note";
import { TemplateView, type TemplateSpot } from "@/components/template/template-view";
import { CutPop } from "@/components/paper/cut-pop";
import { LangToken } from "@/components/paper/lang-token";
import { FilterChip, UnitStatusChip } from "@/components/status";
import { ClampText } from "@/components/ui/clamp-text";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { AcceptSuggestionsModal } from "@/components/assign/accept-suggestions-modal";
import { CounterpartModal } from "@/components/assign/counterpart-modal";
import { EmptyState } from "@/components/ui/empty-state";
import { BundleLoadError } from "@/components/bundle-load-error";
import { flashElement, Truncate } from "@/components/ui/motion";
import { showToast } from "@/components/ui/toast";
import { Tooltip } from "@/components/ui/tooltip";
import { humanizeApiError } from "@/lib/api-errors";
import { getSectionKey } from "@/lib/assign-drop-model";
import { formatGapLabel, formatPlacePosition, PLACE_REFUSAL_KEYS, readGapKey, readPlacePosition, type Placement, type PlaceSpot } from "@/lib/place-spot-model";
import { listAckWarnings } from "@/lib/missing-warnings-model";
import { bulkDecide, type ChangeType, type EditOp, type UnitRow, type ViewUnit, type WrittenSentence } from "@/lib/api-sop";
import { isBundleCaptionNeeded, isBundleKind, listCaptionFields } from "@/lib/caption-model";
import { buildCaptionSlot, type CaptionCandidate } from "@/lib/caption-slot-model";
import { countJoinedLines } from "@/lib/join-sentence-model";
import { addPartnerTargets, canMakeOtherLanguage, isRecommendationPicked, listCoConfirmed, listLinkMenuItems, listSiblingPlaces, listUnlinkRemainder, pickNearby, type LinkMenuItem, type Recommendation } from "@/lib/assign-model";
import { readRewrites } from "@/lib/ai-suggestion-model";
import { readOtherHalf } from "@/lib/counterpart-model";
import { loadBundle } from "@/lib/bundle-store";
import { getDestinationId, hasRowLanguage, isHeadingSourceUnit, isPlaceOption, listTreeOptions, listTreeRows, isSentenceUnit, isTextChangeType, isTranslationOf, listJoinedTargetIds, listLinkLeftovers, pickLinkUnits, readCheckKey, readLinkDefault, readSlotKind, type Destination, type DestinationOption } from "@/lib/classify-model";
import { formatKst } from "@/lib/datetime";
import { useI18n } from "@/lib/i18n";
import { navigate } from "@/lib/nav-buffer";
import { buildNewAiFilter, listNewAiLinks, readNewAiPill } from "@/lib/new-ai-filter-model";
import { buildSheetDraft } from "@/lib/space-preview-model";
import { findNearestCut, hasTocLineIn, listPartSheets } from "@/lib/paper-model";
import { getNewDocumentsHref, getStageHref } from "@/lib/stages";
import { readRefAdvice } from "@/lib/ref-model";
import { buildTocBlock, describeTocParts, toggleTocOpen } from "@/lib/toc-block-model";
import { type SelectOption } from "@/components/ui/select";

import { useAssignPage, FILTERS, FILTER_ICON, SYSTEM_HOLDS, NO_NUMBERS, findDestinationDoc, readMenuCover, revealElement } from "./use-assign-page";

export default function AssignPage() {
  const {
    t, bundleId, bundle, canEdit, docs, oldDocs, oldDocIds, views, unitsKey, setUnitsKey, units, tobe, tobeData, writtenList, identical,
    aiJobs, aiOn, aiBusy, suggestions, invalidUnitIds, readMarkStatus, suggestedTargetUnits, unitMap, written, writtenMap, rows, rowMap,
    rowOfUnit, options, ready, showSkeleton, unsourced, mode, setMode, filter, counts, foldOpen, setFoldOpen, applyFilter, foldMatch,
    setSelectedKey, activeKey, row, solo, setSolo, isSolo, isNewEdit, hasSolo, tocOpen, setTocOpen, tocPick, tocBlocks, checked,
    setChecked, newRemarks, setNewRemarks, menu, setMenu, joinMenu, setJoinMenu, ctxMenu, setCtxMenu, cutUnitId, focusNew, groupData,
    setDrafts, draft, editing, groupPending, savedDestination, destination, rowUnits, rowLangs, firstDecision, systemHold, reasonNow,
    moveCode, setDraft, unsavedCount, leaveTo, setLeaveTo, rowLive, aiDest, aiWhy, isAiRow, recommendations, linkIds, pickedGroups,
    saveGroupData, candidateIds, aiPending, viewOf, setManualOldDoc, oldView, acceptKind, setAcceptKind, acceptDoc, paperModel,
    canPairView, isPairView, pairColumns, pairLinks, partKeys, oldDocId, splitByUnit, shapeView, shapeModel, soloUnit, soloUnits, cutUnit,
    cutLine, linkedTargets, setManualPart, activePart, isFoldEmpty, foldElsewhere, writtenDocs, composedDocs, setManualNewDoc, toggleKey,
    liveDoc, isNewDocOpen, newDocId, newAiReturn, setNewAiReturn, isComposedDoc, newFileId, composedDoc, newRows, headingNotes,
    sectionMarks, joinableIds, templateTitles, linkPairs, view, changeView, zoomPane, setPanes, askAiScope, aiMenuItems, remarkEdit,
    setRemarkEdit, focusAfterRef, firstTextRef, busy, editConfirm, setEditConfirm, counterpartAsk, setCounterpartAsk, oldPaneRef,
    undoState, buildUndo, markRecorded, bulk, setBulk, confirmingIdentical, setConfirmingIdentical, resetScope, setResetScope, accOpen,
    toggleAcc, saveUnits, slots, aiUnfilled, draftPlace, draftSectionKey, draftPosition, newDraft, draftSlotKey, placeResolved,
    canPlaceClick, pickedSpotKey, setCarvePick, carve, carveText, clearCarve, togglePairViewByButton, pairFrom, setPairFrom, setRefEntryId,
    pairSource, selectToc, selectRow, openNewCtxMenu, openSolo, goToUnit, moveRow, hasUnitDraft, isFixedCaption, ctxGroups, rowViewUnits,
    rowSplitUnit, rowSplit, splitBlocked, rowRefUnit, refBlocked, isRefGate, isCaptionGateOn, confirmBlockKey, rowCaptionRefs,
    refCandidates, shapeLines, slotPlaces, slotBlockKinds, shapeMode, headingBack, rewrap, bandBack, stepBase, refPendingIds,
    isLinkedToWritten, captionPendingKeys, docDashboard, refDetail, refInfo, openCtxMenu, runUnitEdit, confirmCounterpart, rewrapTable,
    describeEditConfirm, clearToc, runCaptionRefChange, switchShapeMode, switchToPair, applySplitSuggestion, dismissSplitSuggestion,
    splitPendingIds, readPendingItem, selectNextSplit, selectNextRef, selectNextCaption, splitAtCut, handleOldDoubleClick, runCtx,
    runUnitAction, revertHeadings, planOldJoin, joinOld, renderOldActions, readReasonNeed, runSave, runClear, runUndoStep,
    confirmIdenticalAll, acceptAll, markNew, placeManage, pickDestination, pickNewSentence, handleNewPick, handleJoinPick, readJoinAfter,
    pickJoinMenu, pickPlaceSpot, pickOwnAiLine, jumpToNew, openNewDoc, showInNew, jumpToOld, pickTemplateLine, fillTemplateMissing,
    isTemplateDrag, isOldDrag, finishPairPick, handleOldClick, handlePrimary, startEdit, handlePickClickCapture, pickRecommendation,
    markRecHover, revealPick, setRevealPick, done,
  } = useAssignPage();



  // --- 그리기 ---
  const isPlace = destination?.kind === "slot" || destination?.kind === "step";
  const primaryState = !destination ? "choose" : editing ? "save" : "confirm";
  // 줄에 이미 그 언어 새 문장이 있으면(직접 쓴 것·쓰는 중인 칸·AI 번역) 만들기·쓰기를 보이지 않는다
  const missingLang = canMakeOtherLanguage(rowLangs, savedDestination, row?.status === "confirmed");
  const otherLang = missingLang !== null && !hasRowLanguage(missingLang, slots, groupData, row?.unitIds ?? []) ? missingLang : null;
  // 직접 쓰는 다른 언어 문장의 출처 - 줄의 글 단위(문장·제목·묶이지 않은 칸 문장. 표·그림은 칸 문장을 따로 쓰지 않는다)
  const writeOtherUnit = rowUnits.find((unit) => isSentenceUnit(unit.kind))?.unit_id ?? null;

  /** 다른 언어 직접 쓰기 - 고쳐 쓰기로 들어가 빈 칸 하나를 더하고 그 칸에 포커스 */
  function startWriteOther(lang: "ko" | "en", unitId: number) {
    setDraft({ otherLang: { lang, unitId } }, true);
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(`[data-testid="assign-text-x${unitId}"]`)?.focus());
  }

  function renderPlaceLabel(dest: Destination): { title: string; text: string } {
    const option = options.find((item) => getDestinationId(item.destination) === getDestinationId(dest));
    return { title: option?.docCode ?? "", text: option?.label ?? "" };
  }

  /** 고른 곳이 New 칸에 그려진 상자 - 잇기는 그 문장(짝 포함), 엮은 문서의 칸·step은 그 칸의 줄(비었으면 빈 칸 자리). 지금 칸에 없으면 빈 목록 */
  function listDestinationEls(dest: Destination): HTMLElement[] {
    const find = (id: number) => document.querySelector<HTMLElement>(`[data-pane="new"] [data-testid="assign-new-${id}"]`);
    let els: (HTMLElement | null)[] = [];
    if (dest.kind === "link") els = addPartnerTargets(dest.targetIds, writtenMap).map(find);
    else if (dest.kind === "join") els = composedDoc?.target_doc_id === dest.docId ? [find(dest.targetId)] : [];
    else if ("docId" in dest && composedDoc?.target_doc_id === dest.docId) {
      const key = dest.kind === "step" ? getSectionKey(dest) : dest.slotKey;
      const section = composedDoc.sections.find((item) => item.location_key === key);
      if (section && section.items.length > 0) els = section.items.map((item) => find(item.target_id));
      else if (section) els = [document.querySelector<HTMLElement>(`[data-pane="new"] [data-testid="assign-new-slot-${CSS.escape(section.location_key)}"]`)];
    }
    return els.filter((el): el is HTMLElement => el !== null);
  }

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

  function renderRecommendation(rec: Recommendation, index: number) {
    const pressed = isRecommendationPicked(draft.destination, rec.destination, writtenMap);
    const pending = pressed ? t("assign.unsaved") : undefined;
    const chip = <span className="dest-chip" data-source={rec.source}>{t(`assign.src.${rec.source}`)}</span>;
    const why = rec.why ? <span className="dest-card-why">{rec.why}</span> : null;
    if (rec.destination.kind === "link") {
      const targets = rec.destination.targetIds.map((id) => writtenMap.get(id)).filter((item): item is WrittenSentence => item !== undefined);
      const section = targets[0]?.section_path;
      return (
        <DestCard
          key={rec.key}
          icon={Link2}
          tone="link"
          title={
            <>
              <b>{targets[0]?.doc_code}</b> · {t("assign.chosen.link")}
            </>
          }
          text={targets.map((item) => item.text).join(" / ")}
          foot={
            <>
              {section && <span className="dest-card-sec">§ {section}</span>}
              {chip}
              {why}
            </>
          }
          pressed={pressed}
          pending={pending}
          testId={`assign-rec-${index}`}
          onClick={() => pickRecommendation(rec)}
          onHover={(on) => markRecHover(on ? listDestinationEls(rec.destination) : [])}
        />
      );
    }
    if (rec.destination.kind === "delete" || rec.destination.kind === "move") {
      const isDelete = rec.destination.kind === "delete";
      return (
        <DestCard
          key={rec.key}
          icon={isDelete ? Trash2 : MoveRight}
          tone="danger"
          title={t("assign.acc.move")}
          text={t(isDelete ? "classify.deleted" : "classify.moved")}
          foot={
            <>
              {chip}
              {why}
            </>
          }
          pressed={pressed}
          pending={pending}
          testId={`assign-rec-${index}`}
          onClick={() => pickRecommendation(rec)}
          onHover={(on) => markRecHover(on ? listDestinationEls(rec.destination) : [])}
        />
      );
    }
    const label = renderPlaceLabel(rec.destination);
    return (
      <DestCard
        key={rec.key}
        icon={MapPin}
        title={
          <>
            <b>{label.title}</b> · {t(rec.destination.kind === "slot_heading" ? "assign.slotHeading" : "assign.chosen.place")}
          </>
        }
        text={label.text}
        foot={
          <>
            {chip}
            {why}
          </>
        }
        pressed={pressed}
        pending={pending}
        testId={`assign-rec-${index}`}
        onClick={() => pickRecommendation(rec)}
          onHover={(on) => markRecHover(on ? listDestinationEls(rec.destination) : [])}
      />
    );
  }

  // 칸 제목 자리는 줄 단위가 모두 제목·문장일 때만 보인다 - 표·그림은 칸 제목의 출처가 아니다
  const canPickHeading = rowUnits.length > 0 && rowUnits.every((unit) => isHeadingSourceUnit(unit.kind));
  const treeOptions = listTreeOptions(options, canPickHeading);
  const nearAnchor = destination ?? recommendations[0]?.destination ?? null;
  const nearLinks = nearAnchor?.kind === "link" ? pickNearby(written, nearAnchor.targetIds) : [];
  const nearPlaces: DestinationOption[] = nearAnchor && nearAnchor.kind !== "link" ? listSiblingPlaces(options, nearAnchor) : [];

  function renderNearby() {
    if (nearLinks.length + nearPlaces.length === 0) return <p className="text-xs text-ink-3">{t("assign.acc.none")}</p>;
    if (nearAnchor?.kind === "link") {
      return nearLinks.map((item) => (
        <button key={item.target_id} type="button" className="tree-leaf" data-testid={`assign-near-${item.target_id}`} onClick={(event) => pickNewSentence(item.target_id, event.ctrlKey || event.metaKey)}>
          {item.text}
        </button>
      ));
    }
    return nearPlaces.map((option) => (
      <button key={option.id} type="button" className="tree-leaf" disabled={option.disabled} data-testid={`assign-near-${option.id}`} onClick={() => pickDestination(option.destination)}>
        <span className="mr-1.5 font-mono text-[11px] text-ink-3">{option.docCode}</span>
        {option.label}
        {option.disabled && " · N/A"}
      </button>
    ));
  }

  const accSections: AccordionSection[] = [
    { key: "rec", icon: Sparkles, title: t("assign.acc.rec"), count: recommendations.length, body: recommendations.length === 0 ? <p className="text-xs text-ink-3">{t("assign.acc.none")}</p> : recommendations.map(renderRecommendation) },
    { key: "near", icon: Locate, title: t("assign.acc.near"), count: nearLinks.length + nearPlaces.length, body: renderNearby() },
    { key: "all", icon: ListTree, title: t("assign.acc.all"), count: written.length + options.filter(isPlaceOption).length, body: <DestinationTree written={written} rows={tobeData ? listTreeRows(tobeData, treeOptions) : []} tobeHref={getNewDocumentsHref(bundleId)} onPickLink={pickNewSentence} onPickPlace={pickDestination} manage={placeManage} /> },
    {
      key: "move",
      icon: MoveRight,
      title: t("assign.acc.move"),
      body: (
        <>
          <button type="button" className="tree-leaf" aria-pressed={destination?.kind === "delete"} data-testid="assign-pick-delete" onClick={() => pickDestination({ kind: "delete" })}>
            {t("classify.deleted")}
          </button>
          <button type="button" className="tree-leaf" aria-pressed={destination?.kind === "move"} data-testid="assign-pick-move" onClick={() => pickDestination({ kind: "move" })}>
            {t("classify.moved")}
          </button>
        </>
      ),
    },
  ];

  /** 참조 줄의 새 문장이 EQUIS의 지금 번호·정식 이름과 다르면 작은 주의와 맞춘 글 - 누르면 그 글로 바꾼다(저장은 Confirm) */
  function renderRefAdvice(slotKey: string, lang: ViewUnit["lang"], sourceIds: readonly number[], text: string): ReactNode {
    if (lang !== "ref" || rowRefUnit === null || !sourceIds.includes(rowRefUnit.id)) return null;
    const advice = readRefAdvice(text, rowRefUnit.text, refInfo);
    if (advice === null) return null;
    return (
      <div className="ref-advice" data-testid={`assign-ref-advice-${slotKey}`}>
        <TriangleAlert size={12} strokeWidth={1.75} className="mt-0.5 flex-none" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="font-semibold">{t(advice.issue === "number" ? "assign.ref.adviceNumber" : "assign.ref.adviceTitle")}</span>
          <span className="block break-words text-ink-2">{advice.text}</span>
        </span>
        {canEdit && (
          <button type="button" className="btn ghost h-6 flex-none px-1.5 text-xs" data-testid={`assign-ref-advice-use-${slotKey}`} onClick={() => setDraft({ texts: { ...draft.texts, [slotKey]: advice.text }, changeTypes: { ...draft.changeTypes, [slotKey]: "rewritten" } })}>
            {t("assign.ref.useEquis")}
          </button>
        )}
      </div>
    );
  }

  /** 참조 줄을 이미 쓴 문서의 문장에 이을 때 - 그 문장이 EQUIS와 다르면 작은 주의와 맞춘 글. 이미 쓴 문서의 글은 여기서 고치지 않아 단추는 없다 */
  function renderRefLinkAdvice(written: WrittenSentence): ReactNode {
    if (rowRefUnit === null || rowRefUnit.lang !== "ref") return null;
    const advice = readRefAdvice(written.text, rowRefUnit.text, refInfo);
    if (advice === null) return null;
    return (
      <div className="ref-advice" data-testid={`assign-ref-link-advice-${written.target_id}`}>
        <TriangleAlert size={12} strokeWidth={1.75} className="mt-0.5 flex-none" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="font-semibold">{t(advice.issue === "number" ? "assign.ref.adviceNumber" : "assign.ref.adviceTitle")}</span>
          <span className="block break-words text-ink-2">{advice.text}</span>
        </span>
      </div>
    );
  }

  // 표·그림 줄의 캡션 칸 - 캡션 언어마다 하나, 캡션이 없으면 Write a caption 칸 하나(lib/caption-model listCaptionFields)
  const captionFields = oldView ? rowViewUnits.filter((unit) => isBundleKind(unit.kind)).flatMap((unit) => listCaptionFields(unit, oldView.units, draft, groupData)) : [];
  // 고쳐 쓰기 연필 - 아직 안 쓴 문서의 칸으로 보낼 때만, 고쳐 쓰는 중이 아닐 때 문장 줄마다(E와 같다)
  function renderEditPencil(testId: string) {
    if (!canEdit || !isPlace || editing) return null;
    return (
      <Tooltip label={t("assign.rewriteKey")} align="end">
        <button type="button" className="btn ghost h-6 w-6 flex-none justify-center p-0" aria-label={t("classify.editConfirm")} data-testid={testId} disabled={busy} onClick={startEdit}>
          <FilePen size={13} strokeWidth={1.5} aria-hidden />
        </button>
      </Tooltip>
    );
  }

  const captionLines = (
    <>
      {editing
        ? captionFields.map((field, index) => (
            <label key={field.key} className="grid gap-1">
              <span className="flex items-center gap-1.5 text-xs text-ink-2">
                <LangToken lang={field.lang} />
                {t(field.unitId === null ? "assign.caption.write" : "assign.caption.label")}
              </span>
              <textarea
                ref={index === 0 ? firstTextRef : undefined}
                lang={field.lang === "neutral" ? undefined : field.lang}
                className="min-h-[48px] w-full resize-y rounded-md border border-focus bg-surface px-2.5 py-2 text-[14px] leading-[24px] outline-none focus-visible:outline-none"
                style={{ fontFamily: field.lang === "en" ? "var(--font-source-en)" : "var(--font-source)" }}
                data-testid={`assign-caption-text-${field.lang}`}
                value={field.text}
                onChange={(event) => setDraft({ captionTexts: { ...(draft.captionTexts ?? {}), [field.key]: event.target.value } }, true)}
              />
            </label>
          ))
        : captionFields
            .filter((field) => field.text.trim())
            .map((field) => (
              <div key={field.key} className="chosen-line">
                <LangToken lang={field.lang} />
                <span className="min-w-0 flex-1 text-[13px] leading-5 text-ink" style={{ fontFamily: field.lang === "en" ? "var(--font-source-en)" : "var(--font-source)" }}>
                  <Truncate text={field.text} lang={field.lang === "neutral" ? undefined : field.lang} testId={`assign-caption-${field.lang}`} />
                </span>
                {renderEditPencil(`assign-edit-caption-${field.lang}`)}
              </div>
            ))}
      {/* 캡션이 없어 Confirm이 꺼졌다 - 까닭과 써 넣을 길(Edit and confirm)을 같은 자리에 */}
      {isCaptionGateOn && !editing && (
        <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-st-hold" data-testid="assign-caption-needed">
          <TriangleAlert size={13} strokeWidth={1.75} className="flex-none" aria-hidden />
          <span className="min-w-0 flex-1">{t("assign.caption.needed")}</span>
          {canEdit && (
            <button type="button" className="btn h-6 px-1.5 text-xs" data-testid="assign-caption-write" disabled={busy} onClick={startEdit}>
              <FilePen size={13} strokeWidth={1.5} aria-hidden />
              {t("assign.caption.write")}
            </button>
          )}
        </span>
      )}
    </>
  );
  const newSentences = (
    <div className="grid gap-2" data-testid="assign-new-sentences">
      {rowUnits.some((unit) => isBundleKind(unit.kind)) ? (
        <>
          <p className="rounded-md border border-line-2 px-3 py-2 text-ink-2">{t(rowUnits.some((unit) => unit.kind === "figure") ? "classify.figureAsIs" : "classify.tableAsIs")}</p>
          {captionLines}
        </>
      ) : (
        slots.map((slot, index) => {
          const text = draft.texts[slot.key] ?? slot.text;
          // 나눔·합침·번역은 서버가 구조에서 정한다 - 글자 비교 종류는 출처 하나인 같은 언어 칸에서만 고른다
          const structural = readSlotKind(slot, slots);
          const changed = slot.sourceText !== null && text.trim() !== "" && text.trim() !== slot.sourceText.trim();
          const keptType = isTextChangeType(slot.target?.change_type) ? slot.target.change_type : null;
          // 원문과 같은 글은 그대로만, 고친 글은 말투 · 고쳐 씀만 고를 수 있다(그대로는 서버가 글 비교로 정한다)
          const changeToggle = (
            <ChangeKindToggle
              testId={`assign-slot-change-${slot.key}`}
              value={changed ? (draft.changeTypes[slot.key] ?? keptType ?? "rewritten") : "as_is"}
              disabledKinds={changed ? { as_is: t("assign.why.textChanged") } : { tone: t("assign.why.rewriteFirst"), rewritten: t("assign.why.rewriteFirst") }}
              disabled={!canEdit}
              onChange={(next) => {
                if (next !== "as_is") setDraft({ changeTypes: { ...draft.changeTypes, [slot.key]: next } });
              }}
            />
          );
          const refAdvice = renderRefAdvice(slot.key, slot.lang, slot.sourceIds, text);
          // 읽기 보기는 문장마다 한 줄(언어 · 글 · 고쳐 쓰기 연필 · 끝에 변경 종류) - 결정 칸을 낮게 두어 위 목록이 늘 보이게. 전체 글은 올리면 툴팁
          if (!editing) {
            return (
              <Fragment key={slot.key}>
                <div className="chosen-line">
                  <LangToken lang={slot.lang} />
                  <span className="min-w-0 flex-1 text-[13px] leading-5 text-ink" style={{ fontFamily: slot.lang === "en" ? "var(--font-source-en)" : "var(--font-source)" }}>
                    <Truncate text={text || "_"} lang={slot.lang === "neutral" ? undefined : slot.lang} testId={`assign-text-${slot.key}`} />
                  </span>
                  {renderEditPencil(index === 0 ? "assign-edit" : `assign-edit-${slot.key}`)}
                  {structural ? <ChangeKindChip kind={structural} testId={`assign-slot-kind-${slot.key}`} /> : changeToggle}
                </div>
                {refAdvice}
              </Fragment>
            );
          }
          return (
            <div key={slot.key} className="grid gap-1">
              <div className="grid min-h-[60px] grid-cols-[minmax(0,1fr)] rounded-md border border-focus bg-surface px-2.5 py-2">
                <textarea
                  ref={index === 0 ? firstTextRef : undefined}
                  lang={slot.lang === "neutral" ? undefined : slot.lang}
                  className="min-h-[48px] w-full resize-y bg-transparent text-[14px] leading-[24px] outline-none focus-visible:outline-none"
                  style={{ fontFamily: slot.lang === "en" ? "var(--font-source-en)" : "var(--font-source)" }}
                  data-testid={`assign-text-${slot.key}`}
                  value={text}
                  onChange={(event) => setDraft({ texts: { ...draft.texts, [slot.key]: event.target.value } }, true)}
                />
              </div>
              {/* 고쳐 쓰는 동안도 변경 종류는 같은 세 칸 - 글이 원문과 달라지면 말투 · 고쳐 씀이 켜진다 */}
              <span className="flex h-7 items-center gap-2 text-xs text-ink-2">
                {t("classify.changeType")}
                {structural ? <ChangeKindChip kind={structural} testId={`assign-slot-kind-${slot.key}`} /> : changeToggle}
              </span>
              {refAdvice}
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
    const placeLabel = isPlace ? renderPlaceLabel(destination) : null;
    // 고른 칸 안의 위치(MD 2 S3) - 열린 엮은 문서의 칸을 고른 초안일 때만: "6.1.1 다음 (6.1.2가 된다)" · "글머리 기호 줄 · 끝에"
    const placeAt = draftPlace && composedDoc && placeResolved && draftSectionKey !== null && draftPlace.docId === composedDoc.target_doc_id ? readPlacePosition(placeResolved.sections, draftSectionKey, draftPosition ? draftPosition.after : undefined) : null;
    // 놓인 문장에 잇기 - 그 문장(번호·글)과 잇고 나면 한 문장에 든 Old 줄 수. 문서를 다시 읽는 중이거나 다른 문서를 열었으면 문서 번호만
    const joinItem = destination.kind === "join" && composedDoc?.target_doc_id === destination.docId ? composedDoc.sections.flatMap((section) => section.items).find((item) => item.target_id === destination.targetId) : undefined;
    const joinCode = destination.kind === "join" ? ((tobeData?.docs ?? []).find((doc) => doc.id === destination.docId)?.code ?? "") : "";
    // 여러 Old 줄이 한 New 문장으로 합쳐진 곳(잇기로 이은 문장) - 머리가 "Old n줄 → New 1문장 · 고쳐 씀"
    const mergedLines = isPlace ? Math.max(0, ...slots.filter((slot) => slot.target !== null && slot.sourceIds.length > 1).map((slot) => countJoinedLines(slot.sourceIds, activeKey ?? "", (unitId) => rowOfUnit.get(unitId)))) : 0;
    const isConfirmedView = row?.status === "confirmed" && draft.destination === null;
    const pickedRows = linkIds.map((id) => writtenMap.get(id)).filter((item): item is WrittenSentence => item !== undefined);
    // 줄에 없는 언어의 문장은 번역이다 - 종류를 고르지 않고, 나눔도 같은 언어 문장끼리만 센다(제품 명세 §6.7)
    const translatedIds = new Set(pickedRows.filter((item) => isTranslationOf(item.lang, rowLangs)).map((item) => item.target_id));
    const byLang = new Map<string, number>();
    for (const item of pickedRows) if (!translatedIds.has(item.target_id)) byLang.set(item.lang, (byLang.get(item.lang) ?? 0) + 1);
    const mergedWith = [...new Set(pickedRows.flatMap((item) => item.source_unit_ids).filter((id) => !row?.unitIds.includes(id)))].map((id) => unitMap.get(id)?.display_id ?? String(id));
    const auto = [...byLang.values()].some((count) => count > 1) ? "split" : mergedWith.length > 0 ? "merged" : null;
    // 잇지 않는 언어의 짝 조각은 판단이 있으면 지금 그대로 함께 저장된다 - 줄이 아니라 함께 확정되는 쪽으로 보인다.
    // 판단이 없으면 저장에서 빠지고 서버가 같은 저장 안에서 짝을 풀어 제 줄로 남긴다(아래 알림)
    const linkedLangs = new Set(destination.kind === "join" && joinItem ? [joinItem.lang] : pickedRows.map((item) => item.lang));
    const savedRowIds = destination.kind === "link" || destination.kind === "join" ? pickLinkUnits(rowUnits, linkedLangs).map((unit) => unit.unit_id) : (row?.unitIds ?? []);
    const leftovers = pickedGroups.isLoading ? [] : listLinkLeftovers(destination, { units: saveUnits, group: saveGroupData });
    const coConfirmed = saveGroupData ? listCoConfirmed(saveGroupData, [...savedRowIds, ...leftovers], listJoinedTargetIds(destination)) : [];
    const spansDocs = new Set(pickedRows.map((item) => item.target_doc_id)).size > 1;
    return (
      <div className="chosen-box" data-testid="assign-chosen">
        <span className="chosen-label">
          {isConfirmedView && <Check size={13} strokeWidth={2} className="flex-none" aria-hidden />}
          <Truncate
            text={`${isConfirmedView ? `${t("assign.chosen.confirmed")} · ` : ""}${destination.kind === "link" ? `${t("assign.chosen.link")} · ${[...new Set(pickedRows.map((item) => item.doc_code))].join(", ")}` : destination.kind === "join" ? t("assign.chosen.join") : destination.kind === "slot_heading" ? t("assign.slotHeading") : isPlace ? (mergedLines >= 2 ? t("assign.chosen.merged", { n: mergedLines }) : t("assign.chosen.place")) : t("assign.acc.move")}`}
          />
        </span>
        {(destination.kind === "delete" || destination.kind === "move") && (
          <span className="flex items-center gap-1.5 text-sm font-semibold text-ink">
            {destination.kind === "delete" ? <Trash2 size={14} strokeWidth={1.75} className="flex-none text-danger" aria-hidden /> : <MoveRight size={14} strokeWidth={1.75} className="flex-none text-danger" aria-hidden />}
            {t(destination.kind === "delete" ? "classify.deleted" : "classify.moved")}
          </span>
        )}
        {destination.kind === "link" && (
          <LinkChoice
            rows={pickedRows}
            changeTypes={draft.linkChangeTypes ?? {}}
            aiPending={aiPending}
            translatedIds={translatedIds}
            defaults={Object.fromEntries(pickedRows.map((item) => [item.target_id, readLinkDefault({ lang: item.lang, confirmed_text: item.text, change_type: item.change_type, status: item.status }, rowUnits)]))}
            auto={auto}
            mergedWith={mergedWith}
            onChange={(targetId, value) => setDraft({ linkChangeTypes: { ...(draft.linkChangeTypes ?? {}), [targetId]: value } })}
            renderNote={renderRefLinkAdvice}
          />
        )}
        {destination.kind === "join" && (
          <>
            <span className="flex min-w-0 items-baseline gap-1.5 text-[13px] font-semibold text-ink" data-testid="assign-chosen-join">
              <b className="flex-none font-mono text-[11px]">{[joinCode, joinItem?.number].filter(Boolean).join(" ")}</b>
              {joinItem && <Truncate text={joinItem.text} lang={joinItem.lang === "neutral" ? undefined : joinItem.lang} />}
            </span>
            <span className="text-xs text-ink-2" data-testid="assign-chosen-join-note">
              {t("assign.chosen.joinNote", { n: countJoinedLines(joinItem?.source_unit_ids ?? [], activeKey ?? "", (unitId) => rowOfUnit.get(unitId)) })}
            </span>
          </>
        )}
        {placeLabel && (
          <>
            <span className="flex min-w-0 items-baseline gap-1.5 text-[13px] font-semibold text-ink">
              <b className="flex-none font-mono text-[11px]">{placeLabel.title}</b>
              <Truncate text={placeLabel.text} />
            </span>
            {placeAt && (
              <span className="text-xs text-ink-2" data-testid="assign-chosen-position">
                {formatPlacePosition(placeAt, t)}
              </span>
            )}
            {newSentences}
          </>
        )}
        {destination.kind === "slot_heading" && (
          <p className="text-[13px] text-ink" data-testid="assign-chosen-heading">
            <b className="mr-1 font-mono text-[11px]">{renderPlaceLabel(destination).title}</b>
            {renderPlaceLabel(destination).text}
          </p>
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
        {otherLang && destination.kind !== "link" && destination.kind !== "join" && canEdit && (
          <div className="flex flex-wrap gap-1.5">
            {aiOn && (
              <button type="button" className="btn h-7" data-testid="assign-make-other" disabled={busy} onClick={() => row && void askAiScope("translate", { unit_ids: row.unitIds, direction: otherLang === "en" ? "ko_to_en" : "en_to_ko" })}>
                <Sparkles size={14} strokeWidth={1.5} aria-hidden />
                {t(otherLang === "en" ? "assign.makeEn" : "assign.makeKo")}
              </button>
            )}
            {/* AI가 꺼져 있어도 빠진 언어를 채울 수 있게 */}
            {writeOtherUnit !== null && (
              <button type="button" className="btn h-7" data-testid="assign-write-other" disabled={busy} onClick={() => startWriteOther(otherLang, writeOtherUnit)}>
                <FilePen size={14} strokeWidth={1.5} aria-hidden />
                {t(otherLang === "en" ? "assign.writeEn" : "assign.writeKo")}
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  // 확정 단추 - 결정 칸 맨 아래 늘 같은 자리의 가장 큰 단추. 고른 곳이 없으면 흐리게 꺼지고 까닭은 툴팁(↵는 위 목록의 첫 후보로 간다)
  const confirmButton = (
    <Tooltip label={t((destination !== null ? confirmBlockKey : null) ?? "assign.why.pickFirst")} suppressed={(destination !== null && confirmBlockKey === null) || !row}>
      <button type="button" className="btn pri assign-confirm" data-testid="assign-primary" data-state={primaryState} disabled={!canEdit || !row || busy || !destination || isRefGate || isCaptionGateOn} onClick={handlePrimary}>
        <span className="stack">
          <span data-on={primaryState !== "save" ? "" : undefined}>
            {t("classify.confirm")} <kbd>↵</kbd>
          </span>
          <span data-on={primaryState === "save" ? "" : undefined}>
            {t("classify.saveConfirm")} <kbd>↵</kbd>
          </span>
        </span>
      </button>
    </Tooltip>
  );

  const canClear = row !== null && row.status !== "unassigned";
  // 확정 말고 다른 길 - 결정 칸 머리에 조용히 둔다(확정 위에 두면 넘쳐 누르기 쉽다). 고쳐 쓰기는 고른 곳 상자의 문장 줄 연필로 옮겼고,
  // 배정 취소는 배정이 있을 때만 보인다(쓸 수 없는 단추는 숨긴다 - 1.2.0 피드백). 좁은 폭에서는 글쇠 표시를 뺀다 - 단축키는 Help에 있다
  const actions = canEdit && row && (
    <div className="@container flex gap-1.5" data-testid="assign-actions">
      <button type="button" className="btn assign-alt flex-1" data-testid="assign-hold" disabled={busy} onClick={() => void runSave("hold")}>
        {t("classify.hold")} <kbd className="@max-[200px]:hidden">H</kbd>
      </button>
      {canClear && (
        <button type="button" className="btn assign-alt flex-1" data-testid="assign-clear" disabled={busy} onClick={() => void runClear()}>
          <Undo2 size={13} strokeWidth={1.5} aria-hidden />
          {t("classify.clear")} <kbd className="@max-[200px]:hidden">U</kbd>
        </button>
      )}
    </div>
  );

  // 지금 고른 곳에 꼭 필요한 Remark(지우기·옮기기·두 문서) - 비어 있으면 Remark 줄이 경고 색이 되고 쓰기 단추가 다음 할 일로 강조된다
  const remarkNeed = row && destination ? readReasonNeed("confirm") : null;
  const isRemarkMissing = remarkNeed !== null && !reasonNow.trim();
  // Remark 한 줄(RemarkLine) - 꼭 필요한데 비었으면 글 자리가 경고 "…에는 필수"로 바뀌고 연필이 강조된 채 늘 보인다
  const remarkRow = (
    <RemarkLine
      text={reasonNow}
      emptyLabel="–"
      needMessage={isRemarkMissing ? t(`remark.need.${remarkNeed}`) : null}
      canEdit={canEdit}
      disabled={!row}
      onEdit={() => setRemarkEdit({ kind: "row", need: isRemarkMissing ? remarkNeed : null, then: null })}
      onPick={(text) => setDraft({ reason: text })}
      reloadKey={unitsKey}
      testId="assign-reason"
      editTestId="assign-reason-edit"
    />
  );

  // 머리 아래 한 줄 - 결정 전에 볼 것(검사 결과·확정한 사람)
  const checks = groupData?.targets.flatMap((target) => target.warnings) ?? [];
  // 고른 줄의 첫 문장이 원문에서 놓인 쪽 - 종이 문서와 견줄 때 찾는 자리다(PDF가 아니면 어림한 쪽이라 ≈를 붙인다)
  const rowBlock = mode === "old" && rowViewUnits.length > 0 ? (shapeView?.blocks.find((block) => block.id === rowViewUnits[0].block_id) ?? null) : null;
  const meta = (
    <div className="assign-meta">
      {rowBlock !== null && rowBlock.page !== null && (
        <span className="assign-meta-item tabular-nums text-ink-3" data-testid="assign-row-page">
          {rowBlock.page_basis === "estimated" ? "≈ " : ""}p.{rowBlock.page}
        </span>
      )}
      <span className="assign-meta-item">
        <span className="text-ink-3">{t("classify.checks")}</span>
        <span className="flex flex-wrap gap-1 text-ink-2" data-testid="assign-checks">
          {checks.map((warning, index) => (
            <span key={index} className="pill warn">
              {t(readCheckKey(warning))}
            </span>
          ))}
          {checks.length === 0 && "–"}
        </span>
      </span>
      <span className="assign-meta-item min-w-0">
        <span className="flex-none text-ink-3">{t("classify.confirmedBy")}</span>
        <Truncate className="text-ink-2" text={firstDecision?.confirmed_by ? `${firstDecision.confirmed_by} · ${formatKst(firstDecision.confirmed_at)}` : "–"} testId="assign-confirmed-by" />
      </span>
      {systemHold !== null && (
        <span className="assign-meta-item">
          <span className="text-ink-3">{t("classify.systemHold")}</span>
          <span data-testid="assign-system-hold">
            <span className="pill warn">{t(SYSTEM_HOLDS.includes(systemHold) ? `hold.system.${systemHold}` : "hold.system.other")}</span>
          </span>
        </span>
      )}
    </div>
  );

  function renderStep(n: number, label: string) {
    return (
      <h3 className="assign-step">
        <span className="assign-step-n" aria-hidden>
          {n}
        </span>
        {label}
      </h3>
    );
  }

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

  /** 다듬기 걸음과 그 줄에 걸린 카드(참조 줄 확인·AI 나누기 제안) - Old 줄과 한 단의 New 문장이 같은 것을 쓴다 */
  // 고른 줄이 표·그림이면 다듬기 아래 그 캡션 자리(F7 · F12) - 써 넣은 캡션은 Edit and confirm의 캡션 칸(captionFields)에서 온다
  const rowBundle = shapeLines.length > 0 && !hasSolo ? (rowViewUnits.find((unit) => isBundleKind(unit.kind)) ?? null) : null;
  const captionSlot = rowBundle && shapeModel && slotPlaces
    ? buildCaptionSlot({ bundle: rowBundle, units: shapeModel.units, places: slotPlaces, blockKinds: slotBlockKinds, written: captionFields.filter((field) => field.unitId === null) })
    : null;
  /** 캡션 자리의 후보 하나 - 글은 캡션으로 붙이고(2칸 안), 첫 행은 캡션으로 올리고, 캡션 있는 이웃 그림과는 묶는다. 모두 쪼개기 편집이라 Ctrl+Z로 되돌린다 */
  function runCaptionCandidate(candidate: Exclude<CaptionCandidate, { kind: "write" }>) {
    if (!rowBundle || !captionSlot) return;
    const { bundleId } = captionSlot;
    if (candidate.kind === "near") void runUnitEdit({ type: "attach_caption", unit_id: candidate.unitId, bundle_unit_id: bundleId }, t("assign.ctx.didAttachCaption"), bundleId);
    else if (candidate.kind === "first_row") void runUnitEdit({ type: "set_first_row_caption", table_unit_id: bundleId, caption: true }, t("assign.captionSlot.didFirstRow"), bundleId);
    else void runUnitEdit({ type: "group_figures", unit_ids: [rowBundle.id, candidate.figureId] }, t("assign.captionSlot.didGroup"), rowBundle.id);
  }
  /** ✂ 한/영 나누기 - 모델이 고른 자리를 나눌 수 있는 자리로 맞춰 자른다(두 조각 모두 그 묶음의 캡션으로 남는다) */
  function splitCaption(unitId: number, at: number) {
    const unit = shapeModel?.units.get(unitId);
    const cut = unit ? findNearestCut(unit, at) : null;
    if (cut !== null && captionSlot) void runUnitEdit({ type: "split", unit_id: unitId, at: cut }, t("assign.captionSlot.didSplit"), captionSlot.bundleId);
  }
  function renderCaptionSlot(): ReactNode {
    if (!captionSlot || !rowBundle) return null;
    const { bundleId, groupHeadId } = captionSlot;
    return (
      <CaptionSlot
        slot={captionSlot}
        busy={busy}
        blockedKey={rowViewUnits.some(hasUnitDraft) ? "assign.ctx.why.unsaved" : null}
        writeBlockedKey={isPlace ? null : "assign.captionSlot.why.pickPlace"}
        readDetachBlock={(unitId) => {
          const caption = shapeModel?.units.get(unitId);
          return caption && isFixedCaption(caption) ? "assign.ctx.why.captionInFigure" : null;
        }}
        onCandidate={runCaptionCandidate}
        onWrite={startEdit}
        onDetach={(unitId) => void runUnitEdit({ type: "detach_caption", unit_id: unitId }, t("assign.ctx.didDetachCaption"), bundleId)}
        onSplit={splitCaption}
        onBackFirstRow={() => void runUnitEdit({ type: "set_first_row_caption", table_unit_id: bundleId, caption: false }, t("assign.captionSlot.didBackFirstRow"), bundleId)}
        onUngroup={() => void runUnitEdit({ type: "ungroup_figures", unit_id: rowBundle.id }, t("assign.captionSlot.didUngroup"), groupHeadId)}
      />
    );
  }

  function renderShapeCards(n: number) {
    return (
      <>
        {shapeLines.length > 0 && (
          <>
            {renderStep(n, t("assign.step.shape"))}
            <ShapeTools lines={shapeLines} cutUnitId={cutLine.at !== null ? cutUnitId : null} busy={busy} onAction={(unit, action, lang) => runUnitAction(unit, action, lang)} mode={shapeMode} onMode={switchShapeMode} headingBack={headingBack} bandBack={bandBack} rewrap={rewrap} />
            {renderCaptionSlot()}
          </>
        )}
        {rowRefUnit && shapeView && (
          <RefCard
            key={`${rowRefUnit.id}:${rowRefUnit.ref?.state ?? "new"}:${rowRefUnit.ref?.number ?? ""}`}
            unit={rowRefUnit}
            equis={refInfo?.equis ?? null}
            onReloadEquis={refDetail.reload}
            canEdit={canEdit}
            busy={busy}
            blockedReason={refBlocked}
            left={refPendingIds.length}
            onConfirm={(number) => void runUnitEdit({ type: "set_ref", unit_id: rowRefUnit.id, number }, t("assign.ref.didConfirm"), rowRefUnit.id)}
            onReject={() => void runUnitEdit({ type: "clear_ref", unit_id: rowRefUnit.id }, t("assign.ref.didReject"), rowRefUnit.id)}
            onClose={() => setRefEntryId(null)}
            onNext={selectNextRef}
          />
        )}
        {rowCaptionRefs.length > 0 && shapeModel && (
          <CaptionRefList
            refs={rowCaptionRefs}
            units={shapeModel.units}
            candidates={refCandidates}
            canEdit={canEdit && mode === "old"}
            busy={busy}
            onDetach={(refId) => void runCaptionRefChange(refId, { state: "detached" }, t("assign.captionRef.didDetach"))}
            onRelink={(refId, unitId) => void runCaptionRefChange(refId, { target_unit_id: unitId }, t("assign.captionRef.didRelink"))}
          />
        )}
        {rowSplitUnit && rowSplit && (
          <SplitSuggestionCard
            unit={rowSplitUnit}
            suggestion={rowSplit}
            canEdit={canEdit}
            busy={busy}
            blockedReason={splitBlocked}
            left={splitByUnit.size}
            onApply={() => void applySplitSuggestion(rowSplitUnit, rowSplit)}
            onDismiss={() => void dismissSplitSuggestion(rowSplit)}
            onNext={selectNextSplit}
          />
        )}
      </>
    );
  }

  /** 목차 칸(F12 G2 · G3) - 머리는 상태 칩 없이 "목차 · n줄"(블록)·"목차 · n행"(줄), 1 다듬기는 목차 줄과 그 단추, 2 보낼 곳은 추천 대신 까닭 글,
   *  3 결정은 "따로 할 일 없음"과 꺼진 Confirm(Hold · Unassign은 그리지 않는다). 용지 블록 머리의 손잡이는 표가 적은 것만 여기 둔다 */
  function renderTocPanel(pick: { docId: number; key: number; unitId: number | null }): ReactNode {
    const view = viewOf(pick.docId);
    const info = tocBlocks.find((item) => item.docId === pick.docId && item.key === pick.key);
    if (!view || !info) return null;
    const unitById = new Map(view.units.map((unit) => [unit.id, unit]));
    const units = info.unitIds.flatMap((id) => unitById.get(id) ?? []);
    const block = buildTocBlock(units);
    if (!block) return null;
    const lineAt = pick.unitId === null ? -1 : block.unitIds.indexOf(pick.unitId);
    const line = lineAt >= 0 ? block.lines[lineAt] : null;
    const isOpen = tocOpen.has(block.key);
    const canClear = canEdit && !isNewEdit;
    const parts = describeTocParts(units.map((unit) => unit.lang))
      .map((part) => t(`assign.toc.part.${part.part}`, { n: part.n }))
      .join(" · ");
    return (
      <div className="assign-side-body" data-testid="assign-toc-panel">
        <div className="assign-side-head">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 font-mono text-sm font-semibold" data-testid="assign-toc-head">
              {line ? t("assign.toc.panelLine", { n: lineAt + 1 }) : t("assign.toc.panelBlock", { n: block.counts.total })}
            </span>
            <span className="flex flex-none gap-0.5">
              <Tooltip label={t("assign.rowPrev")} align="end">
                <button type="button" className="btn ghost icon h-6 w-6" aria-label={t("assign.rowPrev")} data-testid="assign-row-prev" onClick={() => moveRow(-1)}>
                  <ArrowUp size={13} strokeWidth={1.6} aria-hidden />
                </button>
              </Tooltip>
              <Tooltip label={t("assign.rowNext")} align="end">
                <button type="button" className="btn ghost icon h-6 w-6" aria-label={t("assign.rowNext")} data-testid="assign-row-next" onClick={() => moveRow(1)}>
                  <ArrowDown size={13} strokeWidth={1.6} aria-hidden />
                </button>
              </Tooltip>
            </span>
          </div>
        </div>
        <div className="assign-pick" data-testid="assign-pick">
          {renderStep(1, t("assign.step.shape"))}
          <div className="toc-panel-shape" data-testid="assign-toc-shape">
            <p className="toc-panel-line">
              <span className="toc-tag">{t("assign.toc.tag")}</span>
              <span className="min-w-0" style={line ? { fontFamily: "var(--font-source)" } : undefined}>
                {line ? line.text : t("assign.toc.summary", { n: block.counts.total, parts, state: t(isOpen ? "assign.toc.stateOpen" : "assign.toc.stateFolded") })}
              </span>
            </p>
            <div className="flex flex-wrap gap-1.5">
              {line === null && (
                <button type="button" className="btn h-7" aria-expanded={isOpen} data-testid="assign-toc-toggle" onClick={() => setTocOpen((open) => toggleTocOpen(open, block.key))}>
                  {t(isOpen ? "assign.toc.collapse" : "assign.toc.expand")}
                </button>
              )}
              {line === null && canClear && (
                <button type="button" className="btn h-7" disabled={busy} data-testid="assign-toc-all" onClick={() => clearToc(block.unitIds)}>
                  {t("assign.toc.allNot")}
                </button>
              )}
              {line !== null && canClear && (
                <button type="button" className="btn h-7" disabled={busy} data-testid="assign-toc-not" onClick={() => clearToc([line.unitId])}>
                  {t("assign.toc.notThis")}
                </button>
              )}
            </div>
          </div>
          {renderStep(2, t("assign.step.pick"))}
          <p className="chosen-box is-empty mx-[var(--pad)] mb-[var(--pad)]" data-testid="assign-toc-why">
            {line ? t("assign.toc.lineWhy", { n: block.counts.total - 1 }) : t("assign.toc.blockWhy")}
          </p>
        </div>
        <div className="assign-decide" data-testid="assign-decide">
          <div className="assign-decide-body">
            {renderStep(3, t("assign.step.decide"))}
            <p className="text-xs text-st-hold" role="status" data-testid="assign-toc-nothing">
              {t("assign.toc.nothing")}
            </p>
          </div>
          <button type="button" className="btn pri assign-confirm" data-testid="assign-primary" disabled>
            {t("classify.confirm")} <kbd>↵</kbd>
          </button>
        </div>
      </div>
    );
  }

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
                <div lang={target.lang === "neutral" ? undefined : target.lang}>
                  <ClampText text={target.text} className="text-[13px] leading-5 text-ink" tabbable={false} />
                </div>
              </div>
              {/* 출처 없는 New도 같은 순서 - 위는 출처를 고르는 길(왼쪽 Old 조각), 아래 붙은 결정 칸에 Remark와 신규 표시 */}
              <div className="assign-pick" data-testid="assign-pick">
                {renderStep(1, t("assign.step.source"))}
                <p className="chosen-box is-empty mx-[var(--pad)] mb-[var(--pad)]">{t("assign.unsourced.body")}</p>
              </div>
              <div className="assign-decide" data-testid="assign-decide">
                <div className="assign-decide-body">
                  {renderStep(2, t("assign.step.decide"))}
                  <RemarkLine
                    text={newRemarks[target.target_id] ?? target.remark}
                    emptyLabel={t("assign.optional")}
                    needMessage={null}
                    canEdit={canEdit}
                    onEdit={() => setRemarkEdit({ kind: "new", targetId: target.target_id })}
                    onPick={(text) => setNewRemarks((prev) => ({ ...prev, [target.target_id]: text }))}
                    reloadKey={unitsKey}
                    testId="assign-new-remark"
                    editTestId="assign-new-remark-edit"
                  />
                </div>
                <button type="button" className="btn pri assign-confirm" data-testid="assign-mark-new" disabled={!canEdit || busy} onClick={markNew}>
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
    if (hasSolo) {
      return (
        <div className="assign-side-body" data-testid="assign-solo">
          <div className="assign-side-head">
            <div className="flex items-center gap-2">
              <Truncate className="min-w-0 flex-1 font-mono text-sm font-semibold" text={soloUnits.map((unit) => unit.display_id).join(" · ") || (shapeView?.document.doc_code ?? "–")} testId="assign-row-id" />
              <span className="tag flex-none">{t("assign.writtenTag")}</span>
              <span className="flex flex-none gap-0.5">
                <Tooltip label={t("assign.rowPrev")} align="end">
                  <button type="button" className="btn ghost icon h-6 w-6" aria-label={t("assign.rowPrev")} data-testid="assign-row-prev" onClick={() => moveRow(-1)}>
                    <ArrowUp size={13} strokeWidth={1.6} aria-hidden />
                  </button>
                </Tooltip>
                <Tooltip label={t("assign.rowNext")} align="end">
                  <button type="button" className="btn ghost icon h-6 w-6" aria-label={t("assign.rowNext")} data-testid="assign-row-next" onClick={() => moveRow(1)}>
                    <ArrowDown size={13} strokeWidth={1.6} aria-hidden />
                  </button>
                </Tooltip>
              </span>
            </div>
            {rowBlock !== null && rowBlock.page !== null && (
              <div className="assign-meta">
                <span className="assign-meta-item tabular-nums text-ink-3" data-testid="assign-row-page">
                  {rowBlock.page_basis === "estimated" ? "≈ " : ""}p.{rowBlock.page}
                </span>
              </div>
            )}
          </div>
          {/* 이 문서의 문장은 배정하지 않는다 - 다듬기(1번)뿐이고, 왜 보낼 곳이 없는지 한 줄로 알린다 */}
          <div className="assign-pick" data-testid="assign-pick">
            {renderShapeCards(1)}
            <p className="chosen-box is-empty mx-[var(--pad)] my-[var(--pad)]" data-testid="assign-solo-note">
              {soloUnits.length === 0 ? t("assign.solo.pick") : t(isNewEdit ? "assign.solo.noteInPlace" : "assign.solo.note")}
            </p>
          </div>
        </div>
      );
    }
    const tocPanel = !row && tocPick ? renderTocPanel(tocPick) : null;
    if (tocPanel) return tocPanel;
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
              <UnitStatusChip status={row.status} testId="assign-row-status" />
            </span>
            {/* 앞·다음 줄 - 손이 오른쪽 칸에 있을 때 원문까지 가지 않고 넘긴다(글쇠 K·J와 같다) */}
            <span className="flex flex-none gap-0.5">
              <Tooltip label={t("assign.rowPrev")} align="end">
                <button type="button" className="btn ghost icon h-6 w-6" aria-label={t("assign.rowPrev")} data-testid="assign-row-prev" onClick={() => moveRow(-1)}>
                  <ArrowUp size={13} strokeWidth={1.6} aria-hidden />
                </button>
              </Tooltip>
              <Tooltip label={t("assign.rowNext")} align="end">
                <button type="button" className="btn ghost icon h-6 w-6" aria-label={t("assign.rowNext")} data-testid="assign-row-next" onClick={() => moveRow(1)}>
                  <ArrowDown size={13} strokeWidth={1.6} aria-hidden />
                </button>
              </Tooltip>
            </span>
            {(units.error ?? suggestions.error) !== null && (
              <button type="button" className="btn h-6 gap-1 px-1.5 text-xs font-normal text-st-hold" data-testid="assign-refresh-error" onClick={() => setUnitsKey((key) => key + 1)}>
                <RefreshCw size={12} strokeWidth={1.5} aria-hidden />
                {t("classify.refreshFailed")}
              </button>
            )}
          </div>
          {meta}
          {/* 머리는 스크롤되지 않으니 긴 AI 사유는 두 줄까지(전체는 올리거나 포커스하면 툴팁) */}
          {rowLive && aiDest && (
            <div className="grid gap-0.5 text-xs text-st-ai" data-testid="assign-ai-reason">
              <div className="flex items-start gap-1.5">
                <Sparkles size={13} strokeWidth={1.5} className="mt-0.5 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1">{aiWhy ? <ClampText text={aiWhy} /> : t("assign.ai.useHint")}</span>
              </div>
              {aiWhy && canEdit && draft.suggestionId !== rowLive.id && <span className="pl-[19px] text-ink-3" data-testid="assign-ai-use-hint">{t("assign.ai.useHint")}</span>}
              {draft.suggestionId === rowLive.id && aiUnfilled.length > 0 && (
                <span className="grid gap-0.5 pl-[19px] text-ink-2" data-testid="assign-ai-unfilled">
                  <span>{t("assign.ai.unfilled")}</span>
                  {aiUnfilled.map((lang) => (
                    <span key={lang} lang={lang} className="select-text">{readRewrites(rowLive)[lang].join(" / ")}</span>
                  ))}
                </span>
              )}
            </div>
          )}
          {!rowLive && row.status === "unassigned" && row.unitIds.some((id) => invalidUnitIds.has(id)) && (
            <div className="flex items-start gap-1.5 text-xs text-ink-3" data-testid="assign-ai-invalid">
              <Sparkles size={13} strokeWidth={1.5} className="mt-0.5 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1">{t("assign.ai.invalid")}</span>
            </div>
          )}
        </div>
        {/* ① 다듬기 → ② 보낼 곳 - 패널에서 이곳만 스크롤된다. 바로 아래 결정 칸(③)이 붙어 있어 고른 곳에서 확정까지 손이 짧다 */}
        <div className="assign-pick" data-testid="assign-pick" onClickCapture={handlePickClickCapture}>
          {renderShapeCards(1)}
          {renderStep(stepBase + 1, t("assign.step.pick"))}
          {isTemplateDrag ? (
            <p className="chosen-box is-empty mx-[var(--pad)] mb-[var(--pad)]" data-testid="assign-tpl-drag-note">
              {t("template.drop.dragging")}
            </p>
          ) : (
            <DestinationAccordion sections={accSections} open={accOpen} onToggle={toggleAcc} />
          )}
          {/* 한 단에서는 New 칸이 없어 이미 쓴 문장을 직접 눌러 고르지 못한다 - 까닭과 양 단으로 넘어가는 길을 그 자리에(추천 카드로 잇는 것은 된다) */}
          {view.single && writtenDocs.length > 0 && (
            <p className="mx-[var(--pad)] mt-1 grid justify-items-start gap-1 rounded-md bg-sunken px-2.5 py-2 text-xs text-ink-2" data-testid="assign-single-hint">
              <span>{t("assign.single.linkHint")}</span>
              <button type="button" className="btn ghost -ml-2 h-7" data-testid="assign-single-hint-two" onClick={() => changeView({ single: false })}>
                <Columns2 size={14} strokeWidth={1.5} aria-hidden />
                {t("assign.view.two")}
              </button>
            </p>
          )}
          <div className="px-[var(--pad)] pb-[var(--pad)] pt-1">{aiNote}</div>
        </div>
        {/* ② 결정 칸 - 패널 아래에 붙는다. 다른 길 셋 · 고른 곳(높이 상한 안에서 이 부분만 스크롤) · 대상 문서 · Remark · 맨 아래 확정 */}
        <div className="assign-decide" data-testid="assign-decide">
          <div className="assign-decide-body">
            {renderStep(stepBase + 2, t("assign.step.decide"))}
            {actions}
            {renderChosen()}
          </div>
          {destination?.kind === "move" && (
            <div className="flex min-w-0 items-center gap-2">
              <span className="flex-none text-xs text-ink-3">{t("classify.moveTo")}</span>
              <span className="block h-8 min-w-0 flex-1">
                <MoveTargetField key={activeKey ?? ""} bundleId={bundleId} value={moveCode} disabled={!canEdit} testId="assign-move-code" onChange={(code) => setDraft({ moveCode: code })} />
              </span>
            </div>
          )}
          {remarkRow}
          {confirmButton}
        </div>
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
      setDraft({ destination: null, linkChangeTypes: {}, position: null });
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

  const error = docs.error ?? views.error ?? units.error ?? tobe.error ?? writtenList.error;
  const reloadAll = () => {
    for (const source of [docs, views, units, tobe, writtenList]) if (source.error !== null) source.reload();
  };
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
  const identicalCount = identical.data?.length ?? 0;
  const bar = (
    <div className="assign-bar" data-testid="assign-bar">
      <div className="flex flex-wrap gap-1" role="tablist" data-testid="assign-filters">
        {FILTERS.filter((item) => item !== "ai_suggested" || counts.ai_suggested > 0).map((item) => {
          return (
            <FilterChip
              key={item}
              tone={item}
              label={item === "all" ? t("assign.acc.all") : item === "ai_suggested" ? t("assign.filter.suggested") : t(`status.unit.${item}`)}
              count={counts[item]}
              selected={mode === "old" && filter === item}
              onClick={() => applyFilter(item)}
              testId={`assign-filter-${item}`}
              icon={FILTER_ICON[item]}
            />
          );
        })}
      </div>
      <span className="text-xs tabular-nums text-ink-3" data-testid="assign-progress">
        {t("assign.progress", { done, total: rows.length })}
      </span>
      <ReadOnlyNote bundle={bundle} testId="assign" />
      {/* 오른쪽 묶음은 한 요소로 - 줄이 넘치면 통째로 다음 줄 오른쪽 끝으로 간다 */}
      <div className="assign-bar-end" data-testid="assign-bar-end">
        {/* 한 단 · 양 단 - 문서 하나만 넓게 보거나 두 문서를 나란히(글쇠 V). 읽기만 하는 사람에게도 보인다 */}
        <span className="view-toggle" role="group" aria-label={t("assign.view.group")} data-testid="assign-view">
          <Tooltip label={t("assign.view.oneTip")}>
            <button type="button" aria-pressed={view.single} aria-label={t("assign.view.one")} data-testid="assign-view-one" onClick={() => changeView({ single: true })}>
              <Square size={14} strokeWidth={1.5} aria-hidden />
            </button>
          </Tooltip>
          <Tooltip label={t("assign.view.twoTip")}>
            <button type="button" aria-pressed={!view.single} aria-label={t("assign.view.two")} data-testid="assign-view-two" onClick={() => changeView({ single: false })}>
              <Columns2 size={14} strokeWidth={1.5} aria-hidden />
            </button>
          </Tooltip>
        </span>
        {/* 그다음 - 오른쪽 묶음이 줄을 넘겨도 늘 같은 자리 */}
        {canEdit && (
          <span className="flex items-center gap-1">
            <Tooltip label={t("assign.undo")}>
              <button type="button" className="btn icon h-7 w-7" aria-label={t("assign.undo")} data-testid="assign-undo" disabled={busy || !undoState.canUndo} onClick={() => void runUndoStep("undo")}>
                <Undo2 size={14} strokeWidth={1.5} aria-hidden />
              </button>
            </Tooltip>
            <Tooltip label={t("assign.redo")}>
              <button type="button" className="btn icon h-7 w-7" aria-label={t("assign.redo")} data-testid="assign-redo" disabled={busy || !undoState.canRedo} onClick={() => void runUndoStep("redo")}>
                <Redo2 size={14} strokeWidth={1.5} aria-hidden />
              </button>
            </Tooltip>
          </span>
        )}
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
        {/* 확인할 것 - 아이콘 + 수(올리면 이름), 누르면 그 줄 목록 창. 누락 경고는 문서별 확인 창 */}
        {aiOn && splitPendingIds.length > 0 && (
          <PendingCount icon={WandSparkles} tone="ai" words={t("assign.pending.split")} label={t("ai.pendingCount", { n: splitPendingIds.length })} items={splitPendingIds.map(readPendingItem)} onGo={goToUnit} onNext={selectNextSplit} testId="assign-split-pending" />
        )}
        {canEdit && refPendingIds.length > 0 && (
          <PendingCount icon={BookMarked} tone="ref" words={t("assign.pending.ref")} label={t("assign.ref.pendingCount", { n: refPendingIds.length })} items={refPendingIds.map(readPendingItem)} onGo={goToUnit} onNext={selectNextRef} testId="assign-ref-pending" />
        )}
        {canEdit && captionPendingKeys.length > 0 && (
          <PendingCount
            icon={Captions}
            tone="warn"
            words={t("assign.pending.caption")}
            label={t("assign.caption.pendingCount", { n: captionPendingKeys.length })}
            items={captionPendingKeys.flatMap((key) => {
              const unitId = rowMap.get(key)?.unitIds[0];
              return unitId === undefined ? [] : [readPendingItem(unitId)];
            })}
            onGo={goToUnit}
            onNext={selectNextCaption}
            testId="assign-caption-pending"
          />
        )}
        {/* 누락 의심 경고 - 확인이 남아 있을 때만 보인다(검토 요청 조건). 원문 자리를 보거나 그 자리에서 확인한다 */}
        <MissingWarnings
          bundleId={bundleId}
          docs={docs.data ?? []}
          canEdit={canEdit}
          onShow={(item) => {
            const unit = item.warning.block_id === null ? undefined : viewOf(item.docId)?.units.find((candidate) => candidate.block_id === item.warning.block_id);
            const key = unit ? rowOfUnit.get(unit.id) : undefined;
            if (key === undefined) {
              // 그 자리에 단위가 없으면(통째로 빠진 글) 문서만 연다
              if (!oldDocIds.includes(item.docId)) return false;
              setManualOldDoc(item.docId);
              return true;
            }
            selectRow(key);
            return true;
          }}
          onChanged={() => {
            docs.reload();
            void loadBundle(bundleId);
          }}
        />
        <AssignMoreMenu
          canEdit={canEdit}
          disabled={busy}
          identicalCount={identicalCount}
          onIdentical={() => setConfirmingIdentical(true)}
          aiItems={aiOn ? aiMenuItems : []}
          resetDocument={oldView ? { id: oldView.document.id, label: oldView.document.doc_code || oldView.document.file_name } : null}
          onReset={setResetScope}
        />
      </div>
    </div>
  );

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
  // 클릭 배치의 자리 보기(MD 2 S3) - 기본 보기와 템플릿 보기가 같은 보기를 쓴다(두 절반의 같은 자리는 같은 보기라 함께 골라진 모양이 된다)
  let newPlace: NewPlaceSpots | null = null;
  const placeBySection = new Map<string, PlaceSpotView>();
  if (canPlaceClick && placeResolved && composedDoc && row) {
    const toView = (key: string, placement: Placement, spot: PlaceSpot, label: string): PlaceSpotView => ({
      key,
      open: placement.kind === "place",
      label: placement.kind === "refused" ? t(PLACE_REFUSAL_KEYS[placement.reason]) : label,
      picked: key === pickedSpotKey,
      onPick: () => pickPlaceSpot(spot, key),
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
  const placeOf = (unitIds: number[]) => {
    const decided = unitIds.map((id) => unitMap.get(id)).find((unit) => unit?.status === "confirmed");
    if (!decided) return null;
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
  const pendingOption = pendingPlace ? options.find((option) => option.id === getDestinationId(pendingPlace)) : undefined;
  // 문장마다의 변경 종류 - 결정 칸의 고르개와 같은 규칙(구조 종류가 먼저, 고친 글이면 고른 값, 아니면 그대로)
  const readPendingChange = (slot: (typeof slots)[number]): ChangeType => {
    const structural = readSlotKind(slot, slots);
    if (structural !== null) return structural;
    const text = draft.texts[slot.key] ?? slot.text;
    const changed = slot.sourceText !== null && text.trim() !== "" && text.trim() !== slot.sourceText.trim();
    const keptType = isTextChangeType(slot.target?.change_type) ? slot.target.change_type : null;
    return changed ? (draft.changeTypes[slot.key] ?? keptType ?? "rewritten") : "as_is";
  };
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
      <div className="relative grid h-full min-h-0 grid-cols-[minmax(0,1fr)_clamp(280px,24vw,420px)]" data-testid="assign">
        {/* 절대 위치라 격자 칸을 차지하지 않는다 - 작업 화면 바닥에서 올라온다 */}
        <SpacePreview
          bundleId={bundleId}
          enabled={!isNewEdit && oldView !== null && rows.length > 0}
          docId={oldDocId}
          docCode={oldView?.document.doc_code ?? ""}
          unitsKey={unitsKey}
          unitIds={row?.unitIds ?? []}
          picked={row && rowUnits.length > 0 ? { id: rowUnits[0].display_id, text: rowUnits.map((unit) => unit.text).join(" ") } : null}
          draft={spaceDraft}
        />
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
            <div ref={setPanes} className="assign-panes" data-single={view.single && !isPairView ? "" : undefined} data-pair-view={isPairView ? "" : undefined} style={{ "--split": `${view.split * 100}%` }}>
              {pairColumns ? (
              // Pair view - Old 칸·New 칸·이음 선 자리에 KO 칸 | 세로선 | EN 칸 | 짝 선. 세로선(폭)과 확대(왼쪽 Old 값, 오른쪽 New 값)는 그대로 쓴다
              <>
              <PairColumn
                side="ko"
                items={pairColumns.ko}
                docLabel={oldDocOptions.find((option) => option.value === String(oldView?.document.id))?.label}
                toggle={<PairViewToggle on onToggle={togglePairViewByButton} />}
                banner={pairBanner !== null && !isNewEdit ? pairBanner : null}
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
                  setSelectedKey(null);
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
                  setSelectedKey(null);
                  setManualPart({ key: "", part });
                }}
                placeholder={<span className="sk h-[480px] w-full" />}
                selectedId={mode === "old" && !isNewEdit ? (cutUnit?.id ?? row?.unitIds[0] ?? soloUnit?.id ?? null) : null}
                highlightIds={mode === "old" ? highlightIds : NO_NUMBERS}
                pickedIds={pickedOld}
                warnBlockIds={warnBlockIds}
                statusOf={readMarkStatus}
                renderNote={placeOf}
                // 삭제·이동한 묶음, 이미 쓴 New 문서(혼자 연 문서)의 묶음과 그 문서에 이은 묶음(입구 2 - 캡션을 그 문서가 정한다)은 캡션이 필요 없다
                isCaptionNeeded={(unitId, hasCaption) => isBundleCaptionNeeded(unitMap.get(unitId), hasCaption, isLinkedToWritten(unitId))}
                // 목차 줄은 Old 문서에서만 흐린 블록으로 접는다(MD 1 F6). 목차 아님은 다듬는 원문이 그 Old 문서일 때만 - New 문장을 고치는 동안은 접고 펴기만
                toc={
                  isSolo
                    ? undefined
                    : {
                        canClear: canEdit && !isNewEdit,
                        busy,
                        onClear: clearToc,
                        open: tocOpen,
                        selected: tocPick !== null && tocPick.docId === oldView?.document.id ? tocPick : null,
                        onToggle: (key) => setTocOpen((open) => toggleTocOpen(open, key)),
                        onPick: (key, unitId) => {
                          if (oldView) selectToc(oldView.document.id, key, unitId, false);
                        },
                      }
                }
                // 제목에서 바꾼 조항 묶음 머리(F8b) - 되돌리기는 다듬는 원문이 그 Old 문서일 때만
                headingShift={isSolo ? undefined : { canRevert: canEdit && !isNewEdit, busy, onRevert: revertHeadings }}
                // 벗긴 표의 줄 묶음 머리 "↺ 다시 표로"(F1) - 다듬는 원문이 그 Old 문서일 때만
                unwrap={isSolo ? undefined : { canRewrap: canEdit && !isNewEdit, busy, onRewrap: rewrapTable }}
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
                        busy,
                        onSave: (unitId, number, follow) =>
                          void runUnitEdit({ type: "set_number", unit_id: unitId, number, follow }, number === null ? t("assign.number.didClear") : t("assign.number.didSet", { n: number }), unitId),
                      }
                    : undefined
                }
                onRangeSelect={
                  canEdit && mode === "old" && oldView
                    ? (range) => {
                        // 목차 줄의 글자는 떼어 내지 않는다(서버 toc_line_locked) - 먼저 목차 아님
                        if (!hasTocLineIn(oldView.units, range.blockId)) setCarvePick({ docId: oldView.document.id, ...range });
                      }
                    : undefined
                }
                banner={
                  pairBanner !== null && !isNewEdit ? (
                    pairBanner
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
                          void runUnitEdit(op, t("split.didCarve"), null);
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
                join={canEdit && mode === "old" ? { busy, plan: planOldJoin, onJoin: joinOld } : undefined}
                renderUnitActions={renderOldActions}
                figureSource={oldView ? { bundleId, docId: oldView.document.id } : undefined}
                zoom={view.zoomOld}
                onZoom={(dir) => zoomPane("old", dir)}
                dragBoxes={isOldDrag}
                headExtra={canPairView ? <PairViewToggle on={false} onToggle={togglePairViewByButton} /> : undefined}
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
                    rows={newRows}
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
                    viewSwitch={
                      isComposedDoc && composedDoc && templateTitles
                        ? {
                            template: view.newTemplate,
                            onChange: (template) => changeView({ newTemplate: template }),
                            body: (
                              <TemplateView
                                doc={composedDoc}
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
        <aside className="assign-side" data-testid="assign-inspector">
          {renderSideBody()}
          <AssignHelp />
        </aside>
      </div>
      {joinLineId === null && renderJoinMenu(false)}
      {menuLineId === null && renderLinkMenu(false)}
      {ctxMenu && ctxGroups && (
        <AssignContextMenu
          key={ctxMenu.seq}
          anchor={ctxMenu.anchor}
          cover={(rowMap.get(ctxMenu.rowKey)?.unitIds ?? []).flatMap((id) => [...document.querySelectorAll<HTMLElement>(`[data-testid="assign-paper-piece-${id}"]`)])}
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
          busy={busy}
          testId="assign-identical-modal"
          onConfirm={() => void confirmIdenticalAll()}
          onClose={() => setConfirmingIdentical(false)}
        />
      )}
      {acceptKind && (
        <AcceptSuggestionsModal
          bundleId={bundleId}
          kind={acceptKind}
          document={acceptDoc}
          busy={busy}
          onAccept={(ids, reason) => void acceptAll(acceptKind, ids, reason)}
          onClose={() => setAcceptKind(null)}
        />
      )}
      {counterpartAsk && (
        <CounterpartModal
          half={readOtherHalf(counterpartAsk.table)}
          choices={counterpartAsk.choices}
          busy={busy}
          onConfirm={(counterpartId) => confirmCounterpart(counterpartAsk.table, counterpartAsk.choices.find((choice) => choice.tableId === counterpartId) ?? null)}
          onClose={() => setCounterpartAsk(null)}
        />
      )}
      {editConfirm && (
        <ConfirmModal
          {...describeEditConfirm(editConfirm)}
          busy={busy}
          testId="assign-edit-confirm"
          onConfirm={() => {
            const { retry } = editConfirm;
            setEditConfirm(null);
            if (retry.kind === "edit") void runUnitEdit(retry.op, retry.okText, retry.followId, true);
            else if (retry.kind === "to_pair") void switchToPair(retry.unit, true);
            else void applySplitSuggestion(retry.unit, retry.suggestion, true);
          }}
          onClose={() => setEditConfirm(null)}
        />
      )}
      {resetScope && bundle && (
        <ResetModal
          bundleId={bundleId}
          scope={resetScope}
          revision={bundle.revision}
          undo={buildUndo(resetScope.kind === "document" ? { scope_label: resetScope.label } : {})}
          onDone={() => {
            markRecorded();
            // 지운 범위의 저장 전 초안은 낡은 판단 위의 고름이라 버린다
            const scope = resetScope;
            setDrafts((prev) => Object.fromEntries(Object.entries(prev).filter(([key]) => scope.kind === "document" && rowMap.get(key)?.documentId !== scope.documentId)));
            setResetScope(null);
            setMenu(null);
            setUnitsKey((key) => key + 1);
            void loadBundle(bundleId);
          }}
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
          onClose={() => {
            focusAfterRef.current = "assign-primary";
            setRemarkEdit(null);
          }}
          onConfirm={(text) => {
            const then = remarkEdit.then;
            focusAfterRef.current = "assign-primary";
            setRemarkEdit(null);
            // 글을 바꾸지 않고 확인하면 초안을 만들지 않는다 - 저장 안 한 변경으로 잡혀 나가기 확인·고치기 막힘이 생기지 않게
            if (text !== reasonNow) setDraft({ reason: text });
            if (then) void runSave(then, text);
          }}
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
            navigate(href, { immediate: true });
          }}
          onClose={() => setLeaveTo(null)}
        />
      )}
      {bulk && (
        <BulkModal
          bundleId={bundleId}
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
              }, buildUndo());
              markRecorded();
              showToast(t("classify.bulkDone", { n: unitRows.length }));
              setBulk(null);
              setChecked(new Set());
              // 한 번에 삭제·이동도 서버가 짝을 정리하지만 어느 짝인지 알려 주지 않는다 - 짝 모양·문서 revision을 다시 받는다
              views.reload();
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


interface BulkModalProps {
  bundleId: number;
  action: "delete" | "move";
  count: number;
  onClose: () => void;
  onConfirm: (reason: string, code: string) => Promise<void>;
}

function BulkModal({ bundleId, action, count, onClose, onConfirm }: BulkModalProps) {
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
      {/* 하나씩 저장할 때의 Remark 창과 같은 칸·최근 사유 - 이 창 안에서 바로 쓴다(창 위에 창을 열지 않는다) */}
      <label className="grid gap-1">
        <span className="text-xs text-ink-2">{t("classify.reason")}</span>
        <textarea
          rows={3}
          className="block w-full resize-y rounded-md border border-line-2 bg-surface px-2 py-[5px] text-[13px] leading-[19px] text-ink focus:border-accent focus:outline-none"
          data-testid="assign-bulk-reason"
          value={reason}
          maxLength={REMARK_MAX_LENGTH}
          autoFocus
          onChange={(event) => setReason(event.target.value)}
        />
      </label>
      <RecentRemarks testId="assign-bulk-recent" onPick={setReason} />
      {action === "move" && (
        <div className="grid gap-1">
          <span className="text-xs text-ink-2">{t("classify.moveTo")}</span>
          <MoveTargetField bundleId={bundleId} value={code} testId="assign-bulk-code" onChange={setCode} />
        </div>
      )}
    </Modal>
  );
}