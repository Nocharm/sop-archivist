// New 칸의 표·그림 줄 - 위에 캡션 줄(없으면 쓰지 않은 문서에서만 "Caption needed"), 칸 새 문장으로 실제 표(넓으면 좌우 스크롤),
// 그림은 Old 칸과 같은 경로로 받은 이미지(없으면 자리 상자).
// 이미 쓴 문서의 표는 칸마다 상자(cellLink, 시안 2 D5) - 칸 위에 출처 칩, Old 줄을 고른 채면 눌러 그 칸에 잇고(문장 잇기와 같다), 끈 조각을 칸에 놓아도 잇는다.
"use client";

import { ImageIcon } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";

import { FigureImage } from "@/components/paper/figure-image";
import { RenumberMark } from "@/components/paper/renumber-mark";
import type { BundleCell, BundleFigure, BundleTable, RenumberChange } from "@/lib/api-sop";
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
  /** 이미 쓴 문서의 칸 잇기 - 없으면(엮은 문서) 칸은 글만 */
  cellLink?: CellLink | null;
}

/** 이미 쓴 문서 표의 칸 잇기 */
export interface CellLink {
  /** Old 줄을 고른 채 고칠 수 있다 - 칸을 눌러 잇는다(호버 강조도 이때만) */
  pickable: boolean;
  /** 끈 조각을 칸에 놓을 수 있다 - 칸 상자에 data-drop을 단다 */
  droppable: boolean;
  /** 지금 고른 칸(그 줄의 잇기 초안·저장된 이음) */
  pickedIds: ReadonlySet<number>;
  onPick: (cell: BundleCell, anchor: HTMLElement, event: MouseEvent) => void;
  /** 칸 위 출처 칩 - 문장 상자와 같은 칩 줄 */
  renderSources: (cell: BundleCell) => ReactNode;
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

/** 칸 하나(칸 번역은 같은 자리에 하나 더) - 칸 잇기가 있으면 누를 수 있는 상자, 칩을 누른 것은 잇기가 아니다 */
function CellBox({ cell, link }: { cell: BundleCell; link: CellLink | null | undefined }) {
  const pickable = link?.pickable === true;
  return (
    <div
      lang={readLangAttr(cell.lang)}
      className={link ? "new-cell" : undefined}
      data-cell-target={cell.target_id}
      data-pickable={pickable ? "" : undefined}
      data-drop={link?.droppable ? "cell" : undefined}
      data-state={link?.pickedIds.has(cell.target_id) ? "picked" : undefined}
      data-testid={`assign-new-cell-${cell.target_id}`}
      onClick={
        pickable
          ? (event) => {
              if (event.target instanceof Element && event.target.closest(".new-src")) return;
              link.onPick(cell, event.currentTarget, event);
            }
          : undefined
      }
    >
      {link && cell.source_unit_ids.length > 0 && link.renderSources(cell)}
      {pickable ? (
        <button type="button" className="new-cell-hit" aria-pressed={link.pickedIds.has(cell.target_id)} data-testid={`assign-new-cell-pick-${cell.target_id}`}>
          {cell.text}
        </button>
      ) : (
        cell.text
      )}
    </div>
  );
}

export function NewBundle({ kind, table, figure, caption, renumber, captionRequired, bundleId, testId, cellLink }: NewBundleProps) {
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
                      <CellBox key={cell.target_id} cell={cell} link={cellLink} />
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
