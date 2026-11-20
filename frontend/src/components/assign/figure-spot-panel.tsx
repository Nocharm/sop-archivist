// 위치 판 - 그림 탭 카드의 "위치 보기"가 Old 칸 왼쪽에서 미끄러져 나오는 판(시안 2 D3). 그 그림 자리 앞뒤 본문 줄만 같은 용지 조각으로 읽기 전용으로 보이고,
// 자리에 점 달린 선을 긋는다. 문장 속 그림이면 그 문장 줄을 강조하고 글자 자리에 세로 표시를 둔다. 판 안 줄을 누르면 본문 탭의 그 줄로 간다. Esc · 바깥 누르기로 닫는다.
"use client";

import { X } from "lucide-react";
import { useRef } from "react";

import { Paper } from "@/components/paper/paper";
import type { ViewUnit } from "@/lib/api-sop";
import { findFigureSpot } from "@/lib/figure-spot-model";
import { useI18n } from "@/lib/i18n";
import type { PaperModel } from "@/lib/paper-model";
import { useDismiss } from "@/lib/use-dismiss";

interface FigureSpotPanelProps {
  model: PaperModel;
  figureUnitId: number;
  statusOf?: (unitId: number) => ViewUnit["status"] | undefined;
  /** 판 안 줄을 누름 - 본문 탭으로 가 그 줄을 고른다 */
  onPick: (unitId: number) => void;
  onClose: () => void;
}

export function FigureSpotPanel({ model, figureUnitId, statusOf, onPick, onClose }: FigureSpotPanelProps) {
  const { t } = useI18n();
  const ref = useRef<HTMLElement>(null);
  useDismiss(ref, true, onClose);
  const spot = findFigureSpot(model, figureUnitId);
  const unit = model.units.get(figureUnitId);
  const displayId = unit?.display_id ?? "";
  const keys = new Set([...(spot?.before ?? []), ...(spot?.after ?? [])]);
  // 세로 표시 - 그림 블록의 문장 속 자리(블록 글 좌표)를 나눌 선 자리로 쓴다(손잡이 없이 선만)
  const figureItem = model.figureItems.find((item) => item.type === "block" && item.block.id === unit?.block_id);
  const anchor = figureItem?.type === "block" ? (figureItem.block.anchor ?? null) : null;
  const cut = spot?.host && anchor ? { blockId: anchor.block_id, offset: anchor.at } : null;
  return (
    <aside ref={ref} className="figure-spot" role="dialog" aria-label={t("figures.spotTitle", { id: displayId })} data-testid="assign-figure-spot">
      <div className="figure-spot-head">
        <span className="figure-spot-title">{t("figures.spotTitle", { id: displayId })}</span>
        <button type="button" className="btn ghost icon h-7 w-7 flex-none" aria-label={t("common.close")} data-testid="assign-figure-spot-close" onClick={onClose}>
          <X size={14} strokeWidth={1.5} aria-hidden />
        </button>
      </div>
      <div className="figure-spot-body">
        {spot === null || keys.size === 0 ? (
          <p className="figure-spot-empty" data-testid="assign-figure-spot-empty">
            {t("figures.spotNone")}
          </p>
        ) : (
          <Paper
            model={model}
            items={model.body}
            selectedId={spot.host?.unitId ?? null}
            cut={cut}
            figureRows="hide"
            spot={{ keys, afterKey: spot.before.at(-1) ?? null, label: t("figures.spotLine", { id: displayId }) }}
            strips={{ statusOf }}
            pickWholeBundle
            onUnitClick={(unitId) => onPick(unitId)}
            testId="assign-spot"
          />
        )}
      </div>
    </aside>
  );
}
