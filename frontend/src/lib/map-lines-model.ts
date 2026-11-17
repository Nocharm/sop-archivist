/** 참조 지도 옆 칸의 줄 문장 - 선(맞은편 마디 · 상태)마다 그 선의 문장과 가려진 줄 수를 붙이는 순수 모델(설계 2026-11-17 참조 지도 §6.8 · §7.2) */
import type { MapLine, MapLines, MapWithheld } from "./api-sop";
import { getEdgeLabel, type NodeLink } from "./map-model";

export type LineSide = "out" | "in";

export interface LinkLines {
  link: NodeLink;
  /** 그 선의 문장 - 구성원인 Bundle의 줄만 온다 */
  lines: MapLine[];
  /** 그 선의 가려진 줄 수(구성원이 아닌 Bundle의 줄) */
  withheld: number;
}

export interface SideLines {
  rows: LinkLines[];
  /** 한쪽 상한을 넘어 오지 않은 문장 줄 수 */
  more: number;
}

/** 그 줄의 맞은편 마디 - 나가는 줄이면 도착, 들어오는 줄이면 출발 */
function getCounterpart(item: Pick<MapLine | MapWithheld, "source" | "target">, side: LineSide): string {
  return side === "out" ? item.target : item.source;
}

function getRowKey(nodeId: string, label: string): string {
  return `${nodeId}\n${label}`;
}

/** 옆 칸의 줄(맞은편 마디 · 상태)마다 그 줄의 문장과 가려진 수를 붙인다 - 줄이 오기 전이나 맞는 줄이 없는 줄은 비어 수만 보인다 */
export function attachLines(links: readonly NodeLink[], lines: MapLines | null, side: LineSide): SideLines {
  const rows = links.map((link) => ({ link, lines: [] as MapLine[], withheld: 0 }));
  if (!lines) return { rows, more: 0 };
  const byKey = new Map(rows.map((row) => [getRowKey(row.link.nodeId, row.link.label), row]));
  for (const line of side === "out" ? lines.out : lines.in) byKey.get(getRowKey(getCounterpart(line, side), getEdgeLabel(line)))?.lines.push(line);
  for (const item of side === "out" ? lines.withheld_out : lines.withheld_in) {
    const row = byKey.get(getRowKey(getCounterpart(item, side), getEdgeLabel(item)));
    if (row) row.withheld += item.lines;
  }
  return { rows, more: side === "out" ? lines.more_out : lines.more_in };
}

/** 지금 고른 마디의 응답일 때만 쓴다 - 읽는 중이거나 앞 마디의 응답이면 null(앞 문서의 문장이 새 문서 아래에 남아 보이지 않게) */
export function pickCurrentLines(lines: MapLines | null, selectedId: string | null, isLoading: boolean): MapLines | null {
  if (!lines || isLoading || selectedId === null || lines.node !== selectedId) return null;
  return lines;
}
