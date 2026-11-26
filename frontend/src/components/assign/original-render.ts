// 원본 DOCX를 그리고 그린 DOM을 다듬는 React 없는 모듈 - 표지 심은 부분 파일로 다시 묶어 docx-preview로 그린 뒤
// 위험한 링크를 지우고, 종이 높이로 쪽을 나누고, 쪽 번호를 채우고, 못 그리는 그림(EMF·WMF)을 빗금 상자로 바꾼다.
// 그리개(docx-preview · jszip)는 원본 탭을 처음 열 때 import()로만 불러온다 - 첫 화면 번들에 넣지 않는다.
// 설계: docs/superpowers/specs/2026-11-27-original-view-design.md §5.2·§5.3·§5.5

import type { OriginalPlace } from "@/lib/api-sop";
import { PAGE_SLACK_PX, planPageBreaks, planRowBreaks, type FlowBox } from "@/lib/original-page-model";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

/** 그리개 클래스 접두 - 그리개 <style>의 선택자가 모두 이 이름 아래라 앱 CSS와 섞이지 않는다 */
export const OV_CLASS = "sopa-ov";
/** 쪽 번호 필드 결과를 그리기 전에 바꿔 두는 표지 글자 - 쪽을 나눈 뒤 그 장의 번호·전체 장 수로 채운다 */
export const PAGE_TOKEN = "⟦PAGE⟧";
export const NUMPAGES_TOKEN = "⟦NUMPAGES⟧";

// 표 머리 반복 줄(w:tblHeader)을 그린 뒤에도 알아보게 심는 책갈피 이름 - 그리개가 줄에 표시를 남기지 않는다
const HEAD_ROW_MARK = "sopahead_";
const HEAD_ROW_CLASS = `${OV_CLASS}-head-row`;
const UNRENDERABLE_CLASS = `${OV_CLASS}-unrenderable`;
const SAFE_HREF_RE = /^(https?:|#)/i;
const METAFILE_SRC_RE = /^data:(?:image\/(?:x-)?(?:emf|wmf)|application\/x-msmetafile)[;,]|\.(?:emf|wmf)(?:[?#]|$)/i;
const METAFILE_PART_RE = /^word\/media\/.+\.(?:emf|wmf)$/i;
const HEADER_FOOTER_PART_RE = /^word\/(?:header|footer)\d*\.xml$/;
const CSS_PX: Record<string, number> = { px: 1, pt: 96 / 72, in: 96, cm: 96 / 2.54, mm: 96 / 25.4 };

const partPath = (key: string) => `word/${key}.xml`;

/** 경로에 나오는 부분 파일(본문 · 머리말 · 각주 …)만 꺼낸다 - 본문은 표 머리 줄 표시 때문에 늘 */
export async function readPartsToMark(file: Blob, places: readonly OriginalPlace[]): Promise<Record<string, string>> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(file);
  const keys = new Set(["document"]);
  for (const place of places) for (const block of place.blocks) keys.add(block.path.split("/", 1)[0]);
  const parts: Record<string, string> = {};
  await Promise.all(
    [...keys].map(async (key) => {
      const entry = zip.file(partPath(key));
      if (entry !== null) parts[key] = await entry.async("string");
    }),
  );
  return parts;
}

/** 표지 심은 부분 파일로 DOCX를 다시 묶어 host에 그린다(그리개 <style>은 styleHost에) */
export async function renderOriginal(file: Blob, parts: Record<string, string>, host: HTMLElement, styleHost: HTMLElement): Promise<void> {
  const [{ default: JSZip }, docx] = await Promise.all([import("jszip"), import("docx-preview")]);
  const zip = await JSZip.loadAsync(file);
  const names = Object.keys(zip.files);
  for (const [key, xml] of Object.entries(parts)) zip.file(partPath(key), xml);
  await Promise.all(
    names
      .filter((name) => HEADER_FOOTER_PART_RE.test(name))
      .map(async (name) => {
        const xml = await zip.files[name].async("string");
        if (xml.includes("PAGE")) zip.file(name, markPageFields(xml));
      }),
  );
  const body = await zip.file(partPath("document"))?.async("string");
  if (body?.includes("tblHeader")) zip.file(partPath("document"), markHeaderRows(body));
  const repacked = await zip.generateAsync({ type: "blob" });
  await docx.renderAsync(repacked, host, styleHost, {
    className: OV_CLASS,
    inWrapper: true,
    breakPages: true,
    ignoreLastRenderedPageBreak: false,
    renderHeaders: true,
    renderFooters: true,
    renderFootnotes: true,
    renderEndnotes: true,
    experimental: false,
    // 그림은 보통 blob 주소라 형식을 알 수 없다 - 메타파일이 든 문서만 형식이 보이는 data 주소로 그려 빗금 상자로 바꾼다
    useBase64URL: names.some((name) => METAFILE_PART_RE.test(name)),
  });
  for (const mark of host.querySelectorAll(`span[id^="${HEAD_ROW_MARK}"]`)) {
    mark.closest("tr")?.classList.add(HEAD_ROW_CLASS);
    mark.remove();
  }
}

/** 머리말 · 꼬리말의 PAGE · NUMPAGES 필드 결과를 표지 글자로 - 그리개는 저장된 결과(대개 1)를 그리고 fldSimple은 버린다 */
export function markPageFields(xml: string): string {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  let changed = false;
  for (const field of [...doc.getElementsByTagNameNS(W, "fldSimple")]) {
    const token = readPageToken(field.getAttributeNS(W, "instr") ?? "");
    if (token === null) continue;
    const firstRun = field.getElementsByTagNameNS(W, "r").item(0);
    const run = doc.createElementNS(W, "w:r");
    const props = firstRun?.getElementsByTagNameNS(W, "rPr").item(0);
    if (props) run.append(props.cloneNode(true));
    const text = doc.createElementNS(W, "w:t");
    text.textContent = token;
    run.append(text);
    field.replaceWith(run);
    changed = true;
  }
  // 복합 필드: begin → instrText(코드) → separate → 결과 글자 → end. 안쪽 필드가 이긴다
  const stack: { code: string; token: string | null; inResult: boolean; wrote: boolean }[] = [];
  for (const run of [...doc.getElementsByTagNameNS(W, "r")]) {
    for (let child = run.firstElementChild; child !== null; child = child.nextElementSibling) {
      if (child.namespaceURI !== W) continue;
      const top = stack.at(-1);
      if (child.localName === "fldChar") {
        const kind = child.getAttributeNS(W, "fldCharType");
        if (kind === "begin") stack.push({ code: "", token: null, inResult: false, wrote: false });
        else if (kind === "separate" && top) Object.assign(top, { inResult: true, token: readPageToken(top.code) });
        else if (kind === "end") stack.pop();
      } else if (child.localName === "instrText" && top && !top.inResult) {
        top.code += child.textContent ?? "";
      } else if (child.localName === "t" && top?.inResult && top.token !== null) {
        child.textContent = top.wrote ? "" : top.token;
        top.wrote = true;
        changed = true;
      }
    }
  }
  return changed ? new XMLSerializer().serializeToString(doc) : xml;
}

function readPageToken(code: string): string | null {
  const name = code.trim().split(/\s+/, 1)[0]?.toUpperCase();
  if (name === "PAGE") return PAGE_TOKEN;
  if (name === "NUMPAGES") return NUMPAGES_TOKEN;
  return null;
}

/** 머리 반복 줄(w:trPr/w:tblHeader가 켜진 줄)의 첫 문단에 책갈피 - 그린 뒤 그 줄에 HEAD_ROW_CLASS를 단다 */
export function markHeaderRows(xml: string): string {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  let count = 0;
  for (const flag of [...doc.getElementsByTagNameNS(W, "tblHeader")]) {
    const value = flag.getAttributeNS(W, "val");
    if (value === "0" || value === "false" || value === "off") continue;
    const row = flag.parentElement?.parentElement;
    const p = row?.localName === "tr" ? row.getElementsByTagNameNS(W, "p").item(0) : null;
    if (!p) continue;
    const mark = doc.createElementNS(W, "w:bookmarkStart");
    mark.setAttributeNS(W, "w:id", String(990_000_000 + count));
    mark.setAttributeNS(W, "w:name", `${HEAD_ROW_MARK}${count}`);
    const end = doc.createElementNS(W, "w:bookmarkEnd");
    end.setAttributeNS(W, "w:id", String(990_000_000 + count));
    p.append(mark, end);
    count += 1;
  }
  return count > 0 ? new XMLSerializer().serializeToString(doc) : xml;
}

/** 올린 문서 안의 링크는 http(s) · 문서 안 #만 남긴다 - javascript: · file: · data: 는 href를 지우고 글은 둔다 */
export function stripUnsafeLinks(root: HTMLElement): void {
  for (const link of root.querySelectorAll("a[href]")) {
    if (!SAFE_HREF_RE.test((link.getAttribute("href") ?? "").trim())) link.removeAttribute("href");
  }
}

/** 브라우저가 그리지 못하는 메타파일 그림을 같은 크기의 빗금 상자 + 글로 바꾸고 바꾼 수를 돌려준다 */
export function replaceUnrenderable(root: HTMLElement, label: string): number {
  let count = 0;
  for (const img of root.querySelectorAll("img")) {
    if (!METAFILE_SRC_RE.test(img.getAttribute("src") ?? "")) continue;
    const box = img.ownerDocument.createElement("span");
    box.className = UNRENDERABLE_CLASS;
    box.style.width = img.style.width || (img.width > 0 ? `${img.width}px` : "");
    box.style.height = img.style.height || (img.height > 0 ? `${img.height}px` : "");
    box.textContent = label;
    img.replaceWith(box);
    count += 1;
  }
  return count;
}

function readCssLength(value: string): number {
  const match = /^(-?[\d.]+)([a-z]*)$/.exec(value.trim());
  if (match === null) return Number.NaN;
  return Number(match[1]) * (CSS_PX[match[2] || "px"] ?? Number.NaN);
}

function isFloating(el: HTMLElement): boolean {
  const style = getComputedStyle(el);
  return style.position === "absolute" || style.position === "fixed" || (style.cssFloat !== "" && style.cssFloat !== "none");
}

function listRows(table: HTMLElement): HTMLElement[] {
  return [...table.querySelectorAll<HTMLElement>(":scope > tr, :scope > tbody > tr, :scope > thead > tr")];
}

/** 복제한 머리말 · 꼬리말의 id를 지운다 - 표지 id가 문서에 하나만 있어야 따라가기가 첫 장으로 간다 */
function cloneWithoutIds(el: Element): Element {
  const copy = el.cloneNode(true) as Element;
  for (const withId of copy.querySelectorAll("[id]")) withId.removeAttribute("id");
  return copy;
}

/** 넘치는 표를 줄에서 자른다 - 잘린 뒤 줄들은 같은 열 폭(colgroup)의 새 표로, 문서가 머리 반복을 켰으면 머리 줄을 되풀이 */
function splitTable(table: HTMLElement, firstRoom: number, usable: number): HTMLElement | null {
  const rows = listRows(table);
  let heads = 0;
  while (heads < rows.length && rows[heads].classList.contains(HEAD_ROW_CLASS)) heads += 1;
  const [cut] = planRowBreaks(
    rows.map((row) => row.offsetTop + row.offsetHeight),
    firstRoom,
    usable,
  );
  if (cut === undefined || cut <= heads) return null;
  const carry = table.cloneNode(false) as HTMLElement;
  for (const col of table.querySelectorAll(":scope > colgroup")) carry.append(col.cloneNode(true));
  for (const head of rows.slice(0, heads)) carry.append(cloneWithoutIds(head));
  carry.append(...rows.slice(cut));
  return carry;
}

/** 종이 높이를 넘는 장 하나를 둘로 - 새 장을 돌려준다(나눌 것이 없으면 null) */
function splitPage(page: HTMLElement): HTMLElement | null {
  const paper = readCssLength(page.style.minHeight);
  const usable = paper - (readCssLength(page.style.paddingTop) || 0) - (readCssLength(page.style.paddingBottom) || 0);
  if (!(usable > 0)) return null;
  const kids = [...page.children].filter((child) => child.tagName === "ARTICLE").flatMap((article) => [...article.children]) as HTMLElement[];
  const boxes: FlowBox[] = kids.map((kid) => ({ top: kid.offsetTop, bottom: kid.offsetTop + kid.offsetHeight, floating: isFloating(kid) }));
  const flow = boxes.filter((box) => !box.floating);
  if (flow.length === 0) return null;
  const start = flow[0].top;
  const over = boxes.findIndex((box) => !box.floating && box.bottom - start > usable + PAGE_SLACK_PX);
  if (over < 0) return null;

  let moving: HTMLElement[] | null = null;
  const overKid = kids[over];
  if (overKid.tagName === "TABLE") {
    const carry = splitTable(overKid, start + usable - boxes[over].top, usable);
    if (carry !== null) {
      overKid.after(carry); // 같은 article 안 - 아래에서 함께 옮긴다
      moving = [carry, ...kids.slice(over + 1)];
    }
  }
  if (moving === null) {
    const [cut] = planPageBreaks(boxes, usable);
    if (cut === undefined) return null;
    moving = kids.slice(cut);
  }

  const next = page.cloneNode(false) as HTMLElement;
  const header = page.querySelector(":scope > header");
  const footer = page.querySelector(":scope > footer");
  if (header) next.append(cloneWithoutIds(header));
  let source: Element | null = null;
  let target: Element | null = null;
  for (const kid of moving) {
    if (kid.parentElement !== source) {
      source = kid.parentElement;
      target = (source as Element).cloneNode(false) as Element;
      next.append(target);
    }
    (target as Element).append(kid);
  }
  if (footer) next.append(cloneWithoutIds(footer));
  page.after(next);
  return next;
}

function fillPageNumbers(page: Element, number: number, total: number): void {
  for (const band of page.querySelectorAll(":scope > header, :scope > footer")) {
    const walker = band.ownerDocument.createTreeWalker(band, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const text = node.nodeValue ?? "";
      if (text.includes("⟦")) node.nodeValue = text.replaceAll(PAGE_TOKEN, String(number)).replaceAll(NUMPAGES_TOKEN, String(total));
    }
  }
}

/** 그린 장마다 본문을 종이 높이로 나눠 새 장을 만들고(머리말 · 꼬리말 복제) 쪽 번호를 채운 뒤 전체 장 수를 돌려준다 */
export function paginateRendered(root: HTMLElement): number {
  const queue = [...root.querySelectorAll<HTMLElement>(`section.${OV_CLASS}`)];
  for (let page = queue.shift(); page !== undefined; page = queue.shift()) {
    const next = splitPage(page);
    if (next !== null) queue.unshift(next);
  }
  const pages = [...root.querySelectorAll(`section.${OV_CLASS}`)];
  pages.forEach((page, index) => fillPageNumbers(page, index + 1, pages.length));
  return pages.length;
}
