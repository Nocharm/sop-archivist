// 원문 용지 - 블록을 원문 순서대로 그리고 단위마다 누를 수 있는 조각을 둔다. 용지 안에는 추출한 글자만 둔다(앱 라벨 금지).
// 글자 조각마다 data-start(블록 안 위치)를 달아, 누른 자리·끌어 고른 범위를 블록 위치로 되돌린다.
"use client";

import { ImageIcon } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";

import type { ViewBlock } from "@/lib/api-sop";
import type { PaperItem, PaperModel, Segment } from "@/lib/paper-model";

export interface PaperCut {
  blockId: number;
  /** 블록 안 위치 - 여기서부터가 뒷조각 */
  offset: number;
}

interface PaperProps {
  model: PaperModel;
  selectedId: number | null;
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
  testId: string;
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

export function Paper({ model, selectedId, pickedIds, cut, warnBlockIds, isDone, onUnitClick, onRangeSelect, testId }: PaperProps) {
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
    return (
      <span
        key={index}
        className="su"
        lang={unit?.lang === "neutral" ? undefined : unit?.lang}
        data-unit={segment.unitId}
        data-testid={`${testId}-unit-${segment.unitId}`}
        data-sel={segment.unitId === selectedId ? "" : undefined}
        data-pick={pickedIds?.has(segment.unitId) ? "" : undefined}
        data-warn={warnBlockIds?.has(block.id) ? "" : undefined}
        data-done={isDone?.(segment.unitId) ? "" : undefined}
        data-cut={isCutHere ? "" : undefined}
      >
        {isCutHere ? (
          <>
            <span className="cut-a" data-start={segment.start}>
              {block.text.slice(segment.start, cut.offset)}
            </span>
            <span className="cut-b" data-start={cut.offset}>
              {block.text.slice(cut.offset, segment.end)}
            </span>
          </>
        ) : (
          <span data-start={segment.start}>{text}</span>
        )}
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
              data-sel={tableUnit.id === selectedId ? "" : undefined}
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
          <span className="pfig-box" aria-hidden>
            <ImageIcon size={28} strokeWidth={1.5} />
          </span>
          <p data-block={block.id}>{renderBlockText(block)}</p>
        </figure>
      );
    }
    return (
      <p key={block.id} data-block={block.id} className={block.heading_level !== null ? "h" : undefined}>
        {renderBlockText(block)}
      </p>
    );
  }

  function handleClick(event: MouseEvent<HTMLDivElement>) {
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return; // 끌어 고르기는 mouseup이 맡는다
    const target = (event.target as HTMLElement).closest<HTMLElement>(".su[data-unit]");
    if (!target) return;
    onUnitClick(Number(target.dataset.unit), readCaret(event.clientX, event.clientY), event);
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
      <div className="pg" onClick={handleClick} onMouseUp={handleMouseUp}>
        {model.header.length > 0 && <div className="pg-edge top grid gap-1">{model.header.map(renderItem)}</div>}
        {model.body.map(renderItem)}
        {model.footer.length > 0 && <div className="pg-edge bottom grid gap-1">{model.footer.map(renderItem)}</div>}
      </div>
    </div>
  );
}
