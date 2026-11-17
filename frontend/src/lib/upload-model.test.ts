import { describe, expect, it } from "vitest";

import { addPickedFiles, formatFileSize, guessUploadSide, listUploadOrder, planNewUpload, readFileCode, resolveSideDrop } from "./upload-model";

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

describe("the picked list of the upload window", () => {
  const file = (name: string, size: number) => new File([new Uint8Array(size)], name);
  const ids = () => {
    let n = 0;
    return () => `f${(n += 1)}`;
  };

  it("adds files, each on the side given or left to the app", () => {
    const picked = addPickedFiles([], [file("a.docx", 1), file("b.docx", 2)], null, ids());
    expect(picked.map((item) => [item.id, item.file.name, item.side, item.docType, item.parentCode])).toEqual([
      ["f1", "a.docx", null, "sop", ""],
      ["f2", "b.docx", null, "sop", ""],
    ]);
    expect(addPickedFiles(picked, [file("c.docx", 3)], "new", ids()).at(-1)?.side).toBe("new");
  });
  it("does not add a file with the same name and size again, and keeps what was chosen", () => {
    const first = addPickedFiles([], [file("a.docx", 1)], null, ids()).map((item) => ({ ...item, side: "new" as const, docType: "wi" as const, parentCode: "SOP-01" }));
    const next = addPickedFiles(first, [file("a.docx", 1), file("a.docx", 2), file("a.docx", 2)], "old", ids());
    expect(next.map((item) => [item.file.size, item.side, item.docType, item.parentCode])).toEqual([
      [1, "new", "wi", "SOP-01"],
      [2, "old", "sop", ""],
    ]);
  });
  it("changes side only on the other group", () => {
    expect([resolveSideDrop("old", "new"), resolveSideDrop("old", "old"), resolveSideDrop("new", null), resolveSideDrop(null, "old")]).toEqual(["new", null, null, "old"]);
  });
  it("uploads the Old group first, each group in picked order", () => expect(listUploadOrder(["new", "old", "old", "new"])).toEqual([1, 2, 0, 3]));
  it("writes a size in KB or MB", () => expect([formatFileSize(0), formatFileSize(188416), formatFileSize(2202010)]).toEqual(["1 KB", "184 KB", "2.1 MB"]));
});
