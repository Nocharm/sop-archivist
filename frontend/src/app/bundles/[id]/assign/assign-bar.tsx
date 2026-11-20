// Assign 화면의 한 부분 - page.tsx의 그리기에서 글자 그대로 옮겼다(쪼개기, 신뢰 기반 계획 스텝 4). 상태와 동작은 useAssignPage()가 준다.
"use client";

import { BookMarked, Captions, Columns2, ExternalLink, Redo2, Square, Trash2, Undo2, WandSparkles } from "lucide-react";
import { MissingWarnings } from "@/components/assign/missing-warnings";
import { AssignMoreMenu } from "@/components/assign/more-menu";
import { PendingCount } from "@/components/assign/pending-count";
import { ReadOnlyNote } from "@/components/read-only-note";
import { FilterChip } from "@/components/status";
import { Tooltip } from "@/components/ui/tooltip";
import { loadBundle } from "@/lib/bundle-store";

import { type AssignPageState, FILTERS, FILTER_ICON } from "./use-assign-page";

export function AssignBar({ state }: { state: AssignPageState }) {
  const {
    t, bundleId, bundle, canEdit, docs, oldDocIds, identical, aiOn, rows, rowMap, rowOfUnit, mode, filter, counts, applyFilter, checked,
    viewOf, setManualOldDoc, oldView, view, changeView, aiMenuItems, isAnyPending, undoState, setBulk, setConfirmingIdentical, setResetScope,
    selectRow, goToUnit, refPendingIds, captionPendingKeys, splitPendingIds, readPendingItem, selectNextSplit, selectNextRef,
    selectNextCaption, runUndoStep, done,
  } = state;

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
              <button type="button" className="btn icon h-7 w-7" aria-label={t("assign.undo")} data-testid="assign-undo" disabled={isAnyPending || !undoState.canUndo} onClick={() => void runUndoStep("undo")}>
                <Undo2 size={14} strokeWidth={1.5} aria-hidden />
              </button>
            </Tooltip>
            <Tooltip label={t("assign.redo")}>
              <button type="button" className="btn icon h-7 w-7" aria-label={t("assign.redo")} data-testid="assign-redo" disabled={isAnyPending || !undoState.canRedo} onClick={() => void runUndoStep("redo")}>
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
          // 묶음 전체 일(같은 글자 확정 · 초기화)은 다른 일이 처리 중이면 시작하지 않는다
          disabled={isAnyPending}
          identicalCount={identicalCount}
          onIdentical={() => setConfirmingIdentical(true)}
          aiItems={aiOn ? aiMenuItems : []}
          resetDocument={oldView ? { id: oldView.document.id, label: oldView.document.doc_code || oldView.document.file_name } : null}
          onReset={setResetScope}
        />
      </div>
    </div>
  );

  return bar;
}
