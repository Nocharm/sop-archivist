// Assign 왼쪽 - Old 원문이 곧 목록이다. Split과 같은 Unit 조각(앞 KO/EN·H 태그, 끝 상태 표시)에 확정한 조각의 간 곳을 한 줄 덧붙인다.
// 필터가 걸리면 용지를 그 필터로 접고, 지금 문서·부분에 맞는 문장이 없으면 용지 대신 빈 상태와 맞는 곳 바로 가기를 둔다.
"use client";

import { ListFilter } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import { PaneZoom } from "@/components/assign/pane-zoom";
import { Paper, type CutDragPos, type PaperCut } from "@/components/paper/paper";
import { PartTabs } from "@/components/paper/part-tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { Select, type SelectOption } from "@/components/ui/select";
import type { ViewUnit } from "@/lib/api-sop";
import { useI18n } from "@/lib/i18n";
import type { FoldOpen } from "@/lib/paper-fold-model";
import type { PaperItem, PaperModel, PaperSheet, PaperTabKey } from "@/lib/paper-model";
import type { JoinKind, JoinPlan } from "@/lib/split-menu-model";

interface OldPaneProps {
  docOptions: SelectOption<string>[];
  docId: string;
  onDocChange: (docId: string) => void;
  /** 고른 문서의 제목 - 좁으면 말줄임 */
  docTitle: string;
  /** 문서 이름 옆의 꼬리표 - 한 단으로 연 New 문서면 그 이름 */
  docTag: string;
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
  /** 확인이 남은 누락 의심 경고가 걸린 문단 - 그 줄에 경고 표시가 붙는다 */
  warnBlockIds: ReadonlySet<number>;
  statusOf: (unitId: number) => ViewUnit["status"] | undefined;
  renderNote: (unitIds: number[]) => ReactNode;
  /** 조각 오른쪽 칸 - 연결 배지 */
  renderPills: (unitId: number) => ReactNode;
  /** 머리 줄에 "Caption needed"를 띄울 표·그림 단위(lib/caption-model isCaptionNeeded) */
  isCaptionNeeded: (unitId: number, hasCaption: boolean) => boolean;
  /** 목차 줄을 흐린 블록 하나로 접는다(Old 문서) - 없으면 보통 조각(한 단으로 연 New 문서) */
  toc?: NonNullable<NonNullable<ComponentProps<typeof Paper>["strips"]>["toc"]>;
  /** 내용이 있는 본문·머리말·꼬리말 탭 - 둘 이상일 때만 탭 줄을 그린다 */
  partKeys: readonly PaperTabKey[];
  activePart: PaperTabKey;
  /** 머리말·꼬리말 탭의 쪽들(설명 줄과 함께 따로 그린다) - 본문 탭이면 null */
  sheets: readonly PaperSheet[] | null;
  onPartChange: (key: PaperTabKey) => void;
  /** 표·그림 어디를 눌러도 묶음 전체를 고른다 - 한/영 짝을 고르거나 쓴 New 문서를 혼자 다듬는 중에는 꺼서 칸 문장을 그대로 고른다 */
  pickWholeBundle: boolean;
  /** Shift는 일괄 고르기 */
  onUnitClick: (unitId: number, keys: { shiftKey: boolean }) => void;
  /** 우클릭·메뉴 글쇠 - 누른 자리와 글자 자리 */
  onUnitContextMenu?: (unitId: number, at: { x: number; y: number }, caret: { blockId: number; offset: number } | null) => void;
  /** 번호 칸 손잡이 - 주면 번호 칸을 눌러 문단 번호를 고친다(작성자만, 쪼개기 편집이라 Ctrl+Z로 되돌린다) */
  numberCell?: { busy: boolean; onSave: (unitId: number, number: string | null, follow: boolean) => void };
  /** 두 번 누르기 - 나눌 선을 놓는다 */
  onUnitDoubleClick?: (unitId: number, caret: { blockId: number; offset: number } | null) => void;
  /** 한 문단 안에서 글자를 끌어 고름 - 고른 범위로 새 Unit을 만든다(작성자만) */
  onRangeSelect?: (range: { blockId: number; start: number; end: number }) => void;
  /** 용지 위 한 줄 - 고른 범위로 Unit 만들기 같은, 용지에 대한 잠깐의 동작 */
  banner?: ReactNode;
  /** 나눌 선(Split과 같은 부품) - 고른 Unit(selectedId) 안에만 그린다 */
  cut?: PaperCut | null;
  onCutDrag?: (pos: CutDragPos) => void;
  onCutNudge?: (step: 1 | -1) => void;
  renderAtCut?: () => ReactNode;
  /** 조각 사이의 붙이기 단추(원문 고치기와 같은 부품) - 작성자만 */
  join?: { busy: boolean; plan: (firstId: number, secondId: number) => JoinPlan; onJoin: (firstId: number, secondId: number, kind: JoinKind) => void };
  /** 고른 조각의 글 아래 단추 줄 - 합친 문장 풀기 */
  renderUnitActions?: (unitId: number) => ReactNode;
  figureSource?: { bundleId: number; docId: number };
  zoom: number;
  onZoom: (dir: "+" | "-") => void;
  /** 조각을 끌 수 있다(끌어서 잇기) - 끄면 글자가 지금처럼 그냥 긁힌다 */
  dragBoxes?: boolean;
  /** 머리의 확대 단추 바로 앞에 그린다 - 한/영 따로 문서의 Pair view 단추 */
  headExtra?: ReactNode;
  /** 문서 고르기 바로 옆 - 문서 대시보드 단추 */
  docDash?: ReactNode;
}

export function OldPane(props: OldPaneProps) {
  const { t } = useI18n();
  const { model } = props;

  /** 쪽의 설명 줄 - 쓰이는 구역(1구역 · 첫 쪽…), 구역 정보가 없는 옛 추출이나 각주는 "머리말 2"처럼 차례로 */
  function describeSheet(sheet: PaperSheet, index: number): string {
    if (sheet.refs.length === 0) return t("split.sheetOrdinal", { name: t(`split.part.${sheet.part}`), n: index + 1 });
    return sheet.refs.map((ref) => t("split.sheetRef", { n: ref.section, type: t(`split.refType.${ref.type}`) })).join(", ");
  }

  function renderPaper(paperModel: PaperModel, items: PaperItem[] | undefined) {
    return (
      <Paper
        model={paperModel}
        items={items}
        selectedId={props.selectedId}
        highlightIds={props.highlightIds}
        pickedIds={props.pickedIds}
        warnBlockIds={props.warnBlockIds}
        onUnitClick={(unitId, _at, event) => props.onUnitClick(unitId, { shiftKey: event.shiftKey })}
        onUnitContextMenu={props.onUnitContextMenu}
        onUnitDoubleClick={props.onUnitDoubleClick}
        onRangeSelect={props.onRangeSelect}
        shiftClickPicks
        pickWholeBundle={props.pickWholeBundle}
        cut={props.cut}
        onCutDrag={props.onCutDrag}
        onCutNudge={props.onCutNudge}
        renderAtCut={props.cut ? props.renderAtCut : undefined}
        figureSource={props.figureSource}
        strips={{ statusOf: props.statusOf, renderNote: props.renderNote, renderPills: props.renderPills, fold: props.fold, join: props.join, isCaptionNeeded: props.isCaptionNeeded, toc: props.toc }}
        renderUnitActions={props.renderUnitActions}
        dragBoxes={props.dragBoxes}
        numberCell={props.numberCell}
        testId="assign-paper"
      />
    );
  }

  return (
    <section className="assign-pane" style={{ "--z": props.zoom }} data-pane="old" data-testid="assign-old">
      <div className="pane-head">
        {props.docOptions.length > 1 ? (
          <Select testId="assign-old-doc" ariaLabel={t("assign.oldDoc")} size="sm" mono value={props.docId} options={props.docOptions} onChange={props.onDocChange} />
        ) : (
          <span className="pane-title">{props.docOptions[0]?.label}</span>
        )}
        {props.docDash}
        <span className="tag" data-testid="assign-old-tag">{props.docTag}</span>
        <span className="pane-sub">{props.docTitle}</span>
        <span className="flex-1" />
        {props.headExtra}
        <PaneZoom value={props.zoom} onStep={props.onZoom} testId="assign-old-zoom" />
      </div>
      {props.partKeys.length > 1 && (
        <div className="flex items-center">
          <PartTabs keys={props.partKeys} active={props.activePart} onChange={props.onPartChange} testIdPrefix="assign-tab" />
        </div>
      )}
      {props.banner}
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
          props.sheets !== null ? (
            // 머리말·꼬리말 탭 - 묶음(구역마다 다른 머리말…)마다 한 쪽이고 어디에 쓰이는지 설명 줄이 붙는다
            <div className="grid w-full gap-[22px]">
              {props.sheets.map((sheet, index) => (
                <div key={sheet.key} className="sheet-set">
                  <p className="sheet-cap" data-testid={`assign-sheet-cap-${sheet.key}`}>
                    {describeSheet(sheet, index)}
                  </p>
                  {renderPaper(model, sheet.items)}
                </div>
              ))}
            </div>
          ) : (
            renderPaper(model, props.partKeys.length > 1 ? model[props.activePart] : undefined)
          )
        ) : (
          props.placeholder
        )}
      </div>
    </section>
  );
}
