import { describe, expect, it } from "vitest";

import type { ToBeProposal } from "./api-sop";
import { buildProposalRows, decideProposalAdoption, decideReadWait, findProposalProblem, listParentChoices, orderProposalWrites } from "./tobe-proposal-model";

const PROPOSAL: ToBeProposal = {
  suggestion_id: 7,
  docs: [
    { code: "WI-QC-0101", title: "Run", doc_type: "wi", parent_code: "SOP-QC-0100", is_equipment_sop: false, steps: ["Prepare"] },
    { code: "SOP-QC-0100", title: "Use", doc_type: "sop", parent_code: null, is_equipment_sop: true, steps: [] },
    { code: "SOP-CF", title: "Listed", doc_type: "sop", parent_code: null, is_equipment_sop: false, steps: [] },
    { code: "QC-0200", title: "No kind", doc_type: null, parent_code: null, is_equipment_sop: false, steps: [] },
  ],
  listed_codes: ["SOP-CF"],
  truncated: false,
  invalid: false,
};

describe("buildProposalRows", () => {
  it("leaves out what is already on the list and picks the rest", () => {
    const rows = buildProposalRows(PROPOSAL);
    expect(rows.map((row) => [row.code, row.isPicked, row.isListed])).toEqual([
      ["WI-QC-0101", true, false],
      ["SOP-QC-0100", true, false],
      ["SOP-CF", false, true],
      ["QC-0200", true, false],
    ]);
  });
});

describe("findProposalProblem (what stops Add, before the server says so)", () => {
  const rows = buildProposalRows(PROPOSAL);

  it("names the row whose kind is not chosen", () => expect(findProposalProblem(rows, ["SOP-CF"])).toEqual({ kind: "type", code: "QC-0200" }));

  it("is clear once every picked row has a kind and a parent that will exist", () => {
    const fixed = rows.map((row) => (row.code === "QC-0200" ? { ...row, doc_type: "wi" as const, parent_code: "SOP-CF" } : row));
    expect(findProposalProblem(fixed, ["SOP-CF"])).toBeNull();
    expect(listParentChoices(fixed, ["SOP-CF"])).toEqual(["SOP-CF", "SOP-QC-0100"]);
  });

  it("names a WI whose parent SOP was unpicked", () => {
    const withoutSop = rows.map((row) => (row.code === "SOP-QC-0100" ? { ...row, isPicked: false } : row.code === "QC-0200" ? { ...row, isPicked: false } : row));
    expect(findProposalProblem(withoutSop, ["SOP-CF"])).toEqual({ kind: "parent", code: "WI-QC-0101" });
  });

  it("says so when nothing is picked", () => expect(findProposalProblem(rows.map((row) => ({ ...row, isPicked: false })), [])).toEqual({ kind: "none" }));
});

describe("orderProposalWrites", () => {
  it("saves SOPs first so the WIs under them find their parent", () => {
    const rows = buildProposalRows(PROPOSAL).map((row) => (row.code === "QC-0200" ? { ...row, isPicked: false } : row));
    expect(orderProposalWrites(rows).map((row) => row.code)).toEqual(["SOP-QC-0100", "WI-QC-0101"]);
  });
});

describe("decideReadWait", () => {
  it("is idle before anything is asked", () => expect(decideReadWait(null, null, 0)).toBe("idle"));

  it("waits until a newer proposal arrives", () => {
    expect(decideReadWait({ after: 0, stopped: 0 }, null, 0)).toBe("waiting");
    expect(decideReadWait({ after: 4, stopped: 0 }, 4, 0)).toBe("waiting");
    expect(decideReadWait({ after: 4, stopped: 0 }, 5, 0)).toBe("idle");
  });

  it("stops waiting when a reading job failed after the request", () => {
    expect(decideReadWait({ after: 0, stopped: 2 }, null, 2)).toBe("waiting");
    expect(decideReadWait({ after: 0, stopped: 2 }, null, 3)).toBe("stopped");
  });

  it("shows the proposal when a retried job delivered one", () => expect(decideReadWait({ after: 0, stopped: 2 }, 1, 3)).toBe("idle"));
});

describe("decideProposalAdoption", () => {
  it("is as_is when every new row goes in unchanged", () => expect(decideProposalAdoption(PROPOSAL, buildProposalRows(PROPOSAL))).toBe("as_is"));

  it("is edited when a row was changed or left out", () => {
    const rows = buildProposalRows(PROPOSAL);
    expect(decideProposalAdoption(PROPOSAL, rows.map((row, index) => (index === 0 ? { ...row, title: "Run it" } : row)))).toBe("edited");
    expect(decideProposalAdoption(PROPOSAL, rows.map((row, index) => (index === 3 ? { ...row, isPicked: false } : row)))).toBe("edited");
  });
});
