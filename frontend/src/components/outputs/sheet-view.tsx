// Excel 시트 한 장을 그린다 - 서버 시트 모델(kind·wrap·head·faint·italic·bold·numeric)을 그대로 옮기고 모양을 다시 판정하지 않는다(설계 §7.3).
// 종이 색은 테마와 무관한 --sheet-* 토큰이다(§9). 함께 쓰는 칸의 흐림·머리 칠·접힘은 모두 모델이 정한 값이다.
"use client";

import type { CSSProperties } from "react";

import type { PreviewCell, PreviewRow, PreviewSheet } from "@/lib/api-sop";
import { useI18n } from "@/lib/i18n";

// Excel 열 폭(글자 수)을 화면 픽셀로 - 글자 하나 7px에 칸 여백 5px(Excel 기본 열 폭 계산과 같다)
function getColumnPixels(width: number): number {
  return Math.round(width * 7 + 5);
}

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
  if (cell.numeric) style.textAlign = "right";
  return style;
}

function SheetRowView({ row, rowNumber, columnCount }: { row: PreviewRow; rowNumber: number; columnCount: number }) {
  // 모델은 늘 열 수만큼 칸을 싣지만 모자라도 빈 칸으로 채워 표가 틀어지지 않게 한다
  const cells = row.cells.slice(0, columnCount);
  return (
    <tr data-row-kind={row.kind} data-row-number={rowNumber}>
      {cells.map((cell, index) => (
        <td
          key={index}
          data-head={cell.head ? "" : undefined}
          style={getCellStyle(cell, row)}
          className={`px-1.5 py-[3px] text-[12px] leading-[16px] ${row.wrap ? "align-top break-words whitespace-pre-wrap" : "overflow-visible align-top whitespace-pre"}`}
        >
          {cell.text}
        </td>
      ))}
    </tr>
  );
}

export function SheetView({ sheet }: { sheet: PreviewSheet }) {
  const { t } = useI18n();
  const columnCount = sheet.widths.length;
  const pixels = sheet.widths.map(getColumnPixels);
  const totalWidth = pixels.reduce((sum, width) => sum + width, 0);
  // freeze "A3"은 1~2행을 붙박이로 - 그 줄들을 thead에 두어 스크롤해도 머리에 붙는다
  const frozenCount = sheet.freeze ? Math.max(0, Number(/\d+/.exec(sheet.freeze)?.[0] ?? "1") - 1) : 0;
  // 그림은 image_row 앞 줄들 아래에 놓는다 - 미리보기가 줄을 잘라 image_row가 실린 줄 밖이면 마지막 줄 뒤
  const imageAfter = sheet.image_png ? Math.min(Math.max((sheet.image_row ?? sheet.rows.length + 1) - 1, 0), sheet.rows.length) : -1;
  const imageRow = sheet.image_png ? (
    <tr key="image">
      <td colSpan={Math.max(columnCount, 1)} className="px-1.5 py-2">
        {/* eslint-disable-next-line @next/next/no-img-element -- 서버가 그린 PNG를 base64로 받는다 */}
        <img data-testid="export-preview-image" src={`data:image/png;base64,${sheet.image_png}`} alt={sheet.name} className="block max-w-none" />
      </td>
    </tr>
  ) : null;
  const bodyRows: React.ReactNode[] = [];
  sheet.rows.forEach((row, index) => {
    if (index === imageAfter) bodyRows.push(imageRow);
    if (index >= frozenCount) bodyRows.push(<SheetRowView key={index} row={row} rowNumber={index + 1} columnCount={columnCount} />);
  });
  if (imageAfter === sheet.rows.length) bodyRows.push(imageRow);

  return (
    <div>
      <div
        data-testid="export-preview-sheet"
        className="max-h-[min(66vh,720px)] overflow-auto rounded-sm border border-line"
        style={{ background: "var(--sheet-paper)", color: "var(--sheet-ink)" }}
      >
        <table className="border-separate border-spacing-0" style={{ tableLayout: "fixed", width: totalWidth }}>
          <colgroup>
            {pixels.map((width, index) => (
              <col key={index} style={{ width }} />
            ))}
          </colgroup>
          {frozenCount > 0 && (
            <thead className="sticky top-0 z-10" style={{ background: "var(--sheet-paper)" }}>
              {sheet.rows.slice(0, frozenCount).map((row, index) => (
                <SheetRowView key={index} row={row} rowNumber={index + 1} columnCount={columnCount} />
              ))}
            </thead>
          )}
          <tbody>{bodyRows}</tbody>
        </table>
      </div>
      {sheet.truncated && (
        <p className="mt-2 text-[13px] text-ink-2" data-testid="export-preview-truncated">
          {t("outputs.preview.truncated", { n: sheet.rows.length, total: sheet.total_rows })}
        </p>
      )}
    </div>
  );
}
