import { describe, expect, it } from "vitest";

import type { PlaceMark } from "./original-place-model";
import { readRenderView, reduceOriginalRender, type OriginalRenderState } from "./use-original-render";

const KEY_A = "1:10";
const KEY_B = "1:11";
const marks = new Map<number, PlaceMark[]>([[3, [{ id: "sopa_0", cell: false, exact: true, page: 1 }]]]);

function renderedA(): OriginalRenderState {
  return reduceOriginalRender(readRenderView(null, KEY_A), { type: "rendered", key: KEY_A, docId: 10, marks, pageCount: 4 });
}

describe("original render state", () => {
  it("starts loading for a document it has not drawn", () => {
    expect(readRenderView(null, KEY_A)).toMatchObject({ key: KEY_A, status: "loading", renderedDocId: null, attempt: 0 });
  });

  it("goes back to loading when the document changes", () => {
    const view = readRenderView(renderedA(), KEY_B);
    expect(view).toMatchObject({ key: KEY_B, status: "loading", renderedDocId: null, pageCount: 0 });
    expect(view.marks.size).toBe(0);
  });

  it("shows the pdf notice for a pdf original", () => {
    const state = reduceOriginalRender(readRenderView(null, KEY_A), { type: "unavailable", key: KEY_A, format: "pdf" });
    expect(state.status).toBe("pdf");
  });

  it("keeps the drawn marks and page count", () => {
    expect(renderedA()).toMatchObject({ status: "ready", renderedDocId: 10, pageCount: 4 });
    expect(renderedA().marks.get(3)?.[0].id).toBe("sopa_0");
  });

  it("shows an error when drawing throws, and retry loads again", () => {
    const failed = reduceOriginalRender(readRenderView(null, KEY_A), { type: "failed", key: KEY_A, error: new Error("broken") });
    expect(failed.status).toBe("error");
    const retried = reduceOriginalRender(failed, { type: "retry", key: KEY_A });
    expect(retried).toMatchObject({ status: "loading", attempt: 1, error: null });
  });

  it("ignores a result for a document that is no longer shown", () => {
    const onB = readRenderView(renderedA(), KEY_B);
    const late = reduceOriginalRender(onB, { type: "rendered", key: KEY_A, docId: 10, marks, pageCount: 4 });
    expect(late).toBe(onB);
  });
});
