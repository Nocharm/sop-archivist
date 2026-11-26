// 원본 DOCX의 부분 XML에 Unit 자리 표지(책갈피)를 심는 순수 모델 - 그리개가 책갈피를 <span id>로 그리므로 표지 id로 문단을 찾는다.
// 경로 규칙은 추출기 backend/app/sop/extract/docx_reader.py `_iter_tagged`·`_read_textboxes`의 사본이다(바꾸면 함께).
// 설계: docs/superpowers/specs/2026-11-27-original-view-design.md §5.2

import type { OriginalPlace } from "./api-sop";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const MC = "http://schemas.openxmlformats.org/markup-compatibility/2006";

/** 표지 책갈피 이름 접두 - 그린 DOM에서 요소 id가 된다 */
export const MARK_PREFIX = "sopa_";

/** Unit 블록 하나의 표지. id ""는 못 찾음, exact false는 가장 가까운 상위 요소로 물러난 표지 */
export type PlaceMark = { id: string; cell: boolean; exact: boolean; page: number | null };

export type PlantedMarks = { parts: Record<string, string>; marks: Map<number, PlaceMark[]>; missed: number };

// 경로 조각 "태그[같은 태그 형제 중 1부터 순번]" - 순번이 없는 조각(document 뒤의 body)은 1번째
const SEGMENT_RE = /^([A-Za-z][\w.-]*)(?:\[(\d+)\])?$/;
const BOOKMARK_ID_RE = /\b[A-Za-z]\w*:id="(\d+)"/g;
// 물러날 때 표지를 받을 수 있는 상위 요소 - 표면 그 표의 첫 문단
const ANCHOR_NAMES = new Set(["p", "tc", "tbl"]);

type Target = { el: Element; cell: boolean };
type Resolved = { targets: Target[]; exact: boolean } | null;

const isMc = (el: Element, name: string) => el.localName === name && el.namespaceURI === MC;

// jsdom의 HTMLCollection 순회는 느리다(3천 문단에 수십 ms) - 형제 고리로 훑는다
function* iterChildren(el: Element): Generator<Element> {
  for (let child = el.firstElementChild; child !== null; child = child.nextElementSibling) yield child;
}

/** 부분 하나의 탐색 도우미 - 요소마다 자식 목록과 글상자 목록을 한 번만 훑어 둔다(3천 경로 문서) */
class PartWalker {
  private readonly children = new Map<Element, Map<string, Element[]>>();
  private readonly boxes = new Map<Element, Element[]>();

  constructor(readonly root: Element) {}

  /** 경로 조각들을 따라간다 - 끝까지 가면 exact, 중간에 끊기면 가장 깊은 p·tc·tbl 조상(없으면 null) */
  resolve(start: Element, segments: readonly string[]): Resolved {
    let el = start;
    let anchor: Element | null = null;
    const mirrors: { from: Element; rest: readonly string[] }[] = [];
    for (let i = 0; i < segments.length; i += 1) {
      const match = SEGMENT_RE.exec(segments[i]);
      if (match === null) return toFallback(anchor);
      const [, name, rawIndex] = match;
      const index = rawIndex === undefined ? 1 : Number(rawIndex);
      let next: Element | null;
      if (name === "txbx") {
        const box = this.listBoxes(el)[index - 1] ?? null;
        const copy = box === null ? null : this.findFallbackCopy(box);
        if (copy !== null) mirrors.push({ from: copy, rest: segments.slice(i + 1) });
        next = box;
      } else {
        next = this.listChildren(el, name)[index - 1] ?? null;
      }
      if (next === null) return toFallback(anchor);
      el = next;
      if (ANCHOR_NAMES.has(el.localName)) anchor = el;
    }
    const main = toTarget(el);
    if (main === null) return toFallback(anchor);
    const targets = [main];
    // 글상자는 mc:Fallback(VML)에 같은 글의 사본이 있다 - 그리개가 어느 쪽을 그리든 표지가 보이게 양쪽에
    for (const mirror of mirrors) {
      const copy = this.resolve(mirror.from, mirror.rest);
      if (copy?.exact) targets.push(...copy.targets);
    }
    return { targets, exact: true };
  }

  private listChildren(el: Element, name: string): readonly Element[] {
    let byName = this.children.get(el);
    if (byName === undefined) {
      byName = new Map();
      for (const child of iterChildren(el)) {
        const list = byName.get(child.localName);
        if (list === undefined) byName.set(child.localName, [child]);
        else list.push(child);
      }
      this.children.set(el, byName);
    }
    return byName.get(name) ?? [];
  }

  /** 문단 안 글상자(w:txbxContent)를 문서 순서로 - 추출기 `_walk_inline`처럼 AlternateContent는 첫 Choice(없으면 Fallback)만 */
  private listBoxes(el: Element): readonly Element[] {
    let list = this.boxes.get(el);
    if (list === undefined) {
      list = [];
      collectBoxes(el, list);
      this.boxes.set(el, list);
    }
    return list;
  }

  /** Choice 쪽 글상자와 같은 자리의 Fallback 사본 - Choice 안에서 k번째 상자면 Fallback 안에서도 k번째 */
  private findFallbackCopy(box: Element): Element | null {
    let choice: Element | null = box.parentElement;
    while (choice !== null && choice !== this.root && !isMc(choice, "Choice")) choice = choice.parentElement;
    if (choice === null || choice === this.root || choice.parentElement === null) return null;
    let fallback: Element | null = null;
    for (const branch of iterChildren(choice.parentElement)) if (isMc(branch, "Fallback")) fallback = branch;
    if (fallback === null) return null;
    const inChoice: Element[] = [];
    collectBoxes(choice, inChoice);
    const inFallback: Element[] = [];
    collectBoxes(fallback, inFallback);
    return inFallback[inChoice.indexOf(box)] ?? null;
  }
}

/** 상자 안으로는 내려가지 않는다 - 추출기도 상자 글을 따로 모으고 상자 안 상자는 그 상자의 문단이 센다 */
function collectBoxes(el: Element, out: Element[]): void {
  for (const child of iterChildren(el)) {
    if (isMc(child, "AlternateContent")) {
      let choice: Element | null = null;
      let fallback: Element | null = null;
      for (const branch of iterChildren(child)) {
        if (choice === null && isMc(branch, "Choice")) choice = branch;
        else if (fallback === null && isMc(branch, "Fallback")) fallback = branch;
      }
      const pick = choice ?? fallback;
      if (pick !== null) collectBoxes(pick, out);
    } else if (child.namespaceURI === W && child.localName === "txbxContent") {
      out.push(child);
    } else {
      collectBoxes(child, out);
    }
  }
}

function toFallback(anchor: Element | null): Resolved {
  const target = anchor === null ? null : toTarget(anchor);
  return target === null ? null : { targets: [target], exact: false };
}

/** 표지를 심을 문단 - 칸이면 칸의 첫 문단, 문단이면 그 문단, 그 밖(표 등)은 안의 첫 문단 */
function toTarget(el: Element): Target | null {
  if (el.namespaceURI === W && el.localName === "p") return { el, cell: false };
  const first = el.getElementsByTagNameNS(W, "p").item(0);
  if (first === null) return null;
  return { el: first, cell: el.localName === "tc" };
}

function readMaxBookmarkId(parts: Record<string, string>): number {
  let max = 0;
  for (const xml of Object.values(parts)) {
    for (const match of xml.matchAll(BOOKMARK_ID_RE)) max = Math.max(max, Number(match[1]));
  }
  return max;
}

/** 부분 안 모든 w:p의 문서 순서 번호 - 원래 문자열의 n번째 `<w:p` 여는 태그와 짝을 짓는다. 접두가 섞이면 null(직렬화로 물러남) */
function numberParagraphs(root: Element): { order: Map<Element, number>; prefix: string | null } | null {
  const order = new Map<Element, number>();
  let prefix: string | null | undefined;
  const stack: Element[] = [root];
  while (stack.length > 0) {
    const el = stack.pop() as Element;
    if (el.localName === "p" && el.namespaceURI === W) {
      if (prefix === undefined) prefix = el.prefix;
      else if (prefix !== el.prefix) return null;
      order.set(el, order.size);
    }
    for (let child = el.lastElementChild; child !== null; child = child.previousElementSibling) stack.push(child);
  }
  return { order, prefix: prefix ?? null };
}

/** 문단 여는 태그 뒤(문단 속성 w:pPr이 있으면 그 뒤)에 끼울 자리. 빈 문단 `<w:p/>`는 열고 닫는 꼴로 바꾼다 */
function findInsertAt(xml: string, tagStart: number, prefix: string): { at: number; selfClosed: boolean; tagEnd: number } {
  const tagEnd = xml.indexOf(">", tagStart);
  if (xml[tagEnd - 1] === "/") return { at: tagEnd - 1, selfClosed: true, tagEnd };
  let at = tagEnd + 1;
  while (at < xml.length && /\s/.test(xml[at])) at += 1;
  const open = `<${prefix}pPr`;
  if (!xml.startsWith(open, at) || !/[\s/>]/.test(xml[at + open.length])) return { at: tagEnd + 1, selfClosed: false, tagEnd };
  const propsEnd = xml.indexOf(">", at);
  if (xml[propsEnd - 1] === "/") return { at: propsEnd + 1, selfClosed: false, tagEnd };
  // pPr 안에 고친 기록(pPrChange)의 pPr이 또 있을 수 있다 - 깊이를 세어 짝 닫는 태그를 찾는다
  const tagRe = new RegExp(`<(/?)${prefix}pPr(?=[\\s/>])[^>]*?(/?)>`, "g");
  tagRe.lastIndex = propsEnd + 1;
  let depth = 1;
  for (let m = tagRe.exec(xml); m !== null; m = tagRe.exec(xml)) {
    if (m[1] === "/") depth -= 1;
    else if (m[2] !== "/") depth += 1;
    if (depth === 0) return { at: m.index + m[0].length, selfClosed: false, tagEnd };
  }
  return { at: tagEnd + 1, selfClosed: false, tagEnd };
}

/**
 * 표지를 원래 XML 문자열에 끼운다 - 바꾼 DOM 전체를 다시 직렬화하지 않는다(3천 문단 문서에서 jsdom 직렬화만 0.1초).
 * 문자열의 `<w:p` 수가 DOM과 다르면(주석 안 태그 등) null을 돌려 직렬화로 물러난다.
 */
function spliceMarks(xml: string, root: Element, inserts: Map<Element, string>): string | null {
  const numbered = numberParagraphs(root);
  if (numbered === null) return null;
  const prefix = numbered.prefix === null ? "" : `${numbered.prefix}:`;
  const starts: number[] = [];
  const openRe = new RegExp(`<${prefix}p(?=[\\s/>])`, "g");
  for (let m = openRe.exec(xml); m !== null; m = openRe.exec(xml)) starts.push(m.index);
  if (starts.length !== numbered.order.size) return null;
  const cuts = [...inserts].map(([el, snippet]) => {
    const tagStart = starts[numbered.order.get(el) as number];
    return { ...findInsertAt(xml, tagStart, prefix), snippet };
  });
  cuts.sort((a, b) => a.at - b.at);
  const pieces: string[] = [];
  let from = 0;
  for (const cut of cuts) {
    pieces.push(xml.slice(from, cut.at));
    pieces.push(cut.selfClosed ? `>${cut.snippet}</${prefix}p>` : cut.snippet);
    from = cut.selfClosed ? cut.tagEnd + 1 : cut.at;
  }
  pieces.push(xml.slice(from));
  return pieces.join("");
}

function insertBookmarkNode(p: Element, id: string, name: string): void {
  const doc = p.ownerDocument;
  const start = doc.createElementNS(W, "w:bookmarkStart");
  start.setAttributeNS(W, "w:id", id);
  start.setAttributeNS(W, "w:name", name);
  const end = doc.createElementNS(W, "w:bookmarkEnd");
  end.setAttributeNS(W, "w:id", id);
  const props = p.firstElementChild?.localName === "pPr" ? p.firstElementChild : null;
  const before = props === null ? p.firstChild : props.nextSibling;
  p.insertBefore(start, before);
  p.insertBefore(end, before);
}

/** 원본 부분 XML에 Unit 블록마다 책갈피 표지를 심는다 - parts 키는 xml_path 첫 조각(word/<키>.xml), 바꾼 부분만 다시 쓴다 */
export function plantPlaceMarks(parts: Record<string, string>, places: readonly OriginalPlace[]): PlantedMarks {
  let nextId = readMaxBookmarkId(parts) + 1;
  const docs = new Map<string, { root: Element; walker: PartWalker; inserts: Map<Element, { id: string; name: string }> } | null>();
  const nameOf = new Map<Element, string>(); // 같은 문단은 표지 하나를 함께 쓴다
  const byPath = new Map<string, Omit<PlaceMark, "page">>();
  let missed = 0;

  const openPart = (key: string) => {
    if (!docs.has(key)) {
      const xml = parts[key];
      const doc = xml === undefined ? null : new DOMParser().parseFromString(xml, "application/xml");
      const broken = doc === null || doc.getElementsByTagName("parsererror").length > 0;
      docs.set(key, broken ? null : { root: doc.documentElement, walker: new PartWalker(doc.documentElement), inserts: new Map() });
    }
    return docs.get(key) ?? null;
  };

  const resolvePath = (path: string): Omit<PlaceMark, "page"> => {
    const known = byPath.get(path);
    if (known !== undefined) return known;
    const [key, ...segments] = path.split("/");
    const part = openPart(key);
    const resolved = part === null ? null : part.walker.resolve(part.root, segments);
    let mark: Omit<PlaceMark, "page">;
    if (part === null || resolved === null) {
      missed += 1;
      mark = { id: "", cell: false, exact: false };
    } else {
      const first = resolved.targets[0];
      const name = nameOf.get(first.el) ?? `${MARK_PREFIX}${nameOf.size}`;
      for (const target of resolved.targets) {
        if (part.inserts.has(target.el)) continue;
        nameOf.set(target.el, name);
        part.inserts.set(target.el, { id: String(nextId), name });
        nextId += 1;
      }
      mark = { id: name, cell: first.cell, exact: resolved.exact };
    }
    byPath.set(path, mark);
    return mark;
  };

  const marks = new Map<number, PlaceMark[]>();
  for (const unit of places) {
    marks.set(
      unit.unit_id,
      unit.blocks.map((block) => ({ ...resolvePath(block.path), page: block.page })),
    );
  }

  const out = { ...parts };
  for (const [key, part] of docs) {
    if (part === null || part.inserts.size === 0) continue;
    const prefix = part.root.lookupPrefix(W);
    const tag = prefix === null ? "" : `${prefix}:`;
    const snippets = new Map(
      [...part.inserts].map(([el, { id, name }]) => [
        el,
        `<${tag}bookmarkStart ${tag}id="${id}" ${tag}name="${name}"/><${tag}bookmarkEnd ${tag}id="${id}"/>`,
      ]),
    );
    const spliced = prefix === null ? null : spliceMarks(parts[key], part.root, snippets);
    if (spliced !== null) {
      out[key] = spliced;
      continue;
    }
    for (const [el, { id, name }] of part.inserts) insertBookmarkNode(el, id, name);
    out[key] = new XMLSerializer().serializeToString(part.root.ownerDocument);
  }
  return { parts: out, marks, missed };
}
