// Excel 시트 한 장을 폭에 맞춘 한 장으로 그린다 - 서버 시트 모델(kind·wrap·head·faint·italic·bold·numeric·indent·tone·bands)을 그대로 옮기고 모양을 다시 판정하지 않는다(제품 명세 §7.14 시트 모델).
// 스크롤바 없이 끌기·휠·글쇠로 옮긴다(lib/sheet-pan.ts). 결과물 Export 미리보기와 Assign Space 미리보기가 같이 쓴다 - 고른 줄·확정 전 덮어 그리기는 Assign만 준다.
// 종이와 표시 색은 테마와 무관한 --sheet-* 토큰이다(styles/sheet.css).
"use client";

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";

import type { PreviewCell, PreviewRow, PreviewSheet } from "@/lib/api-sop";
import { useI18n } from "@/lib/i18n";
import { attachSheetPan, type SheetPan } from "@/lib/sheet-pan";
import {
  buildFoldedCells,
  findDraftRow,
  findPickedGroup,
  getFoldLabelKey,
  getFoldMark,
  getFrozenCount,
  getRowMark,
  listBandTones,
  listSheetItems,
  listShownItems,
  readDraftText,
  spanCells,
  toColumnPercents,
  type SheetDraft,
  type SheetRowMark,
} from "@/lib/sheet-view-model";

// 줄 종류가 정하는 위 테두리 - group_start는 medium, in_group은 thin, 그 밖은 없음
function getRowBorderTop(kind: PreviewRow["kind"]): string | undefined {
  if (kind === "group_start") return "1px solid var(--sheet-line-medium)";
  if (kind === "in_group") return "1px solid var(--sheet-line-thin)";
  return undefined;
}

function getCellStyle(cell: PreviewCell, row: PreviewRow): CSSProperties {
  const style: CSSProperties = {
    borderTop: getRowBorderTop(row.kind),
    color: cell.head ? "var(--sheet-head-ink)" : cell.faint ? "var(--sheet-faint)" : "var(--sheet-ink)",
  };
  if (cell.head) {
    style.background = "var(--sheet-head-bg)";
    style.borderBottom = "2px solid var(--sheet-line-thick)";
  }
  if (cell.bold || cell.head) style.fontWeight = 700;
  if (cell.italic) style.fontStyle = "italic";
  if (cell.strike) style.textDecoration = "line-through";
  if (cell.numeric) style.textAlign = "right";
  // 칸 안 들여쓰기(C 글머리 기호 줄의 Item 칸) - 기본 안쪽 여백 5px(.sv-t td)에 단계마다 9px
  if (cell.indent > 0) style.paddingLeft = `${5 + cell.indent * 9}px`;
  return style;
}

/** 칸 하나의 글 - 확정 전 값이 있으면 덮어 그리고, tone이 있으면 색 칩 */
function renderCellText(cell: PreviewCell, draftText: string | undefined): ReactNode {
  if (draftText !== undefined) return <span className="sv-draft">{draftText}</span>;
  if (cell.tone) return <span className="sv-chip" data-tone={cell.tone}>{cell.text}</span>;
  return cell.text;
}

/** 목차 줄을 눌러 펼치고 접는 줄의 몫 */
export interface SheetTocToggle {
  expanded: boolean;
  /** Location 칸 끝에 붙는 글(펼친 무리 첫 줄의 "▾ 접기") */
  locationSuffix?: string;
  onToggle: () => void;
  testId: string;
}

interface SheetRowViewProps {
  row: PreviewRow;
  /** 줄의 칸 대신 그릴 칸(접힌 목차 줄) */
  cells?: PreviewCell[];
  rowNumber: number;
  columnCount: number;
  columnKeys: readonly string[];
  bandTones?: readonly (string | null)[];
  mark?: SheetRowMark;
  draft?: SheetDraft;
  pendingLabel?: string;
  toc?: SheetTocToggle;
}

function SheetRowView({ row, cells, rowNumber, columnCount, columnKeys, bandTones, mark = null, draft, pendingLabel, toc }: SheetRowViewProps) {
  const spans = spanCells(cells ? { ...row, cells } : row, columnCount);
  function handleKeyDown(event: KeyboardEvent<HTMLTableRowElement>) {
    if (!toc || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    toc.onToggle();
  }
  return (
    <tr
      data-row-kind={row.kind}
      data-row-number={rowNumber}
      data-mark={mark ?? undefined}
      data-toc={toc ? (toc.expanded ? "open" : "folded") : undefined}
      data-testid={toc?.testId}
      role={toc ? "button" : undefined}
      aria-expanded={toc ? toc.expanded : undefined}
      tabIndex={toc ? 0 : undefined}
      onClick={(event) => {
        // Alt+끌기로 글자를 고른 뒤의 click은 펼치기가 아니다(끌기 뒤 click은 lib/sheet-pan.ts가 삼킨다)
        if (toc && !event.altKey) toc.onToggle();
      }}
      onKeyDown={toc ? handleKeyDown : undefined}
    >
      {spans.map(({ cell, column, span }) => {
        const key = columnKeys[column];
        return (
          <td key={column} colSpan={span > 1 ? span : undefined} data-head={cell.head ? "" : undefined} data-band={bandTones?.[column] ?? undefined} style={getCellStyle(cell, row)}>
            {renderCellText(cell, readDraftText(draft, key))}
            {key === "location" && toc?.locationSuffix && <span className="sv-toc-toggle"> {toc.locationSuffix}</span>}
            {key === "status" && pendingLabel && <span className="sv-pending">{pendingLabel}</span>}
          </td>
        );
      })}
    </tr>
  );
}

function ColumnGroup({ percents }: { percents: readonly number[] }) {
  return (
    <colgroup>
      {percents.map((percent, index) => (
        <col key={index} style={{ width: `${percent}%` }} />
      ))}
    </colgroup>
  );
}

export interface SheetViewProps {
  sheet: PreviewSheet;
  /** 고른 단위 - 그 줄을 칠하고 같은 Group ID 줄을 옅게 칠하며, 열 때와 바뀔 때 세로 가운데에 둔다(Assign 미리보기) */
  selectedUnitId?: number | null;
  /** 바뀌면 고른 줄을 다시 가운데로 - 같은 박스를 다시 눌러도(끌어 둔 시트를 되돌린다) */
  centreKey?: number;
  /** 확정 전에 고른 곳 - 고른 단위의 첫 줄에 덮어 그린다(Assign 미리보기) */
  draft?: SheetDraft;
  /** data-testid 머리 - `<testId>-sheet` · `-head` · `-body` · `-image` · `-truncated` · `-toc-<줄 index>` */
  testId?: string;
}

export function SheetView({ sheet, selectedUnitId = null, centreKey = 0, draft, testId = "export-preview" }: SheetViewProps) {
  const { t } = useI18n();
  const frameRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLTableElement>(null);
  const clipRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLTableElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);
  const markRef = useRef<HTMLSpanElement>(null);
  const panRef = useRef<SheetPan | null>(null);
  // 펼친 목차 무리 - 무리 첫 줄의 index. 다른 시트를 그리면 부르는 쪽이 key로 새로 그린다
  const [openTocs, setOpenTocs] = useState<ReadonlySet<number>>(() => new Set());

  const columnCount = sheet.widths.length;
  const percents = toColumnPercents(sheet.fit_widths ?? sheet.widths);
  const frozenCount = getFrozenCount(sheet.freeze);
  const bandTones = listBandTones(sheet.bands, columnCount);
  const columnKeys = sheet.column_keys ?? [];
  const pickedGroup = findPickedGroup(sheet.rows, selectedUnitId);
  const draftRow = findDraftRow(sheet.rows, selectedUnitId, draft);
  // 접을 줄(toc)은 서버가 단 시트(A · 문단 Excel)에만 있다 - 열의 뜻을 모르는 문단 Excel은 Text 칸에 한 줄로 접는다
  const items = listShownItems(listSheetItems(sheet.rows, frozenCount, openTocs, true), selectedUnitId);
  const isLineFold = sheet.column_keys === null;
  const hasHead = frozenCount > 0 || sheet.bands.length > 0;

  useEffect(() => {
    const frame = frameRef.current;
    const clip = clipRef.current;
    const body = bodyRef.current;
    const rail = railRef.current;
    const thumb = thumbRef.current;
    const mark = markRef.current;
    if (!frame || !clip || !body || !rail || !thumb || !mark) return;
    const pan = attachSheetPan({ frame, head: headRef.current, clip, body, rail, thumb, mark });
    panRef.current = pan;
    return () => {
      pan.detach();
      panRef.current = null;
    };
  }, []);

  // 열 때와 고른 줄이 바뀔 때(같은 줄을 다시 눌러 centreKey가 오를 때도) 고른 줄을 세로 가운데에(고른 줄이 없으면 위치 막대만 다시 그린다)
  useEffect(() => {
    panRef.current?.centrePicked();
  }, [selectedUnitId, sheet, centreKey]);

  function toggleToc(start: number) {
    setOpenTocs((previous) => {
      const next = new Set(previous);
      if (next.has(start)) next.delete(start);
      else next.add(start);
      return next;
    });
  }

  // 그림은 image_row 앞 줄들 아래에 놓는다 - 미리보기가 줄을 잘라 image_row가 실린 줄 밖이면 마지막 줄 뒤
  const imageAfter = sheet.image_png ? Math.min(Math.max((sheet.image_row ?? sheet.rows.length + 1) - 1, 0), sheet.rows.length) : -1;
  const imageRow = sheet.image_png ? (
    <tr key="image">
      <td colSpan={Math.max(columnCount, 1)}>
        {/* eslint-disable-next-line @next/next/no-img-element -- 서버가 그린 PNG를 base64로 받는다 */}
        <img data-testid={`${testId}-image`} src={`data:image/png;base64,${sheet.image_png}`} alt={sheet.name} className="sv-image" draggable={false} />
      </td>
    </tr>
  ) : null;

  const bodyRows: ReactNode[] = [];
  let imagePlaced = imageAfter < 0;
  for (const item of items) {
    const start = item.type === "row" ? item.index : item.start;
    if (!imagePlaced && start >= imageAfter) {
      bodyRows.push(imageRow);
      imagePlaced = true;
    }
    if (item.type === "fold") {
      const texts = { label: t(isLineFold ? "outputs.sheet.tocFoldedLine" : getFoldLabelKey(item.rows), { n: item.rows.length }), more: t("outputs.sheet.tocMore", { n: item.rows.length - 1 }) };
      bodyRows.push(
        <SheetRowView
          key={`toc-${item.start}`}
          row={item.rows[0]}
          cells={buildFoldedCells(item.rows, columnKeys, texts)}
          rowNumber={item.start + 1}
          columnCount={columnCount}
          columnKeys={columnKeys}
          bandTones={bandTones}
          mark={getFoldMark(item.rows, selectedUnitId, pickedGroup)}
          toc={{ expanded: false, onToggle: () => toggleToc(item.start), testId: `${testId}-toc-${item.start}` }}
        />,
      );
      continue;
    }
    const isDraftRow = item.index === draftRow;
    const opensToc = item.tocStart === item.index;
    bodyRows.push(
      <SheetRowView
        key={item.index}
        row={item.row}
        rowNumber={item.index + 1}
        columnCount={columnCount}
        columnKeys={columnKeys}
        bandTones={bandTones}
        mark={getRowMark(item.row, selectedUnitId, pickedGroup)}
        draft={isDraftRow ? draft : undefined}
        pendingLabel={isDraftRow ? t("outputs.sheet.notConfirmed") : undefined}
        toc={opensToc ? { expanded: true, locationSuffix: t("outputs.sheet.tocCollapse"), onToggle: () => toggleToc(item.index), testId: `${testId}-toc-${item.index}` } : undefined}
      />,
    );
  }
  if (!imagePlaced) bodyRows.push(imageRow);

  return (
    <div className="sv">
      {/* 스크롤바가 없어 글쇠로도 옮긴다 - 포커스를 받는 틀(↑ ↓ ← → · PageUp · PageDown · Home · End) */}
      <div ref={frameRef} className="sv-frame" data-testid={`${testId}-sheet`} tabIndex={0} role="region" aria-label={`${sheet.name} · ${t("outputs.sheet.legend")}`}>
        {hasHead && (
          <div className="sv-head">
            <table ref={headRef} className="sv-t" data-testid={`${testId}-head`}>
              <ColumnGroup percents={percents} />
              <tbody>
                {sheet.bands.length > 0 && (
                  <tr data-band-row="">
                    {sheet.bands.map((band, index) => (
                      <th key={index} colSpan={band.span} className="sv-band" data-tone={band.tone}>
                        {band.label}
                      </th>
                    ))}
                  </tr>
                )}
                {sheet.rows.slice(0, frozenCount).map((row, index) => (
                  <SheetRowView key={index} row={row} rowNumber={index + 1} columnCount={columnCount} columnKeys={columnKeys} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div ref={clipRef} className="sv-clip">
          <table ref={bodyRef} className="sv-t" data-testid={`${testId}-body`}>
            <ColumnGroup percents={percents} />
            <tbody>{bodyRows}</tbody>
          </table>
          <div ref={railRef} className="sv-rail" aria-hidden hidden>
            <span ref={thumbRef} className="sv-rail-thumb" />
            <span ref={markRef} className="sv-rail-mark" hidden />
          </div>
        </div>
      </div>
      {sheet.truncated && (
        <p className="text-[13px] text-ink-2" data-testid={`${testId}-truncated`}>
          {t("outputs.preview.truncated", { n: sheet.rows.length, total: sheet.total_rows })}
        </p>
      )}
    </div>
  );
}
