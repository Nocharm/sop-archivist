// 한 용지의 접은 표(11-23 명세 E2) - 문서마다 브라우저에 기억하고(lib/table-fold-prefs), 문서가 바뀌면 그리는 중에 그 문서의 기억을 다시 읽는다(이펙트 없음).
"use client";

import { useState } from "react";

import { readFoldedTables, writeFoldedTables } from "./table-fold-prefs";
import { toggleFold, toggleFoldAll, type TableBlock } from "./table-tab-model";

const NONE: ReadonlySet<number> = new Set();

export interface FoldedTables {
  folded: ReadonlySet<number>;
  /** 표 하나를 접거나 펼친다 */
  toggle: (tableId: number) => void;
  /** 표 모두 접기 · 펼치기 - 하나라도 펼쳐 있으면 모두 접는다 */
  toggleAll: (blocks: readonly TableBlock[]) => void;
}

/** docId는 보는 문서(올린 파일 id) - 없으면 아무것도 접지 않는다 */
export function useFoldedTables(docId: number | null): FoldedTables {
  const [state, setState] = useState<{ docId: number | null; folded: ReadonlySet<number> }>({ docId: null, folded: NONE });
  let current = state;
  if (state.docId !== docId) {
    current = { docId, folded: docId === null ? NONE : readFoldedTables(docId) };
    setState(current);
  }
  // 앞 상태에서 셈한다 - 화면에서 먼 덩어리의 단추가 낡은 접힘을 쥐고 있어도 지금 것에 더한다
  const change = (next: (folded: ReadonlySet<number>) => ReadonlySet<number>) => {
    if (docId === null) return;
    setState((prev) => {
      const folded = next(prev.docId === docId ? prev.folded : readFoldedTables(docId));
      writeFoldedTables(docId, folded);
      return { docId, folded };
    });
  };
  return {
    folded: current.folded,
    toggle: (tableId) => change((folded) => toggleFold(folded, tableId)),
    toggleAll: (blocks) => change((folded) => toggleFoldAll(folded, blocks)),
  };
}
