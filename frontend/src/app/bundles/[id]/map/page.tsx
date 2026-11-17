// Map - 문서 사이 참조와 후속 문서(참조 지도). 이 Bundle의 Old 문서가 가리키는 문서, 이 Bundle을 가리키는 문서, 그 문서들이 무엇으로 바뀌는지를 읽기만 한다.
// 남의 Bundle은 서버가 요약만 보낸다(설계 2026-11-17 참조 지도 §5) - 화면은 받은 것만 그린다. 고치는 일은 Assign에서 한다.
"use client";

import { Files } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useDeferredValue, useEffect, useEffectEvent, useMemo, useState, type ReactNode } from "react";

import { BundleLoadError } from "@/components/bundle-load-error";
import { listShownRows, MapList } from "@/components/map/map-list";
import { MapSide } from "@/components/map/map-side";
import { MapToolbar } from "@/components/map/map-toolbar";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadError } from "@/components/ui/load-error";
import { getRefMap, type MapScope } from "@/lib/api-sop";
import { isBundleUnavailable } from "@/lib/api-errors";
import { useI18n } from "@/lib/i18n";
import { buildMapView, DEFAULT_FILTERS, type MapFilters, type MapView } from "@/lib/map-model";
import { getStageHref } from "@/lib/stages";
import { useLoaded } from "@/lib/use-loaded";

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
  // Task 7이 "map"으로 바꾸고 Map · List 단추를 더한다
  const [view] = useState<"map" | "list">("list");
  const [filters, setFilters] = useState<MapFilters>(DEFAULT_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const loaded = useLoaded(() => getRefMap(bundleId, scope), `${bundleId}:${scope}`);

  // 접근을 잃으면(403·404) 다시 읽어 성공할 때까지 앞서 받은 지도를 그리지 않는다 - useLoaded는 실패해도 앞 자료를 남긴다(계획 판단 29)
  const lostAccess = isBundleUnavailable(loaded.error);
  const [blocked, setBlocked] = useState(false);
  if (lostAccess && !blocked) setBlocked(true);
  if (blocked && !lostAccess && !loaded.isLoading && loaded.error === null) setBlocked(false);
  const data = blocked ? null : loaded.data;

  const query = useDeferredValue(filters.query);
  const mapView = useMemo<MapView | null>(
    () => (data ? buildMapView(data, { proposedOnly: filters.proposedOnly, showMoved: filters.showMoved, query }) : null),
    [data, filters.proposedOnly, filters.showMoved, query],
  );

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

  // Enter - 보이는 줄 순서로 맞는 문서를 차례로 고른다(끝이면 처음으로). 줄이 없는 맞는 문서는 그 뒤에
  function selectNextMatch() {
    if (!mapView || !mapView.hasQuery) return;
    const order: string[] = [];
    const seen = new Set<string>();
    const add = (id: string) => {
      if (mapView.matches.has(id) && !seen.has(id)) {
        seen.add(id);
        order.push(id);
      }
    };
    for (const row of listShownRows(mapView)) {
      add(row.from.id);
      add(row.to.id);
    }
    for (const node of mapView.nodes) add(node.id);
    if (order.length === 0) return;
    const at = selectedId === null ? -1 : order.indexOf(selectedId);
    setSelectedId(order[(at + 1) % order.length]);
  }

  if (lostAccess) {
    return (
      <div className="map-screen" data-testid="map">
        <BundleLoadError error={loaded.error} onRetry={loaded.reload} testId="map" />
      </div>
    );
  }

  const self = data?.bundles.find((bundle) => bundle.relation === "self");
  const isFiltered = filters.proposedOnly || !filters.showMoved || (mapView?.hasQuery ?? false);
  const canSearchAll = scope === "linked" && mapView !== null && mapView.hasQuery && mapView.matches.size === 0;

  let main: ReactNode;
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
        onRefresh={loaded.reload}
      />
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
          <div className="map-scroll">{main}</div>
        </div>
        <aside className="map-side" data-testid="map-side" aria-label={t("map.title")}>
          {data ? <MapSide data={data} selectedId={selectedId} onPick={setSelectedId} onClear={() => setSelectedId(null)} /> : <MapSkeleton />}
        </aside>
      </div>
    </div>
  );
}
