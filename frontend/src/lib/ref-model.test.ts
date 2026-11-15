import { describe, expect, it } from "vitest";

import type { ViewUnit } from "./api-sop";
import { guessRefNumber, isRefPending, pickRefUnit } from "./ref-model";

function makeUnit(id: number, ref: ViewUnit["ref"]): ViewUnit {
  return {
    id, display_id: `OLD-1-00${id}`, kind: "sentence", spans: [[id, 0, 4]], text: "text", lang: ref?.state === "confirmed" ? "ref" : "en", table_id: null, row_index: null,
    group_unit_id: null, boundary_confirmed: false, status: "unassigned", pair_id: null, pos_seq: id, block_id: id, is_edited: false, can_unmerge: false, split_suggestion_id: null, ref,
  };
}

describe("guessRefNumber", () => {
  it("takes the first document number wherever it sits in the text", () => {
    expect(guessRefNumber("SOP-ABC-1016 Operation of UV spectrophotometer")).toBe("SOP-ABC-1016");
    expect(guessRefNumber("세부 사항은 WI-04를 따른다.")).toBe("WI-04");
    expect(guessRefNumber("See SOP-QA-204 and SOP-QA-205.")).toBe("SOP-QA-204");
  });

  it("gives an empty string when nothing looks like a number", () => {
    expect(guessRefNumber("Wear protective gloves.")).toBe("");
    expect(guessRefNumber("SOP-ABC-1016A")).toBe("");
  });
});

describe("pickRefUnit", () => {
  it("shows the pending proposal before a confirmed reference", () => {
    const confirmed = makeUnit(1, { state: "confirmed", number: "SOP-A-1" });
    const proposed = makeUnit(2, { state: "proposed", number: "SOP-A-2" });

    expect(pickRefUnit([makeUnit(3, null), confirmed, proposed])).toBe(proposed);
    expect(pickRefUnit([makeUnit(3, null), confirmed])).toBe(confirmed);
    expect(pickRefUnit([makeUnit(3, null)])).toBeNull();
  });

  it("counts only proposals as pending", () => {
    expect(isRefPending(makeUnit(1, { state: "proposed", number: "SOP-A-1" }))).toBe(true);
    expect(isRefPending(makeUnit(1, { state: "confirmed", number: "SOP-A-1" }))).toBe(false);
    expect(isRefPending(undefined)).toBe(false);
  });
});
