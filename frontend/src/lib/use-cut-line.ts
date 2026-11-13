// 나눌 선 - 고른 문장 안 한 자리에 선을 놓고(두 번 누르기·메뉴) 끌거나 ←→로 옮긴 뒤 "Split here"로 나눈다. Split과 Assign이 같이 쓴다.
// 선은 지금 고른 단위에만 산다 - 다른 단위를 고르면(unit이 바뀌면) 저절로 사라진다.
"use client";

import { useState } from "react";

import type { ViewUnit } from "./api-sop";
import { canSplitAt, findNearestCut, resolveCutDrag, toBlockOffset, toUnitOffset } from "./paper-model";

export interface CutLine {
  /** 고른 단위 안의 선 자리(단위 글자 위치) - 없으면 null */
  at: number | null;
  /** Paper에 넘길 선 자리(블록 기준) */
  cut: { blockId: number; offset: number } | null;
  /** 블록 위치(누른 자리)에 선을 놓는다 - 놓았으면 true */
  placeAtCaret: (unit: ViewUnit, caret: { blockId: number; offset: number } | null) => boolean;
  /** 누른 자리 가까이(없으면 문장 가운데 가까이) 나눌 수 있는 자리에 선을 놓는다 - 놓았으면 true */
  placeNear: (unit: ViewUnit, caret: { blockId: number; offset: number } | null) => boolean;
  drag: (pos: { blockId: number; offset: number } | "start" | "end") => void;
  nudge: (step: 1 | -1) => void;
  clear: () => void;
}

export function useCutLine(unit: ViewUnit | null): CutLine {
  const [cutAt, setCutAt] = useState<{ unitId: number; at: number } | null>(null);
  const at = cutAt && unit && cutAt.unitId === unit.id ? cutAt.at : null;
  const cut = unit && at !== null ? toBlockOffset(unit.spans, at) : null;

  function placeAtCaret(target: ViewUnit, caret: { blockId: number; offset: number } | null): boolean {
    const offset = caret ? toUnitOffset(target.spans, caret.blockId, caret.offset) : null;
    if (offset === null || !canSplitAt(target, offset)) return false;
    setCutAt({ unitId: target.id, at: offset });
    return true;
  }

  function placeNear(target: ViewUnit, caret: { blockId: number; offset: number } | null): boolean {
    const offset = caret ? toUnitOffset(target.spans, caret.blockId, caret.offset) : null;
    const next = findNearestCut(target, offset ?? Math.floor(target.text.length / 2));
    if (next === null) return false;
    setCutAt({ unitId: target.id, at: next });
    return true;
  }

  // 선을 끄는 동안 - 고른 단위 안의 나눌 수 있는 자리로만 옮긴다(밖으로 끌면 처음·끝에 멈춘다)
  function drag(pos: { blockId: number; offset: number } | "start" | "end") {
    if (!unit) return;
    const next = resolveCutDrag(unit, pos);
    if (next !== null && next !== at) setCutAt({ unitId: unit.id, at: next });
  }

  function nudge(step: 1 | -1) {
    if (!unit || at === null) return;
    for (let next = at + step; next > 0 && next < unit.text.length; next += step) {
      if (canSplitAt(unit, next) && toBlockOffset(unit.spans, next) !== null) {
        setCutAt({ unitId: unit.id, at: next });
        return;
      }
    }
  }

  return { at, cut, placeAtCaret, placeNear, drag, nudge, clear: () => setCutAt(null) };
}
