// Assign 왼쪽 - Old 원문이 곧 목록이다. Split과 같은 Unit 조각(앞 KO/EN·H 태그, 끝 상태 표시)에 확정한 조각의 간 곳을 한 줄 덧붙인다.
// 필터가 걸리면 용지를 그 필터로 접고, 지금 문서·부분에 맞는 문장이 없으면 용지 대신 빈 상태와 맞는 곳 바로 가기를 둔다.
"use client";

import { ListFilter } from "lucide-react";
import type { ReactNode } from "react";

import { PaneZoom } from "@/components/assign/pane-zoom";
import { Paper, type CutDragPos, type PaperCut } from "@/components/paper/paper";
import { PartTabs } from "@/components/paper/part-tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { Select, type SelectOption } from "@/components/ui/select";
import type { ViewUnit } from "@/lib/api-sop";
import { useI18n } from "@/lib/i18n";
import type { FoldOpen } from "@/lib/paper-fold-model";
import type { PaperModel, PaperTabKey } from "@/lib/paper-model";

interface OldPaneProps {
  docOptions: SelectOption<string>[];
  docId: string;
  onDocChange: (docId: string) => void;
  /** 고른 문서의 제목 - 좁으면 말줄임 */
  docTitle: string;
  model: PaperModel | null;
  /** 필터 접기 - 없으면(All·출처 없는 New 모드) 용지 전부 */
  fold?: { matchIds: ReadonlySet<number>; open: FoldOpen; onOpenChange: (next: FoldOpen) => void };
  /** 지금 문서·부분에 맞는 문장이 없을 때 용지 대신 보일 바로 가기(문서·부분·수) - null이면 용지 */
  foldEmpty: Array<{ docId: number; part: PaperTabKey; label: string }> | null;
  onFoldGo: (docId: number, part: PaperTabKey) => void;
  /** 모델을 아직 못 받았을 때(스켈레톤·빈 화면) */
  placeholder: ReactNode;
  selectedId: number | null;
  highlightIds: ReadonlySet<number>;
  pickedIds: ReadonlySet<number>;
  statusOf: (unitId: number) => ViewUnit["status"] | undefined;
  renderNote: (unitIds: number[]) => ReactNode;
  /** 조각 오른쪽 칸 - 연결 배지 */
  renderPills: (unitId: number) => ReactNode;
  /** 내용이 있는 본문·머리말·꼬리말 탭 - 둘 이상일 때만 탭 줄을 그린다 */
  partKeys: readonly PaperTabKey[];
  activePart: PaperTabKey;
  onPartChange: (key: PaperTabKey) => void;
  /** Shift는 일괄 고르기 */
  onUnitClick: (unitId: number, keys: { shiftKey: boolean }) => void;
  /** 우클릭·메뉴 글쇠 - 누른 자리와 글자 자리 */
  onUnitContextMenu?: (unitId: number, at: { x: number; y: number }, caret: { blockId: number; offset: number } | null) => void;
  /** 두 번 누르기 - 나눌 선을 놓는다 */
  onUnitDoubleClick?: (unitId: number, caret: { blockId: number; offset: number } | null) => void;
  /** 나눌 선(Split과 같은 부품) - 고른 Unit(selectedId) 안에만 그린다 */
  cut?: PaperCut | null;
  onCutDrag?: (pos: CutDragPos) => void;
  onCutNudge?: (step: 1 | -1) => void;
  renderAtCut?: () => ReactNode;
  figureSource?: { bundleId: number; docId: number };
  zoom: number;
  onZoom: (dir: "+" | "-") => void;
}

const IS_CHECKED = () => true;

export function OldPane(props: OldPaneProps) {
  const { t } = useI18n();
  const { model } = props;
  return (
    <section className="assign-pane" style={{ "--z": props.zoom }} data-pane="old" data-testid="assign-old">
      <div className="pane-head">
        {props.docOptions.length > 1 ? (
          <Select testId="assign-old-doc" ariaLabel={t("assign.oldDoc")} size="sm" mono value={props.docId} options={props.docOptions} onChange={props.onDocChange} />
        ) : (
          <span className="pane-title">{props.docOptions[0]?.label}</span>
        )}
        <span className="tag">Old</span>
        <span className="pane-sub">{props.docTitle}</span>
        <span className="flex-1" />
        <PaneZoom value={props.zoom} onStep={props.onZoom} testId="assign-old-zoom" />
      </div>
      {props.partKeys.length > 1 && (
        <div className="flex items-center">
          <PartTabs keys={props.partKeys} active={props.activePart} onChange={props.onPartChange} testIdPrefix="assign-tab" />
        </div>
      )}
      <div className="pane-body">
        {model && props.foldEmpty !== null ? (
          <EmptyState
            icon={ListFilter}
            testId="assign-fold-empty"
            title={t("assign.foldEmpty")}
            action={
              props.foldEmpty.length > 0 && (
                <div className="fold-elsewhere">
                  <span className="fold-elsewhere-label">{t("assign.foldElsewhere")}</span>
                  {props.foldEmpty.map((place) => (
                    <button key={`${place.docId}-${place.part}`} type="button" className="btn fold-go" data-testid={`assign-fold-go-${place.docId}-${place.part}`} onClick={() => props.onFoldGo(place.docId, place.part)}>
                      {place.label}
                    </button>
                  ))}
                </div>
              )
            }
          />
        ) : model ? (
          <Paper
            model={model}
            items={props.partKeys.length > 1 ? model[props.activePart] : undefined}
            selectedId={props.selectedId}
            highlightIds={props.highlightIds}
            pickedIds={props.pickedIds}
            onUnitClick={(unitId, _at, event) => props.onUnitClick(unitId, { shiftKey: event.shiftKey })}
            onUnitContextMenu={props.onUnitContextMenu}
            onUnitDoubleClick={props.onUnitDoubleClick}
            cut={props.cut}
            onCutDrag={props.onCutDrag}
            onCutNudge={props.onCutNudge}
            renderAtCut={props.cut ? props.renderAtCut : undefined}
            figureSource={props.figureSource}
            contour
            strips={{ isChecked: IS_CHECKED, hideChecked: true, statusOf: props.statusOf, renderNote: props.renderNote, renderPills: props.renderPills, fold: props.fold }}
            testId="assign-paper"
          />
        ) : (
          props.placeholder
        )}
      </div>
    </section>
  );
}
