// 사용 설명서(Markdown 한 벌, public/manual/user-manual.md)를 화면이 쓰는 조각으로 나눈다.
// 설명서 화면·읽음 표시·찾기와 내용 검사(manual-content.test.ts)가 같은 모델을 쓴다. 글은 고치지 않고 나누기만 한다.

import { parseBundlePath, type StageKey } from "./stages";

export const MANUAL_PATH = "/manual";
/** 원문과 그림이 놓인 정적 경로 - 화면과 (나중의) 챗봇이 같은 파일을 읽는다 */
export const MANUAL_ASSET_BASE = "/manual/";
export const MANUAL_SOURCE_URL = `${MANUAL_ASSET_BASE}user-manual.md`;
/** 설명서 글의 언어 - 화면 말이 영어여도 글은 한국어라, 글이 놓인 곳에 붙여 어절로 끊기게 한다(base.css :lang(ko)) */
export const MANUAL_LANG = "ko";

export interface ManualHeading {
  id: string;
  title: string;
}

export interface ManualSection {
  id: string;
  /** 여백에 쓰는 조각 번호 - M-01부터 */
  tag: string;
  title: string;
  /** 제목 줄을 뺀 본문 Markdown */
  body: string;
  /** 자리 이름이 있는 작은 제목(###) - 목차의 하위 줄 */
  headings: ManualHeading[];
  /** 제목과 본문의 지문 - 읽은 뒤 글이 바뀌었는지 가린다 */
  hash: string;
  /** 찾기용 소문자 글(주소·자리 이름은 뺀다) */
  text: string;
}

export interface ManualDoc {
  title: string;
  /** 이 글이 설명하는 서비스 버전(major.minor) */
  version: string;
  /** 마지막으로 고친 날(YYYY-MM-DD) */
  updated: string;
  /** 첫 조각 앞의 머리말 Markdown */
  lead: string;
  sections: ManualSection[];
}

const FRONT_MATTER = /^---\n([\s\S]*?)\n---\n/;
const ANCHOR = /\s+\{#([a-z0-9][a-z0-9-]*)\}\s*$/;
const IMAGE_REF = /^!\[[^\]]*\]\(\s*([^\s)]+)/gm;

// 읽음 표시에만 쓰는 짧은 지문(FNV-1a 32비트) - 보안 용도가 아니고, secure context가 아니어도(평문 HTTP) 돌아야 해서 crypto를 쓰지 않는다
function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function splitAnchor(heading: string): { title: string; id: string | null } {
  const anchor = ANCHOR.exec(heading);
  return anchor ? { title: heading.slice(0, anchor.index).trim(), id: anchor[1] } : { title: heading.trim(), id: null };
}

function buildSearchText(title: string, body: string): string {
  return `${title}\n${body}`
    .replace(/\]\([^)]*\)/g, "]")
    .replace(/\{#[a-z0-9-]+\}/g, "")
    .toLowerCase();
}

function readFrontMatter(block: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of block.split("\n")) {
    const colon = line.indexOf(":");
    if (colon > 0) values[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return values;
}

/** 원문을 머리말과 조각(## 제목 하나가 조각 하나)으로 나눈다. 코드 블록 안의 ##는 제목이 아니다 */
export function parseManual(source: string): ManualDoc {
  const text = source.replace(/\r\n/g, "\n");
  const front = FRONT_MATTER.exec(text);
  const meta = front ? readFrontMatter(front[1]) : {};
  const lines = (front ? text.slice(front[0].length) : text).split("\n");

  let title = meta.title ?? "";
  const lead: string[] = [];
  const drafts: { heading: string; lines: string[] }[] = [];
  let isInFence = false;
  for (const line of lines) {
    if (line.startsWith("```")) isInFence = !isInFence;
    if (!isInFence && line.startsWith("## ")) {
      drafts.push({ heading: line.slice(3), lines: [] });
    } else if (drafts.length > 0) {
      drafts[drafts.length - 1].lines.push(line);
    } else if (!isInFence && line.startsWith("# ")) {
      title = line.slice(2).trim();
    } else {
      lead.push(line);
    }
  }

  const sections = drafts.map((draft, index): ManualSection => {
    const { title: sectionTitle, id } = splitAnchor(draft.heading);
    const body = draft.lines.join("\n").trim();
    const headings: ManualHeading[] = [];
    let isInBodyFence = false;
    for (const line of draft.lines) {
      if (line.startsWith("```")) isInBodyFence = !isInBodyFence;
      if (isInBodyFence || !line.startsWith("### ")) continue;
      const sub = splitAnchor(line.slice(4));
      if (sub.id) headings.push({ id: sub.id, title: sub.title });
    }
    return {
      id: id ?? `section-${index + 1}`,
      tag: `M-${String(index + 1).padStart(2, "0")}`,
      title: sectionTitle,
      body,
      headings,
      hash: hashText(`${sectionTitle}\n${body}`),
      text: buildSearchText(sectionTitle, body),
    };
  });

  return { title, version: meta.version ?? "", updated: meta.updated ?? "", lead: lead.join("\n").trim(), sections };
}

/** 글에 쓴 그림 주소(블록 그림 줄) - 그림 크기 읽기와 내용 검사가 쓴다 */
export function listImageRefs(source: string): string[] {
  return [...new Set(Array.from(source.matchAll(IMAGE_REF), (match) => match[1]))];
}

export type ReadState = "unread" | "read" | "updated";
/** 조각 id → 읽었을 때의 지문 */
export type ReadMarks = Readonly<Record<string, string>>;

/** 읽은 뒤 글이 바뀌었으면 updated - 확정한 뒤 원문이 바뀌면 다시 보게 하는 제품 규칙과 같다 */
export function getReadState(section: ManualSection, marks: ReadMarks): ReadState {
  const mark = marks[section.id];
  if (mark === undefined) return "unread";
  return mark === section.hash ? "read" : "updated";
}

/** 띄어 쓴 낱말이 모두 들어 있는 조각만 남긴다(대소문자 무시). 빈 검색어면 전부 */
export function findSections(sections: readonly ManualSection[], query: string): ManualSection[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...sections];
  return sections.filter((section) => terms.every((term) => section.text.includes(term)));
}

/** 단계 화면 → 그 화면을 설명하는 조각. 조각 id를 바꾸면 내용 검사가 여기서 걸린다 */
export const MANUAL_STAGE_SECTION: Record<StageKey, string> = {
  overview: "bundle",
  documents: "documents",
  split: "split",
  tobe: "tobe",
  assign: "assign",
  outputs: "outputs",
  review: "review",
  history: "history",
};

/** 단계 밖 화면이 가리키는 조각 */
export const MANUAL_PAGE_SECTION = { home: "start", account: "account" } as const;

/** 조각이 설명하는 단계 - 목차가 레일과 같은 번호·아이콘을 쓴다 */
export function getSectionStage(sectionId: string): StageKey | null {
  const entry = Object.entries(MANUAL_STAGE_SECTION).find(([, id]) => id === sectionId);
  return entry ? (entry[0] as StageKey) : null;
}

/** 지금 화면을 설명하는 조각의 주소 - 도움말이 그 자리로 열린다 */
export function getManualHref(pathname: string): string {
  const bundle = parseBundlePath(pathname);
  if (bundle?.stage) return `${MANUAL_PATH}#${MANUAL_STAGE_SECTION[bundle.stage]}`;
  if (pathname === "/") return `${MANUAL_PATH}#${MANUAL_PAGE_SECTION.home}`;
  if (pathname.startsWith("/account") || pathname.startsWith("/admin")) return `${MANUAL_PATH}#${MANUAL_PAGE_SECTION.account}`;
  return MANUAL_PATH;
}
