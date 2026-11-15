import { describe, expect, it } from "vitest";

import { guessUploadSide, planNewUpload, readFileCode } from "./upload-model";

describe("readFileCode (the number in a file name, read the way the server reads it)", () => {
  it("takes the first document number", () => {
    expect(readFileCode("SYNTHETIC_SOP-QC-00005_v3.0_Eppendorf Centrifuge.docx")).toBe("SOP-QC-00005");
    expect(readFileCode("WI-04 draft.pdf")).toBe("WI-04");
  });

  it("finds none in a name without one", () => {
    expect(readFileCode("SYNTHETIC notes.docx")).toBe("");
    expect(readFileCode("sop-qc-00005.docx")).toBe("");
  });

  it("does not take a version for the extension", () => {
    expect(readFileCode("SOP-AB-12 Rev.2")).toBe("SOP-AB-12");
  });
});

describe("guessUploadSide", () => {
  const listed = new Set(["WI-04", "SOP-NEW-1"]);

  it("picks New when the number is on the New list", () => expect(guessUploadSide("WI-04", listed, new Set())).toBe("new"));
  it("picks Old for an unknown number or no number", () => {
    expect(guessUploadSide("SOP-QC-00005", listed, new Set())).toBe("old");
    expect(guessUploadSide("", listed, new Set())).toBe("old");
  });
  it("keeps Old when an uploaded Old document already has that number", () => expect(guessUploadSide("WI-04", listed, new Set(["WI-04"]))).toBe("old"));
});

describe("planNewUpload (where a New file lands on the list)", () => {
  const docs = [
    { id: 1, code: "SOP-NEW-1", entrance: "assign" as const, document_id: null },
    { id: 2, code: "WI-04", entrance: "match" as const, document_id: 9 },
    { id: 3, code: "WI-05", entrance: "assign" as const, document_id: null },
  ];

  it("attaches to an empty row with the same number", () => expect(planNewUpload("SOP-NEW-1", docs, new Set())).toEqual({ kind: "attach", code: "SOP-NEW-1" }));
  it("makes a new row for a number the list does not have, or no number", () => {
    expect(planNewUpload("WI-99", docs, new Set())).toEqual({ kind: "create" });
    expect(planNewUpload("", docs, new Set())).toEqual({ kind: "create" });
  });
  it("will not attach to a row that already has a file", () => expect(planNewUpload("WI-04", docs, new Set())).toEqual({ kind: "blocked", reasonKey: "upload.why.hasFile" }));
  it("will not attach to a row that already has sentences", () => expect(planNewUpload("WI-05", docs, new Set([3]))).toEqual({ kind: "blocked", reasonKey: "upload.why.inUse" }));
});
