import { describe, expect, it } from "vitest";

import type { ToBe, ToBeProposal } from "./api-sop";
import { buildProposalInput, buildProposalRows, decideProposalAdoption, decideReadWait, findProposalProblem, listParentChoices, orderProposalWrites } from "./tobe-proposal-model";

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

describe("buildProposalInput", () => {
  const LIST: ToBe = {
    revision: 12,
    docs: [
      { id: 1, code: "SOP-CF", title: "Listed", doc_type: "sop", parent_code: null, entrance: "assign", is_equipment_sop: true, order_index: 0, document_id: null },
      { id: 2, code: "WI-04", title: "Written", doc_type: "wi", parent_code: "SOP-CF", entrance: "match", is_equipment_sop: false, order_index: 3, document_id: 9 },
    ],
    na_slots: [{ code: "SOP-CF", slot_key: "definitions", reason: "none" }],
    wi_steps: [{ code: "WI-04", step_no: 1, title: "Start" }],
    outline_items: [],
    outline_suggestions: {},
  };

  it("sends the whole list once: what was there, then the picked rows with SOPs first", () => {
    const rows = buildProposalRows(PROPOSAL).map((row) => (row.code === "QC-0200" ? { ...row, isPicked: false } : row));
    const input = buildProposalInput(LIST, rows);
    expect(input.revision).toBe(12);
    expect(input.docs.map((doc) => [doc.code, doc.doc_type, doc.parent_code, doc.is_equipment_sop, doc.order_index])).toEqual([
      ["SOP-CF", "sop", null, true, 0],
      ["WI-04", "wi", "SOP-CF", false, 3],
      ["SOP-QC-0100", "sop", null, true, 4],
      ["WI-QC-0101", "wi", "SOP-QC-0100", false, 5],
    ]);
    expect(input.docs.find((doc) => doc.code === "WI-QC-0101")?.title).toBe("Run");
  });

  it("keeps the N/A sections and steps that were there and numbers the new steps from 1", () => {
    const rows = buildProposalRows(PROPOSAL).map((row) => (row.code === "WI-QC-0101" ? { ...row, steps: ["Prepare", "Run"] } : { ...row, isPicked: row.code === "SOP-QC-0100" }));
    const input = buildProposalInput(LIST, rows);
    expect(input.na_slots).toEqual(LIST.na_slots);
    expect(input.wi_steps).toEqual([
      { code: "WI-04", step_no: 1, title: "Start" },
      { code: "WI-QC-0101", step_no: 1, title: "Prepare" },
      { code: "WI-QC-0101", step_no: 2, title: "Run" },
    ]);
  });

  it("does not carry an equipment mark onto a WI or a parent onto an SOP", () => {
    const rows = buildProposalRows(PROPOSAL).map((row) => ({ ...row, isPicked: row.code === "SOP-QC-0100", doc_type: row.code === "SOP-QC-0100" ? ("wi" as const) : row.doc_type, parent_code: row.code === "SOP-QC-0100" ? "SOP-CF" : row.parent_code }));
    expect(buildProposalInput(LIST, rows).docs.at(-1)).toMatchObject({ code: "SOP-QC-0100", doc_type: "wi", parent_code: "SOP-CF", is_equipment_sop: false });
  });

  it("starts the order at 0 on an empty list", () => {
    const input = buildProposalInput({ revision: 1, docs: [], na_slots: [], wi_steps: [], outline_items: [], outline_suggestions: {} },buildProposalRows({ ...PROPOSAL, listed_codes: [] }).filter((row) => row.doc_type === "sop"));
    expect(input.docs.map((doc) => doc.order_index)).toEqual([0, 1]);
  });
});
