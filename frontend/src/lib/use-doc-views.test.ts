// 문서마다 보기 · 줄 - 편집 뒤 그 문서만 다시 받고, 보기와 줄은 같은 렌더에 바뀌며, 늦게 닿은 옛 응답은 새것을 덮지 않는다.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Decision, DocumentView, UnitRow } from "./api-sop";
import { EMPTY_DOC_VIEWS, groupUnitsByDoc, listDocUnits, listDocViews, listPlacedSince, mergeDocBatch, patchUnitDecisions, useDocViews, type DocBatch } from "./use-doc-views";

const api = vi.hoisted(() => ({ calls: [] as string[], revision: new Map<number, number>() }));
vi.mock("./api-sop", () => ({
  getDocumentView: (_bundleId: number, docId: number) => {
    api.calls.push(`view:${docId}`);
    return Promise.resolve({ document: { id: docId, revision: api.revision.get(docId) ?? 1 }, units: [] });
  },
  listAllUnits: (_bundleId: number, docId?: number) => {
    api.calls.push(docId === undefined ? "units:all" : `units:${docId}`);
    const ids = docId === undefined ? [1, 2] : [docId];
    return Promise.resolve(ids.map((id) => ({ unit_id: id * 100 + (api.revision.get(id) ?? 1), document_id: id })));
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const view = (docId: number, revision = 1) => ({ document: { id: docId, revision }, units: [] }) as unknown as DocumentView;
const row = (unitId: number, docId: number) => ({ unit_id: unitId, document_id: docId }) as UnitRow;
const batch = (seq: number, views: DocumentView[], units: Array<[number, UnitRow[]]> = [], asked: number[] = []): DocBatch => ({ seq, views, units: new Map(units), asked });

describe("patchUnitDecisions", () => {
  const decision = { disposition: "delete", status: "confirmed", revision: 4 } as Decision;
  it("puts a save's decisions on its rows without counting a placement", () => {
    const placed = mergeDocBatch(EMPTY_DOC_VIEWS, batch(1, [view(1), view(2)], [[1, [row(10, 1), row(11, 1)]], [2, [row(20, 2)]]]));
    const next = patchUnitDecisions(placed, 2, new Map([[10, decision]]));
    expect(next.units.get(1)).toEqual([{ ...row(10, 1), decision, status: "confirmed" }, row(11, 1)]);
    expect(next.units.get(2)).toBe(placed.units.get(2));
    expect(next.placed).toBe(placed.placed);
    expect(next.placedAt).toBe(placed.placedAt);
  });
  it("is not undone by rows asked before the save, and gives way to rows asked after it", () => {
    const placed = mergeDocBatch(EMPTY_DOC_VIEWS, batch(1, [view(1)], [[1, [row(10, 1)]]]));
    const patched = patchUnitDecisions(placed, 3, new Map([[10, decision]]));
    expect(mergeDocBatch(patched, batch(2, [], [[1, [row(10, 1)]]])).units.get(1)).toEqual([{ ...row(10, 1), decision, status: "confirmed" }]);
    expect(mergeDocBatch(patched, batch(4, [], [[1, [row(10, 1)]]])).units.get(1)).toEqual([row(10, 1)]);
  });
  it("keeps the same state when no row is named", () => {
    const placed = mergeDocBatch(EMPTY_DOC_VIEWS, batch(1, [view(1)], [[1, [row(10, 1)]]]));
    expect(patchUnitDecisions(placed, 2, new Map([[99, decision]]))).toBe(placed);
  });
});

describe("mergeDocBatch", () => {
  it("places a document's view and rows together and counts one placement", () => {
    const next = mergeDocBatch(EMPTY_DOC_VIEWS, batch(1, [view(1)], [[1, [row(10, 1)]]]));
    expect(next.views.get(1)?.document.revision).toBe(1);
    expect(next.units.get(1)).toEqual([row(10, 1)]);
    expect(next.placed).toBe(1);
    expect(listPlacedSince(next, 0)).toEqual([1]);
  });
  it("does not let an older response overwrite a newer one, per document", () => {
    const fresh = mergeDocBatch(EMPTY_DOC_VIEWS, batch(6, [view(1, 9)], [[1, [row(19, 1)]]]));
    // the full reload asked earlier (seq 5) lands later - doc 1 stays at the edit's answer, doc 2 is placed
    const late = mergeDocBatch(fresh, batch(5, [view(1, 8), view(2, 3)], [[1, [row(18, 1)]], [2, [row(20, 2)]]]));
    expect(late.views.get(1)?.document.revision).toBe(9);
    expect(late.units.get(1)).toEqual([row(19, 1)]);
    expect(late.views.get(2)?.document.revision).toBe(3);
    expect(listPlacedSince(late, fresh.placed)).toEqual([2]);
  });
  it("keeps the untouched map when only rows come back - a decision save does not rebuild the views", () => {
    const base = mergeDocBatch(EMPTY_DOC_VIEWS, batch(1, [view(1)], [[1, [row(10, 1)]]]));
    const next = mergeDocBatch(base, batch(2, [], [[1, [row(11, 1)]]]));
    expect(next.views).toBe(base.views);
    expect(listPlacedSince(next, base.placed)).toEqual([]);
  });
  it("counts a document as reloading until its batch is placed", () => {
    const asking = { ...EMPTY_DOC_VIEWS, asking: new Map([[1, 1]]) };
    expect(mergeDocBatch(asking, batch(1, [view(1)], [], [1])).asking.has(1)).toBe(false);
  });
});

describe("listDocViews · listDocUnits", () => {
  it("is not ready before the document list and is ready at once for a bundle with no Old document", () => {
    expect(listDocViews(new Map(), null)).toBeNull();
    expect(listDocViews(new Map(), [])).toEqual([]);
    expect(listDocUnits(new Map(), [])).toEqual([]);
  });
  it("keeps the document order for views and the server's document id order for rows", () => {
    const views = new Map([[2, view(2)], [1, view(1)]]);
    expect(listDocViews(views, [2, 1])?.map((item) => item.document.id)).toEqual([2, 1]);
    expect(listDocUnits(new Map([[2, [row(20, 2)]], [1, [row(10, 1)]]]), [2, 1])?.map((item) => item.unit_id)).toEqual([10, 20]);
    expect(listDocUnits(new Map([[1, [row(10, 1)]]]), [2, 1])).toBeNull();
  });
  it("splits the full row list by document, with an empty list for a document with no rows", () => {
    expect(groupUnitsByDoc([row(10, 1)], [1, 2])).toEqual(new Map([[1, [row(10, 1)]], [2, []]]));
  });
});

describe("useDocViews", () => {
  const box: { docs: ReturnType<typeof useDocViews> | null; renders: string[] } = { docs: null, renders: [] };
  function Harness() {
    const docs = useDocViews(7, [1, 2]);
    // every committed render - the edited document's view revision and its row id must always match
    const shown = docs.views?.find((item) => item.document.id === 1);
    const rows = docs.units?.filter((item) => item.document_id === 1);
    box.renders.push(`${shown?.document.revision ?? "-"}/${rows?.map((item) => item.unit_id % 100).join(",") ?? "-"}`);
    box.docs = docs;
    return null;
  }
  beforeEach(() => {
    api.calls = [];
    api.revision.clear();
    box.renders = [];
  });

  it("does not place a view an Undo overtook, and stops counting it as being read", async () => {
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(createElement(Harness)));
    const placed = box.docs?.placed;
    api.revision.set(1, 2);
    let isOk: boolean | undefined;
    await act(async () => {
      isOk = await box.docs?.reload({ docs: [1], units: [1] }, () => false);
    });
    expect([isOk, box.docs?.placed, box.docs?.isReloading(1)]).toEqual([true, placed, false]);
    expect(box.renders.at(-1)).toBe("1/1");
    await act(async () => root.unmount());
  });

  it("after an edit fetches only that document's view and rows, and they arrive in one render", async () => {
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(createElement(Harness)));
    expect(api.calls.sort()).toEqual(["units:all", "view:1", "view:2"]);
    api.calls = [];
    api.revision.set(1, 2);
    await act(async () => box.docs?.reload({ docs: [1], units: [1] }));
    expect(api.calls.sort()).toEqual(["units:1", "view:1"]);
    expect(box.renders.filter((item) => item !== "-/-")).not.toContain("2/1");
    expect(box.renders.filter((item) => item !== "-/-")).not.toContain("1/2");
    expect(box.renders.at(-1)).toBe("2/2");
    act(() => root.unmount());
  });

  it("marks the document as reloading until the fetched batch is applied - the motion path applies it later", async () => {
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(createElement(Harness)));
    api.revision.set(1, 3);
    let ready: DocBatch | null = null;
    await act(async () => {
      ready = (await box.docs?.fetch({ docs: [1], units: [1] })) ?? null;
    });
    expect(box.docs?.isReloading(1)).toBe(true);
    expect(box.docs?.isReloading(2)).toBe(false);
    act(() => box.docs?.apply(ready as unknown as DocBatch));
    expect(box.docs?.isReloading(1)).toBe(false);
    expect(box.renders.at(-1)).toBe("3/3");
    act(() => root.unmount());
  });
});
