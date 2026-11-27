// 위치 판 - Old 칸 옆에서 미끄러져 나와 한 Unit의 본문 자리를 그 앞뒤 줄과 함께 읽기 전용 용지 조각으로 보인다.
// 그림(그림 탭 카드의 "위치 보기", 시안 2 D3): 문단 사이 자리에 점선 네모(작은 미리 보기 + 이름 + 캡션), 문장 속 그림이면 그 문장을 칠하고 글자 자리에 "▣ 그림" 표지.
// 짝(1단 보기 짝 안내 줄 한 번 누름, B7): 짝 박스를 칠한다. 판 안 줄을 누르면 본문 탭의 그 줄로 간다. Esc · 바깥 누르기(짝 안내 줄은 빼고) · 닫기 단추로 닫는다.
// 2단 보기는 Old 칸 왼쪽(그림만), 1단 보기는 오른쪽(old-pane이 정한다).
"use client";

import { ImageIcon, X } from "lucide-react";
import { useRef, type ReactNode } from "react";

import { FigureImage } from "@/components/paper/figure-image";
import { Paper } from "@/components/paper/paper";
import type { ViewUnit } from "@/lib/api-sop";
import { findFigureSpot, findUnitSpot } from "@/lib/figure-spot-model";
import { useI18n } from "@/lib/i18n";
import type { PaperModel } from "@/lib/paper-model";
import { useDismiss } from "@/lib/use-dismiss";

/** 판에 보일 자리 - 그림이면 그림 자리, 짝이면 짝 박스(title은 안내 줄과 같은 "짝 · 아래 §7.1 (EN)") */
export type SpotTarget = { kind: "figure"; unitId: number } | { kind: "pair"; unitId: number; title: string };

interface SpotPanelProps {
  model: PaperModel;
  target: SpotTarget;
  side: "left" | "right";
  statusOf?: (unitId: number) => ViewUnit["status"] | undefined;
  /** 그림 미리 보기를 받아 올 곳 - 없으면 그림 아이콘 */
  figureSource?: { bundleId: number; docId: number };
  /** 판 안 줄을 누름 - 본문 탭으로 가 그 줄을 고른다 */
  onPick: (unitId: number) => void;
  onClose: () => void;
}

interface SpotView {
  title: string;
  keys: Set<string>;
  selectedId: number | null;
  cut: { blockId: number; offset: number } | null;
  marker?: { afterKey: string | null; node: ReactNode };
  chip?: ReactNode;
  empty: string;
}

export function SpotPanel({ model, target, side, statusOf, figureSource, onPick, onClose }: SpotPanelProps) {
  const { t } = useI18n();
  const ref = useRef<HTMLElement>(null);
  // 판을 연 짝 안내 줄은 바깥이 아니다 - 그 줄의 두 번 누름(짝으로 가기)이 첫 누름에 판이 닫혀 용지가 움직이면 빗나간다
  useDismiss(ref, true, onClose, ".pair-hint");
  const view = target.kind === "figure" ? buildFigureView(target.unitId) : buildPairView(target.unitId, target.title);
  const testId = target.kind === "figure" ? "assign-figure-spot" : "assign-pair-spot";

  function buildFigureView(figureUnitId: number): SpotView {
    const spot = findFigureSpot(model, figureUnitId);
    const unit = model.units.get(figureUnitId);
    const id = unit?.display_id ?? "";
    // 문장 속 자리(블록 글 좌표)는 나눌 선 자리로 쓴다 - 손잡이 없이 그 자리에 표지만
    const figureItem = model.figureItems.find((item) => item.type === "block" && item.block.id === unit?.block_id);
    const block = figureItem?.type === "block" ? figureItem.block : null;
    const anchor = block?.anchor ?? null;
    // 캡션 하나를 같이 쓰는 그림은 첫 그림의 캡션을 쓴다
    const captionOwner = unit?.caption_figure_id ?? figureUnitId;
    const caption = [...model.units.values()].filter((item) => item.kind === "caption" && item.group_unit_id === captionOwner).map((item) => item.text).join(" ");
    const box = (
      <div className="spot-figure" data-testid="assign-spot-figure">
        <span className="spot-figure-thumb">
          {figureSource && block?.has_image ? <FigureImage bundleId={figureSource.bundleId} docId={figureSource.docId} blockId={block.id} thumb /> : <ImageIcon size={18} strokeWidth={1.5} aria-hidden />}
        </span>
        <span className="spot-figure-text">
          <span className="spot-figure-label">{t("figures.spotHere", { id })}</span>
          {caption && <span className="spot-figure-caption">{caption}</span>}
        </span>
      </div>
    );
    return {
      title: t("figures.spotTitle", { id }),
      keys: new Set([...(spot?.before ?? []), ...(spot?.after ?? [])]),
      selectedId: spot?.host?.unitId ?? null,
      cut: spot?.host && anchor ? { blockId: anchor.block_id, offset: anchor.at } : null,
      // 문장 속 그림은 그 글자 자리 표지가, 문단 사이 그림은 줄 사이 네모가 자리를 보인다
      marker: spot && !spot.host ? { afterKey: spot.before.at(-1) ?? null, node: box } : undefined,
      chip: (
        <span className="spot-chip" data-testid="assign-spot-chip">
          {t("figures.spotChip", { id })}
        </span>
      ),
      empty: t("figures.spotNone"),
    };
  }

  function buildPairView(unitId: number, title: string): SpotView {
    const spot = findUnitSpot(model, unitId);
    return {
      title,
      keys: new Set(spot ? [...spot.before, spot.row, ...spot.after] : []),
      selectedId: unitId,
      cut: null,
      empty: t("paper.pairSpot.none"),
    };
  }

  return (
    <aside ref={ref} className="spot-panel" data-side={side} role="group" aria-label={view.title} data-testid={testId}>
      <div className="spot-panel-head">
        <span className="spot-panel-title">{view.title}</span>
        <button type="button" className="btn ghost icon h-7 w-7 flex-none" aria-label={t("common.close")} data-testid={`${testId}-close`} onClick={onClose}>
          <X size={14} strokeWidth={1.5} aria-hidden />
        </button>
      </div>
      <div className="spot-panel-body">
        {view.keys.size === 0 ? (
          <p className="spot-panel-empty" data-testid={`${testId}-empty`}>
            {view.empty}
          </p>
        ) : (
          <Paper
            model={model}
            items={model.body}
            selectedId={view.selectedId}
            cut={view.cut}
            renderAtCut={view.chip ? () => view.chip : undefined}
            figureRows="hide"
            spot={{ keys: view.keys, marker: view.marker }}
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
