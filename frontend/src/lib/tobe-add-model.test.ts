import { describe, expect, it } from "vitest";

import type { EquisInfo } from "./api-sop";
import { describeAdd, listEquisHints, planAddRows, readCodes } from "./tobe-add-model";

describe("readCodes (numbers typed or pasted into the add field)", () => {
  it("reads one number, trimmed", () => expect(readCodes("  WI-07 ")).toEqual(["WI-07"]));
  it("splits pasted lines, tabs and commas, and drops repeats and blanks", () =>
    expect(readCodes("SOP-1\nWI-2\tWI-3, WI-2\n\n;SOP-4")).toEqual(["SOP-1", "WI-2", "WI-3", "SOP-4"]));
});

describe("planAddRows", () => {
  const listed = [{ code: "SOP-CF", doc_type: "sop" as const }, { code: "WI-01", doc_type: "wi" as const }];

  it("skips numbers already on the list and says which", () => {
    const plan = planAddRows(["WI-01", "WI-09"], listed);
    expect(plan.skipped).toEqual(["WI-01"]);
    expect(plan.rows).toEqual([{ code: "WI-09", doc_type: "wi", parent_code: "SOP-CF" }]);
  });

  it("takes the kind from the number, and puts a WI under the nearest SOP before it", () => {
    const plan = planAddRows(["SOP-QC-2", "WI-QC-21", "WI-QC-22"], listed);
    expect(plan.rows).toEqual([
      { code: "SOP-QC-2", doc_type: "sop", parent_code: null },
      { code: "WI-QC-21", doc_type: "wi", parent_code: "SOP-QC-2" },
      { code: "WI-QC-22", doc_type: "wi", parent_code: "SOP-QC-2" },
    ]);
  });

  it("makes a WI under the last SOP when the number does not say, and an SOP on an empty list", () => {
    expect(planAddRows(["QC-00012"], listed).rows).toEqual([{ code: "QC-00012", doc_type: "wi", parent_code: "SOP-CF" }]);
    expect(planAddRows(["QC-00012"], []).rows).toEqual([{ code: "QC-00012", doc_type: "sop", parent_code: null }]);
  });

  it("adds a WI as an SOP when there is no SOP to put it under", () =>
    expect(planAddRows(["WI-01"], []).rows).toEqual([{ code: "WI-01", doc_type: "sop", parent_code: null }]));
});

describe("listEquisHints (what EQUIS knows that the row does not say yet)", () => {
  const found = (over: Partial<EquisInfo>): EquisInfo => ({ state: "found", subtype: "", equipment_tag: "", ...over }) as EquisInfo;

  it("offers nothing without a found EQUIS record", () => {
    expect(listEquisHints({ doc_type: "wi", is_equipment_sop: false }, null)).toEqual([]);
    expect(listEquisHints({ doc_type: "wi", is_equipment_sop: false }, { ...found({ subtype: "SOP" }), state: "not_found" })).toEqual([]);
  });

  it("offers SOP when EQUIS calls the document an SOP and the row is a WI", () => {
    expect(listEquisHints({ doc_type: "wi", is_equipment_sop: false }, found({ subtype: "SOP" }))).toEqual([{ kind: "type", value: "sop" }]);
    expect(listEquisHints({ doc_type: "sop", is_equipment_sop: false }, found({ subtype: "SOP" }))).toEqual([]);
  });

  it("does not guess a WI from a subtype it cannot read", () =>
    expect(listEquisHints({ doc_type: "sop", is_equipment_sop: false }, found({ subtype: "Work Instruction" }))).toEqual([]));

  it("offers the equipment mark when EQUIS has an equipment tag on an unmarked SOP", () => {
    expect(listEquisHints({ doc_type: "sop", is_equipment_sop: false }, found({ equipment_tag: "CF-001" }))).toEqual([{ kind: "equipment", tag: "CF-001" }]);
    expect(listEquisHints({ doc_type: "sop", is_equipment_sop: true }, found({ equipment_tag: "CF-001" }))).toEqual([]);
    expect(listEquisHints({ doc_type: "wi", is_equipment_sop: false }, found({ equipment_tag: "CF-001" }))).toEqual([]);
  });
});

describe("describeAdd (what the add field will do)", () => {
  const listed = [{ code: "SOP-PH", doc_type: "sop" as const }, { code: "WI-04", doc_type: "wi" as const }];
  it("says nothing for an empty field", () => expect(describeAdd("  ", listed)).toEqual({ kind: "none" }));
  it("names the SOP or the WI and its parent", () => {
    expect(describeAdd("SOP-MX", listed)).toEqual({ kind: "sop", code: "SOP-MX" });
    expect(describeAdd(" WI-09 ", listed)).toEqual({ kind: "wi", code: "WI-09", parent: "SOP-PH" });
    expect(describeAdd("QC-0400", listed)).toEqual({ kind: "wi", code: "QC-0400", parent: "SOP-PH" });
  });
  it("says a WI number becomes an SOP when the list has no SOP, and only then", () => {
    expect(describeAdd("WI-09", [])).toEqual({ kind: "sopFallback", code: "WI-09" });
    expect(describeAdd("QC-0400", [])).toEqual({ kind: "sop", code: "QC-0400" });
  });
  it("says a number is already on the list", () => {
    expect(describeAdd("WI-04", listed)).toEqual({ kind: "taken", code: "WI-04" });
    expect(describeAdd("WI-04, SOP-PH", listed)).toEqual({ kind: "taken", code: "WI-04" });
  });
  it("counts several new numbers", () => expect(describeAdd("WI-09, WI-10, WI-04", listed)).toEqual({ kind: "many", n: 2 }));
});
