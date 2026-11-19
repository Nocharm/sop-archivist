// 참조 지도 도구 줄 - 제목 · 찾기 · 범위 · 거르기 · (보기·확대 자리) · 다시 읽기. 좁으면 줄을 바꾼다. 읽기만 하는 화면이라 저장 단추가 없다.
"use client";

import { RefreshCw, Search, X } from "lucide-react";
import { useEffect, useEffectEvent, useRef, type ReactNode } from "react";

import { Tooltip } from "@/components/ui/tooltip";
import type { MapScope } from "@/lib/api-sop";
import { useI18n } from "@/lib/i18n";
import type { MapFilters } from "@/lib/map-model";

interface MapToolbarProps {
  scope: MapScope;
  filters: MapFilters;
  view: "map" | "list";
  /** 범위 linked에서 찾는 글에 맞는 것이 없다 - Search all Bundles를 보인다 */
  canSearchAll: boolean;
  isLoading: boolean;
  onScope(scope: MapScope): void;
  onFilters(next: MapFilters): void;
  onSearchEnter(): void;
  onSearchAll(): void;
  onRefresh(): void;
  /** Map · List와 확대 단추가 들어갈 자리 */
  children?: ReactNode;
}

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

const SCOPES: readonly MapScope[] = ["linked", "all"];

export function MapToolbar({ scope, filters, view, canSearchAll, isLoading, onScope, onFilters, onSearchEnter, onSearchAll, onRefresh, children }: MapToolbarProps) {
  const { t } = useI18n();
  const searchRef = useRef<HTMLInputElement>(null);

  // `/`는 찾기 칸으로(설명서 화면과 같은 글쇠) - 글 입력 중이거나 Ctrl·⌘·Alt와 함께면 가로채지 않는다
  const handleKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return;
    if (document.querySelector('[role="dialog"],[role="menu"],[role="listbox"]') !== null) return;
    event.preventDefault();
    searchRef.current?.focus();
    searchRef.current?.select();
  });

  useEffect(() => {
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  return (
    <div className="map-toolbar" data-view={view}>
      <h1 className="page-title ul">{t("map.title")}</h1>
      <label className="map-search flex h-8 min-w-0 items-center gap-2 rounded-md border border-line-2 bg-surface px-2 focus-within:border-accent focus-within:ring-1 focus-within:ring-accent">
        <Search size={14} strokeWidth={1.5} className="shrink-0 text-ink-3" aria-hidden />
        <input
          ref={searchRef}
          type="text"
          className="manual-search-input map-search-input min-w-0 flex-1 bg-transparent text-[13px]"
          placeholder={t("map.search")}
          aria-label={t("map.search")}
          value={filters.query}
          data-testid="map-search"
          onChange={(event) => onFilters({ ...filters, query: event.target.value })}
          onKeyDown={(event) => {
            // 한글 입력 중의 Enter는 글자를 확정할 뿐이다
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
            event.preventDefault();
            onSearchEnter();
          }}
        />
        {filters.query !== "" && (
          <Tooltip label={t("manual.searchClear")} align="end">
            <button
              type="button"
              className="manual-search-clear"
              aria-label={t("manual.searchClear")}
              data-testid="map-search-clear"
              onClick={() => {
                onFilters({ ...filters, query: "" });
                searchRef.current?.focus();
              }}
            >
              <X size={14} strokeWidth={1.5} aria-hidden />
            </button>
          </Tooltip>
        )}
      </label>
      {canSearchAll && (
        <button type="button" className="btn" data-testid="map-search-all" onClick={onSearchAll}>
          {t("map.searchAll")}
        </button>
      )}
      <div className="view-toggle map-scope" role="group" aria-label={t("map.title")}>
        {SCOPES.map((item) => (
          <button key={item} type="button" aria-pressed={scope === item} data-testid={`map-scope-${item}`} onClick={() => onScope(item)}>
            {t(`map.scope.${item}`)}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          className="chip-toggle"
          aria-pressed={filters.proposedOnly}
          data-testid="map-filter-proposed"
          onClick={() => onFilters({ ...filters, proposedOnly: !filters.proposedOnly })}
        >
          {t("map.filter.proposed")}
        </button>
        <button
          type="button"
          className="chip-toggle"
          aria-pressed={filters.showMoved}
          data-testid="map-filter-moved"
          onClick={() => onFilters({ ...filters, showMoved: !filters.showMoved })}
        >
          {t("map.filter.moved")}
        </button>
      </div>
      {children}
      <span className="ml-auto">
        <Tooltip label={t("map.refresh")} align="end">
          <button type="button" className="btn icon ghost" aria-label={t("map.refresh")} data-testid="map-refresh" disabled={isLoading} onClick={onRefresh}>
            <RefreshCw size={16} strokeWidth={1.5} aria-hidden />
          </button>
        </Tooltip>
      </span>
    </div>
  );
}
