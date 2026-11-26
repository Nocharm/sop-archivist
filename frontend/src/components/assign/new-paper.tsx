// Assign 오른쪽 - 이미 쓴 New 문서를 Old와 같은 용지(Paper)로 그린다. 박스는 Unit이고, New 문장의 사실(출처 칩 · 후보 · 고른 곳 · 출처 없음 · EQUIS 표시 · AI 거르기)은
// 얹기 층(lib/new-overlay-model, PaperProps.strips.overlay)으로 박스 위에 얹는다. 머리말 · 꼬리말 · 그림 탭도 Old와 같고, 이을 수 없는 박스(제목 · 머리말 …)는 올리면 까닭이 뜬다.
// 연결선 · 끌어 놓기 · 화면에 들이기가 찾는 표시 - 문장 박스 .new-line[data-target], 이을 수 있는 박스 [data-linkable], 표 칸 .new-cell[data-cell-target].
// 얹어 그리는 값을 더하면 덩이의 key(모델)나 아래 readKey에도 더한다 - 빠지면 긴 문서의 먼 덩어리에 낡은 모습이 남는다.
"use client";

import { Scissors, Sparkles, Spline } from "lucide-react";
import { useState, type MouseEvent, type ReactNode } from "react";

import { NewAiTag, SourceChips } from "@/components/assign/new-sources";
import { PaneZoom } from "@/components/assign/pane-zoom";
import { RefMark } from "@/components/assign/ref-mark";
import { Paper, type CutDragPos, type PaperCut, type PaperOverlay, type PaperPending } from "@/components/paper/paper";
import { describeSheet, PartTabs } from "@/components/paper/part-tabs";
import { Truncate } from "@/components/ui/motion";
import { Select, type SelectOption } from "@/components/ui/select";
import { Tooltip } from "@/components/ui/tooltip";
import type { DocumentView } from "@/lib/api-sop";
import { useI18n } from "@/lib/i18n";
import { readOverlayKey, readUnlinkableKey, type NewBox, type NewCellNote, type NewOverlay } from "@/lib/new-overlay-model";
import { listPartSheets, type FigureRowMode, type PaperItem, type PaperModel, type PaperTabKey, type PaperTabs } from "@/lib/paper-model";

export interface NewPaperProps {
  bundleId: number;
  docOptions: SelectOption<string>[];
  /** 열린 New 문서(To-Be 문서 id) */
  docId: string;
  /** 그 문서의 올린 파일(문서 id) - 그림을 받는다 */
  fileId: number;
  onDocChange: (docId: string) => void;
  tag: string;
  headExtra?: ReactNode;
  banner?: ReactNode;
  linesOn: boolean;
  onToggleLines: () => void;
  /** 이 문서의 원문을 한 단으로 연다 */
  onWide?: () => void;
  zoom: number;
  onZoom: (dir: "+" | "-") => void;
  /** 아직 받지 못했으면 null - 그동안 placeholder(뼈대 · 불러오기 실패) */
  view: DocumentView | null;
  model: PaperModel | null;
  tabs: PaperTabs | null;
  placeholder: ReactNode;
  overlay: NewOverlay;
  /** AI 거르기의 띠를 눌러 그 칸을 펼친다 - 펼친 칸은 얹기 층(openAiSections)이 안다 */
  onOpenAiSection: (sectionKey: string) => void;
  /** Old 줄을 고른 채 고칠 수 있다 - 칸을 눌러 잇는다(호버 강조도 이때만) */
  cellPickable: boolean;
  /** 끈 조각을 칸에 놓을 수 있다 */
  cellDroppable: boolean;
  /** 칸 칩의 × - 없으면 끊기가 없다 */
  onUnlink?: (targetId: number, unitId: number) => void;
  sourceLabel: (unitId: number) => string;
  onJumpSource: (unitId: number, targetId: number) => void;
  /** 고른 박스(나눌 선이 놓인 박스) */
  selectedUnitId: number | null;
  /** Old를 마지막에 눌렀다 - 여기 고른 것은 점선 테(먼저 고른 쪽) */
  held?: boolean;
  /** 여럿 고른 박스 */
  pickedUnitIds: ReadonlySet<number>;
  pending?: PaperPending;
  /** ⇧J ⇧J · ⇧K ⇧K로 무장한 합치기의 두 박스 - 점선 미리보기 */
  mergeArm?: { fromId: number; toId: number } | null;
  /** 박스를 누름 - anchor는 그 박스(칸이면 칸 조각) */
  onPick: (unitId: number, keys: { shiftKey: boolean; additive: boolean }, anchor: HTMLElement, event: MouseEvent) => void;
  /** 보여야 할 박스들(이동해 갈 곳 · 출처 없는 New의 고른 것) - 바뀌어 든 박스의 탭을 연다 */
  showUnitIds: readonly (number | null)[];
  /** 띄울 메뉴가 없으면 false(브라우저 메뉴를 그대로 둔다) */
  onContextMenu?: (unitId: number, at: { x: number; y: number }, caret: { blockId: number; offset: number } | null) => boolean;
  cut?: PaperCut | null;
  onCutDrag?: (pos: CutDragPos) => void;
  onCutNudge?: (step: 1 | -1) => void;
  renderAtCut?: () => ReactNode;
  /** 고른 박스의 글 아래 단추 줄(박스 아래 단추 줄) */
  renderUnitActions?: (unitId: number) => ReactNode;
}

// 눌러도 박스를 누른 것이 아닌 자리 - 박스 아래 단추 줄의 빈자리, 칸에 딸린 읽기 전용 글, 왼쪽 번호 칸
const NOT_PRESSED = ".strip-acts, .new-cell-note, .strip-lead";

const ignoreDoubleClick = () => undefined;

export function NewPaper(props: NewPaperProps) {
  const { t } = useI18n();
  const { model, view, overlay } = props;
  const { boxes } = overlay;
  // "+N"을 눌러 출처 칩을 모두 펼친 새 문장
  const [openSources, setOpenSources] = useState<ReadonlySet<number>>(new Set());
  // 보는 탭 - 보여야 할 박스(이동해 갈 곳, 고른 것)가 바뀌어 들면 그 박스의 탭을 연다(각주 · 미주의 New 문장은 꼬리말 탭). 풀리면 보던 탭 그대로, 문서를 바꾸면 본문부터(렌더 중 상태 맞추기)
  const asks = [...props.showUnitIds, props.selectedUnitId];
  const [tab, setTab] = useState<{ docId: string; key: PaperTabKey; seen: readonly (number | null)[] }>({ docId: props.docId, key: "body", seen: [] });
  const isSameDoc = tab.docId === props.docId;
  const seen = isSameDoc ? tab.seen : [];
  const isAsked = props.tabs !== null && asks.some((id, at) => id !== (seen[at] ?? null));
  if (!isSameDoc || isAsked) {
    const fresh = isAsked ? asks.find((id, at) => id !== null && id !== (seen[at] ?? null)) : null;
    const wanted = fresh == null ? undefined : props.tabs?.tabOf.get(fresh);
    setTab({ docId: props.docId, key: wanted ?? (isSameDoc ? tab.key : "body"), seen: isAsked ? asks : seen });
  }
  const tabKeys = model ? (["body", "header", "footer", "figures"] as const).filter((key) => model[key].length > 0) : [];
  const activeTab = tabKeys.includes(tab.key) ? tab.key : (tabKeys[0] ?? "body");
  // 문서를 바꾸면 새 문서가 옆에서 들어온다 - 문서 목록에서 뒤 문서면 오른쪽에서, 앞 문서면 왼쪽에서(렌더 중 상태 맞추기)
  const [slide, setSlide] = useState<{ docId: string; dir: "next" | "prev" | null }>({ docId: props.docId, dir: null });
  if (slide.docId !== props.docId) {
    const from = props.docOptions.findIndex((option) => option.value === slide.docId);
    const to = props.docOptions.findIndex((option) => option.value === props.docId);
    setSlide({ docId: props.docId, dir: from < 0 || to < 0 ? null : to > from ? "next" : "prev" });
  }

  /** 모델의 key에 없는 것 - 칩 글 · 펼친 칩 · 칸을 지금 누르고 놓고 끊을 수 있나 */
  function readKey(ids: ReadonlySet<number>): string {
    const own = [...ids].flatMap((id) => {
      const box = boxes.get(id);
      if (!box) return [];
      const noteLabels = box.notes.flatMap((note) => [...note.sourceIds.map(props.sourceLabel), openSources.has(note.targetId)]);
      const cell = box.kind === "cell" ? [props.cellPickable, props.cellDroppable, props.onUnlink !== undefined] : [];
      return [[id, ...box.sourceIds.map(props.sourceLabel), openSources.has(box.targetId), ...noteLabels, ...cell].join(",")];
    });
    return `${readOverlayKey(boxes, ids)}/${own.join(";")}`;
  }

  function buildBoxProps(box: NewBox): ReturnType<PaperOverlay["boxProps"]> {
    if (box.kind === "cell") {
      return {
        className: "new-cell",
        attrs: { "data-cell-target": box.targetId, "data-state": box.state, "data-open": box.isOpen ? "" : undefined, "data-pickable": props.cellPickable ? "" : undefined, "data-drop": props.cellDroppable ? "cell" : undefined },
        testId: `assign-new-cell-${box.targetId}`,
      };
    }
    if (box.kind === "bundle") return { attrs: { "data-state": box.state }, testId: `assign-new-${box.targetId}` };
    return {
      className: "new-line",
      attrs: { "data-target": box.targetId, "data-lang": box.lang, "data-state": box.state, "data-pair-group": model?.units.get(box.unitId)?.pair_id ?? undefined, "data-linkable": "" },
      testId: `assign-new-${box.targetId}`,
    };
  }

  function renderChips(targetId: number, ids: readonly number[], isAi: boolean, onUnlink?: (unitId: number) => void): ReactNode {
    return (
      <SourceChips
        targetId={targetId}
        ids={ids}
        isAi={isAi}
        sourceLabel={props.sourceLabel}
        onJump={props.onJumpSource}
        isOpen={openSources.has(targetId)}
        onOpen={(id) => setOpenSources((prev) => new Set(prev).add(id))}
        onUnlink={onUnlink}
      />
    );
  }

  /** 원문 조각이 없는 칸 문장(칸 번역) - 글과 출처만 보인다 */
  function renderNote(note: NewCellNote): ReactNode {
    return (
      <div key={note.targetId} lang={note.lang === "neutral" ? undefined : note.lang} className="new-cell-note" data-cell-target={note.targetId} data-open={note.isOpen ? "" : undefined} data-testid={`assign-new-cell-${note.targetId}`}>
        {note.sourceIds.length > 0 && <span className="new-srcs">{renderChips(note.targetId, note.sourceIds, note.isAi)}</span>}
        {note.text}
      </div>
    );
  }

  function renderTop(box: NewBox): ReactNode {
    if (box.kind === "bundle") return <NewAiTag targetId={box.targetId} mark={box.ai} />;
    const { onUnlink } = props;
    const isEmpty = box.sourceIds.length === 0 && (box.kind === "cell" || (!box.isMarkedNew && box.refRow === null));
    if (isEmpty) return null;
    return (
      <span className="new-srcs">
        {renderChips(box.targetId, box.sourceIds, box.isAi, box.kind === "cell" && onUnlink ? (unitId) => onUnlink(box.targetId, unitId) : undefined)}
        {box.kind === "sentence" && box.isMarkedNew && <span className="new-src is-new">{t("assign.markedNew")}</span>}
        {/* 참조 줄이 EQUIS와 어긋난다(번호·이름·EQUIS에 없음·폐기) - 출처가 없는 줄에도 뜬다. 이 문서의 글은 여기서 고치지 않아 알리기만 한다 */}
        {box.refRow !== null && <RefMark row={box.refRow} />}
        <NewAiTag targetId={box.targetId} mark={box.ai} />
      </span>
    );
  }

  /** 접힌 카드의 자리 - 그 칸의 첫 접힌 줄이면 띠 하나 */
  function renderFolded(unitIds: readonly number[]): ReactNode {
    const band = unitIds.map((id) => boxes.get(id)?.band).find((item) => item);
    if (!band) return null;
    return (
      <button type="button" className="new-ai-band" aria-expanded={false} data-testid={`assign-new-ai-hidden-${band.sectionKey}`} onClick={() => props.onOpenAiSection(band.sectionKey)}>
        <Sparkles size={12} strokeWidth={1.75} className="flex-none" aria-hidden />
        {t("assign.newAi.hidden", { n: band.count })}
      </button>
    );
  }

  const paperOverlay: PaperOverlay = {
    isFolded: (id) => boxes.get(id)?.isAiFolded ?? false,
    keyOf: readKey,
    boxProps: (id) => {
      const box = boxes.get(id);
      return box ? buildBoxProps(box) : null;
    },
    rowAttrs: (id) => {
      const ai = boxes.get(id)?.ai;
      return ai === undefined ? undefined : { "data-ai-view": ai === "mine_ai" || ai === "mine_went" ? "mine" : "dim" };
    },
    renderTop: (id) => {
      const box = boxes.get(id);
      return box ? renderTop(box) : null;
    },
    renderFoot: (id) => boxes.get(id)?.notes.map(renderNote),
    renderFolded,
    textProps: (id) => {
      const box = boxes.get(id);
      if (!box || box.kind === "bundle") return undefined;
      // 칸은 누를 수 있을 때만 누르는 자리의 이름을 단다
      const testId = box.kind === "sentence" ? `assign-new-pick-${box.targetId}` : props.cellPickable ? `assign-new-cell-pick-${box.targetId}` : undefined;
      return { className: "new-text", "data-testid": testId };
    },
    readWhy: (id) => {
      const unit = model?.units.get(id);
      const key = unit ? readUnlinkableKey(unit, boxes.get(id), activeTab) : null;
      return key === null ? null : t(key);
    },
  };

  function renderPaper(paperModel: PaperModel, items: readonly PaperItem[] | undefined, figureRows: FigureRowMode): ReactNode {
    return (
      <Paper
        key={figureRows}
        model={paperModel}
        items={items}
        figureRows={figureRows}
        pageClassName="new-sheet new-paper"
        selectedId={props.selectedUnitId}
        pickedIds={props.pickedUnitIds}
        held={props.held}
        renderUnitActions={props.renderUnitActions}
        // 표는 칸마다 고르고 잇는다
        pickWholeBundle={false}
        shiftClickPicks
        pressThroughSelection
        onUnitClick={(unitId, _at, event) => {
          const target = event.target as Element;
          const anchor = target.closest<HTMLElement>(".cell-piece, .strip");
          if (anchor && !target.closest(NOT_PRESSED)) props.onPick(unitId, { shiftKey: event.shiftKey, additive: event.ctrlKey || event.metaKey }, anchor, event);
        }}
        onUnitContextMenu={props.onContextMenu}
        // 두 번 누르기로 하는 일은 없다 - 낱말이 골라져 둘째 누름이 먹히지 않게 자리만 잡는다
        onUnitDoubleClick={ignoreDoubleClick}
        cut={props.cut}
        onCutDrag={props.onCutDrag}
        onCutNudge={props.onCutNudge}
        renderAtCut={props.cut ? props.renderAtCut : undefined}
        figureSource={{ bundleId: props.bundleId, docId: props.fileId }}
        // 이미 쓴 문서는 캡션을 요구하지 않는다(입구 2)
        strips={{ isCaptionNeeded: () => false, pending: props.pending, mergeArm: props.mergeArm, overlay: paperOverlay }}
        testId="assign-new-paper"
      />
    );
  }

  function renderBody(paperModel: PaperModel, documentView: DocumentView): ReactNode {
    if (activeTab === "figures") return renderPaper(paperModel, paperModel.figureItems, "only");
    if (activeTab === "body") return renderPaper(paperModel, tabKeys.length > 1 ? paperModel.body : undefined, "hide");
    // 머리말·꼬리말 탭 - 묶음(구역마다 다른 머리말…)마다 한 쪽이고 어디에 쓰이는지 설명 줄이 붙는다(Old와 같다)
    return (
      <div className="grid w-full gap-[22px]">
        {listPartSheets(documentView, paperModel, activeTab).map((sheet, index) => (
          <div key={sheet.key} className="sheet-set">
            <p className="sheet-cap" data-testid={`assign-new-sheet-cap-${sheet.key}`}>
              {describeSheet(sheet, index, t)}
            </p>
            {renderPaper(paperModel, sheet.items, "hide")}
          </div>
        ))}
      </div>
    );
  }

  return (
    <section className="assign-pane" style={{ "--z": props.zoom }} data-pane="new" data-doc={props.docId} data-tab={activeTab} data-testid="assign-new">
      <div className="pane-head">
        {props.docOptions.length > 1 ? (
          <Select testId="assign-new-doc" ariaLabel={t("assign.newDoc")} size="sm" mono value={props.docId} options={props.docOptions} onChange={props.onDocChange} />
        ) : (
          <span className="pane-title">{props.docOptions[0]?.label}</span>
        )}
        <span className="tag new-pane-tag" data-testid="assign-new-tag">
          <Truncate text={props.tag} revealOnFocus />
        </span>
        {props.headExtra}
        <span className="flex-1" />
        {props.onWide && (
          <Tooltip label={t("assign.openSplitTip")}>
            <button type="button" className="pane-toggle" aria-label={t("assign.openSplit")} data-testid="assign-new-edit-original" onClick={props.onWide}>
              <Scissors size={14} strokeWidth={1.5} aria-hidden />
            </button>
          </Tooltip>
        )}
        <Tooltip label={props.linesOn ? t("assign.linesOn") : t("assign.linesOff")}>
          <button type="button" className="pane-toggle" aria-pressed={props.linesOn} aria-label={props.linesOn ? t("assign.linesOn") : t("assign.linesOff")} data-testid="assign-lines-toggle" onClick={props.onToggleLines}>
            <Spline size={13} strokeWidth={1.8} aria-hidden />
          </button>
        </Tooltip>
        <PaneZoom value={props.zoom} onStep={props.onZoom} testId="assign-new-zoom" />
      </div>
      {tabKeys.length > 1 && (
        <div className="flex items-center">
          <PartTabs keys={tabKeys} active={activeTab} onChange={(key) => setTab((prev) => ({ ...prev, key }))} counts={{ figures: model?.figures.length }} testIdPrefix="assign-new-tab" />
        </div>
      )}
      {props.banner}
      <div className="pane-body" tabIndex={-1} role="group" aria-label={t("assign.paperBody", { tag: props.tag })}>
        {/* 이 감싸개는 문서가 바뀌어도 그대로다 - 연결선이 크기를 지켜본다(LinkLines의 .pane-body > *) */}
        <div>
          {model && view ? (
            <div key={props.docId} className="new-slide" data-slide={slide.dir ?? undefined}>
              {renderBody(model, view)}
            </div>
          ) : (
            props.placeholder
          )}
        </div>
      </div>
    </section>
  );
}
