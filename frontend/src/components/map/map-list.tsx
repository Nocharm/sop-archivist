// 참조 지도의 List - 지도와 같은 선을 표로(From · To · Becomes · Bundle · State · Lines). 범위·거르기·찾기를 그대로 따르고, 줄을 누르면 맞은편 문서를 고른다.
// DataList를 쓰지 않는다 - 표·카드 보기 단추가 Map · List 옆에 하나 더 생긴다(계획 판단 16).
"use client";

import { SearchX } from "lucide-react";
import { useMemo } from "react";

import { EmptyState } from "@/components/ui/empty-state";
import { useDelegatedTip } from "@/components/ui/delegated-tip";
import { LoadMoreRows } from "@/components/ui/load-more";
import type { MapNode } from "@/lib/api-sop";
import { useI18n } from "@/lib/i18n";
import { describeNode, listMapRows, type BecomesState, type EdgeLabel, type MapRow, type MapView } from "@/lib/map-model";
import { getRowOpenProps } from "@/lib/row-open";
import { truncateMiddle } from "@/lib/truncate-middle";
import { useProgressiveList } from "@/lib/use-progressive-list";

export const EDGE_PILL: Record<EdgeLabel, string> = { confirmed: "pill quiet", proposed: "pill ref", moved: "pill dash" };

/** 후속 문서가 없을 때의 문구 키 - "none"(New 문서)은 문구가 없다 */
export const BECOMES_EMPTY_KEY: Partial<Record<BecomesState, string>> = {
  undecided: "map.side.undecided",
  noSuccessor: "map.side.noSuccessor",
  nobody: "map.side.nobody",
};

interface MapListProps {
  view: MapView;
  selectedId: string | null;
  /** 거르기·찾기가 걸려 있다 - 줄이 없을 때 "맞는 것이 없음"을 말한다. 주지 않으면 찾는 중인지만 본다 */
  isFiltered?: boolean;
  onPick(nodeId: string): void;
  onClear(): void;
}

/** 찾는 중이면 From이나 To가 맞는 줄만 */
export function listShownRows(view: MapView): MapRow[] {
  const rows = listMapRows(view);
  return view.hasQuery ? rows.filter((row) => view.matches.has(row.from.id) || view.matches.has(row.to.id)) : rows;
}

function NodeCell({ node }: { node: MapNode }) {
  const { t } = useI18n();
  const number = node.number || t("map.node.noNumber");
  return (
    <td data-tip={node.title ? `${number}\n${node.title}` : number}>
      <div className="map-no clamp-2">{node.number ? truncateMiddle(node.number, 14, 8) : number}</div>
      {node.title && <div className="map-sub clamp-2">{node.title}</div>}
    </td>
  );
}

export function MapList({ view, selectedId, isFiltered = view.hasQuery, onPick, onClear }: MapListProps) {
  const { t } = useI18n();
  const tip = useDelegatedTip();
  const rows = useMemo(() => listShownRows(view), [view]);
  // 후속 문서가 없는 도착 문서의 빈 상태 - 선을 보지 않는 규칙이라 선 없이 묻는다(줄마다 선 전체를 훑지 않게)
  const emptyBecomes = useMemo(() => {
    const slim = { scope: view.scope, truncated: false, bundles: view.bundles, nodes: view.nodes, edges: [] };
    const states = new Map<string, BecomesState>();
    for (const row of rows) {
      if (row.to.becomes.length > 0 || states.has(row.to.id)) continue;
      states.set(row.to.id, describeNode(slim, row.to.id)?.becomesState ?? "none");
    }
    return states;
  }, [rows, view]);
  const resetKey = `${view.scope}:${view.hasQuery}:${view.matches.size}:${rows.length}:${rows[0]?.key ?? ""}`;
  const { visible, hasMore, sentinelRef } = useProgressiveList(rows, resetKey);

  if (rows.length === 0) {
    // 선이 원래 없으면 아무것도 그리지 않는다 - 옆 칸이 "참조 없음"을 말한다
    if (!isFiltered) return null;
    return (
      <EmptyState
        icon={SearchX}
        title={t("map.empty.filtered")}
        testId="map-empty-filtered"
        action={
          <button type="button" className="btn" data-testid="map-empty-clear" onClick={onClear}>
            {t("map.empty.clear")}
          </button>
        }
      />
    );
  }

  return (
    <div {...tip.handlers}>
      <table className="dtable map-table" data-testid="map-list">
        <colgroup>
          <col style={{ width: "22%" }} />
          <col style={{ width: "22%" }} />
          <col style={{ width: "22%" }} />
          <col style={{ width: "16%" }} />
          <col style={{ width: 104 }} />
          <col style={{ width: 64 }} />
        </colgroup>
        <thead>
          <tr>
            <th>{t("map.list.from")}</th>
            <th>{t("map.list.to")}</th>
            <th>{t("map.list.becomes")}</th>
            <th>{t("map.list.bundle")}</th>
            <th>{t("map.list.state")}</th>
            <th className="num">{t("map.list.lines")}</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((row, index) => {
            const becomes = row.to.becomes.map((item) => item.code || item.title).join(", ");
            const emptyKey = BECOMES_EMPTY_KEY[emptyBecomes.get(row.to.id) ?? "none"];
            const becomesText = becomes || (emptyKey ? t(emptyKey) : "–");
            const bundleText = row.bundle ? [row.bundle.code, row.bundle.title].filter(Boolean).join(" · ") : t("map.owner.none");
            return (
              <tr
                key={row.key}
                data-link=""
                data-testid={`map-row-${index}`}
                data-source={row.from.id}
                data-target={row.to.id}
                data-label={row.label}
                aria-selected={selectedId !== null && (row.from.id === selectedId || row.to.id === selectedId)}
                {...getRowOpenProps(() => onPick(row.pickId))}
              >
                <NodeCell node={row.from} />
                <NodeCell node={row.to} />
                <td data-tip={becomesText}>
                  <div className={`clamp-2 ${becomes ? "map-no" : "text-ink-3"}`}>{becomesText}</div>
                </td>
                <td data-tip={bundleText}>
                  <div className="clamp-2 text-ink-2">{bundleText}</div>
                </td>
                <td>
                  <span className={EDGE_PILL[row.label]}>{t(`map.edge.${row.label}`)}</span>
                </td>
                <td className="num">{row.lines}</td>
              </tr>
            );
          })}
          {hasMore && <LoadMoreRows sentinelRef={sentinelRef} columns={6} testId="map-list-more" />}
        </tbody>
      </table>
      {tip.node}
    </div>
  );
}
