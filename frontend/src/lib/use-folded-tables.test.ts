// 한 용지의 접은 표 - 문서마다 기억하고, 문서를 바꾸면 그 문서의 기억을 다시 읽는다.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it } from "vitest";

import type { TableBlock } from "./table-tab-model";
import { useFoldedTables, type FoldedTables } from "./use-folded-tables";

const blocks = [2, 5].map((tableId): TableBlock => ({ tableId, section: "", rows: 1, cols: 1, caption: "", isUnwrapped: false, unitIds: [tableId * 10] }));

describe("useFoldedTables", () => {
  beforeEach(() => window.localStorage.clear());

  it("remembers folds per document and reads them back when the document changes", async () => {
    window.localStorage.setItem("sopa.assign.tablesFolded.4", "[5]");
    let shown: FoldedTables | null = null;
    function Probe({ docId }: { docId: number | null }) {
      shown = useFoldedTables(docId);
      return null;
    }
    const root = createRoot(document.createElement("div"));
    const draw = (docId: number | null) => act(async () => root.render(createElement(Probe, { docId })));
    await draw(3);
    expect(shown!.folded).toEqual(new Set());
    await act(async () => shown!.toggle(2));
    expect(shown!.folded).toEqual(new Set([2]));
    expect(window.localStorage.getItem("sopa.assign.tablesFolded.3")).toBe("[2]");
    await act(async () => shown!.toggleAll(blocks));
    expect(shown!.folded).toEqual(new Set([2, 5]));
    await draw(4);
    expect(shown!.folded).toEqual(new Set([5]));
    await draw(3);
    expect(shown!.folded).toEqual(new Set([2, 5]));
    await act(async () => shown!.toggleAll(blocks));
    expect(window.localStorage.getItem("sopa.assign.tablesFolded.3")).toBeNull();
    await draw(null);
    expect(shown!.folded).toEqual(new Set());
    await act(async () => root.unmount());
  });
});
