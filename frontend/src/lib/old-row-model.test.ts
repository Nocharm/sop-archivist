import { describe, expect, it } from "vitest";

import type { SopDocument } from "./api-sop";
import { canExpandOld, isStrayNew, listOldActions, listOldRows } from "./old-row-model";

const doc = (id: number, side: "old" | "new", target: number | null, status = "ready") => ({ id, side, target_doc_id: target, status }) as SopDocument;

describe("old-row-model", () => {
  it("lists Old documents first, then New files that have no row", () => {
    const rows = listOldRows([doc(1, "new", null), doc(2, "old", null), doc(3, "new", 7), doc(4, "old", null)]);
    expect(rows.map((row) => row.id)).toEqual([2, 4, 1]);
  });

  it("calls a New file stray only when it has no row", () => {
    expect([isStrayNew(doc(1, "new", null)), isStrayNew(doc(2, "new", 7)), isStrayNew(doc(3, "old", null))]).toEqual([true, false, false]);
  });

  it("offers preview and download only for a read document, delete only to an editor", () => {
    expect(listOldActions({ status: "ready" }, true)).toEqual(["preview", "download", "delete"]);
    expect(listOldActions({ status: "ready" }, false)).toEqual(["preview", "download"]);
    expect(listOldActions({ status: "rejected" }, true)).toEqual(["delete"]);
    expect(listOldActions({ status: "failed" }, false)).toEqual([]);
  });

  it("expands only a read document", () => expect([canExpandOld({ status: "ready" }), canExpandOld({ status: "rejected" }), canExpandOld({ status: "failed" })]).toEqual([true, false, false]));
});
