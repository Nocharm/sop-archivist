// Assign 화면의 한 부분 - page.tsx의 그리기에서 글자 그대로 옮겼다(쪼개기, 신뢰 기반 계획 스텝 4). 상태와 동작은 useAssignPage()가 준다.
"use client";

import { ArrowDown, ArrowUp, Check, Columns2, FilePen, Link2, ListTree, Locate, MapPin, RefreshCw, Sparkles, Trash2, TriangleAlert, Undo2 } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { DestCard } from "@/components/assign/dest-card";
import { DestinationAccordion, type AccordionSection } from "@/components/assign/destination-accordion";
import { DestinationTree } from "@/components/assign/destination-tree";
import { CaptionRefList } from "@/components/assign/caption-ref-list";
import { CaptionSlot } from "@/components/assign/caption-slot";
import { RefCard } from "@/components/assign/ref-card";
import { ShapeTools } from "@/components/assign/shape-tools";
import { SplitSuggestionCard } from "@/components/assign/split-suggestion";
import { ChangeKindChip } from "@/components/assign/change-kind-chip";
import { LinkChoice } from "@/components/assign/link-choice";
import { RemarkLine } from "@/components/assign/remark-modal";
import { LangToken } from "@/components/paper/lang-token";
import { UnitStatusChip } from "@/components/status";
import { ClampText } from "@/components/ui/clamp-text";
import { EmptyState } from "@/components/ui/empty-state";
import { Refresh, Truncate } from "@/components/ui/motion";
import { Tooltip } from "@/components/ui/tooltip";
import { formatPlacePosition, readPlacePosition } from "@/lib/place-spot-model";
import { type ViewUnit, type WrittenSentence } from "@/lib/api-sop";
import { isBundleKind, listCaptionFields } from "@/lib/caption-model";
import { buildCaptionSlot, type CaptionCandidate } from "@/lib/caption-slot-model";
import { countJoinedLines } from "@/lib/join-sentence-model";
import { canMakeOtherLanguage, isRecommendationPicked, listCoConfirmed, listSiblingPlaces, pickNearby, type Recommendation } from "@/lib/assign-model";
import { readRewrites } from "@/lib/ai-suggestion-model";
import { getDestinationId, hasRowLanguage, isHeadingSourceUnit, isPlaceOption, listTreeOptions, listTreeRows, isSentenceUnit, isTranslationOf, listJoinedTargetIds, listLinkLeftovers, pickLinkUnits, previewLinkChange, previewSlotChange, readCheckKey, readSlotKind, type DestinationOption } from "@/lib/classify-model";
import { formatKst } from "@/lib/datetime";
import { findNearestCut } from "@/lib/paper-model";
import { getNewDocumentsHref } from "@/lib/stages";
import { readRefAdvice } from "@/lib/ref-model";
import { buildTocBlock, describeTocParts, toggleTocOpen } from "@/lib/toc-block-model";

import { type AssignPageState, SYSTEM_HOLDS } from "./use-assign-page";

/** 고른 박스를 맨 앞으로(나머지는 그 순서대로) - 머리의 Unit 번호가 Shape 줄과 같은 차례로 읽힌다(설계 D3) */
function putFirst<T>(items: readonly T[], isFirst: (item: T) => boolean): T[] {
  return [...items.filter(isFirst), ...items.filter((item) => !isFirst(item))];
}

/** headEnd - 칸 머리 끝에 앉는 단추(좁은 창의 떼기, side-float). 없으면 null */
export function AssignSidePanel({ state, headEnd }: { state: AssignPageState; headEnd: ReactNode }) {
  const {
    t, bundleId, canEdit, unitsKey, reloadData, docViews, tobeData, aiJobs, aiOn, aiBusy, suggestions, invalidUnitIds, unitMap, written,
    writtenMap, rowOfUnit, options, isDrafting, hiddenPlace, legacyMove, openTranslations, translationBlocked, settleTranslations, mode, activeKey, row, isNewEdit, hasSolo, tocOpen, setTocOpen, tocPick, tocBlocks, newRemarks,
    setNewRemarks, cutUnitId, focusNew, groupData, draft, editing, savedDestination, destination, rowUnits, rowLangs, firstDecision,
    systemHold, reasonNow, setDraft, rowLive, aiDest, aiWhy, recommendations, linkIds, pickedGroups, saveGroupData,
    viewOf, oldView, splitByUnit, shapeView, shapeModel, soloUnits, cutLine, writtenDocs, composedDoc, view, changeView, askAiScope,
    setRemarkEdit, firstTextRef, busy, isAnyPending, accOpen, toggleAcc, saveUnits, slots, aiUnfilled, draftPlace, draftSectionKey, draftPosition,
    placeResolved, setRefEntryId, moveRow, hasUnitDraft, isFixedCaption, rowViewUnits, rowSplitUnit, rowSplit, splitBlocked, rowRefUnit,
    refBlocked, isRefGate, isCaptionGateOn, confirmBlockKey, rowCaptionRefs, refCandidates, shapeLines, shapeFirstId, slotPlaces, slotCellTables, startCaptionPick,
    shapeMode, headingBack, rewrap, bandBack, stepBase, refPendingIds, refDetail, refInfo, runUnitEdit, clearToc, runCaptionRefChange,
    switchShapeMode, applySplitSuggestion, dismissSplitSuggestion, selectNextSplit, selectNextRef, runUnitAction, readReasonNeed, runSave,
    runClear, markNew, placeManage, pickDestination, pickNewSentence, isTemplateDrag, handlePrimary, startEdit,
    pickRecommendation, markRecHover, renderPlaceLabel, listDestinationEls, canClear, isRowDeleted,
  } = state;




  // --- 그리기 ---
  const isPlace = destination?.kind === "slot" || destination?.kind === "step";
  const primaryState = !destination ? "choose" : editing ? "save" : "confirm";
  // 줄에 이미 그 언어 새 문장이 있으면(직접 쓴 것·쓰는 중인 칸·AI 번역) 만들기·쓰기를 보이지 않는다. 새 문서를 숨긴 동안은 늘 없다
  const missingLang = !isDrafting ? null : canMakeOtherLanguage(rowLangs, savedDestination, row?.status === "confirmed");
  const otherLang = missingLang !== null && !hasRowLanguage(missingLang, slots, groupData, row?.unitIds ?? []) ? missingLang : null;
  // 직접 쓰는 다른 언어 문장의 출처 - 줄의 글 단위(문장·제목·묶이지 않은 칸 문장. 표·그림은 칸 문장을 따로 쓰지 않는다)
  const writeOtherUnit = rowUnits.find((unit) => isSentenceUnit(unit.kind))?.unit_id ?? null;
  // 고른 곳 상자의 쉬머 열쇠 - 고른 보낼 곳과 자리(설계 2026-11-20 D5). 보낼 곳을 고르거나 바꾸면 한 번 쓸고, 다른 박스를 고르면
  // 상자를 새로 붙여(key) 쓸지 않는다 - 그때는 결정 칸 전체가 고른 Unit 열쇠로 한 번 쓴다(겹쳐 두 번 쓸지 않게)
  const chosenToken = draft.destination ? `${getDestinationId(draft.destination)}@${draft.position ? String(draft.position.after) : "end"}` : "";

  /** 다른 언어 직접 쓰기 - 고쳐 쓰기로 들어가 빈 칸 하나를 더하고 그 칸에 포커스 */
  function startWriteOther(lang: "ko" | "en", unitId: number) {
    setDraft({ otherLang: { lang, unitId } }, true);
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(`[data-testid="assign-text-x${unitId}"]`)?.focus());
  }

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
    if (rec.destination.kind === "delete") {
      return (
        <DestCard
          key={rec.key}
          icon={Trash2}
          tone="danger"
          title={t("assign.acc.move")}
          text={t("classify.deleted")}
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
  // 숨긴 새 문서의 자리는 고를 거리가 아니라 첫 추천의 둘레를 보인다
  const nearAnchor = (hiddenPlace === null ? destination : null) ?? recommendations[0]?.destination ?? null;
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
    { key: "all", icon: ListTree, title: t("assign.acc.all"), count: written.length + options.filter(isPlaceOption).length, body: <DestinationTree written={written} rows={isDrafting && tobeData ? listTreeRows(tobeData, treeOptions) : []} tobeHref={getNewDocumentsHref(bundleId)} onPickLink={pickNewSentence} onPickPlace={pickDestination} manage={placeManage} /> },
    {
      key: "move",
      icon: Trash2,
      title: t("assign.acc.move"),
      body: (
        <>
          <button type="button" className="tree-leaf" aria-pressed={destination?.kind === "delete"} data-testid="assign-pick-delete" onClick={() => pickDestination({ kind: "delete" })}>
            {t("classify.deleted")}
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
          <button type="button" className="btn ghost h-6 flex-none px-1.5 text-xs" data-testid={`assign-ref-advice-use-${slotKey}`} onClick={() => setDraft({ texts: { ...draft.texts, [slotKey]: advice.text } })}>
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
          // 종류는 읽기만 - 나눔·합침·번역은 서버가 구조에서, "=" / "수정"은 글 비교로 정한다(화면은 같은 규칙의 미리 보기)
          const structural = readSlotKind(slot, slots);
          const changeKind = structural ? (
            <ChangeKindChip kind={structural} testId={`assign-slot-kind-${slot.key}`} />
          ) : (
            <ChangeKindChip kind={previewSlotChange(slot, draft.texts[slot.key])} testId={`assign-slot-change-${slot.key}`} />
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
                  {changeKind}
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
              {/* 고쳐 쓰는 동안도 같은 표시 - 글이 원문과 달라지면 "="가 "수정"으로 바뀐다 */}
              <span className="flex h-7 items-center gap-2 text-xs text-ink-2">
                {t("classify.changeType")}
                {changeKind}
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
        <Refresh key={shapeFirstId ?? ""} token={chosenToken} className="chosen-box is-empty" testId="assign-chosen">
          {t("assign.chosen.empty")}
        </Refresh>
      );
    }
    if (hiddenPlace !== null) {
      return (
        <Refresh key={shapeFirstId ?? ""} token={chosenToken} className="chosen-box" testId="assign-chosen">
          <p className="text-[13px] leading-5 text-ink" data-testid="assign-hidden-place">
            {t("assign.hidden.place", { code: hiddenPlace.docCode || "–", label: hiddenPlace.label || "–" })}
          </p>
        </Refresh>
      );
    }
    if (legacyMove !== null) {
      return (
        <Refresh key={shapeFirstId ?? ""} token={chosenToken} className="chosen-box" testId="assign-chosen">
          <p className="text-[13px] leading-5 text-ink" data-testid="assign-legacy-move">
            {t("assign.legacyMove", { code: legacyMove.code || "–" })}
          </p>
        </Refresh>
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
    // 줄에 없는 언어의 문장은 번역이다 - 나눔도 같은 언어 문장끼리만 센다(제품 명세 §6.7)
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
      <Refresh key={shapeFirstId ?? ""} token={chosenToken} className="chosen-box" testId="assign-chosen">
        <span className="chosen-label">
          {isConfirmedView && <Check size={13} strokeWidth={2} className="flex-none" aria-hidden />}
          <Truncate
            text={`${isConfirmedView ? `${t("assign.chosen.confirmed")} · ` : ""}${destination.kind === "link" ? `${t("assign.chosen.link")} · ${[...new Set(pickedRows.map((item) => item.doc_code))].join(", ")}` : destination.kind === "join" ? t("assign.chosen.join") : destination.kind === "slot_heading" ? t("assign.slotHeading") : isPlace ? (mergedLines >= 2 ? t("assign.chosen.merged", { n: mergedLines }) : t("assign.chosen.place")) : t("assign.acc.move")}`}
          />
        </span>
        {destination.kind === "delete" && (
          <span className="flex items-center gap-1.5 text-sm font-semibold text-ink">
            <Trash2 size={14} strokeWidth={1.75} className="flex-none text-danger" aria-hidden />
            {t("classify.deleted")}
          </span>
        )}
        {destination.kind === "link" && (
          <LinkChoice
            rows={pickedRows}
            translatedIds={translatedIds}
            changes={Object.fromEntries(pickedRows.map((item) => [item.target_id, previewLinkChange({ kind: item.kind, lang: item.lang, confirmed_text: item.text, change_type: item.change_type, source_unit_ids: item.source_unit_ids }, rowUnits, row?.unitIds ?? [])]))}
            auto={auto}
            mergedWith={mergedWith}
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
      </Refresh>
    );
  }

  // 남은 번역 줄(확정 전 AI 번역 · 보류로 돌아간 번역) - 고른 곳과 상관없이 정할 수 있게 고른 곳 상자 아래에
  const translationBox = openTranslations.length > 0 && (
    <div className="chosen-box" data-testid="assign-translations">
      <span className="chosen-label">{t("assign.hidden.translations")}</span>
      {openTranslations.map((item) => (
        <div key={item.id} className="chosen-line" data-testid={`assign-translation-${item.id}`}>
          <LangToken lang={item.lang} />
          <span className="min-w-0 flex-1 text-[13px] leading-5 text-ink">
            <ClampText text={item.text} />
          </span>
        </div>
      ))}
      {canEdit && translationBlocked && <p className="text-xs text-ink-2" data-testid="assign-translation-blocked">{t("assign.hidden.translationBlocked")}</p>}
      {canEdit && (
        <div className="flex flex-wrap gap-1.5">
          {/* 출처 문장이 없어진 번역(배정 취소)은 지우기만 */}
          {openTranslations.some((item) => item.can_confirm) && (
            <button type="button" className="btn h-7" data-testid="assign-translation-confirm" disabled={isAnyPending || translationBlocked} onClick={() => void settleTranslations(openTranslations, "confirm")}>
              <Check size={14} strokeWidth={1.5} aria-hidden />
              {t("assign.hidden.translationConfirm")}
            </button>
          )}
          <button type="button" className="btn h-7" data-testid="assign-translation-remove" disabled={isAnyPending || translationBlocked} onClick={() => void settleTranslations(openTranslations, "remove")}>
            <Trash2 size={14} strokeWidth={1.5} aria-hidden />
            {t("assign.hidden.translationRemove")}
          </button>
        </div>
      )}
    </div>
  );

  // 확정 단추 - 결정 칸 맨 아래 늘 같은 자리의 가장 큰 단추. 고른 곳이 없으면 흐리게 꺼지고 까닭은 툴팁(↵는 위 목록의 첫 후보로 간다)
  const confirmButton = (
    <Tooltip label={t((destination !== null ? confirmBlockKey : null) ?? "assign.why.pickFirst")} suppressed={(destination !== null && confirmBlockKey === null) || !row}>
      <button type="button" className="btn pri assign-confirm" data-testid="assign-primary" data-state={primaryState} disabled={!canEdit || !row || busy || !destination || isRefGate || isCaptionGateOn || hiddenPlace !== null || legacyMove !== null} onClick={handlePrimary}>
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
          {t(isRowDeleted ? "assign.ctx.undoDelete" : "classify.clear")} <kbd className="@max-[200px]:hidden">U</kbd>
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
      // 삭제는 Remark를 비우면 처분 이름으로 기록된다 - 빈 자리에 그 글을 흐리게 보인다
      emptyLabel={destination?.kind === "delete" ? t("remark.defaultDelete") : "–"}
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
  const builtCaptionSlot = rowBundle && shapeModel && slotPlaces
    ? buildCaptionSlot({ bundle: rowBundle, units: shapeModel.units, places: slotPlaces, cellTables: slotCellTables, written: captionFields.filter((field) => field.unitId === null) })
    : null;
  // 캡션 써 넣기는 새 문서 칸의 고쳐 쓰기라 숨긴 동안 후보에서 뺀다
  const captionSlot = builtCaptionSlot && !isDrafting ? { ...builtCaptionSlot, candidates: builtCaptionSlot.candidates.filter((candidate) => candidate.kind !== "write") } : builtCaptionSlot;
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
        onPickLine={() => startCaptionPick(bundleId)}
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
              {headEnd}
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

  // 머리가 없는 모양(고르기 전 · 다 끝난 출처 없음)에서는 단추만 있는 머리 한 줄
  const bareHead = headEnd ? <div className="flex flex-none justify-end px-[var(--pad)] pt-3">{headEnd}</div> : null;

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
                  {headEnd && <span className="ml-auto flex-none">{headEnd}</span>}
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
                <button type="button" className="btn pri assign-confirm" data-testid="assign-mark-new" disabled={!canEdit || isAnyPending} onClick={markNew}>
                  {t("assign.markNew")}
                </button>
              </div>
            </>
          ) : (
            <>
              {bareHead}
              <EmptyState icon={Check} testId="assign-unsourced-done" title={t("assign.unsourced.title")} body={t("assign.unsourced.done")} compact />
            </>
          )}
        </div>
      );
    }
    if (hasSolo) {
      return (
        <div className="assign-side-body" data-testid="assign-solo">
          <div className="assign-side-head">
            <div className="flex items-center gap-2">
              <Truncate className="min-w-0 flex-1 font-mono text-sm font-semibold" text={putFirst(soloUnits, (unit) => unit.id === shapeFirstId).map((unit) => unit.display_id).join(" · ") || (shapeView?.document.doc_code ?? "–")} testId="assign-row-id" />
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
                {headEnd}
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
          {bareHead}
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
            <Truncate className="min-w-0 flex-1 font-mono text-sm font-semibold" text={putFirst(rowUnits, (unit) => unit.unit_id === shapeFirstId).map((unit) => unit.display_id).join(" · ") || "–"} testId="assign-row-id" />
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
              {headEnd}
            </span>
            {(docViews.error ?? suggestions.error) !== null && (
              <button type="button" className="btn h-6 gap-1 px-1.5 text-xs font-normal text-st-hold" data-testid="assign-refresh-error" onClick={() => reloadData(true)}>
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
        <div className="assign-pick" data-testid="assign-pick">
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
          {isDrafting && <div className="px-[var(--pad)] pb-[var(--pad)] pt-1">{aiNote}</div>}
        </div>
        {/* ② 결정 칸 - 패널 아래에 붙는다. 다른 길 셋 · 고른 곳(높이 상한 안에서 이 부분만 스크롤) · 대상 문서 · Remark · 맨 아래 확정.
            다른 박스를 고르면 내용이 통째로 바뀌니 그 자리에서 한 번 쓸고 지나간다(스크롤로 끌지 않는다, 설계 2026-11-20 D5) */}
        <Refresh token={shapeFirstId ?? ""} className="assign-decide" testId="assign-decide">
          <div className="assign-decide-body">
            {renderStep(stepBase + 2, t("assign.step.decide"))}
            {actions}
            {renderChosen()}
            {translationBox}
          </div>
          {remarkRow}
          {confirmButton}
        </Refresh>
      </div>
    );
  }

  return renderSideBody();
}
