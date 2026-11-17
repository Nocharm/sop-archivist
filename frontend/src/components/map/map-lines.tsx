// 참조 지도 옆 칸 - Cites · Cited by 의 한 줄(선) 아래에 그 선의 문장. 문장은 서버가 그 줄이 든 Bundle의 구성원에게만 보낸다(설계 §7.2) -
// 그 밖의 줄은 "줄 N개 가려짐 · 요약만" 한 줄로 수만 적는다. 화면은 받은 것만 그린다(가리는 것은 서버다).
"use client";

import { RefreshCw } from "lucide-react";

import type { MapLines } from "@/lib/api-sop";
import { useI18n } from "@/lib/i18n";
import type { LineSide, LinkLines } from "@/lib/map-lines-model";

/** 옆 칸이 받는 줄 문장의 상태 - data는 지금 고른 문서의 응답일 때만(pickCurrentLines) */
export interface SideLinesState {
  data: MapLines | null;
  isLoading: boolean;
  error: unknown;
  onRetry(): void;
}

/** 한 선의 문장과 가려진 줄 수 - 둘 다 없으면(줄이 오기 전) 아무것도 그리지 않는다 */
export function LinkSentences({ row, side }: { row: LinkLines; side: LineSide }) {
  const { t } = useI18n();
  const { link, lines, withheld } = row;
  if (lines.length === 0 && withheld === 0) return null;
  return (
    <>
      {lines.length > 0 && (
        <ul className="map-sentences">
          {lines.map((line) => {
            const counterpart = side === "out" ? line.target : line.source;
            return (
              // 글은 자르지 않고 다 보인다(서버가 300자에서 자른다) - 툴팁도 Tab 자리도 없는 읽기 전용 줄이다. 누르는 길은 다음 걸음의 줄 끝 단추
              <li key={line.unit_id} className="map-sentence" data-testid={`map-line-${line.unit_id}-${counterpart}`}>
                <span className="map-sentence-id">{line.display_id}</span>
                <span className="map-sentence-text">{line.text_truncated ? `${line.text}…` : line.text}</span>
              </li>
            );
          })}
        </ul>
      )}
      {withheld > 0 && (
        <p className="map-withheld" data-testid={`map-lines-hidden-${side}-${link.nodeId}-${link.label}`}>
          {t("map.side.hidden", { n: withheld })}
        </p>
      )}
    </>
  );
}

/** 목록 아래 - 읽는 중이면 쉬머, 상한을 넘었으면 "줄 N개 더" */
export function SideLinesFoot({ side, isLoading, more }: { side: LineSide; isLoading: boolean; more: number }) {
  const { t } = useI18n();
  if (isLoading) {
    return (
      <div className="grid gap-1.5 px-1.5" aria-hidden data-testid={`map-lines-loading-${side}`}>
        <span className="sk h-3.5 w-[88%]" />
        <span className="sk h-3.5 w-[64%]" />
      </div>
    );
  }
  if (more === 0) return null;
  return (
    <p className="px-1.5 text-[13px] text-ink-3" data-testid={`map-lines-more-${side}`}>
      {t("map.side.moreLines", { n: more })}
    </p>
  );
}

/** 문장을 읽지 못했을 때 - 지도와 요약은 그대로 두고 이 한 줄과 다시 시도(설계 §6.9) */
export function SideLinesError({ onRetry }: { onRetry(): void }) {
  const { t } = useI18n();
  return (
    <p className="flex flex-wrap items-center gap-3 text-[13px] text-ink-2" role="alert" data-testid="map-lines-error">
      {t("map.lines.error")}
      <button type="button" className="btn" data-testid="map-lines-retry" onClick={onRetry}>
        <RefreshCw size={14} strokeWidth={1.5} aria-hidden />
        {t("common.retry")}
      </button>
    </p>
  );
}
