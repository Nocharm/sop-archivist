// Assign 왼쪽 - Old 원문이 곧 목록이다. Split과 같은 Unit 조각(앞 KO/EN·H 태그, 끝 상태 표시)에 확정한 조각의 간 곳을 한 줄 덧붙인다.
// 필터가 걸리면 용지를 그 필터로 접고, 지금 문서·부분에 맞는 문장이 없으면 용지 대신 빈 상태와 맞는 곳 바로 가기를 둔다.
"use client";

import { ListFilter } from "lucide-react";
import { useState, type ComponentProps, type ReactNode, type RefObject } from "react";

import { PaneZoom } from "@/components/assign/pane-zoom";
import { SpotPanel, type SpotTarget } from "@/components/assign/spot-panel";
import { FigureTab } from "@/components/paper/figure-tab";
import { Paper, type CutDragPos, type PaperCut, type PaperNumberCell } from "@/components/paper/paper";
import { describeSheet, PartTabs } from "@/components/paper/part-tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { Select, type SelectOption } from "@/components/ui/select";
import type { ViewUnit } from "@/lib/api-sop";
import { useI18n } from "@/lib/i18n";
import type { FoldOpen } from "@/lib/paper-fold-model";
import type { PairHint } from "@/lib/pair-hint-model";
import type { PaperItem, PaperModel, PaperSheet, PaperTabKey } from "@/lib/paper-model";
import type { PickScope } from "@/lib/pick-scope-model";
import type { JoinKind, JoinPlan } from "@/lib/split-menu-model";
import { isAllFolded } from "@/lib/table-tab-model";
import type { FoldedTables } from "@/lib/use-folded-tables";
import { useSheetSlide } from "@/lib/use-pane-slide";

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
  /** 고름 두 겹 - 누른 조각이 든 묶음(짝 카드 · 표)의 얇은 테와 꼬리표 */
  scope?: PickScope | null;
  /** New를 마지막에 눌렀다 - 여기 고른 것은 점선 테(먼저 고른 쪽) */
  held?: boolean;
  pickedIds: ReadonlySet<number>;
  /** 여럿 고른 줄(Shift) - Unit → 줄 키. 짝 고르기의 pickedIds와 따로, 덩어리 표시로 그린다 */
  checkedRows?: ReadonlyMap<number, string>;
  /** 확인이 남은 누락 의심 경고가 걸린 문단 - 그 줄에 경고 표시가 붙는다 */
  warnBlockIds: ReadonlySet<number>;
  statusOf: (unitId: number) => ViewUnit["status"] | undefined;
  renderNote: (unitIds: number[]) => ReactNode;
  /** 조각 오른쪽 칸 - 연결 배지 */
  renderPills: (unitId: number) => ReactNode;
  /** 머리 줄에 "Caption needed"를 띄울 표·그림 단위(lib/caption-model isCaptionNeeded) */
  isCaptionNeeded: (unitId: number, hasCaption: boolean) => boolean;
  /** 저절로 삭제된 줄을 종류마다 흐린 블록 하나로 접는다(Old 문서) - 없으면 보통 조각(한 단으로 연 New 문서) */
  noise?: NonNullable<NonNullable<ComponentProps<typeof Paper>["strips"]>["noise"]>;
  /** 제목에서 바꾼 조항 묶음의 머리 "[제목 → 문장] … · ↺ 제목으로"(F8b) - 없으면 머리를 달지 않는다 */
  headingShift?: NonNullable<ComponentProps<typeof Paper>["strips"]>["headingShift"];
  /** 벗긴 표의 줄 묶음 머리 "↺ 다시 표로"(F1) - 없으면 머리 없이 왼쪽 세로선만 */
  unwrap?: NonNullable<ComponentProps<typeof Paper>["strips"]>["unwrap"];
  /** 고른 박스 아래 떨어진 짝 안내 줄 - 누르면 짝으로 간다(1단 보기는 한 번 = 짝 엿보기 판, 두 번 = 가기). 없으면 그리지 않는다 */
  pairHint?: { onGo: (unitId: number) => void };
  /** 1단 보기 - 위치 판이 오른쪽에서 나오고(용지는 비켜서거나 자리가 모자라면 덮인다) 짝 안내 줄이 엿보기를 연다(B7). 아니면 판은 왼쪽 */
  single: boolean;
  /** 삭제로 확정한 줄을 흐린 한 줄로 접는다(설계 D6) - 없으면 평소 박스 */
  deleted?: NonNullable<ComponentProps<typeof Paper>["strips"]>["deleted"];
  /** 고른 박스가 이어 붙은 짝 카드 안이면 왼쪽 손잡이(카드 안 순서, 설계 D8) - 없으면 그리지 않는다 */
  pairGrip?: NonNullable<ComponentProps<typeof Paper>["strips"]>["pairGrip"];
  /** 처리 중인 일 - 그 자리 알약과 박스 쉬머, 잠긴 박스(설계 2026-11-20 D4) */
  pending?: NonNullable<ComponentProps<typeof Paper>["strips"]>["pending"];
  /** ⇧J ⇧J · ⇧K ⇧K로 무장한 합치기의 두 박스 - 점선 미리보기 */
  mergeArm?: NonNullable<ComponentProps<typeof Paper>["strips"]>["mergeArm"];
  /** 칸 전체 - 풀기 전환(useUnwrapMotion)이 이 안에서 바뀌는 곳을 찾고 잰다 */
  paneRef?: RefObject<HTMLElement | null>;
  /** 내용이 있는 본문·머리말·꼬리말 탭 - 둘 이상일 때만 탭 줄을 그린다 */
  partKeys: readonly PaperTabKey[];
  activePart: PaperTabKey;
  /** 머리말·꼬리말 탭의 쪽들(설명 줄과 함께 따로 그린다) - 본문 탭이면 null */
  sheets: readonly PaperSheet[] | null;
  onPartChange: (key: PaperTabKey) => void;
  /** 표·그림 어디를 눌러도 묶음 전체를 고른다 - 한/영 짝을 고르거나 쓴 New 문서를 혼자 다듬는 중에는 꺼서 칸 문장을 그대로 고른다 */
  pickWholeBundle: boolean;
  /** Shift는 일괄 고르기 */
  /** isMargin - 문단 상자의 글 밖(여백·앞머리)을 눌렀다 */
  onUnitClick: (unitId: number, keys: { shiftKey: boolean }, isMargin: boolean) => void;
  /** 우클릭·메뉴 글쇠 - 누른 자리와 글자 자리 */
  onUnitContextMenu?: (unitId: number, at: { x: number; y: number }, caret: { blockId: number; offset: number } | null) => void;
  /** 번호 칸 손잡이 - 주면 번호 칸을 눌러 문단 번호를 고친다(작성자만, 쪼개기 편집이라 Ctrl+Z로 되돌린다) */
  numberCell?: PaperNumberCell;
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
  /** 그림 탭 카드의 삭제 확정(시안 2 D3) - 없으면 지우기 단추가 없다(한 단으로 연 New 문서 · 고칠 수 없는 사람) */
  figures?: { onDelete?: (unitId: number, reason: string) => Promise<void> };
  /** 접은 본문 표(11-23 명세 E2) - 표 머리 접기 · 본문 탭 위 표 모두 접기. 없으면 접지 않는다 */
  tableFold?: FoldedTables;
}

export function OldPane({ paneRef, ...props }: OldPaneProps) {
  const { t } = useI18n();
  const { model } = props;
  // 위치 판 - 그 문서 보기에서만(문서를 바꾸면 닫힌다). 짝 판은 연 때 고른 박스를 쥔다
  const [spot, setSpot] = useState<{ docId: string; target: SpotTarget; from: number | null } | null>(null);
  // 짝 판은 다른 박스를 고르거나(두 번 눌러 짝으로 감 · 글쇠 이동 포함) 2단 보기로 바꾸면 닫힌다 - 다시 그 박스로 와도 열리지 않게 지운다
  if (spot?.target.kind === "pair" && (spot.from !== props.selectedId || !props.single)) setSpot(null);
  const spotTarget = spot !== null && spot.docId === props.docId && model?.units.has(spot.target.unitId) ? spot.target : null;
  const sheetSlide = useSheetSlide(spotTarget !== null && props.single, props.activePart);

  /** 판을 열고 닫는다 - 1단 보기면 그 직전 용지 자리를 잡아 비켜서는 움직임을 준다 */
  function changeSpot(next: { target: SpotTarget; from: number | null } | null) {
    if (props.single) sheetSlide.capture();
    setSpot(next === null ? null : { ...next, docId: props.docId });
  }

  const pairHint = props.pairHint && props.single
    ? {
        ...props.pairHint,
        onPeek: (hint: PairHint) =>
          changeSpot({ target: { kind: "pair", unitId: hint.targetUnitId, title: t(hint.dir === "up" ? "paper.pairSpot.above" : "paper.pairSpot.below", { lang: hint.lang, where: hint.where }) }, from: props.selectedId }),
      }
    : props.pairHint;

  /** 그림 탭 용지의 속성 - 본문 용지와 같은 고르기 · 표시(틈 단추 · 번호 칸 · 나눌 선 · 필터 접기는 없다) */
  function buildPaperProps(paperModel: PaperModel, items: PaperItem[] | undefined): ComponentProps<typeof Paper> {
    return {
      model: paperModel,
      items,
      selectedId: props.selectedId,
      highlightIds: props.highlightIds,
      scope: props.scope,
      pickedIds: props.pickedIds,
      checkedRows: props.checkedRows,
      held: props.held,
      warnBlockIds: props.warnBlockIds,
      onUnitClick: (unitId, _at, event) => props.onUnitClick(unitId, { shiftKey: event.shiftKey }, !(event.target as HTMLElement).closest(".su[data-unit]")),
      onUnitContextMenu: props.onUnitContextMenu,
      shiftClickPicks: true,
      pickWholeBundle: props.pickWholeBundle,
      figureSource: props.figureSource,
      strips: { statusOf: props.statusOf, renderNote: props.renderNote, renderPills: props.renderPills, isCaptionNeeded: props.isCaptionNeeded, deleted: props.deleted, pending: props.pending },
      dragBoxes: props.dragBoxes,
      testId: "assign-paper",
    };
  }

  function renderPaper(paperModel: PaperModel, items: PaperItem[] | undefined, tableRows: "all" | "only" = "all") {
    return (
      <Paper
        figureRows="hide"
        tableRows={tableRows}
        model={paperModel}
        items={items}
        selectedId={props.selectedId}
        highlightIds={props.highlightIds}
        scope={props.scope}
        pickedIds={props.pickedIds}
        checkedRows={props.checkedRows}
        held={props.held}
        warnBlockIds={props.warnBlockIds}
        onUnitClick={(unitId, _at, event) => props.onUnitClick(unitId, { shiftKey: event.shiftKey }, !(event.target as HTMLElement).closest(".su[data-unit]"))}
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
        strips={{ statusOf: props.statusOf, renderNote: props.renderNote, renderPills: props.renderPills, fold: tableRows === "only" ? undefined : props.fold, join: props.join, isCaptionNeeded: props.isCaptionNeeded, noise: props.noise, headingShift: props.headingShift, unwrap: props.unwrap, pairHint, deleted: props.deleted, pending: props.pending, mergeArm: props.mergeArm, pairGrip: props.pairGrip, tables: props.tableFold && { folded: props.tableFold.folded, onToggle: props.tableFold.toggle } }}
        renderUnitActions={props.renderUnitActions}
        dragBoxes={props.dragBoxes}
        numberCell={props.numberCell}
        testId="assign-paper"
      />
    );
  }

  return (
    <section ref={paneRef} className="assign-pane" style={{ "--z": props.zoom }} data-pane="old" data-testid="assign-old">
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
          <PartTabs keys={props.partKeys} active={props.activePart} onChange={props.onPartChange} counts={{ figures: model?.figures.length, tables: model?.tableBlocks.length }} testIdPrefix="assign-tab" />
          {props.tableFold && model && props.activePart === "body" && model.tableBlocks.length > 0 && (
            <button type="button" className="btn ghost tables-fold-all" data-testid="assign-tables-fold-all" onClick={() => props.tableFold?.toggleAll(model.tableBlocks)}>
              {t(isAllFolded(props.tableFold.folded, model.tableBlocks) ? "assign.tableFold.allOpen" : "assign.tableFold.all")}
            </button>
          )}
        </div>
      )}
      {props.banner}
      {/* 오른쪽 칸 단추를 마우스로 누른 뒤 포커스가 돌아올 자리 */}
      <div className="pane-body" tabIndex={-1} role="group" aria-label={t("assign.paperBody", { tag: props.docTag })}>
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
        ) : model && props.activePart === "figures" ? (
          // 그림 탭 - 본문에서 뺀 그림 카드(시안 2 D3). 필터 접기는 걸지 않는다(카드가 그 탭의 목록 전부)
          <FigureTab paper={buildPaperProps(model, undefined)} onShowPosition={(unitId) => changeSpot({ target: { kind: "figure", unitId }, from: null })} onDelete={props.figures?.onDelete} />
        ) : model && props.activePart === "tables" ? (
          // 표 탭 - 본문의 표만, 표마다 위치 머리. 손질 · 표 도구는 본문과 같다(필터 접기는 걸지 않는다 - 그림 탭과 같이)
          renderPaper(model, model.body, "only")
        ) : model ? (
          props.sheets !== null ? (
            // 머리말·꼬리말 탭 - 묶음(구역마다 다른 머리말…)마다 한 쪽이고 어디에 쓰이는지 설명 줄이 붙는다
            <div className="grid w-full gap-[22px]">
              {props.sheets.map((sheet, index) => (
                <div key={sheet.key} className="sheet-set">
                  <p className="sheet-cap" data-testid={`assign-sheet-cap-${sheet.key}`}>
                    {describeSheet(sheet, index, t)}
                  </p>
                  {renderPaper(model, sheet.items)}
                </div>
              ))}
            </div>
          ) : (
            renderPaper(model, props.partKeys.length > 1 && props.activePart !== "figures" && props.activePart !== "tables" ? model[props.activePart] : undefined)
          )
        ) : (
          props.placeholder
        )}
      </div>
      {model && spotTarget !== null && (
        <SpotPanel
          key={`${spotTarget.kind}-${spotTarget.unitId}`}
          model={model}
          target={spotTarget}
          side={props.single ? "right" : "left"}
          statusOf={props.statusOf}
          figureSource={props.figureSource}
          onPick={(unitId) => {
            changeSpot(null);
            props.onPartChange("body");
            props.onUnitClick(unitId, { shiftKey: false }, false);
          }}
          onClose={() => changeSpot(null)}
        />
      )}
    </section>
  );
}
