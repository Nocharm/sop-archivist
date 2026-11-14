// 확인이 필요한 경고 모으기 - 확인이 필요 없는 경고는 빼고, 남은 수를 센다.
import { describe, expect, it } from "vitest";

import type { ExtractionWarning, SopDocument } from "./api-sop";
import { countPendingWarnings, listAckWarnings } from "./missing-warnings-model";

function makeWarning(id: number, patch: Partial<ExtractionWarning> = {}): ExtractionWarning {
  return { id, kind: "missing_text", block_id: 10 + id, detail: { snippet: `SYNTHETIC snippet ${id}` }, needs_ack: true, acked_by: null, acked_at: null, ack_note: "", ...patch };
}

function makeDoc(id: number, warnings: ExtractionWarning[] | null, patch: Partial<SopDocument> = {}): SopDocument {
  return {
    id, side: "old", file_name: `SYNTHETIC_${id}.docx`, file_format: "docx", size_bytes: 1, doc_code: `OLD-${id}`, doc_version: "1", title: "", language_layout: "mixed" as SopDocument["language_layout"],
    status: "ready", status_reason: "", revision: 1, target_doc_id: null, uploaded_by: "qa.member", uploaded_at: "2026-11-15T00:00:00Z",
    extraction: warnings === null ? null : { id, aux_status: "ok", warnings }, unchecked_boundaries: 0, ...patch,
  };
}

describe("listAckWarnings", () => {
  it("keeps only warnings that need a check, in document order", () => {
    const docs = [
      makeDoc(1, [makeWarning(1), makeWarning(2, { needs_ack: false, kind: "auto_numbering" })]),
      makeDoc(2, null),
      makeDoc(3, [makeWarning(3, { acked_by: "qa.member" })], { side: "new", doc_code: "" }),
    ];

    const items = listAckWarnings(docs);

    expect(items.map((item) => [item.docId, item.docLabel, item.side, item.warning.id])).toEqual([
      [1, "OLD-1", "old", 1],
      [3, "SYNTHETIC_3.docx", "new", 3],
    ]);
  });

  it("counts the ones nobody has checked yet", () => {
    const items = listAckWarnings([makeDoc(1, [makeWarning(1), makeWarning(2, { acked_by: "qa.member" }), makeWarning(3)])]);

    expect(countPendingWarnings(items)).toBe(2);
    expect(countPendingWarnings([])).toBe(0);
  });
});
