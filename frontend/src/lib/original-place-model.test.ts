import { describe, expect, it } from "vitest";

import type { OriginalPlace } from "./api-sop";
import { MARK_PREFIX, plantPlaceMarks } from "./original-place-model";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const NS = `xmlns:w="${W}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"`;

const para = (text: string, withPPr = true) =>
  `<w:p>${withPPr ? '<w:pPr><w:pStyle w:val="Body"/></w:pPr>' : ""}<w:r><w:t>${text}</w:t></w:r></w:p>`;
const docXml = (body: string) => `<?xml version="1.0" encoding="UTF-8"?><w:document ${NS}><w:body>${body}</w:body></w:document>`;
const place = (unitId: number, ...paths: string[]): OriginalPlace => ({
  unit_id: unitId,
  blocks: paths.map((path) => ({ path, page: 1 })),
});

function parse(xml: string): Document {
  return new DOMParser().parseFromString(xml, "application/xml");
}

/** 표지(bookmarkStart)를 담은 문단의 글 - 표지를 어디에 심었는지 본다 */
function readMarkedText(xml: string, name: string): string[] {
  const doc = parse(xml);
  return [...doc.getElementsByTagNameNS(W, "bookmarkStart")]
    .filter((mark) => mark.getAttributeNS(W, "name") === name)
    .map((mark) => mark.parentElement?.textContent ?? "");
}

// 추출기(docx_reader.py _iter_tagged)의 경로 조각은 같은 태그 형제 중 1부터 센 순번이다
describe("plantPlaceMarks", () => {
  it("plants a bookmark at the start of each paragraph", () => {
    const parts = { document: docXml(para("first") + para("second")) };
    const result = plantPlaceMarks(parts, [place(7, "document/body/p[2]")]);

    const doc = parse(result.parts.document);
    const second = doc.getElementsByTagNameNS(W, "p")[1];
    const kids = [...second.children].map((child) => child.localName);
    expect(kids.slice(0, 3)).toEqual(["pPr", "bookmarkStart", "bookmarkEnd"]);
    expect(second.children[1].getAttributeNS(W, "name")).toBe(`${MARK_PREFIX}0`);
    expect(result.marks.get(7)?.[0]).toEqual({ id: "sopa_0", cell: false, exact: true, page: 1 });
    expect(result.missed).toBe(0);
  });

  it("plants as the first child when the paragraph has no properties", () => {
    const parts = { document: docXml(para("bare", false)) };
    const result = plantPlaceMarks(parts, [place(1, "document/body/p[1]")]);
    const p = parse(result.parts.document).getElementsByTagNameNS(W, "p")[0];
    expect(p.firstElementChild?.localName).toBe("bookmarkStart");
  });

  it("opens an empty self-closing paragraph to hold the mark", () => {
    const result = plantPlaceMarks({ document: docXml(`${para("a")}<w:p/>`) }, [place(1, "document/body/p[2]")]);
    const p = parse(result.parts.document).getElementsByTagNameNS(W, "p")[1];
    expect([...p.children].map((child) => child.localName)).toEqual(["bookmarkStart", "bookmarkEnd"]);
  });

  it("skips past a paragraph property block that holds an older copy", () => {
    const props = '<w:pPr><w:jc w:val="left"/><w:pPrChange w:id="1"><w:pPr><w:jc w:val="right"/></w:pPr></w:pPrChange></w:pPr>';
    const result = plantPlaceMarks({ document: docXml(`<w:p>${props}<w:r><w:t>x</w:t></w:r></w:p>`) }, [place(1, "document/body/p[1]")]);
    const p = parse(result.parts.document).getElementsByTagNameNS(W, "p")[0];
    expect([...p.children].map((child) => child.localName)).toEqual(["pPr", "bookmarkStart", "bookmarkEnd", "r"]);
  });

  it("still plants when the text has a paragraph tag the tree does not", () => {
    const result = plantPlaceMarks({ document: docXml(`<!-- <w:p> -->${para("a")}${para("b")}`) }, [place(1, "document/body/p[2]")]);
    expect(readMarkedText(result.parts.document, "sopa_0")).toEqual(["b"]);
  });

  it("marks the first paragraph of a table cell", () => {
    const cells = (row: number) =>
      [1, 2, 3].map((col) => `<w:tc><w:tcPr/>${para(`r${row}c${col}a`)}${para(`r${row}c${col}b`)}</w:tc>`).join("");
    const table = `<w:tbl><w:tblPr/><w:tr>${cells(1)}</w:tr><w:tr>${cells(2)}</w:tr></w:tbl>`;
    const result = plantPlaceMarks({ document: docXml(para("x") + table) }, [place(3, "document/body/tbl[1]/tr[2]/tc[3]")]);

    expect(result.marks.get(3)?.[0]).toMatchObject({ cell: true, exact: true });
    expect(readMarkedText(result.parts.document, "sopa_0")).toEqual(["r2c3a"]);
  });

  it("walks through wrappers such as content controls", () => {
    const body = `<w:sdt><w:sdtPr/><w:sdtContent>${para("in control")}</w:sdtContent></w:sdt>`;
    const result = plantPlaceMarks({ document: docXml(body) }, [place(1, "document/body/sdt[1]/sdtContent[1]/p[1]")]);
    expect(readMarkedText(result.parts.document, "sopa_0")).toEqual(["in control"]);
  });

  it("keeps bookmark ids above existing ids", () => {
    const old = `<w:p><w:bookmarkStart w:id="900" w:name="_Toc1"/><w:r><w:t>a</w:t></w:r><w:bookmarkEnd w:id="900"/></w:p>`;
    const result = plantPlaceMarks({ document: docXml(old + para("b")) }, [place(1, "document/body/p[2]")]);
    const marks = [...parse(result.parts.document).getElementsByTagNameNS(W, "bookmarkStart")].filter(
      (mark) => mark.getAttributeNS(W, "name") === "sopa_0",
    );
    expect(Number(marks[0].getAttributeNS(W, "id"))).toBeGreaterThan(900);
  });

  it("marks both Choice and Fallback copies of a text box", () => {
    const box = (text: string) => `<w:txbxContent>${para(`${text} one`)}${para(`${text} two`)}</w:txbxContent>`;
    const anchor =
      `<w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wps:txbx>${box("choice")}</wps:txbx></w:drawing></mc:Choice>` +
      `<mc:Fallback><w:pict><v:shape><v:textbox>${box("fallback")}</v:textbox></v:shape></w:pict></mc:Fallback></mc:AlternateContent></w:r>`;
    const host = `<w:p><w:pPr/>${anchor}<w:r><w:t>host</w:t></w:r></w:p>`;
    const result = plantPlaceMarks({ document: docXml(host) }, [place(5, "document/body/p[1]/txbx[1]/p[2]")]);

    expect(readMarkedText(result.parts.document, "sopa_0").sort()).toEqual(["choice two", "fallback two"]);
    const ids = [...parse(result.parts.document).getElementsByTagNameNS(W, "bookmarkStart")].map((mark) => mark.getAttributeNS(W, "id"));
    expect(new Set(ids).size).toBe(2);
    expect(result.marks.get(5)?.[0]).toMatchObject({ id: "sopa_0", exact: true });
  });

  it("counts text boxes in document order without the Fallback copies", () => {
    const box = (text: string) => `<w:txbxContent>${para(text)}</w:txbxContent>`;
    const shape = (text: string) =>
      `<w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wps:txbx>${box(`${text} choice`)}</wps:txbx></w:drawing></mc:Choice>` +
      `<mc:Fallback><w:pict><v:textbox>${box(`${text} fallback`)}</v:textbox></w:pict></mc:Fallback></mc:AlternateContent></w:r>`;
    const host = `<w:p>${shape("first")}${shape("second")}</w:p>`;
    const result = plantPlaceMarks({ document: docXml(host) }, [place(1, "document/body/p[1]/txbx[2]/p[1]")]);
    expect(readMarkedText(result.parts.document, "sopa_0").sort()).toEqual(["second choice", "second fallback"]);
  });

  it("plants marks in header parts", () => {
    const header = `<?xml version="1.0" encoding="UTF-8"?><w:hdr ${NS}>${para("head")}</w:hdr>`;
    const document = docXml(para("body"));
    const result = plantPlaceMarks({ document, header1: header }, [place(2, "header1/p[1]")]);

    expect(readMarkedText(result.parts.header1, "sopa_0")).toEqual(["head"]);
    expect(result.parts.document).toBe(document);
    expect(result.marks.get(2)?.[0]).toMatchObject({ id: "sopa_0", exact: true });
  });

  it("falls back to the nearest ancestor for a shortened path", () => {
    const table = `<w:tbl><w:tr><w:tc>${para("cell")}</w:tc></w:tr></w:tbl>`;
    const result = plantPlaceMarks({ document: docXml(table) }, [
      { unit_id: 4, blocks: [{ path: "document/body/tbl[1]/…/p[3]", page: 2 }] },
    ]);

    const mark = result.marks.get(4)?.[0];
    expect(mark).toMatchObject({ exact: false, page: 2 });
    expect(mark?.id).not.toBe("");
    expect(readMarkedText(result.parts.document, mark?.id ?? "")).toEqual(["cell"]);
    expect(result.missed).toBe(0);
  });

  it("falls back to the paragraph when a step inside it is missing", () => {
    const result = plantPlaceMarks({ document: docXml(para("host")) }, [place(1, "document/body/p[1]/txbx[4]/p[1]")]);
    expect(result.marks.get(1)?.[0]).toMatchObject({ exact: false, cell: false });
    expect(readMarkedText(result.parts.document, "sopa_0")).toEqual(["host"]);
  });

  it("reports a missed path", () => {
    const result = plantPlaceMarks({ document: docXml(para("only")) }, [
      { unit_id: 9, blocks: [{ path: "document/body/p[99]", page: 3 }] },
    ]);
    expect(result.marks.get(9)?.[0]).toEqual({ id: "", cell: false, exact: false, page: 3 });
    expect(result.missed).toBe(1);
  });

  it("reports a path into a part that was not given", () => {
    const result = plantPlaceMarks({ document: docXml(para("only")) }, [place(9, "footer2/p[1]")]);
    expect(result.marks.get(9)?.[0].id).toBe("");
    expect(result.missed).toBe(1);
  });

  it("shares one mark for repeated paths", () => {
    const result = plantPlaceMarks({ document: docXml(para("a") + para("b")) }, [
      place(1, "document/body/p[1]", "document/body/p[2]"),
      place(2, "document/body/p[2]"),
    ]);
    expect(result.marks.get(1)?.map((mark) => mark.id)).toEqual(["sopa_0", "sopa_1"]);
    expect(result.marks.get(2)?.[0].id).toBe("sopa_1");
    expect(readMarkedText(result.parts.document, "sopa_1")).toEqual(["b"]);
  });

  it("plants 3,000 paths within 200ms", () => {
    const body = Array.from({ length: 3000 }, (_, i) => para(`paragraph ${i}`)).join("");
    const places = Array.from({ length: 3000 }, (_, i) => place(i + 1, `document/body/p[${i + 1}]`));
    const parts = { document: docXml(body) };

    const start = performance.now();
    const result = plantPlaceMarks(parts, places);
    const took = performance.now() - start;

    expect(result.missed).toBe(0);
    expect(result.marks.get(3000)?.[0].id).toBe("sopa_2999");
    expect(took).toBeLessThan(200);
  });
});
