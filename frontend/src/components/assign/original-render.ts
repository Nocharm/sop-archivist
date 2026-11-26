// 원본 DOCX를 그리고 그린 DOM을 다듬는 React 없는 모듈 - 표지 심은 부분 파일로 다시 묶어 docx-preview로 그린 뒤
// 위험한 링크를 지우고, 종이 높이로 쪽을 나누고, 쪽 번호를 채우고, EMF·WMF 그림은 rtf.js로 SVG를 그리고 못 그린 것만 빗금 상자로 바꾼다.
// 그리개(docx-preview · jszip)는 원본 탭을 처음 열 때 import()로만 불러온다 - 첫 화면 번들에 넣지 않는다.
// 설계: docs/superpowers/specs/2026-11-27-original-view-design.md §5.2·§5.3·§5.5

import type { OriginalPlace } from "@/lib/api-sop";
import { PAGE_SLACK_PX, planPageBreaks, planRowBreaks, readCssLength, type FlowBox } from "@/lib/original-page-model";

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

/** 표지 심은 부분 파일로 DOCX를 다시 묶어 host에 그린다(그리개 <style>은 걸러서 styleHost에) - 둘 다 openOriginalRoot의 그림자 뿌리 안 */
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
  if (body !== undefined) {
    const marked = fillPageDefaults(body.includes("tblHeader") ? markHeaderRows(body) : body);
    if (marked !== body) zip.file(partPath("document"), marked);
  }
  const repacked = await zip.generateAsync({ type: "blob" });
  // 그리개 <style>은 올린 문서에서 만든 글이다 - 문서에 붙이기 전에(붙이면 @import · url()을 바로 받으러 간다) 떼어 둔 곳에 그려 거른다
  const staging = host.ownerDocument.createElement("div");
  await docx.renderAsync(repacked, host, staging, {
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
  scopeRenderedStyles(staging);
  styleHost.replaceChildren(...staging.childNodes);
  for (const mark of host.querySelectorAll(`span[id^="${HEAD_ROW_MARK}"]`)) {
    mark.closest("tr")?.classList.add(HEAD_ROW_CLASS);
    mark.remove();
  }
}

// 장 설정에 종이 크기 · 여백이 없을 때 Word가 쓰는 값(한국어 Word 기본 A4, 위아래 · 좌우 2.54cm) - 단위 twip(1/1440인치)
const DEFAULT_PAGE_SIZE = '<w:pgSz w:w="11906" w:h="16838"/>';
const DEFAULT_PAGE_MARGIN = '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="851" w:footer="992" w:gutter="0"/>';
const SECTION_RE = /<w:sectPr\b[^>]*?(?:\/>|>[\s\S]*?<\/w:sectPr>)/g;

/** 장 설정(w:sectPr)에 종이 크기 · 여백이 빠졌으면 Word 기본값을 채운다 - 없으면 그리개가 종이 없이 한 장으로 그려 쪽을 못 나눈다.
 *  장 설정이 아예 없는 본문은 끝에 하나를 더한다. 바꿀 것이 없으면 같은 글을 돌려준다 */
export function fillPageDefaults(xml: string): string {
  const fill = (section: string) => {
    const missing = (section.includes("<w:pgSz") ? "" : DEFAULT_PAGE_SIZE) + (section.includes("<w:pgMar") ? "" : DEFAULT_PAGE_MARGIN);
    if (missing === "") return section;
    return section.endsWith("/>") ? `${section.slice(0, -2)}>${missing}</w:sectPr>` : section.replace(/<\/w:sectPr>$/, `${missing}</w:sectPr>`);
  };
  if (!/<w:sectPr\b/.test(xml)) return xml.replace(/<\/w:body>/, `<w:sectPr>${DEFAULT_PAGE_SIZE}${DEFAULT_PAGE_MARGIN}</w:sectPr></w:body>`);
  return xml.replace(SECTION_RE, fill);
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

// 그리개 CSS는 그림자 뿌리 안에만 붙는다(openOriginalRoot) - 앱으로 새어 나가지 않는 경계는 그림자 뿌리다.
// 여기서는 바깥 자원을 받으러 가는 규칙과 그림자 뿌리 밖(:host)을 건드리는 규칙만 거른다. 판정은 브라우저가 다시 쓴 cssText로.
const STYLE_RULE = 1;
const FONT_FACE_RULE = 5;
const CSS_ESCAPE_RE = /\\([0-9a-fA-F]{1,6}\s?|[^\n0-9a-fA-F])/g;
// url( 인자 - 따옴표 둘 · 따옴표 없음
const CSS_URL_RE = /url\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^)\s"']*))\s*\)/gi;
const SAFE_URL_RE = /^(?:blob|data):/i;
// 주소를 품을 수 있는 다른 꼴 - src( 는 함수만(@font-face의 src: 서술자는 아니다)
const FETCHING_RE = /image-set\(|cross-fade\(|element\(|(?:^|[^\w-])src\(|@import/i;
const QUOTED_RE = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g;

/** CSS 이스케이프(\72 · \r)를 글자로 푼다 - `u\rl(`처럼 숨긴 꼴도 같은 검사에 걸리게 */
function decodeCssEscapes(text: string): string {
  return text.replace(CSS_ESCAPE_RE, (_, escape: string) => {
    const hex = escape.trim();
    if (/^[0-9a-fA-F]+$/.test(hex)) {
      const code = Number.parseInt(hex, 16);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "�";
    }
    return escape;
  });
}

/** 규칙이 바깥 자원을 받으러 가지 않는가 - url()은 blob:/data:만, 꼴을 못 읽은 url(·주소를 품는 함수·@import·`//`가 든 글자열은 안 된다 */
function isLocalOnly(cssText: string): boolean {
  const text = decodeCssEscapes(cssText);
  let urls = 0;
  for (const match of text.matchAll(CSS_URL_RE)) {
    urls += 1;
    if (!SAFE_URL_RE.test((match[1] ?? match[2] ?? match[3] ?? "").trim())) return false;
  }
  if ((text.match(/url\(/gi)?.length ?? 0) !== urls) return false;
  const rest = text.replace(CSS_URL_RE, "");
  if (FETCHING_RE.test(rest)) return false;
  return !(rest.match(QUOTED_RE) ?? []).some((quoted) => quoted.includes("//"));
}

function isAllowedRule(rule: CSSRule): boolean {
  if (!isLocalOnly(rule.cssText)) return false;
  if (rule.type === FONT_FACE_RULE) {
    // 글꼴은 주소(src)가 있고 모두 blob:/data:일 때만 - 주소 없는 @font-face는 쓸모가 없으니 닫힌 쪽으로 버린다
    const src = (rule as CSSFontFaceRule).style.getPropertyValue("src");
    return /url\(/i.test(src) && isLocalOnly(src);
  }
  // @import · @media · @keyframes · @page … 는 그리개가 내지 않는다. :host는 그림자 뿌리 밖의 주인 요소를 꾸민다
  return rule.type === STYLE_RULE && !/:host|::slotted/i.test((rule as CSSStyleRule).selectorText);
}

/** CSS 글을 문서에 붙이지 않고 규칙으로 읽는다 - 만든 시트(replaceSync)는 @import를 버리고 받지 않는다, 없으면 비활성 문서에서 */
function readCssRules(text: string, owner: Document): CSSRule[] | null {
  if (typeof CSSStyleSheet !== "undefined" && "replaceSync" in CSSStyleSheet.prototype) {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(text);
      return [...sheet.cssRules];
    } catch {
      // 만든 시트를 못 쓰는 환경 - 아래 비활성 문서로 읽는다
    }
  }
  const inert = owner.implementation.createHTMLDocument("");
  const probe = inert.createElement("style");
  probe.textContent = text;
  inert.head.append(probe);
  return probe.sheet === null ? null : [...probe.sheet.cssRules];
}

/**
 * 그리개가 styleHost에 넣은 <style>을 다시 쓴다(textContent) - 올린 문서에서 만든 CSS를 믿지 않는다.
 * 바깥 자원을 받는 규칙 · :host 규칙 · 규칙이 아닌 것(@import 등)을 버리고 버린 규칙 수를 돌려준다. 문서에 붙이기 전에 부른다.
 */
export function scopeRenderedStyles(styleHost: HTMLElement): number {
  let dropped = 0;
  for (const style of styleHost.querySelectorAll("style")) {
    const text = style.textContent ?? "";
    const rules = readCssRules(text, styleHost.ownerDocument);
    if (rules === null) {
      if (text.trim() !== "") dropped += 1;
      style.textContent = "";
      continue;
    }
    const kept = rules.filter(isAllowedRule);
    dropped += rules.length - kept.length;
    style.textContent = kept.map((rule) => rule.cssText).join("\n");
  }
  return dropped;
}

// 그림자 뿌리 안의 앱 모양 - 색은 바깥에서 물려받는 토큰(var(--…))만. 종이는 다크 테마에서도 흰색(--ov-paper)
const OV_SHADOW_CSS = `
:host { display: block; }
div.${OV_CLASS}-wrapper { background: transparent; padding: 16px 16px 0; }
div.${OV_CLASS}-wrapper > section.${OV_CLASS} { background: var(--ov-paper); box-shadow: var(--shadow-1); margin-bottom: 16px; }
.is-ov-picked { background-color: var(--ov-paint) !important; box-shadow: inset 3px 0 0 var(--sheet-accent); }
.is-ov-flash { animation: ov-flash 700ms var(--ease-exit) both; }
@keyframes ov-flash { 0%, 30% { outline: 3px solid var(--sheet-accent); outline-offset: 2px; } 100% { outline: 3px solid transparent; outline-offset: 2px; } }
.${UNRENDERABLE_CLASS} { display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box; overflow: hidden; vertical-align: middle; padding: 2px; border: 1px solid var(--sheet-line-thin); background: repeating-linear-gradient(45deg, transparent 0 6px, var(--sheet-rail) 6px 8px); color: var(--sheet-ink); font: 600 10px / 1.2 var(--font-ui); text-align: center; white-space: normal; }
@media (prefers-reduced-motion: reduce) { .is-ov-flash { animation: none; } }
`;

/**
 * host에 그림자 뿌리를 열고(이미 있으면 비우고) 앱 모양 시트 · 그리개 <style> 자리 · 그릴 자리를 둔다.
 * 그리개 CSS는 이 뿌리 밖(앱)에 닿지 않고 앱 CSS도 안으로 들어오지 않는다. 표지는 root.getElementById로 찾는다.
 */
export function openOriginalRoot(host: HTMLElement, kept?: { styles: HTMLElement; body: HTMLElement }): { root: ShadowRoot; styles: HTMLElement; body: HTMLElement } {
  const root = host.shadowRoot ?? host.attachShadow({ mode: "open" });
  const doc = host.ownerDocument;
  // kept = 전에 그려 둔 칸 둘 - 시트를 닫았다 열어 새 host가 생겨도 그린 DOM을 옮겨 붙인다(다시 그리지 않는다)
  const styles = kept?.styles ?? doc.createElement("div");
  const body = kept?.body ?? doc.createElement("div");
  const appStyle: Node[] = [];
  if ("adoptedStyleSheets" in root && typeof CSSStyleSheet !== "undefined" && "replaceSync" in CSSStyleSheet.prototype) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(OV_SHADOW_CSS);
    root.adoptedStyleSheets = [sheet];
  } else {
    // 만든 시트를 못 쓰는 환경 - 그리개 <style> 뒤에 두어 같은 무게면 이긴다
    const style = doc.createElement("style");
    style.textContent = OV_SHADOW_CSS;
    appStyle.push(style);
  }
  root.replaceChildren(styles, ...appStyle, body);
  return { root, styles, body };
}

/** 올린 문서 안의 링크는 http(s) · 문서 안 #만 남긴다 - javascript: · file: · data: 는 href를 지우고 글은 둔다 */
export function stripUnsafeLinks(root: HTMLElement): void {
  for (const link of root.querySelectorAll("a[href]")) {
    if (!SAFE_HREF_RE.test((link.getAttribute("href") ?? "").trim())) link.removeAttribute("href");
  }
}

const SVG_NS = "http://www.w3.org/2000/svg";
const METAFILE_CLASS = `${OV_CLASS}-metafile`;
const SAFE_SVG_HREF_RE = /^(data:|#)/i;
const MM_ANISOTROPIC = 8;
const DATA_BASE64_RE = /^data:[^,]*;base64,([\s\S]*)$/i;

/** 메타파일 그림에 들어 있는 위험한 SVG 요소 · 속성을 지운다 - script · foreignObject · on* · data:/# 아닌 href */
export function sanitizeMetafileSvg(svg: SVGElement): void {
  for (const bad of svg.querySelectorAll("script, foreignObject")) bad.remove();
  for (const node of [svg, ...svg.querySelectorAll("*")]) {
    for (const attr of [...node.attributes]) {
      const name = attr.name.toLowerCase();
      const isHref = name === "href" || name === "xlink:href";
      if (name.startsWith("on") || (isHref && !SAFE_SVG_HREF_RE.test(attr.value.trim()))) node.removeAttribute(attr.name);
    }
  }
}

function decodeDataUri(src: string): ArrayBuffer | null {
  const match = DATA_BASE64_RE.exec(src.trim());
  if (match === null) return null;
  const binary = atob(match[1]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** EMF 머리(" EMF" 표식)와 WMF(자리 지정 머리 또는 형식 0001/0002)를 바이트로 알아본다 - MIME은 믿지 않는다 */
function readMetafileKind(view: DataView): "emf" | "wmf" | null {
  if (view.byteLength >= 44 && view.getUint32(0, true) === 1 && view.getUint32(40, true) === 0x464d4520) return "emf";
  if (view.byteLength >= 22 && view.getUint32(0, true) === 0x9ac6cdd7) return "wmf";
  if (view.byteLength >= 18 && [1, 2].includes(view.getUint16(0, true)) && view.getUint16(2, true) === 9) return "wmf";
  return null;
}

/** 머리에 적힌 그림 크기(장치 단위) - 없으면 칸 크기(px)로 대신한다 */
function readMetafileExtent(view: DataView, kind: "emf" | "wmf", fallback: { w: number; h: number }): { w: number; h: number } {
  let w = 0;
  let h = 0;
  if (kind === "emf") {
    w = view.getInt32(16, true) - view.getInt32(8, true) + 1;
    h = view.getInt32(20, true) - view.getInt32(12, true) + 1;
  } else if (view.getUint32(0, true) === 0x9ac6cdd7) {
    w = view.getInt16(10, true) - view.getInt16(6, true);
    h = view.getInt16(12, true) - view.getInt16(8, true);
  }
  return w > 0 && h > 0 ? { w, h } : fallback;
}

async function drawMetafile(img: HTMLImageElement): Promise<SVGElement | null> {
  const buffer = decodeDataUri(img.getAttribute("src") ?? "");
  if (buffer === null) return null;
  const view = new DataView(buffer);
  const kind = readMetafileKind(view);
  if (kind === null) return null;
  const px = { w: img.width > 0 ? img.width : 300, h: img.height > 0 ? img.height : 150 };
  const extent = readMetafileExtent(view, kind, px);
  const settings = { width: "100%", height: "100%", wExt: extent.w, hExt: extent.h, xExt: extent.w, yExt: extent.h, mapMode: MM_ANISOTROPIC };
  // rtf.js 루트는 2MB짜리 RTF 묶음까지 끌어오므로 EMF · WMF 묶음만 따로 불러온다
  const svg =
    kind === "emf"
      ? new (await import("rtf.js/dist/EMFJS.bundle.min.js")).Renderer(buffer).render(settings)
      : new (await import("rtf.js/dist/WMFJS.bundle.min.js")).Renderer(buffer).render(settings);
  if (svg.namespaceURI !== SVG_NS || svg.querySelector("path, rect, line, polygon, polyline, ellipse, text, image") === null) return null;
  sanitizeMetafileSvg(svg);
  return svg;
}

/** 메타파일 그림(EMF · WMF)을 rtf.js로 SVG로 그려 같은 자리 · 같은 크기로 바꾼다 - 못 그린 것은 그대로 두어 replaceUnrenderable이 빗금 상자로 바꾼다 */
export async function renderMetafiles(root: HTMLElement): Promise<{ drawn: number; failed: number }> {
  const targets = [...root.querySelectorAll("img")].filter((img) => METAFILE_SRC_RE.test(img.getAttribute("src") ?? ""));
  let drawn = 0;
  let failed = 0;
  for (const img of targets) {
    let svg: SVGElement | null = null;
    try {
      svg = await drawMetafile(img);
    } catch {
      svg = null; // 깨진 메타파일 - 그리기를 멈추지 않고 빗금 상자로 물러난다(실패 수로 알린다)
    }
    if (svg === null) {
      failed += 1;
      continue;
    }
    const box = img.ownerDocument.createElement("span");
    box.className = METAFILE_CLASS;
    box.style.cssText = img.style.cssText;
    if (box.style.position !== "absolute") box.style.display = "inline-block";
    if (box.style.width === "" && img.width > 0) box.style.width = `${img.width}px`;
    if (box.style.height === "" && img.height > 0) box.style.height = `${img.height}px`;
    box.append(svg);
    img.replaceWith(box);
    drawn += 1;
  }
  return { drawn, failed };
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
