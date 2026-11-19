// New 칸의 표·그림 줄 - 위에 캡션 줄(없으면 쓰지 않은 문서에서만 "Caption needed"), 칸 새 문장으로 실제 표(넓으면 좌우 스크롤),
// 그림은 Old 칸과 같은 경로로 받은 이미지(없으면 자리 상자).
"use client";

import { ImageIcon } from "lucide-react";

import { FigureImage } from "@/components/paper/figure-image";
import { RenumberMark } from "@/components/paper/renumber-mark";
import type { BundleFigure, BundleTable, RenumberChange } from "@/lib/api-sop";
import { groupTableCells } from "@/lib/composed-model";
import { useI18n } from "@/lib/i18n";

interface NewBundleProps {
  kind: "table" | "figure";
  table?: BundleTable | null;
  figure?: BundleFigure | null;
  /** 캡션 글(여러 언어는 줄바꿈으로 이어 온다) */
  caption?: string | null;
  /** 이 새 문서에서 다시 매긴 번호 - 캡션 앞에 "표 3 → 표 1"로 보인다. 바뀌지 않았으면 없음 */
  renumber?: RenumberChange | null;
  /** 캡션이 없을 때 "Caption needed"를 보이나 - 이미 쓴 문서(입구 2)는 캡션을 요구하지 않아 보이지 않는다 */
  captionRequired: boolean;
  bundleId: number;
  testId: string;
}

/** 글꼴을 고르는 lang 속성 - 언어 없는 칸은 감싼 쪽을 따른다 */
function readLangAttr(lang: string): string | undefined {
  return lang === "ko" || lang === "en" ? lang : undefined;
}

function CaptionLine({ caption, renumber, captionRequired, testId }: { caption?: string | null; renumber?: RenumberChange | null; captionRequired: boolean; testId: string }) {
  const { t } = useI18n();
  if (caption) {
    return (
      <p className="new-bundle-cap" data-testid={`${testId}-caption`}>
        {renumber && <RenumberMark change={renumber} testId={`${testId}-renumber`} />}
        {caption}
      </p>
    );
  }
  if (!captionRequired) return null;
  return (
    <p className="new-bundle-cap" data-missing="" data-testid={`${testId}-caption-missing`}>
      {t("assign.captionNeeded")}
    </p>
  );
}

export function NewBundle({ kind, table, figure, caption, renumber, captionRequired, bundleId, testId }: NewBundleProps) {
  if (kind === "figure") {
    return (
      <figure className="new-bundle pfig" data-testid={testId}>
        <CaptionLine caption={caption} renumber={renumber} captionRequired={captionRequired} testId={testId} />
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
    <div className="new-bundle" data-testid={testId}>
      <CaptionLine caption={caption} renumber={renumber} captionRequired={captionRequired} testId={testId} />
      {/* 넓은 표는 좌우로 스크롤한다 - 결과물 C 표와 같은 .ptbl-scroll, 확정 전 칸이 든 자리는 점선 */}
      <div className="ptbl-scroll">
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
    </div>
  );
}
