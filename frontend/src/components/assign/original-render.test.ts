import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  NUMPAGES_TOKEN,
  PAGE_TOKEN,
  fillPageDefaults,
  markHeaderRows,
  markPageFields,
  paginateRendered,
  renderMetafiles,
  replaceUnrenderable,
  stripUnsafeLinks,
} from "./original-render";

// emf-converter는 바깥 그리개라 가짜로 - 부르는 쪽이 넘긴 옵션과 돌려받은 PNG 처리만 본다
const converterState = vi.hoisted(() => ({ calls: 0, fail: false, options: [] as unknown[] }));
vi.mock("emf-converter/lite", () => ({
  convertMetafileToDataUrl: async (_input: unknown, options: unknown) => {
    converterState.calls += 1;
    converterState.options.push(options);
    if (converterState.fail) throw new Error("bad metafile");
    return "data:image/png;base64,iVBORw0KGgo=";
  },
}));

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

// jsdom에는 배치가 없다 - data-h를 높이로, 앞 형제들(떠 있는 것 빼고)의 높이 합을 offsetTop으로 심는다(복제한 요소도 따라온다)
const saved = {
  top: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetTop"),
  height: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight"),
};
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return Number(this.dataset.h ?? 0);
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetTop", {
    configurable: true,
    get(this: HTMLElement) {
      let top = Number(this.parentElement?.dataset.top ?? 0);
      for (let el = this.previousElementSibling; el !== null; el = el.previousElementSibling) {
        if ((el as HTMLElement).style.position !== "absolute") top += Number((el as HTMLElement).dataset.h ?? 0);
      }
      return top;
    },
  });
});
afterEach(() => {
  if (saved.top) Object.defineProperty(HTMLElement.prototype, "offsetTop", saved.top);
  if (saved.height) Object.defineProperty(HTMLElement.prototype, "offsetHeight", saved.height);
  document.body.replaceChildren();
});

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string)[]) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  node.append(...kids);
  return node;
}

/** 그리개가 만드는 장 하나 - 종이 500px, 위·아래 여백 50px(쓸 높이 400) */
function buildPage(...kids: HTMLElement[]): HTMLElement {
  const page = el("section", { class: "sopa-ov" });
  page.style.minHeight = "375pt"; // 500px
  page.style.paddingTop = "50px";
  page.style.paddingBottom = "50px";
  const header = el("header", {}, el("p", {}, "Head ", el("span", { id: "sopa_9" }), `page ${PAGE_TOKEN} of ${NUMPAGES_TOKEN}`));
  const article = el("article", { "data-top": "50" }, ...kids);
  const footer = el("footer", {}, el("p", {}, `- ${PAGE_TOKEN} -`));
  page.append(header, article, footer);
  return page;
}

describe("stripUnsafeLinks", () => {
  it("strips non-http links", () => {
    const root = el(
      "div",
      {},
      el("a", { href: "javascript:alert(1)" }, "js"),
      el("a", { href: " FILE:///c" }, "file"),
      el("a", { href: "data:text/html,<b>x</b>" }, "data"),
      el("a", { href: "https://x" }, "web"),
      el("a", { href: "#sec" }, "inside"),
    );
    stripUnsafeLinks(root);
    const hrefs = [...root.querySelectorAll("a")].map((link) => link.getAttribute("href"));
    expect(hrefs).toEqual([null, null, null, "https://x", "#sec"]);
    expect(root.textContent).toBe("jsfiledatawebinside");
  });
});

describe("paginateRendered", () => {
  it("splits a long page into paper-sized pages with header, footer and page numbers", () => {
    const root = el("div");
    root.append(buildPage(...Array.from({ length: 12 }, (_, i) => el("p", { "data-h": "100" }, `para ${i}`))));
    document.body.append(root);

    const total = paginateRendered(root);

    const pages = [...root.querySelectorAll("section.sopa-ov")];
    expect(total).toBe(3);
    expect(pages).toHaveLength(3);
    expect(pages.map((page) => page.querySelectorAll("article > p").length)).toEqual([4, 4, 4]);
    expect(pages.map((page) => page.querySelector(":scope > header")?.textContent)).toEqual([
      "Head page 1 of 3",
      "Head page 2 of 3",
      "Head page 3 of 3",
    ]);
    expect(pages.map((page) => page.querySelector(":scope > footer")?.textContent)).toEqual(["- 1 -", "- 2 -", "- 3 -"]);
    // 머리말을 복제해도 표지 id가 겹치지 않는다
    expect(root.querySelectorAll('[id="sopa_9"]')).toHaveLength(1);
  });

  it("counts the first paragraph's top margin against the paper", () => {
    const paras = Array.from({ length: 12 }, (_, i) => el("p", { "data-h": "100" }, `para ${i}`));
    paras[0].style.marginTop = "30px"; // 장 첫 제목 앞 간격 - 빼고 재면 장이 그만큼 종이보다 길어졌다
    const root = el("div");
    root.append(buildPage(...paras));

    expect(paginateRendered(root)).toBe(4);

    expect([...root.querySelectorAll("section.sopa-ov")].map((page) => page.querySelectorAll("article > p").length)).toEqual([3, 4, 4, 1]);
  });

  it("leaves floating boxes out of the measure", () => {
    const floating = el("div", { "data-h": "900" });
    floating.style.position = "absolute";
    const root = el("div");
    root.append(buildPage(el("p", { "data-h": "100" }), floating, el("p", { "data-h": "100" })));
    expect(paginateRendered(root)).toBe(1);
  });

  it("splits a table by rows with the same columns and repeated header row", () => {
    const head = el("tr", { "data-h": "50", class: "sopa-ov-head-row" }, el("td", {}, "Head"));
    const rows = Array.from({ length: 11 }, (_, i) => el("tr", { "data-h": "50" }, el("td", {}, `row ${i}`)));
    const colgroup = el("colgroup", {}, el("col"), el("col"));
    const table = el("table", { "data-h": "600" }, colgroup, head, ...rows);
    const root = el("div");
    root.append(buildPage(el("p", { "data-h": "250" }, "intro"), table));

    expect(paginateRendered(root)).toBe(3);

    const pages = [...root.querySelectorAll("section.sopa-ov")];
    const tables = pages.map((page) => page.querySelector("article > table"));
    expect(tables[0]?.querySelectorAll("tr")).toHaveLength(3); // 머리 줄 + 2줄(250 + 150 = 400)
    expect(tables[1]?.querySelector("colgroup")?.children).toHaveLength(2);
    expect(tables[1]?.querySelector("tr")?.textContent).toBe("Head");
    expect(tables[1]?.querySelectorAll("tr")[1]?.textContent).toBe("row 2");
    const bodyRows = tables.flatMap((one) => [...(one?.querySelectorAll("tr") ?? [])].filter((row) => row.textContent !== "Head"));
    expect(bodyRows.map((row) => row.textContent)).toEqual(rows.map((row) => row.textContent));
  });
});

describe("replaceUnrenderable", () => {
  it("swaps metafile pictures for a hatched box of the same size", () => {
    const emf = el("img", { src: "data:image/x-emf;base64,AQAAAA==" });
    emf.style.width = "120pt";
    emf.style.height = "80pt";
    const wmf = el("img", { src: "data:image/x-wmf;base64,183GmgAA" });
    wmf.style.width = "10pt";
    wmf.style.height = "12pt";
    const png = el("img", { src: "data:image/png;base64,iVBORw0KGgo=" });
    const root = el("div", {}, emf, el("p", {}, wmf), png);

    expect(replaceUnrenderable(root, "Preview unavailable (EMF)")).toBe(2);

    const boxes = [...root.querySelectorAll<HTMLElement>("span.sopa-ov-unrenderable")];
    expect(boxes.map((box) => [box.style.width, box.style.height])).toEqual([
      ["120pt", "80pt"],
      ["10pt", "12pt"],
    ]);
    expect(boxes[0].textContent).toBe("Preview unavailable (EMF)");
    expect(root.querySelectorAll("img")).toHaveLength(1);
  });
});

/** 최소 EMF 머리(형식 1 · " EMF" 표식 · 범위 0..99) / 자리 지정 WMF 머리를 data 주소로 */
function metafileUri(kind: "emf" | "wmf"): string {
  const bytes = new Uint8Array(kind === "emf" ? 88 : 22);
  const view = new DataView(bytes.buffer);
  if (kind === "emf") {
    view.setUint32(0, 1, true);
    view.setUint32(4, 88, true);
    view.setInt32(16, 99, true);
    view.setInt32(20, 49, true);
    view.setUint32(40, 0x464d4520, true);
  } else {
    view.setUint32(0, 0x9ac6cdd7, true);
    view.setInt16(10, 200, true);
    view.setInt16(12, 100, true);
  }
  return `data:image/x-${kind};base64,${btoa(String.fromCharCode(...bytes))}`;
}

describe("renderMetafiles", () => {
  beforeEach(() => {
    Object.assign(converterState, { calls: 0, fail: false, options: [] });
  });

  it("draws an EMF image as a PNG in the same img", async () => {
    const img = el("img", { src: metafileUri("emf") });
    const root = el("div", {}, img);

    expect(await renderMetafiles(root)).toEqual({ drawn: 1, failed: 0 });

    expect(root.querySelector("img")).toBe(img);
    expect(img.getAttribute("src")).toBe("data:image/png;base64,iVBORw0KGgo=");
    expect(converterState.options[0]).toMatchObject({ dpiScale: 2, timeoutMs: 5000 });
  });

  it("draws a WMF image too", async () => {
    const root = el("div", {}, el("img", { src: metafileUri("wmf") }));

    expect(await renderMetafiles(root)).toEqual({ drawn: 1, failed: 0 });

    expect(converterState.calls).toBe(1);
  });

  it("keeps the original size and position", async () => {
    const img = el("img", { src: metafileUri("emf") });
    img.style.width = "120pt";
    img.style.height = "80pt";
    img.style.position = "absolute";
    const root = el("div", {}, img);

    await renderMetafiles(root);

    expect([img.style.width, img.style.height, img.style.position]).toEqual(["120pt", "80pt", "absolute"]);
  });

  it("leaves the image for the hatch box when the converter throws or the bytes are not a metafile", async () => {
    converterState.fail = true;
    const root = el("div", {}, el("img", { src: metafileUri("emf") }), el("img", { src: "data:image/x-emf;base64,AQAAAA==" }));

    expect(await renderMetafiles(root)).toEqual({ drawn: 0, failed: 2 });

    expect(replaceUnrenderable(root, "x")).toBe(2);
    expect(converterState.calls).toBe(1);
  });

  it("does not load the converter when there is no metafile", async () => {
    const root = el("div", {}, el("img", { src: "data:image/png;base64,iVBORw0KGgo=" }));

    expect(await renderMetafiles(root)).toEqual({ drawn: 0, failed: 0 });

    expect(converterState.calls).toBe(0);
  });
});

describe("fillPageDefaults", () => {
  const body = (section: string) => `<w:document xmlns:w="w"><w:body><w:p/>${section}</w:body></w:document>`;

  it("adds A4 size and margins to a section without them", () => {
    const out = fillPageDefaults(body('<w:sectPr><w:headerReference r:id="h1"/></w:sectPr>'));
    expect(out).toContain('<w:headerReference r:id="h1"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440"');
  });

  it("fills a self-closing section and adds one when the body has none", () => {
    expect(fillPageDefaults(body("<w:sectPr/>"))).toContain('<w:sectPr><w:pgSz w:w="11906"');
    expect(fillPageDefaults(body(""))).toContain('<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar');
  });

  it("keeps the document's own size and margins", () => {
    const own = body('<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr>');
    expect(fillPageDefaults(own)).toBe(own);
  });

  it("fills only the missing half", () => {
    const out = fillPageDefaults(body('<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>'));
    expect(out).toContain('w:w="12240"');
    expect(out).not.toContain('w:w="11906"');
    expect(out).toContain("<w:pgMar ");
  });
});

describe("markPageFields", () => {
  const hdr = (inner: string) => `<w:hdr xmlns:w="${W}">${inner}</w:hdr>`;

  it("turns complex PAGE and NUMPAGES field results into tokens", () => {
    const field = (code: string, shown: string) =>
      `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> ${code} \\* MERGEFORMAT </w:instrText></w:r>` +
      `<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>${shown}</w:t></w:r><w:r><w:t>x</w:t></w:r>` +
      `<w:r><w:fldChar w:fldCharType="end"/></w:r>`;
    const xml = markPageFields(hdr(`<w:p><w:r><w:t>Page </w:t></w:r>${field("PAGE", "1")}<w:r><w:t> of </w:t></w:r>${field("NUMPAGES", "9")}</w:p>`));
    const text = [...new DOMParser().parseFromString(xml, "application/xml").getElementsByTagNameNS(W, "t")].map((t) => t.textContent).join("");
    expect(text).toBe(`Page ${PAGE_TOKEN} of ${NUMPAGES_TOKEN}`);
  });

  it("turns a simple PAGE field into a plain run the renderer draws", () => {
    const xml = markPageFields(hdr(`<w:p><w:fldSimple w:instr=" PAGE "><w:r><w:rPr><w:b/></w:rPr><w:t>3</w:t></w:r></w:fldSimple></w:p>`));
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    expect(doc.getElementsByTagNameNS(W, "fldSimple")).toHaveLength(0);
    const run = doc.getElementsByTagNameNS(W, "r")[0];
    expect(run.parentElement?.localName).toBe("p");
    expect(run.getElementsByTagNameNS(W, "b")).toHaveLength(1);
    expect(run.textContent).toBe(PAGE_TOKEN);
  });

  it("leaves other fields alone", () => {
    const source = hdr(`<w:p><w:fldSimple w:instr=" DATE "><w:r><w:t>today</w:t></w:r></w:fldSimple></w:p>`);
    expect(markPageFields(source)).toBe(source);
  });
});

describe("markHeaderRows", () => {
  it("plants a mark in the first paragraph of each repeated header row", () => {
    const row = (header: boolean, text: string) =>
      `<w:tr>${header ? "<w:trPr><w:tblHeader/></w:trPr>" : ""}<w:tc><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc></w:tr>`;
    const off = `<w:tr><w:trPr><w:tblHeader w:val="0"/></w:trPr><w:tc><w:p/></w:tc></w:tr>`;
    const xml = `<w:document xmlns:w="${W}"><w:body><w:tbl>${row(true, "H")}${row(false, "B")}${off}</w:tbl></w:body></w:document>`;
    const doc = new DOMParser().parseFromString(markHeaderRows(xml), "application/xml");
    const marks = [...doc.getElementsByTagNameNS(W, "bookmarkStart")];
    expect(marks).toHaveLength(1);
    expect(marks[0].parentElement?.textContent).toBe("H");
  });
});

describe("renderOriginal", () => {
  it("draws planted marks as element ids and flags repeated header rows", async () => {
    const { default: JSZip } = await import("jszip");
    const { plantPlaceMarks } = await import("@/lib/original-place-model");
    const { openOriginalRoot, readPartsToMark, renderOriginal } = await import("./original-render");
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    );
    zip.file(
      "_rels/.rels",
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    );
    const head = '<w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc><w:p><w:r><w:t>Head</w:t></w:r></w:p></w:tc></w:tr>';
    const row = '<w:tr><w:tc><w:p><w:r><w:t>Row</w:t></w:r></w:p></w:tc></w:tr>';
    zip.file(
      "word/document.xml",
      `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>One</w:t></w:r></w:p>` +
        `<w:p><w:r><w:t>Two</w:t></w:r></w:p><w:tbl>${head}${row}</w:tbl><w:sectPr/></w:body></w:document>`,
    );
    const file = await zip.generateAsync({ type: "blob" });
    const places = [{ unit_id: 1, blocks: [{ path: "document/body/p[2]", page: 1 }] }];

    const planted = plantPlaceMarks(await readPartsToMark(file, places), places);
    const host = document.createElement("div");
    document.body.append(host);
    const { root, styles, body } = openOriginalRoot(host);
    await renderOriginal(file, planted.parts, body, styles);

    expect(root.getElementById("sopa_0")?.closest("p")?.textContent).toBe("Two");
    expect(host.querySelector("section.sopa-ov")).toBeNull(); // 그린 것은 그림자 뿌리 안에만
    expect(body.querySelector("section.sopa-ov")).not.toBeNull();
    const host2 = body.querySelectorAll("tr.sopa-ov-head-row");
    expect(host2).toHaveLength(1);
    expect([...body.querySelectorAll("tr.sopa-ov-head-row")].map((tr) => tr.textContent)).toEqual(["Head"]);
    expect(styles.querySelector("style")).not.toBeNull();
  });
});

describe("scopeRenderedStyles", () => {
  function buildStyles(...texts: string[]): HTMLElement {
    const host = document.createElement("div");
    for (const text of texts) {
      const style = document.createElement("style");
      style.textContent = text;
      host.append(style);
    }
    return host;
  }

  it("scopes renderer styles to the shadow root", async () => {
    const { openOriginalRoot, scopeRenderedStyles } = await import("./original-render");
    const outside = document.createElement("p");
    outside.className = "app-x";
    const host = document.createElement("div");
    document.body.append(outside, host);
    const { styles, body } = openOriginalRoot(host);
    const emitted = buildStyles("body { display: none; } .app-x { display: none; } .sopa-ov p { margin: 0pt; } :host { display: none; }");
    scopeRenderedStyles(emitted);
    styles.append(...emitted.childNodes);
    body.append(document.createElement("article"));

    expect(getComputedStyle(outside).display).not.toBe("none");
    expect(getComputedStyle(host).display).not.toBe("none");
    expect(styles.textContent).toContain(".sopa-ov p");
    expect(styles.textContent).not.toContain(":host");
    expect(host.shadowRoot?.contains(styles)).toBe(true);
  });

  it("keeps the renderer's own scoped rules", async () => {
    const { scopeRenderedStyles } = await import("./original-render");
    const host = buildStyles(
      ".sopa-ov-wrapper { padding: 30px; } p.sopa-ov_heading1 span { font-weight: bold; } section.sopa-ov { width: 600px; } p.sopa-ov-num-1-0::before { content: '1.'; }",
    );
    expect(scopeRenderedStyles(host)).toBe(0);
    for (const kept of [".sopa-ov-wrapper", "p.sopa-ov_heading1 span", "section.sopa-ov", "p.sopa-ov-num-1-0::before"]) {
      expect(host.textContent).toContain(kept);
    }
  });

  it("drops fetches hidden behind other forms", async () => {
    const { scopeRenderedStyles } = await import("./original-render");
    const host = buildStyles(
      '.sopa-ov p { background-image: image-set("https://e/x" 1x); }',
      '.sopa-ov p { background-image: -webkit-image-set("https://e/x" 1x); }',
      ".sopa-ov p { background: u\\rl(https://e/x); }",
      ".sopa-ov p { background: url(   'https://e/x'   ); }",
      ".sopa-ov p { background: \\75 rl(https://e/x); }",
      '@font-face { font-family: Evil; src: src("https://e/f"); }',
      '@import "https://e";',
      '.sopa-ov p { content: "//e/x"; }',
      ".sopa-ov p { background: cross-fade(url(blob:a), url(blob:b), 50%); }",
    );

    scopeRenderedStyles(host);

    // 버린 수는 세지 않는다 - 엔진마다 읽지 못한 선언을 먼저 버리는 몫이 달라(jsdom), 남은 글에 바깥 주소가 없는 것만 본다
    expect(host.textContent).not.toMatch(/e\/x|e\/f|https|@import|Evil|cross-fade/);
  });

  it("drops each hidden fetch our filter must catch", async () => {
    const { scopeRenderedStyles } = await import("./original-render");
    // 사용자 속성(--…)은 엔진이 값을 따지지 않고 그대로 두므로 거르기 자체를 본다
    const host = buildStyles(
      '.a { --x: image-set("https://e/x" 1x); }',
      ".b { --x: u\\rl(https://e/x); }",
      ".c { --x: url(   'https://e/x'   ); }",
      ".d { --x: \\75 rl(https://e/x); }",
      ".e { --x: element(#x); }",
      '.f { content: "//e/x"; }',
      ".g { --x: url(blob:http://local/1); --y: url(data:image/png;base64,AA//AA); }",
    );

    expect(scopeRenderedStyles(host)).toBe(6);
    expect(host.textContent).toContain("blob:http://local/1");
    expect(host.textContent).toContain("AA//AA");
    expect(host.textContent).not.toMatch(/e\/x|element/);
  });

  it("drops external urls in styles", async () => {
    const { scopeRenderedStyles } = await import("./original-render");
    const host = buildStyles(
      '@import url("https://evil/a.css");',
      ".sopa-ov p { background: url(https://evil/x); } .sopa-ov-wrapper { --sopa-ov-dot: url(blob:http://local/1); } .sopa-ov span { background: url(data:image/png;base64,AAAA); }",
      "@font-face { font-family: Evil; src: url(https://evil/font.woff); }",
      "@font-face { font-family: Kept; src: url(blob:http://local/font); }",
    );

    scopeRenderedStyles(host);

    const text = host.textContent ?? "";
    expect(text).not.toContain("evil");
    expect(text).not.toContain("@import");
    expect(text).toContain("blob:http://local/1");
    expect(text).toContain("data:image/png");
    // jsdom의 CSSOM은 @font-face의 src를 버려 blob 글꼴이 남는지는 브라우저에서만 보인다 - 여기서는 바깥 글꼴이 빠지는 것만 본다
    expect(text).not.toContain("Evil");
  });
});
