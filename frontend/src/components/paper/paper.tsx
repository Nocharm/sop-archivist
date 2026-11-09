// 원문 용지 - 블록을 원문 순서대로 그리고 단위마다 누를 수 있는 조각을 둔다. 용지 안에는 추출한 글자만 둔다(앱 라벨 금지).
// 글자 조각마다 data-start(블록 안 위치)를 달아, 누른 자리·끌어 고른 범위를 블록 위치로 되돌린다.
// Split(strips)에서는 경계를 확인한 문단을 잘린 종이 조각으로 띄우고, 문단 앞에 글자 태그(KO·EN·H), 오른쪽 끝에 아이콘 표시를 둔다.
// 고른 단위는 글자 영역의 가장 바깥 윤곽 하나로 감싼다(contour). 태그·아이콘·확인 단추는 앱 표시라 용지 글자와 섞이지 않게 aria로만 읽힌다.
"use client";

import { CircleCheck, FolderCheck, ImageIcon, Link2, Scissors, Sparkles } from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";

import { FigureImage } from "@/components/paper/figure-image";
import type { ViewBlock, ViewUnit } from "@/lib/api-sop";
import { buildContourPath, canMergeAdjacent, getMarks, getTags, type PaperItem, type PaperModel, type Segment, type UnitMark } from "@/lib/paper-model";

const MARK_ICONS: Record<UnitMark, typeof CircleCheck> = {
  edited: Scissors,
  pair: Link2,
  classified: FolderCheck,
  ai: Sparkles,
  checked: CircleCheck,
};
const MARK_ORDER: readonly UnitMark[] = ["edited", "pair", "classified", "ai", "checked"];

export interface PaperCut {
  blockId: number;
  /** 블록 안 위치 - 여기서부터가 뒷조각 */
  offset: number;
}

interface PaperProps {
  model: PaperModel;
  selectedId: number | null;
  /** 함께 밑줄을 긋는 단위(분류에서 짝의 두 쪽) */
  highlightIds?: ReadonlySet<number>;
  /** 합치기·짝 맞추기로 고른 단위 */
  pickedIds?: ReadonlySet<number>;
  /** 나눌 자리 미리 보기(고른 단위 안) */
  cut?: PaperCut | null;
  /** 누락 의심 등 경고가 걸린 블록 - 물결 밑줄 */
  warnBlockIds?: ReadonlySet<number>;
  /** 끝난 단위는 흐리게(분류에서 확정) */
  isDone?: (unitId: number) => boolean;
  onUnitClick: (unitId: number, at: { blockId: number; offset: number } | null, event: MouseEvent) => void;
  onRangeSelect?: (range: { blockId: number; start: number; end: number }) => void;
  /** 그림을 받을 묶음·문서 - 없으면 그림 자리 상자만 */
  figureSource?: { bundleId: number; docId: number };
  testId: string;
  /** Split - 문단을 종이 조각으로, 앞에 태그, 끝에 표시. isChecked는 먼저 칠한 경계 확인까지 본다 */
  strips?: {
    isChecked: (unit: ViewUnit) => boolean;
    canMerge: boolean;
    onGapMerge: (firstId: number, secondId: number) => void;
    mergeLabel: string;
    /** Assign - 모든 문단을 조각으로 두므로 경계 확인 표시는 뺀다 */
    hideChecked?: boolean;
    /** Assign - 보기를 다시 부르지 않아도 지금 커버 상태로 표시한다 */
    statusOf?: (unitId: number) => ViewUnit["status"] | undefined;
    /** Assign - 조각 아래 한 줄(간 곳) */
    renderNote?: (unitIds: number[]) => ReactNode;
  };
  /** 고른 단위를 밑줄 대신 바깥 윤곽으로 감싼다 */
  contour?: boolean;
  /** 고른 단위의 끝에 붙는 것(확인 단추) */
  renderUnitEnd?: (unitId: number) => ReactNode;
  /** 나눌 선 자리에 붙는 것(나누기 팝업) */
  renderAtCut?: () => ReactNode;
  onUnitDoubleClick?: (unitId: number, at: { blockId: number; offset: number } | null) => void;
}

/** 화면 좌표 → 블록 위치. 글자 조각 요소의 data-start에 글자 노드 안 위치를 더한다 */
function readCaret(x: number, y: number): { blockId: number; offset: number } | null {
  let node: Node | null = null;
  let nodeOffset = 0;
  if ("caretPositionFromPoint" in document) {
    const pos = document.caretPositionFromPoint(x, y);
    node = pos?.offsetNode ?? null;
    nodeOffset = pos?.offset ?? 0;
  } else if ("caretRangeFromPoint" in document) {
    // Safari 등 구형 API
    const range = (document as Document & { caretRangeFromPoint: (x: number, y: number) => Range | null }).caretRangeFromPoint(x, y);
    node = range?.startContainer ?? null;
    nodeOffset = range?.startOffset ?? 0;
  }
  return node ? readNodeOffset(node, nodeOffset) : null;
}

function readNodeOffset(node: Node, nodeOffset: number): { blockId: number; offset: number } | null {
  const piece = (node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element))?.closest<HTMLElement>("[data-start]");
  const block = piece?.closest<HTMLElement>("[data-block]");
  if (!piece || !block) return null;
  return { blockId: Number(block.dataset.block), offset: Number(piece.dataset.start) + (node.nodeType === Node.TEXT_NODE ? nodeOffset : 0) };
}

/** 블록 안 단위 id(나온 순서, 중복 없이) */
function listBlockUnits(model: PaperModel, blockId: number): number[] {
  const ids: number[] = [];
  for (const segment of model.segments.get(blockId) ?? []) {
    if (segment.unitId !== null && !ids.includes(segment.unitId)) ids.push(segment.unitId);
  }
  return ids;
}

/** 단위의 마지막 조각인가 - 끝에 확인 단추를 붙일 자리 */
function isUnitEnd(unit: ViewUnit | undefined, blockId: number, segmentEnd: number): boolean {
  const last = unit?.spans[unit.spans.length - 1];
  return last !== undefined && last[0] === blockId && last[2] === segmentEnd;
}

export function Paper({
  model,
  selectedId,
  highlightIds,
  pickedIds,
  cut,
  warnBlockIds,
  isDone,
  onUnitClick,
  onRangeSelect,
  figureSource,
  testId,
  strips,
  contour = false,
  renderUnitEnd,
  renderAtCut,
  onUnitDoubleClick,
}: PaperProps) {
  const pageRef = useRef<HTMLDivElement>(null);
  const [contourPath, setContourPath] = useState("");

  // 고른 단위의 바깥 윤곽 - 그린 뒤 글자 상자를 재서 SVG path로. 창·글꼴이 바뀌면 다시 잰다
  useEffect(() => {
    const page = pageRef.current;
    if (!contour || !page) return;
    const measure = () => {
      const base = page.getBoundingClientRect();
      const rects =
        selectedId === null
          ? []
          : Array.from(page.querySelectorAll<HTMLElement>(`.su[data-unit="${selectedId}"] [data-start]`)).flatMap((piece) =>
              Array.from(piece.getClientRects()).map((rect) => ({ left: rect.left - base.left, right: rect.right - base.left, top: rect.top - base.top, bottom: rect.bottom - base.top })),
            );
      setContourPath(buildContourPath(rects.filter((rect) => rect.right - rect.left > 0.5)));
    };
    const frame = requestAnimationFrame(measure);
    const observer = new ResizeObserver(() => requestAnimationFrame(measure));
    observer.observe(page);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [contour, selectedId, model, cut]);

  function renderSegment(block: ViewBlock, segment: Segment, index: number): ReactNode {
    const text = block.text.slice(segment.start, segment.end);
    if (segment.unitId === null) {
      return (
        <span key={index} data-start={segment.start}>
          {text}
        </span>
      );
    }
    const unit = model.units.get(segment.unitId);
    const isCutHere = cut && cut.blockId === block.id && cut.offset > segment.start && cut.offset < segment.end && segment.unitId === selectedId;
    const endExtra = segment.unitId === selectedId && renderUnitEnd && isUnitEnd(unit, block.id, segment.end) ? renderUnitEnd(segment.unitId) : null;
    const checked = strips && unit ? strips.isChecked(unit) : false;
    return (
      <span key={index} className="contents">
      <span
        key={index}
        className="su"
        lang={unit?.lang === "neutral" ? undefined : unit?.lang}
        data-unit={segment.unitId}
        data-testid={`${testId}-unit-${segment.unitId}`}
        data-sel={segment.unitId === selectedId || highlightIds?.has(segment.unitId) ? "" : undefined}
        data-pick={pickedIds?.has(segment.unitId) ? "" : undefined}
        data-warn={warnBlockIds?.has(block.id) ? "" : undefined}
        data-done={isDone?.(segment.unitId) ? "" : undefined}
        data-cut={isCutHere ? "" : undefined}
        data-checked={checked ? "" : undefined}
      >
        {isCutHere ? (
          <>
            <span className="cut-a" data-start={segment.start}>
              {block.text.slice(segment.start, cut.offset)}
            </span>
            {renderAtCut && <span className="cut-anchor">{renderAtCut()}</span>}
            <span className="cut-b" data-start={cut.offset}>
              {block.text.slice(cut.offset, segment.end)}
            </span>
          </>
        ) : (
          <span data-start={segment.start}>{text}</span>
        )}
      </span>
      {endExtra}
      </span>
    );
  }

  function renderBlockText(block: ViewBlock): ReactNode {
    return (model.segments.get(block.id) ?? []).map((segment, index) => renderSegment(block, segment, index));
  }

  function renderItem(item: PaperItem): ReactNode {
    if (item.type === "table") {
      const tableUnit = item.unitId === null ? null : model.units.get(item.unitId);
      return (
        <div key={`t${item.table.id}`} className="grid gap-1">
          {tableUnit && (
            // 표 전체를 한 단위로 고르는 손잡이 - 글자 없이 선만 보인다(용지에 앱 글자를 넣지 않는다)
            <button
              type="button"
              className="ptbl-cap h-2.5 p-0"
              aria-label={tableUnit.display_id}
              data-unit={tableUnit.id}
              data-testid={`${testId}-unit-${tableUnit.id}`}
              data-sel={tableUnit.id === selectedId || highlightIds?.has(tableUnit.id) ? "" : undefined}
              onClick={(event) => onUnitClick(tableUnit.id, null, event)}
            />
          )}
          <table className="ptbl">
            <tbody>
              {item.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell) => (
                    <td key={cell.id} colSpan={cell.grid_span} rowSpan={cell.row_span}>
                      <p data-block={cell.id}>{renderBlockText(cell)}</p>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    const { block } = item;
    if (block.kind === "figure") {
      return (
        <figure key={block.id} className="pfig">
          {figureSource && block.has_image ? (
            <FigureImage bundleId={figureSource.bundleId} docId={figureSource.docId} blockId={block.id} />
          ) : (
            <span className="pfig-box" aria-hidden>
              <ImageIcon size={28} strokeWidth={1.5} />
            </span>
          )}
          <p data-block={block.id}>{renderBlockText(block)}</p>
        </figure>
      );
    }
    const paragraph = (
      <p key={block.id} data-block={block.id} className={block.heading_level !== null ? "h" : undefined}>
        {renderBlockText(block)}
      </p>
    );
    if (!strips) return paragraph;
    // 문단 하나의 표시 - 태그는 있는 언어와 보류, 아이콘은 하나라도 있으면(확인은 모두 확인했을 때)
    const units = listBlockUnits(model, block.id).map((id) => model.units.get(id)).filter((unit): unit is ViewUnit => unit !== undefined);
    const langs = [...new Set(units.map((unit) => getTags(unit).lang).filter((lang): lang is "KO" | "EN" => lang !== null))];
    const hold = units.some((unit) => getTags(unit).hold);
    const allChecked = units.length > 0 && units.every((unit) => strips.isChecked(unit));
    const live = units.map((unit) => ({ ...unit, status: strips.statusOf?.(unit.id) ?? unit.status }));
    const marks = new Set<UnitMark>(live.flatMap((unit) => getMarks(unit).filter((mark) => mark !== "checked")));
    if (allChecked && !strips.hideChecked) marks.add("checked");
    return (
      <div key={block.id} className="strip" data-checked={allChecked ? "" : undefined} data-testid={`${testId}-strip-${block.id}`}>
        <span className="strip-tags" aria-hidden>
          {langs.map((lang, index) =>
            index === langs.length - 1 && hold ? (
              <span key={lang} className={`ptag duo ${lang.toLowerCase()}`}>
                <span>{lang}</span>
                <span>H</span>
              </span>
            ) : (
              <span key={lang} className={`ptag ${lang.toLowerCase()}`}>
                {lang}
              </span>
            ),
          )}
          {langs.length === 0 && hold && <span className="ptag hold">H</span>}
        </span>
        {paragraph}
        {strips.renderNote?.(units.map((unit) => unit.id))}
        <span className="strip-marks" aria-hidden>
          {MARK_ORDER.filter((mark) => marks.has(mark)).map((mark) => {
            const Icon = MARK_ICONS[mark];
            return <Icon key={mark} size={14} strokeWidth={mark === "checked" ? 2 : 1.6} className={`pmark ${mark}`} />;
          })}
        </span>
      </div>
    );
  }

  /** 본문 - Split이면 확인한 문단 위아래를 얇게 잘라 띄우고, 그 틈에 호버하면 위아래 합치기 */
  function renderBody(): ReactNode {
    if (!strips) return model.body.map(renderItem);
    const nodes: ReactNode[] = [];
    model.body.forEach((item, index) => {
      if (index > 0) {
        const prev = model.body[index - 1];
        if (prev.type === "block" && item.type === "block" && prev.block.kind !== "figure" && item.block.kind !== "figure") {
          const prevUnits = listBlockUnits(model, prev.block.id).map((id) => model.units.get(id)).filter((unit): unit is ViewUnit => unit !== undefined);
          const nextUnits = listBlockUnits(model, item.block.id).map((id) => model.units.get(id)).filter((unit): unit is ViewUnit => unit !== undefined);
          // 한 단위가 두 문단에 걸쳐 있으면 그 사이는 경계가 아니다 - 틈을 긋지 않는다
          const sharesUnit = prevUnits.some((unit) => nextUnits.includes(unit));
          const isCut = !sharesUnit && [prevUnits, nextUnits].some((units) => units.length > 0 && units.every((unit) => strips.isChecked(unit)));
          if (isCut) {
            const first = prevUnits[prevUnits.length - 1];
            const second = nextUnits[0];
            const mergeable = strips.canMerge && first !== undefined && second !== undefined && canMergeAdjacent(first, second);
            nodes.push(
              <div key={`gap-${item.block.id}`} className="strip-gap" data-testid={`${testId}-gap-${item.block.id}`}>
                {mergeable && (
                  <button type="button" className="btn strip-merge" data-testid={`${testId}-gap-merge-${item.block.id}`} onClick={() => strips.onGapMerge(first.id, second.id)}>
                    {strips.mergeLabel}
                  </button>
                )}
              </div>,
            );
          }
        }
      }
      nodes.push(renderItem(item));
    });
    return nodes;
  }

  function handleClick(event: MouseEvent<HTMLDivElement>) {
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return; // 끌어 고르기는 mouseup이 맡는다
    const target = (event.target as HTMLElement).closest<HTMLElement>(".su[data-unit]");
    if (!target) return;
    onUnitClick(Number(target.dataset.unit), readCaret(event.clientX, event.clientY), event);
  }

  function handleDoubleClick(event: MouseEvent<HTMLDivElement>) {
    if (!onUnitDoubleClick) return;
    const target = (event.target as HTMLElement).closest<HTMLElement>(".su[data-unit]");
    if (!target) return;
    window.getSelection()?.removeAllRanges();
    onUnitDoubleClick(Number(target.dataset.unit), readCaret(event.clientX, event.clientY));
  }

  // 두 번 누를 때 브라우저가 낱말을 고르지 않게 - 나눌 자리를 정하는 동작이다
  function handleMouseDown(event: MouseEvent<HTMLDivElement>) {
    if (onUnitDoubleClick && event.detail > 1 && (event.target as HTMLElement).closest(".su[data-unit]")) event.preventDefault();
  }

  function handleMouseUp() {
    if (!onRangeSelect) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    const start = readNodeOffset(range.startContainer, range.startOffset);
    const end = readNodeOffset(range.endContainer, range.endOffset);
    // 1차는 한 블록 안 고르기만 - 블록을 넘는 범위는 합치기로 한다
    if (start && end && start.blockId === end.blockId && end.offset > start.offset) {
      onRangeSelect({ blockId: start.blockId, start: start.offset, end: end.offset });
    }
  }

  return (
    <div className="sheet" data-testid={testId}>
      <div
        ref={pageRef}
        className="pg"
        data-strips={strips ? "" : undefined}
        data-contour={contour ? "" : undefined}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
      >
        {contour && contourPath && (
          <svg className="sel-contour" aria-hidden>
            <path d={contourPath} />
          </svg>
        )}
        {model.header.length > 0 && <div className="pg-edge top grid gap-1">{model.header.map(renderItem)}</div>}
        {renderBody()}
        {model.footer.length > 0 && <div className="pg-edge bottom grid gap-1">{model.footer.map(renderItem)}</div>}
      </div>
    </div>
  );
}
