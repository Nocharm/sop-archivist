// Map - 문서 사이 참조와 후속 문서(참조 지도). 이 Bundle의 Old 문서가 가리키는 문서, 이 Bundle을 가리키는 문서, 그 문서들이 무엇으로 바뀌는지를 읽기만 한다.
// 남의 Bundle은 서버가 요약만 보낸다(설계 2026-11-17 참조 지도 §5) - 화면은 받은 것만 그린다. 고치는 일은 Assign에서 한다.
"use client";

import { Files, Maximize, SearchX, ZoomIn, ZoomOut } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useDeferredValue, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { BundleLoadError } from "@/components/bundle-load-error";
import { CANVAS_PAD, MapCanvas, revealMapNode } from "@/components/map/map-canvas";
import type { SideLinesState } from "@/components/map/map-lines";
import { listShownRows, MapList } from "@/components/map/map-list";
import { MapSide } from "@/components/map/map-side";
import { MapToolbar } from "@/components/map/map-toolbar";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadError } from "@/components/ui/load-error";
import { Tooltip } from "@/components/ui/tooltip";
import { getMapLines, getRefMap, type MapScope } from "@/lib/api-sop";
import { isBundleUnavailable } from "@/lib/api-errors";
import { useI18n } from "@/lib/i18n";
import { fitZoom, getZoomScroll, layoutMap, listMapOrder, stepZoom, ZOOM_MAX, ZOOM_MIN } from "@/lib/map-layout";
import { pickCurrentLines } from "@/lib/map-lines-model";
import { buildMapView, DEFAULT_FILTERS, getLaneKey, listCollapsedAtStart, type MapFilters, type MapView } from "@/lib/map-model";
import { getStageHref } from "@/lib/stages";
import { useLoaded } from "@/lib/use-loaded";

const VIEWS = ["map", "list"] as const;

function MapSkeleton() {
  return (
    <div className="grid gap-3 p-[var(--pad)]" aria-hidden>
      {[0, 1, 2, 3, 4, 5].map((row) => (
        <span key={row} className="sk h-5" style={{ width: `${62 + ((row * 17) % 33)}%` }} />
      ))}
    </div>
  );
}

export default function MapPage() {
  const { t } = useI18n();
  const bundleId = Number(useParams<{ id: string }>().id);
  const [scope, setScope] = useState<MapScope>("linked");
  // 들어올 때마다 지도에서 시작한다 - 보기·범위·거르기를 기억하지 않는다(설계 §6.7)
  const [view, setView] = useState<"map" | "list">("map");
  const [filters, setFilters] = useState<MapFilters>(DEFAULT_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  // "문서 N개 더"를 누른 줄기 - 범위 all의 자료가 오면 그 줄기만 편 채 접힘을 채운다
  const [pendingLane, setPendingLane] = useState<string | null>(null);
  // 접힘을 채운 자료의 범위 - 범위를 바꾼 뒤 처음 온 자료에서만 다시 채우고, 다시 읽기에서는 사람이 접고 편 것을 지킨다
  const [seededScope, setSeededScope] = useState<MapScope | null>(null);
  // 들어올 때마다 100% - 기억하지 않는다
  const [zoom, setZoom] = useState(1);
  const scrollRef = useRef<HTMLDivElement>(null);
  // 확대를 바꾼 뒤 맞출 스크롤 - 바뀐 크기가 그려진 뒤(useLayoutEffect) 기준점 밑의 세계 자리를 되돌린다
  const pendingZoomRef = useRef<{ from: number; to: number; anchor: { x: number; y: number }; left: number; top: number } | null>(null);
  // 펴는 줄기의 마디가 그려진 뒤 보이게 할 마디
  const pendingRevealRef = useRef<string | null>(null);
  const loaded = useLoaded(() => getRefMap(bundleId, scope), `${bundleId}:${scope}`);

  // 접근을 잃으면(403·404) 다시 읽어 성공할 때까지 앞서 받은 지도를 그리지 않는다 - useLoaded는 실패해도 앞 자료를 남긴다(계획 판단 29)
  const lostAccess = isBundleUnavailable(loaded.error);
  const [blocked, setBlocked] = useState(false);
  if (lostAccess && !blocked) setBlocked(true);
  if (blocked && !lostAccess && !loaded.isLoading && loaded.error === null) setBlocked(false);
  const data = blocked ? null : loaded.data;

  // 고른 문서의 줄 문장 - 고를 때 · 범위를 바꿀 때 · 다시 읽을 때 받는다. 늦게 온 앞 문서의 응답은 그리지 않는다(pickCurrentLines)
  const lines = useLoaded(() => (selectedId === null ? Promise.resolve(null) : getMapLines(bundleId, selectedId, scope)), `${bundleId}:${scope}:${selectedId ?? ""}`);
  // 문장 읽기가 403·404면 접근을 잃은 것이다 - 지도를 다시 읽어 위의 길(앞서 받은 지도를 그리지 않기)을 탄다. 같은 실패에는 한 번만
  const [linesLostFor, setLinesLostFor] = useState<unknown>(null);
  if (isBundleUnavailable(lines.error) && lines.error !== linesLostFor) {
    setLinesLostFor(lines.error);
    loaded.reload();
  }
  const sideLines: SideLinesState = {
    data: lines.error === null ? pickCurrentLines(lines.data, selectedId, lines.isLoading) : null,
    isLoading: selectedId !== null && lines.isLoading,
    error: lines.error,
    onRetry: lines.reload,
  };

  /** 지도와 고른 문서의 문장을 함께 다시 읽는다 */
  function reloadAll() {
    loaded.reload();
    lines.reload();
  }

  // 범위 all은 이 Bundle과 이어지지 않은 줄기를 접은 채 시작한다(계획 판단 26). 렌더 중에 맞춘다 - 이펙트 안에서 동기로 상태를 바꾸지 않는다
  if (data && data.scope !== seededScope) {
    setSeededScope(data.scope);
    setCollapsed(new Set(data.scope === "all" ? listCollapsedAtStart(data, pendingLane) : []));
    setPendingLane(null);
  }

  const query = useDeferredValue(filters.query);
  const mapView = useMemo<MapView | null>(
    () => (data ? buildMapView(data, { proposedOnly: filters.proposedOnly, showMoved: filters.showMoved, query }) : null),
    [data, filters.proposedOnly, filters.showMoved, query],
  );
  const layout = useMemo(() => (mapView ? layoutMap(mapView, collapsed) : null), [mapView, collapsed]);

  // 범위·거르기를 바꿔 고른 문서가 보이지 않게 되면 고름을 푼다(계획 판단 27). 옆 칸에서 고른 숨은 문서는 그대로 둔다 - 보이는 지도가 바뀔 때만 본다
  const [checkedView, setCheckedView] = useState<MapView | null>(mapView);
  if (mapView !== checkedView) {
    setCheckedView(mapView);
    if (selectedId !== null && mapView !== null && !mapView.nodes.some((node) => node.id === selectedId)) setSelectedId(null);
  }

  const handleKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.key !== "Escape" || selectedId === null) return;
    if (document.querySelector('[role="dialog"],[role="menu"],[role="listbox"]') !== null) return;
    setSelectedId(null);
  });

  useEffect(() => {
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  // 펴는 줄기의 마디는 다음 렌더에 생긴다 - 그려진 뒤에 보이게 한다
  useEffect(() => {
    const nodeId = pendingRevealRef.current;
    if (nodeId === null || !scrollRef.current) return;
    pendingRevealRef.current = null;
    revealMapNode(scrollRef.current, nodeId);
  });

  /** 지도에서 그 문서가 보이게 한다 - 접힌 줄기에 있으면 먼저 펴고, 지도가 아직 그려지지 않았으면(List에서 넘어올 때) 그려진 뒤에 */
  function showInMap(nodeId: string, isDrawn: boolean) {
    const node = mapView?.nodes.find((item) => item.id === nodeId);
    if (!node) return;
    const laneKey = getLaneKey(node.bundle_id);
    if (collapsed.has(laneKey)) {
      const next = new Set(collapsed);
      next.delete(laneKey);
      setCollapsed(next);
      pendingRevealRef.current = nodeId;
    } else if (isDrawn && scrollRef.current) {
      revealMapNode(scrollRef.current, nodeId);
    } else {
      pendingRevealRef.current = nodeId;
    }
  }

  /** 그 문서를 고르고 지도에서 보이게 한다 */
  function pickNode(nodeId: string) {
    setSelectedId(nodeId);
    if (view === "map") showInMap(nodeId, true);
  }

  // List에서 고른 문서는 Map으로 넘어올 때 그 줄기를 펴고 보이게 한다
  function switchView(next: "map" | "list") {
    if (next === view) return;
    setView(next);
    if (next === "map" && selectedId !== null) showInMap(selectedId, false);
  }

  useLayoutEffect(() => {
    const pending = pendingZoomRef.current;
    const el = scrollRef.current;
    if (!pending || !el) return;
    pendingZoomRef.current = null;
    const next = getZoomScroll({ left: pending.left, top: pending.top }, pending.anchor, CANVAS_PAD, pending.from, pending.to);
    el.scrollLeft = next.left;
    el.scrollTop = next.top;
  }, [zoom]);

  /** 확대를 바꾼다 - 단추·글쇠는 칸 가운데를, 휠은 포인터 자리를 지킨다 */
  function changeZoom(next: number, anchor: { x: number; y: number } | null) {
    if (next === zoom) return;
    const el = scrollRef.current;
    if (el) pendingZoomRef.current = { from: zoom, to: next, anchor: anchor ?? { x: el.clientWidth / 2, y: el.clientHeight / 2 }, left: el.scrollLeft, top: el.scrollTop };
    setZoom(next);
  }

  function fitAll() {
    const el = scrollRef.current;
    if (el && layout) changeZoom(fitZoom({ width: el.clientWidth, height: el.clientHeight }, layout), null);
  }

  function toggleLane(laneKey: string) {
    const next = new Set(collapsed);
    if (!next.delete(laneKey)) next.add(laneKey);
    setCollapsed(next);
  }

  // "문서 N개 더" - 범위를 All Bundles로 바꾸고 그 줄기를 편 채 연다(계획 판단 26)
  function openMore(laneKey: string) {
    setPendingLane(laneKey);
    setScope("all");
  }

  /** List의 보이는 줄 순서로 맞는 문서(줄의 From · To 차례), 줄이 없는 맞는 문서는 그 뒤에 */
  function listRowMatchOrder(shown: MapView): string[] {
    const order: string[] = [];
    const seen = new Set<string>();
    const add = (id: string) => {
      if (shown.matches.has(id) && !seen.has(id)) {
        seen.add(id);
        order.push(id);
      }
    };
    for (const row of listShownRows(shown)) {
      add(row.from.id);
      add(row.to.id);
    }
    for (const node of shown.nodes) add(node.id);
    return order;
  }

  // Enter - 보고 있는 순서로 맞는 문서를 차례로 고른다(끝이면 처음으로): 지도는 줄기 순서 → 줄기 안 순서(접힌 줄기의 문서면 그 줄기를 편다), List는 줄 순서
  function selectNextMatch() {
    if (!mapView || !mapView.hasQuery) return;
    const order = view === "map" ? listMapOrder(mapView).filter((id) => mapView.matches.has(id)) : listRowMatchOrder(mapView);
    if (order.length === 0) return;
    const at = selectedId === null ? -1 : order.indexOf(selectedId);
    pickNode(order[(at + 1) % order.length]);
  }

  if (lostAccess) {
    return (
      <div className="map-screen" data-testid="map">
        <BundleLoadError error={loaded.error} onRetry={reloadAll} testId="map" />
      </div>
    );
  }

  const self = data?.bundles.find((bundle) => bundle.relation === "self");
  const isFiltered = filters.proposedOnly || !filters.showMoved || (mapView?.hasQuery ?? false);
  const canSearchAll = scope === "linked" && mapView !== null && mapView.hasQuery && mapView.matches.size === 0;
  // 지도에 맞는 것이 없다 - 찾는 중이면 맞는 문서가 없을 때, 거르기만이면 남은 선이 없을 때
  const isMapUnmatched = mapView !== null && (mapView.hasQuery ? mapView.matches.size === 0 : isFiltered && mapView.edges.length === 0);

  let main: ReactNode;
  // 지도는 제 스크롤 칸(map-canvas)을 가진다 - 표·빈 상태만 바깥 스크롤 칸에 둔다
  let isCanvas = false;
  if (!data || !mapView) {
    main = loaded.error !== null ? <LoadError error={loaded.error} onRetry={loaded.reload} testId="map" /> : <MapSkeleton />;
  } else if (scope === "linked" && self?.document_count === 0 && mapView.edges.length === 0) {
    main = (
      <EmptyState
        icon={Files}
        title={t("map.empty.noDocs")}
        body={t("map.empty.noDocsBody")}
        testId="map-empty-docs"
        action={
          <Link href={getStageHref(bundleId, "documents")} className="btn" data-testid="map-empty-docs-go">
            {t("stage.documents")}
          </Link>
        }
      />
    );
  } else if (view === "map" && isMapUnmatched) {
    // 찾기·거르기에 맞는 것이 없으면 흐린 지도 대신 List와 같은 말과 단추(설계 §6.9)
    main = (
      <EmptyState
        icon={SearchX}
        title={t("map.empty.filtered")}
        testId="map-empty-filtered"
        action={
          <button type="button" className="btn" data-testid="map-empty-clear" onClick={() => setFilters(DEFAULT_FILTERS)}>
            {t("map.empty.clear")}
          </button>
        }
      />
    );
  } else if (view === "map" && layout) {
    isCanvas = true;
    main = (
      <MapCanvas
        view={mapView}
        layout={layout}
        zoom={zoom}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onToggleLane={toggleLane}
        onMore={openMore}
        onZoom={changeZoom}
        onFit={fitAll}
        scrollRef={scrollRef}
      />
    );
  } else {
    main = <MapList view={mapView} selectedId={selectedId} isFiltered={isFiltered} onPick={setSelectedId} onClear={() => setFilters(DEFAULT_FILTERS)} />;
  }

  return (
    <div className="map-screen dense" data-testid="map">
      <MapToolbar
        scope={scope}
        filters={filters}
        view={view}
        canSearchAll={canSearchAll}
        isLoading={loaded.isLoading}
        onScope={setScope}
        onFilters={setFilters}
        onSearchEnter={selectNextMatch}
        onSearchAll={() => setScope("all")}
        onRefresh={reloadAll}
      >
        <div className="view-toggle map-views" role="group" aria-label={t("map.view.label")}>
          {VIEWS.map((item) => (
            <button key={item} type="button" aria-pressed={view === item} data-testid={`map-view-${item}`} onClick={() => switchView(item)}>
              {t(`map.view.${item}`)}
            </button>
          ))}
        </div>
        {/* 그린 지도가 있을 때만 - 빈 상태·맞는 것 없음 위에는 확대할 것이 없다 */}
        {isCanvas && (
          <div className="map-zoom">
            <Tooltip label={t("map.zoom.out")}>
              <button type="button" className="btn icon ghost" aria-label={t("map.zoom.out")} data-testid="map-zoom-out" disabled={zoom <= ZOOM_MIN} onClick={() => changeZoom(stepZoom(zoom, -1), null)}>
                <ZoomOut size={16} strokeWidth={1.5} aria-hidden />
              </button>
            </Tooltip>
            <span className="map-zoom-value" data-testid="map-zoom-value">
              {Math.round(zoom * 100)}%
            </span>
            <Tooltip label={t("map.zoom.in")}>
              <button type="button" className="btn icon ghost" aria-label={t("map.zoom.in")} data-testid="map-zoom-in" disabled={zoom >= ZOOM_MAX} onClick={() => changeZoom(stepZoom(zoom, 1), null)}>
                <ZoomIn size={16} strokeWidth={1.5} aria-hidden />
              </button>
            </Tooltip>
            <Tooltip label={t("map.zoom.fit")}>
              <button type="button" className="btn icon ghost" aria-label={t("map.zoom.fit")} data-testid="map-zoom-fit" onClick={fitAll}>
                <Maximize size={16} strokeWidth={1.5} aria-hidden />
              </button>
            </Tooltip>
          </div>
        )}
      </MapToolbar>
      <div className="map-body">
        <div className="map-main">
          <div>
            {data?.truncated && (
              <p className="map-notice" role="status" data-testid="map-truncated">
                {t("map.truncated", { n: data.nodes.length })}
              </p>
            )}
            {data && loaded.error !== null && <LoadError error={loaded.error} onRetry={loaded.reload} testId="map" compact />}
          </div>
          {isCanvas ? main : <div className="map-scroll">{main}</div>}
        </div>
        <aside className="map-side" data-testid="map-side" aria-label={t("map.title")}>
          {data ? <MapSide data={data} selectedId={selectedId} lines={sideLines} onPick={pickNode} onClear={() => setSelectedId(null)} /> : <MapSkeleton />}
        </aside>
      </div>
    </div>
  );
}
