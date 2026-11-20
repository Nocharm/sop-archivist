// 위치 판의 줄 - 그림 탭 카드의 "위치 보기" 판이 그 그림의 본문 앞뒤 줄과 문장 속 글자 자리를 고르고(시안 2 D3),
// 1단 보기의 짝 엿보기 판이 짝 박스와 그 앞뒤 줄을 고른다(B7). 용지와 같은 줄 펴기를 쓴다.

import { buildRows, foldCaptionRows, pickFigureRows, toUnitOffset, type FigureRowMode, type PaperItem, type PaperModel, type PaperRow } from "./paper-model";
import { orderPairRuns } from "./pair-order-model";
import { orderUnwrappedRows } from "./unwrap-model";

/** 판에 보일 앞뒤 줄 수 - 그림 판과 짝 판이 같다 */
export const SPOT_ROWS = 3;

export interface FigureSpot {
  /** 자리 앞 줄 키(문서 순) - 문장 속 그림이면 그 문장 줄이 마지막이다. 자리 선은 이 마지막 줄 뒤(비면 맨 위) */
  before: string[];
  /** 자리 뒤 줄 키(문서 순) */
  after: string[];
  /** 그림이 든 문장과 그 단위 글 안 자리 - 그림만 든 문단 · 옛 추출(anchor 없음)이면 null */
  host: { unitId: number; at: number } | null;
}

/** 짝 판의 줄 - 짝 박스 줄과 그 앞뒤 본문 줄(문서 순) */
export interface UnitSpot {
  before: string[];
  row: string;
  after: string[];
}

function readRowUnitId(row: PaperRow): number | null {
  return row.type === "table" ? row.item.unitId : row.unitId;
}

/** 용지 줄 펴기 - 캡션을 묶음 줄에 접고, 그림 줄을 고르고(mode), 벗긴 표 덩이 · 짝 카드 안 순서를 따른다. 용지(Paper)와 위치 판이 같은 줄을 쓴다 */
export function buildStripRows(items: readonly PaperItem[], model: PaperModel, mode: FigureRowMode = "all"): PaperRow[] {
  const rows = pickFigureRows(foldCaptionRows(buildRows(items, model.segments), model.units), model.figureGroupOf, mode);
  return orderPairRuns(orderUnwrappedRows(rows, model), (row) => model.units.get(readRowUnitId(row) ?? -1));
}

/**
 * 그림 단위의 본문 자리 - 본문 탭 줄(그림 탭 줄은 뺀다) 가운데 그 그림 바로 앞 3줄 · 뒤 3줄.
 * 그림 블록에 문장 속 자리(anchor)가 있으면 그 글자를 덮는 단위의 줄이 앞 줄의 마지막이 되고(강조 · 세로 표시), 없으면 그림 블록 바로 앞 줄 뒤에 선만 긋는다.
 * 본문에 없는 그림이면 null.
 */
export function findFigureSpot(model: PaperModel, figureUnitId: number): FigureSpot | null {
  const rows = buildStripRows(model.body, model);
  const index = rows.findIndex((row) => row.type === "figure" && row.unitId === figureUnitId);
  if (index < 0) return null;
  const figureRow = rows[index];
  const anchor = figureRow.type === "figure" ? (figureRow.block.anchor ?? null) : null;
  let host: FigureSpot["host"] = null;
  let pivot = index;
  if (anchor) {
    const unit = [...model.units.values()].find((item) => item.kind !== "figure" && item.spans.some(([blockId, start, end]) => blockId === anchor.block_id && start <= anchor.at && anchor.at <= end));
    const at = unit ? toUnitOffset(unit.spans, anchor.block_id, anchor.at) : null;
    // 칸 문장은 제 표 줄 안이다(데이터 표)
    const hostIndex = unit ? rows.findIndex((row) => (row.type === "piece" ? row.unitId === unit.id : row.type === "table" && row.item.unitId !== null && row.item.unitId === unit.group_unit_id)) : -1;
    if (unit && at !== null && hostIndex >= 0) {
      host = { unitId: unit.id, at };
      pivot = hostIndex;
    }
  }
  return { ...listAround(rows, pivot, host !== null, model), host };
}

/**
 * 글 단위(짝 박스)의 본문 자리 - 그 단위의 줄(칸 문장이면 제 표 줄)과 앞 3줄 · 뒤 3줄(그림 줄은 건너뛴다). 본문에 없으면 null.
 */
export function findUnitSpot(model: PaperModel, unitId: number): UnitSpot | null {
  const unit = model.units.get(unitId);
  if (!unit || unit.kind === "figure") return null;
  const rows = buildStripRows(model.body, model);
  const index = rows.findIndex((row) => (row.type === "piece" ? row.unitId === unitId : row.type === "table" && row.item.unitId !== null && row.item.unitId === unit.group_unit_id));
  if (index < 0) return null;
  return { ...listAround(rows, index, false, model), row: rows[index].key };
}

/** 가운데 줄(pivot) 앞뒤의 본문 줄 키 - withPivot이면 가운데 줄이 앞 줄의 마지막이 된다 */
function listAround(rows: readonly PaperRow[], pivot: number, withPivot: boolean, model: PaperModel): { before: string[]; after: string[] } {
  const isBodyRow = (row: PaperRow) => pickFigureRows([row], model.figureGroupOf, "hide").length === 1;
  const before: string[] = [];
  for (let at = withPivot ? pivot : pivot - 1; at >= 0 && before.length < SPOT_ROWS; at -= 1) if (isBodyRow(rows[at])) before.unshift(rows[at].key);
  const after: string[] = [];
  for (let at = pivot + 1; at < rows.length && after.length < SPOT_ROWS; at += 1) if (isBodyRow(rows[at])) after.push(rows[at].key);
  return { before, after };
}
