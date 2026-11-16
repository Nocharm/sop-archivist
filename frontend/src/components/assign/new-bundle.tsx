// New 칸의 표·그림 줄 - 칸 새 문장으로 실제 표(넓으면 좌우 스크롤), 그림은 Old 칸과 같은 경로로 받은 이미지(없으면 자리 상자).
"use client";

import { ImageIcon } from "lucide-react";

import { FigureImage } from "@/components/paper/figure-image";
import type { BundleFigure, BundleTable } from "@/lib/api-sop";

interface NewBundleProps {
  kind: "table" | "figure";
  table?: BundleTable | null;
  figure?: BundleFigure | null;
  bundleId: number;
  testId: string;
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
  const rows = Array.from({ length: table?.rows ?? 0 }, (_, row) => table?.cells.filter((cell) => cell.row === row) ?? []);
  return (
    // 넓은 표는 좌우로 스크롤한다 - 결과물 C 표와 같은 .ptbl-scroll, 확정 전 칸은 점선
    <div className="new-bundle ptbl-scroll" data-testid={testId}>
      <table className="ptbl">
        <tbody>
          {rows.map((cells, row) => (
            <tr key={row}>
              {cells.map((cell) => (
                // lang은 글꼴을 고른다 - 언어 없는 칸은 감싼 쪽을 따른다
                <td key={cell.col} className={cell.status === "confirmed" ? undefined : "border-dashed"} lang={cell.lang === "ko" || cell.lang === "en" ? cell.lang : undefined}>
                  {cell.text}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
