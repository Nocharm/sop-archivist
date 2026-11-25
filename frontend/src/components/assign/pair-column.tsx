// Pair view의 한 칸 - 한/영 따로 문서(ko_en_separate)의 한 언어 Unit을 원문 순서로 가벼운 조각 목록으로 편다(용지를 다시 그리지 않는다).
// 언어가 없는 줄(참조 줄·표·그림)은 흐리게 제자리에 서고, 짝은 세로선 쪽 변의 막대로 보인다(확정 실선 · 제안 점선). 선은 pair-lines.tsx가 긋는다.
"use client";

import { Languages } from "lucide-react";
import type { ReactNode } from "react";

import { PaneZoom } from "@/components/assign/pane-zoom";
import { LangToken } from "@/components/paper/lang-token";
import { UnitStatusChip } from "@/components/status";
import { useDelegatedTip } from "@/components/ui/delegated-tip";
import { EmptyState } from "@/components/ui/empty-state";
import { Tooltip } from "@/components/ui/tooltip";
import type { CoverStatus } from "@/lib/api-sop";
import { useI18n } from "@/lib/i18n";
import type { PairColumnItem, PairLang, PairUnit } from "@/lib/pair-drop-model";

/** Old 칸 머리(꺼짐)와 KO 칸 머리(켜짐)의 같은 단추 - 칸 머리가 좁으면 라벨을 접고 아이콘만(이름은 툴팁·aria-label) */
export function PairViewToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  const { t } = useI18n();
  return (
    // 라벨은 칸 머리가 좁으면 접힌다(CSS 컨테이너 질의라 화면 코드는 모른다) - 툴팁이 늘 이름부터 말한다
    <Tooltip label={`${t("assign.pairView")} — ${t("assign.pairView.tip")}`}>
      <button type="button" className="pane-toggle has-label" aria-pressed={on} aria-label={t("assign.pairView")} data-testid="assign-pair-view" onClick={onToggle}>
        <Languages size={13} strokeWidth={1.8} aria-hidden />
        <span>{t("assign.pairView")}</span>
      </button>
    </Tooltip>
  );
}

interface PairColumnProps {
  side: PairLang;
  items: readonly PairColumnItem[];
  /** 머리 왼쪽의 문서 이름 - KO 칸만 넘긴다 */
  docLabel?: string;
  /** 머리 오른쪽의 Pair view 단추 - KO 칸만 */
  toggle?: ReactNode;
  /** 머리 아래 한 줄(짝 고르기 띠) - KO 칸만 */
  banner?: ReactNode;
  selectedIds: ReadonlySet<number>;
  pickedIds: ReadonlySet<number>;
  statusOf: (unitId: number) => CoverStatus | undefined;
  /** 조각을 끌 수 있다 - Task 4가 켠다 */
  canDrag: boolean;
  onUnitClick: (unitId: number, keys: { shiftKey: boolean }) => void;
  zoom: number;
  onZoom: (dir: "+" | "-") => void;
}

export function PairColumn({ side, items, docLabel, toggle, banner, selectedIds, pickedIds, statusOf, canDrag, onUnitClick, zoom, onZoom }: PairColumnProps) {
  const { t } = useI18n();
  // 참조 줄의 REF 표시가 data-tip을 단다 - 조각마다 Tooltip을 두지 않고 목록 하나가 띄운다
  const tip = useDelegatedTip();

  /** 조각의 글 - 표는 "표", 글이 없는 그림은 "그림" */
  function readPieceText(unit: PairUnit): string {
    if (unit.kind === "table") return t("split.table");
    if (unit.kind === "figure") return unit.text.trim() || t("assign.newFigure");
    return unit.text;
  }

  return (
    // data-pane은 두 문서 틀의 자리 규칙(스크롤 막대 쪽·여백)과 문서별 확대(use-pane-zoom)를 그대로 받으려고 지금 값을 쓴다 - Pair view만의 규칙은 data-pair-col로 가린다
    <section className="assign-pane pair-col" data-pane={side === "ko" ? "old" : "new"} data-pair-col={side} data-testid={`assign-pair-${side}`} style={{ "--z": zoom }}>
      <div className="pane-head">
        {docLabel !== undefined && <span className="pane-title">{docLabel}</span>}
        <span className="tag" data-testid={`assign-pair-tag-${side}`}>
          {side === "ko" ? "KO" : "EN"}
        </span>
        <span className="flex-1" />
        {toggle}
        <PaneZoom value={zoom} onStep={onZoom} testId={`assign-pair-zoom-${side}`} />
      </div>
      {banner}
      <div className="pane-body" tabIndex={-1}>
        {items.length === 0 ? (
          <EmptyState compact icon={Languages} testId={`assign-pair-empty-${side}`} title={t("assign.pairView.empty")} />
        ) : (
          <div className="pair-list" role="list" {...tip.handlers}>
            {items.map(({ unit, isPiece, pair }) => {
              const status = statusOf(unit.id) ?? unit.status;
              return (
                <div
                  key={unit.id}
                  className="pair-piece"
                  role="listitem"
                  data-unit={unit.id}
                  data-testid={`assign-pair-piece-${unit.id}`}
                  data-kind={unit.kind}
                  lang={unit.lang === "ko" || unit.lang === "en" ? unit.lang : undefined}
                  data-dim={isPiece ? undefined : ""}
                  data-pair={pair?.status}
                  data-sel={selectedIds.has(unit.id) ? "" : undefined}
                  data-picked={pickedIds.has(unit.id) ? "" : undefined}
                  data-drag-box={canDrag && isPiece ? "" : undefined}
                  onClick={(event) => onUnitClick(unit.id, { shiftKey: event.shiftKey })}
                >
                  <span className="pair-piece-id">{unit.display_id}</span>
                  <span className="pair-piece-text">{readPieceText(unit)}</span>
                  {!isPiece && unit.lang === "ref" && <LangToken lang="ref" isRefProposed={unit.ref?.state === "proposed"} />}
                  {status && status !== "unassigned" && <UnitStatusChip status={status} size="sm" />}
                </div>
              );
            })}
            {tip.node}
          </div>
        )}
      </div>
    </section>
  );
}
