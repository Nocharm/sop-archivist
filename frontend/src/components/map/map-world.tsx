// 참조 지도의 세계 - 줄기(Bundle) · 선(SVG 한 장) · 마디(문서 단추)를 배치 모델의 좌표로 겹쳐 그린다(설계 2026-11-17 참조 지도 §6.4).
// 툴팁 상태를 가진 겉 상자(map-canvas)와 떼어 둔다 - 툴팁이 뜰 때 마디 수백 개가 다시 그려지지 않게.
// 올리기·포커스 강조와 고른 마디의 이웃 강조는 React 상태가 아니라 DOM 속성(data-hot · data-on)이다(link-lines.tsx와 같은 까닭). 고르기만 React 상태다.
"use client";

import { ChevronDown, ChevronRight, Lock } from "lucide-react";
import { memo, useLayoutEffect, useMemo, useRef, type FocusEvent, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";

import { BundleStatusPill } from "@/components/status";
import type { MapBundle, MapNode } from "@/lib/api-sop";
import { useI18n } from "@/lib/i18n";
import { LANE_HEAD, LANE_W, listNeighbors, MORE_H, NODE_H, NODE_W, stepZoom, ZOOM_FAR, type LaidLane, type MapLayout } from "@/lib/map-layout";
import { getEntryFocus, getLaneFocus, getMapKeyAction, readLaneFocus, type MapFocus } from "@/lib/map-keys";
import { countNodeLines, formatBecomes, getEdgeKey, getEdgeLabel, getEdgeSides, type MapView } from "@/lib/map-model";
import { truncateMiddle } from "@/lib/truncate-middle";

export interface MapWorldProps {
  view: MapView;
  layout: MapLayout;
  zoom: number;
  selectedId: string | null;
  onSelect(nodeId: string | null): void;
  onToggleLane(laneKey: string): void;
  onMore(laneKey: string): void;
  /** 글쇠 + · - (칸 가운데를 기준으로) */
  onZoom(next: number, anchor: null): void;
  /** 글쇠 0 */
  onFit(): void;
}

type Owner = "self" | "member" | "summary" | "none";
type Neighbors = ReturnType<typeof listNeighbors>;

// 선 끝 점의 반지름(px)
const DOT_R = 2.5;

function findNodeEl(world: HTMLElement, nodeId: string): HTMLElement | null {
  return world.querySelector<HTMLElement>(`[data-node="${CSS.escape(nodeId)}"]`);
}

/** 그 마디와 이웃 마디·맞닿은 선에 data-on - 앞서 단 것은 모두 뗀다(null이면 떼기만) */
function markNeighbors(world: HTMLElement, nodeId: string | null, neighbors: Neighbors) {
  for (const el of world.querySelectorAll("[data-on]")) el.removeAttribute("data-on");
  if (nodeId === null) return;
  findNodeEl(world, nodeId)?.setAttribute("data-on", "");
  const entry = neighbors.get(nodeId);
  if (!entry) return;
  for (const id of entry.nodes) findNodeEl(world, id)?.setAttribute("data-on", "");
  for (const key of entry.edges) for (const el of world.querySelectorAll(`[data-edge="${CSS.escape(key)}"]`)) el.setAttribute("data-on", "");
}

function readNodeId(target: EventTarget | null): string | null {
  return target instanceof Element ? (target.closest<HTMLElement>(".map-node")?.dataset.node ?? null) : null;
}

/** 포커스가 선 요소의 글쇠 자리 - 마디 id나 줄기 머리 `lane:<key>`, 그 밖이면 null */
function readFocus(target: EventTarget | null): MapFocus | null {
  if (!(target instanceof Element)) return null;
  const nodeId = readNodeId(target);
  if (nodeId !== null) return nodeId;
  const head = target.closest<HTMLElement>("[data-head]")?.dataset.head;
  return head === undefined ? null : getLaneFocus(head);
}

function findFocusEl(world: HTMLElement, focus: MapFocus): HTMLElement | null {
  const laneKey = readLaneFocus(focus);
  return laneKey === null ? findNodeEl(world, focus) : world.querySelector<HTMLElement>(`[data-head="${CSS.escape(laneKey)}"]`);
}

function getOwner(bundle: MapBundle | undefined): Owner {
  return bundle ? bundle.relation : "none";
}

interface LaneHeadProps {
  lane: LaidLane;
  bundle: MapBundle | undefined;
  /** 지도 안의 Tab 자리 하나가 이 줄기의 접기 단추인가(움직이는 tabindex) */
  isEntry: boolean;
}

function LaneHead({ lane, bundle, isEntry }: LaneHeadProps) {
  const { t } = useI18n();
  const owner = getOwner(bundle);
  // 구성원이 아닌 Bundle은 제목이 오지 않는다(빈 글) - 코드만 적고 다른 무엇으로도 채우지 않는다
  const name = bundle ? [bundle.code, bundle.title].filter(Boolean).join(" · ") : t("map.owner.none");
  const toggleLabel = t(lane.collapsed ? "map.lane.expand" : "map.lane.collapse");
  const Chevron = lane.collapsed ? ChevronRight : ChevronDown;
  return (
    <div className="map-lane-head" style={{ height: LANE_HEAD }}>
      <div className="map-lane-row">
        <span className="map-lane-name" data-tip={name}>
          {name}
        </span>
        {owner === "summary" && (
          <span className="map-lane-lock" data-testid={`map-lane-lock-${lane.key}`} data-tip={t("map.lane.lockTip")}>
            <Lock size={12} strokeWidth={1.5} aria-hidden />
          </span>
        )}
        <button
          type="button"
          className="map-lane-toggle"
          data-head={lane.key}
          data-testid={`map-lane-toggle-${lane.key}`}
          aria-expanded={!lane.collapsed}
          aria-label={toggleLabel}
          data-tip={toggleLabel}
          tabIndex={isEntry ? 0 : -1}
        >
          <Chevron size={14} strokeWidth={1.5} aria-hidden />
        </button>
      </div>
      <div className="map-lane-row map-lane-meta">
        {bundle ? (
          <>
            <span className="map-lane-owner" data-o={owner} data-tip={t(`map.owner.${owner}`)}>
              {t(`map.owner.${owner}`)}
            </span>
            <BundleStatusPill status={bundle.status} />
            <span className="map-lane-docs">{t("map.lane.docs", { n: bundle.document_count })}</span>
          </>
        ) : (
          <span className="map-lane-owner" data-o="none" data-tip={t("map.lane.noneSub")}>
            {t("map.lane.noneSub")}
          </span>
        )}
      </div>
    </div>
  );
}

export const MapWorld = memo(function MapWorld({ view, layout, zoom, selectedId, onSelect, onToggleLane, onMore, onZoom, onFit }: MapWorldProps) {
  const { t } = useI18n();
  const worldRef = useRef<HTMLDivElement>(null);
  // 지금 올린(포커스한) 마디 - 같은 마디 안의 움직임마다 표시를 다시 달지 않게
  const hotRef = useRef<string | null>(null);
  const nodeById = useMemo(() => new Map(view.nodes.map((node) => [node.id, node])), [view]);
  const bundleById = useMemo(() => new Map(view.bundles.map((bundle) => [bundle.id, bundle])), [view]);
  const edgeByKey = useMemo(() => new Map(view.edges.map((edge) => [getEdgeKey(edge), edge])), [view]);
  const sides = useMemo(() => getEdgeSides(view), [view]);
  const lineCounts = useMemo(() => countNodeLines(view), [view]);
  const neighbors = useMemo(() => listNeighbors(layout.edges), [layout]);
  // 움직이는 tabindex - 지도 안의 Tab 자리는 이것 하나다(고른 마디, 없으면 이 Bundle의 첫 마디, 그것도 없으면 첫 줄기 머리)
  const entry = getEntryFocus(layout, selectedId);

  // 고른 마디의 이웃 강조 - 고름이나 그린 것이 바뀔 때마다 맞추고, 남은 올리기 강조는 거둔다
  useLayoutEffect(() => {
    const world = worldRef.current;
    if (!world) return;
    hotRef.current = null;
    world.removeAttribute("data-hot");
    markNeighbors(world, selectedId, neighbors);
  }, [selectedId, neighbors]);

  // 올리기·포커스 강조 - 고른 마디가 없을 때만(고른 동안에는 고른 마디의 이웃이 강조된 채다)
  function showHot(nodeId: string | null) {
    const world = worldRef.current;
    if (!world || selectedId !== null) return;
    if (nodeId === null) world.removeAttribute("data-hot");
    else world.setAttribute("data-hot", "");
    markNeighbors(world, nodeId, neighbors);
  }

  function handleOver(event: PointerEvent<HTMLDivElement> | FocusEvent<HTMLDivElement>) {
    const nodeId = readNodeId(event.target);
    if (nodeId === null || nodeId === hotRef.current) return;
    hotRef.current = nodeId;
    showHot(nodeId);
  }

  function handleOut(event: PointerEvent<HTMLDivElement> | FocusEvent<HTMLDivElement>) {
    const from = readNodeId(event.target);
    // 같은 마디 안에서 옮겨 간 것은 나간 것이 아니다
    if (from === null || readNodeId(event.relatedTarget) === from) return;
    hotRef.current = null;
    showHot(null);
  }

  // 글쇠 - 화살표·Home·End는 포커스를 옮기고, Esc는 고름을 풀고, + · - · 0은 확대. 고르기·접기(Enter·Space)는 단추의 click이 한다(같은 길 하나)
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const world = worldRef.current;
    if (!world) return;
    const action = getMapKeyAction(event.key, readFocus(event.target) ?? "", layout);
    // 지도 끝에서의 화살표는 null - 포커스와 고름을 그대로 둔다
    if (action === null || action.kind === "select" || action.kind === "toggle") return;
    event.preventDefault();
    if (action.kind === "focus") {
      const el = findFocusEl(world, action.id);
      el?.focus({ preventScroll: true });
      el?.scrollIntoView({ block: "nearest", inline: "nearest" });
    } else if (action.kind === "clear") {
      onSelect(null);
    } else if (action.kind === "zoom") {
      const next = stepZoom(zoom, action.dir);
      if (next !== zoom) onZoom(next, null);
    } else {
      onFit();
    }
  }

  // 마디·접기·"N개 더"는 세계 하나가 듣는다
  function handleClick(event: MouseEvent<HTMLDivElement>) {
    if (!(event.target instanceof Element)) return;
    const nodeId = readNodeId(event.target);
    if (nodeId !== null) {
      onSelect(nodeId === selectedId ? null : nodeId);
      return;
    }
    const head = event.target.closest<HTMLElement>("[data-head]")?.dataset.head;
    if (head !== undefined) {
      onToggleLane(head);
      return;
    }
    const more = event.target.closest<HTMLElement>("[data-more]")?.dataset.more;
    if (more !== undefined) onMore(more);
  }

  function renderNode(node: MapNode, lane: LaidLane) {
    const laid = layout.nodes.get(node.id);
    if (!laid) return null;
    const bundle = node.bundle_id === null ? undefined : bundleById.get(node.bundle_id);
    const owner = getOwner(bundle);
    const number = node.number || t("map.node.noNumber");
    const becomes = formatBecomes(node);
    const becomesText = node.becomes.map((item) => item.code || item.title).join(", ");
    const counts = lineCounts.get(node.id) ?? { cites: 0, citedBy: 0 };
    const label = [
      number,
      node.title,
      t(`map.owner.${owner}`),
      becomesText && `${t("map.side.becomes")} ${becomesText}`,
      t("map.side.cites", { n: counts.cites }),
      t("map.side.citedBy", { n: counts.citedBy }),
    ]
      .filter(Boolean)
      .join(", ");
    const tip = [number, node.title, becomesText && `→ ${becomesText}`].filter(Boolean).join("\n");
    const isSelected = node.id === selectedId;
    return (
      <button
        key={node.id}
        type="button"
        className="map-node"
        data-testid={`map-node-${node.id}`}
        data-node={node.id}
        data-lane={lane.key}
        data-o={owner}
        data-kind={node.kind}
        data-tip={tip}
        data-sel={isSelected ? "" : undefined}
        data-match={view.matches.has(node.id) ? "" : undefined}
        aria-label={label}
        aria-pressed={isSelected}
        tabIndex={node.id === entry ? 0 : -1}
        style={{ left: laid.x - lane.x, top: laid.y, width: NODE_W, height: NODE_H }}
      >
        <span className="map-node-row">
          <span className="map-node-no">
            {node.kind === "target" && <span className="map-node-new">{t("map.node.newTag")}</span>}
            {node.number ? truncateMiddle(node.number, 10, 6) : number}
          </span>
          {becomes && (
            <span className="map-node-becomes" data-tentative={bundle?.status !== "done" ? "" : undefined}>
              {`→ ${becomes.first}`}
              {becomes.more > 0 && ` +${becomes.more}`}
            </span>
          )}
        </span>
        <span className="map-node-title">{node.title}</span>
      </button>
    );
  }

  return (
    <div
      ref={worldRef}
      className="map-world"
      data-testid="map-world"
      data-far={zoom < ZOOM_FAR ? "" : undefined}
      data-focus={selectedId !== null && layout.nodes.has(selectedId) ? "" : undefined}
      data-find={view.hasQuery ? "" : undefined}
      style={{ width: layout.width, height: layout.height, transform: `scale(${zoom})` }}
      onPointerOver={handleOver}
      onPointerOut={handleOut}
      onFocus={handleOver}
      onBlur={handleOut}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      {layout.lanes.map((lane) => {
        const bundle = lane.bundleId === null ? undefined : bundleById.get(lane.bundleId);
        return (
          <div
            key={lane.key}
            className="map-lane"
            role="group"
            aria-label={bundle ? [bundle.code, bundle.title].filter(Boolean).join(" · ") : t("map.owner.none")}
            data-testid={`map-lane-${lane.key}`}
            data-o={getOwner(bundle)}
            data-collapsed={lane.collapsed ? "" : undefined}
            style={{ left: lane.x, width: LANE_W, height: lane.height }}
          >
            <LaneHead lane={lane} bundle={bundle} isEntry={entry === getLaneFocus(lane.key)} />
            {lane.nodeIds.map((id) => {
              const node = nodeById.get(id);
              return node ? renderNode(node, lane) : null;
            })}
            {lane.more && (
              <button
                type="button"
                className="map-lane-more"
                data-more={lane.key}
                data-testid={`map-lane-more-${lane.key}`}
                tabIndex={-1}
                style={{ top: lane.more.y, left: (LANE_W - NODE_W) / 2, width: NODE_W, height: MORE_H }}
              >
                {t("map.lane.more", { n: lane.more.count })}
              </button>
            )}
          </div>
        );
      })}
      <svg className="map-edges" data-testid="map-edges" aria-hidden width={layout.width} height={Math.max(layout.height, LANE_HEAD)}>
        {layout.edges.map((laid) => {
          const edge = edgeByKey.get(laid.key);
          if (!edge) return null;
          const side = sides.get(laid.key) ?? "peer";
          return (
            <g key={laid.key}>
              <path className="map-edge" d={laid.d} data-edge={laid.key} data-k={side} data-label={getEdgeLabel(edge)} />
              <circle className="map-edge-dot" cx={laid.dot.x} cy={laid.dot.y} r={DOT_R} data-edge={laid.key} data-k={side} />
            </g>
          );
        })}
      </svg>
    </div>
  );
});
