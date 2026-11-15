import { describe, expect, it } from "vitest";

import type { EquisInfo, UnitRefDetail, ViewUnit } from "./api-sop";
import { guessRefNumber, isRefPending, pickRefUnit, readRefAdvice } from "./ref-model";

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

describe("readRefAdvice", () => {
  const OLD = "SOP-ABC-1016 Operation of UV spectrophotometer";
  const NOW = "SOP-ABC-00001 Operation and Maintenance of UV spectrophotometer";
  const equis: EquisInfo = {
    state: "found", refreshing: false, verdict: "attention", reasons: ["old_number"], notes: [], current: null, in_progress: [], retired: null,
    number: "SOP-ABC-00001", trail: [], ambiguous: [], name: "Operation and Maintenance of UV spectrophotometer", subtype: "", owning_department: "", plant: "", area: "",
    legacy_numbers: [], equipment_tag: "", doc_url: null, title_locked: false, fetched_at: null,
  };
  const detail = (over: Partial<UnitRefDetail> = {}): UnitRefDetail => ({ state: "confirmed", number: "SOP-ABC-1016", equis, suggested_text: NOW, ...over });

  it("says the number differs while the old number is still written", () => {
    expect(readRefAdvice(OLD, OLD, detail())).toEqual({ issue: "number", text: NOW });
  });

  it("says the title differs once the number is the current one", () => {
    expect(readRefAdvice("SOP-ABC-00001 Operation of UV spectrophotometer", OLD, detail())).toEqual({ issue: "title", text: NOW });
  });

  it("is quiet when the text matches, ignoring case and spacing", () => {
    expect(readRefAdvice("sop-abc-00001  operation and maintenance of UV spectrophotometer ", OLD, detail())).toBeNull();
  });

  it("compares with the source when the source already matches EQUIS", () => {
    expect(readRefAdvice(NOW, NOW, detail({ suggested_text: null }))).toBeNull();
    expect(readRefAdvice("SOP-ABC-00001 UV", NOW, detail({ suggested_text: null }))).toEqual({ issue: "title", text: NOW });
  });

  it("has nothing to compare with when EQUIS does not know the number, retired it, or is off", () => {
    expect(readRefAdvice(OLD, OLD, detail({ equis: { ...equis, state: "not_found" } }))).toBeNull();
    expect(readRefAdvice(OLD, OLD, detail({ equis: { ...equis, retired: { version: "3.0", status: "Obsolete", effective_date: "", retired_date: "2018-11-21" } } }))).toBeNull();
    expect(readRefAdvice(OLD, OLD, detail({ equis: null }))).toBeNull();
    expect(readRefAdvice(OLD, OLD, null)).toBeNull();
  });
});
