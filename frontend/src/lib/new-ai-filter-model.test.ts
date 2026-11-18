// New 쪽 AI 제안 거르기 모델 - 고른 줄의 제안·간 곳·다른 줄의 제안·확정 줄·다른 문서의 제안·고른 줄 없음·칩 꺼짐.
import { describe, expect, it } from "vitest";

import type { WrittenSentence } from "./api-sop";
import type { EmptySlotRow, NewPaneRow } from "./composed-model";
import { buildNewAiFilter, listNewAiLinks, readNewAiPill, readNewAiSectionKey } from "./new-ai-filter-model";

function makeRow(id: number, extra: Partial<WrittenSentence> = {}): WrittenSentence {
  return {
    target_id: id, target_doc_id: 9, doc_code: "SOP-FLT", section_path: "6.1. Filter change", order_index: id, lang: "ko", kind: "sentence", text: `문장 ${id}`,
    status: "confirmed", change_type: null, source_unit_ids: [], partner_target_id: null, remark: "", revision: 1, ...extra,
  };
}

const EMPTY_SLOT: EmptySlotRow = { kind: "empty", key: "6.2", section_path: "6.2. Cleaning", na: false, fixed: null, autoItems: [] };

// 고른 줄은 Unit 15(한/영 짝이면 15·16). 31은 확정된 다른 줄, 19·20·21은 다른 줄의 AI 제안
const ROWS: NewPaneRow[] = [
  makeRow(1, { source_unit_ids: [31] }),
  makeRow(2, { status: "ai_suggested", source_unit_ids: [15] }),
  makeRow(3, { status: "ai_suggested", source_unit_ids: [19] }),
  makeRow(4, { status: "ai_suggested", source_unit_ids: [20], kind: "table" }),
  EMPTY_SLOT,
  makeRow(5, { section_path: "6.3. Records", status: "ai_suggested", source_unit_ids: [21] }),
  makeRow(6, { section_path: "6.3. Records", status: "unassigned" }),
];

describe("buildNewAiFilter", () => {
  it("does not filter while the chip is off", () => {
    expect(buildNewAiFilter(false, [15], ROWS)).toBeNull();
  });

  it("does not filter while no line is picked", () => {
    expect(buildNewAiFilter(true, null, ROWS)).toBeNull();
    expect(buildNewAiFilter(true, [], ROWS)).toBeNull();
  });

  it("keeps the picked line's AI suggestion and marks where the line already went", () => {
    const rows = [makeRow(1, { status: "ai_suggested", source_unit_ids: [15] }), makeRow(2, { status: "confirmed", source_unit_ids: [16, 40] })];

    const filter = buildNewAiFilter(true, [15, 16], rows);

    expect(filter?.marks.get("t:1")).toBe("mine_ai");
    expect(filter?.marks.get("t:2")).toBe("mine_went");
    expect(filter?.bands.size).toBe(0);
  });

  it("folds other lines' AI suggestions into one band per section, at the first folded row", () => {
    const filter = buildNewAiFilter(true, [15], ROWS);

    expect(filter?.marks.get("t:3")).toBe("other_ai");
    expect(filter?.marks.get("t:4")).toBe("other_ai");
    expect(filter?.marks.get("t:5")).toBe("other_ai");
    expect([...(filter?.bands ?? [])]).toEqual([
      ["t:3", { sectionKey: "6.1", count: 2 }],
      ["t:5", { sectionKey: "6.3", count: 1 }],
    ]);
  });

  it("dims lines that are already confirmed, sourceless lines included, and leaves empty slots alone", () => {
    const filter = buildNewAiFilter(true, [15], ROWS);

    expect(filter?.marks.get("t:1")).toBe("dim");
    expect(filter?.marks.get("t:6")).toBe("dim");
    expect(filter?.marks.has("slot:6.2")).toBe(false);
  });

  it("has nothing to keep when the picked line's suggestion is in another document", () => {
    const filter = buildNewAiFilter(true, [99], ROWS);

    expect([...(filter?.marks.values() ?? [])].some((mark) => mark === "mine_ai" || mark === "mine_went")).toBe(false);
    expect(filter?.marks.get("t:2")).toBe("other_ai");
    expect(filter?.bands.get("t:2")).toEqual({ sectionKey: "6.1", count: 3 });
  });

  it("changes its key with the picked line, so opened bands fold again", () => {
    expect(buildNewAiFilter(true, [15, 16], ROWS)?.key).toBe("15,16");
    expect(buildNewAiFilter(true, [19], ROWS)?.key).toBe("19");
  });
});

describe("readNewAiSectionKey", () => {
  it("reads the section number, or the heading text of an unnumbered section", () => {
    expect(readNewAiSectionKey("6.1. Filter change")).toBe("6.1");
    expect(readNewAiSectionKey("Safety")).toBe("Safety");
    expect(readNewAiSectionKey("")).toBe("top");
  });
});

describe("listNewAiLinks", () => {
  const pairs = [
    { unitId: 15, targetId: 2 },
    { unitId: 19, targetId: 3 },
  ];

  it("draws only the picked line's links while filtering", () => {
    expect(listNewAiLinks(pairs, buildNewAiFilter(true, [15], ROWS), [15])).toEqual([{ unitId: 15, targetId: 2 }]);
  });

  it("draws every link while not filtering", () => {
    expect(listNewAiLinks(pairs, null, [15])).toBe(pairs);
  });
});

describe("readNewAiPill", () => {
  it("offers to open the document that holds the picked line's suggestion", () => {
    expect(readNewAiPill({ isOn: true, suggestionDocId: 12, openDocId: 9, returnDocId: null })).toEqual({ kind: "open", docId: 12 });
  });

  it("offers the way back once that document is open", () => {
    expect(readNewAiPill({ isOn: true, suggestionDocId: 12, openDocId: 12, returnDocId: 9 })).toEqual({ kind: "back", docId: 9 });
  });

  it("shows nothing when the suggestion is in the open document and nothing was opened from the pill", () => {
    expect(readNewAiPill({ isOn: true, suggestionDocId: 9, openDocId: 9, returnDocId: null })).toBeNull();
  });

  it("shows nothing while the chip is off or the picked line has no pending suggestion", () => {
    expect(readNewAiPill({ isOn: false, suggestionDocId: 12, openDocId: 9, returnDocId: null })).toBeNull();
    expect(readNewAiPill({ isOn: true, suggestionDocId: null, openDocId: 9, returnDocId: 9 })).toBeNull();
  });
});
