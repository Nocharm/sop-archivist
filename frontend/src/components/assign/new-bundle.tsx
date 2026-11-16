// New 칸의 표·그림 줄 - 칸 새 문장으로 실제 표(넓으면 좌우 스크롤), 그림은 Old 칸과 같은 경로로 받은 이미지(없으면 자리 상자).
"use client";

import { ImageIcon } from "lucide-react";

import { FigureImage } from "@/components/paper/figure-image";
import type { BundleFigure, BundleTable } from "@/lib/api-sop";
import { groupTableCells } from "@/lib/composed-model";

interface NewBundleProps {
  kind: "table" | "figure";
  table?: BundleTable | null;
  figure?: BundleFigure | null;
  bundleId: number;
  testId: string;
}

/** 글꼴을 고르는 lang 속성 - 언어 없는 칸은 감싼 쪽을 따른다 */
function readLangAttr(lang: string): string | undefined {
  return lang === "ko" || lang === "en" ? lang : undefined;
}

export function NewBundle({ kind, table, figure, bundleId, testId }: NewBundleProps) {
  if (kind === "figure") {
    return (
      <figure className="new-bundle pfig" data-testid={testId}>
        {figure ? (
          <FigureImage bundleId={bundleId} docId={figure.document_id} blockId={figure.block_id} />
        ) : (
          <span className="pfig-box" aria-hidden>
            <ImageIcon size={28} strokeWidth={1.5} />
          </span>
        )}
      </figure>
    );
  }
  const rows = table ? groupTableCells(table) : [];
  return (
    // 넓은 표는 좌우로 스크롤한다 - 결과물 C 표와 같은 .ptbl-scroll, 확정 전 칸이 든 자리는 점선
    <div className="new-bundle ptbl-scroll" data-testid={testId}>
      <table className="ptbl">
        <tbody>
          {rows.map((cols, row) => (
            <tr key={row}>
              {cols.map((cells, col) => (
                // 칸 번역은 같은 자리에 줄로 쌓는다 - 칸을 하나 더 두면 뒤 열이 밀린다
                <td key={col} className={cells.every((cell) => cell.status === "confirmed") ? undefined : "border-dashed"}>
                  {cells.map((cell) => (
                    <div key={cell.target_id} lang={readLangAttr(cell.lang)} data-cell-target={cell.target_id}>
                      {cell.text}
                    </div>
                  ))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
