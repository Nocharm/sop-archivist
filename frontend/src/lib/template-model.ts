// 템플릿 보기(MD 1 F9 · F8c) - 결과물 C 꼴의 문서(칸마다 줄)를 회사 템플릿 모양의 블록으로 다시 편다. 새 계산은 없다: 줄·글·번호는 받은 그대로이고
// 순서도 칸 순서 그대로다(템플릿 보기가 결과물 C와 다른 내용을 보이면 실패 - 설계 §3). Assign New 칸과, 뒤에 Order 화면(MD 2 S5)이 같은 모델을 쓴다.
// 미러링: SOP는 영어 절반 → 한글 절반, WI는 한글 → 영어. 저장은 짝 한 줄 그대로이고 그리기만 두 번이다 - 같은 묶음 키(meaning_key, 결과물 A의 줄)의
// 영어 줄과 한글 줄을 차례로 맞대어 "거울 줄"로 묶고, 그 줄은 두 절반에서 같은 자리에 그려지며 하나를 고르면 둘이 함께 칠해진다.
// 번호: 줄 자기 C 번호(표시)를 쓴다. 자기 표시가 생략인 줄(짝으로 함께 놓인 한글 줄)만 같은 거울 줄 상대의 표시를 빌린다 - 그래서 짝은 두 절반이 같은 번호다.
// 반대 언어 줄이 하나도 없는 묶음의 줄은 반대 절반에 "번역 없음" 자리를 둔다. 반대 언어가 있지만 수가 다르면(1:2) 남는 줄은 자기 C 표시 그대로 한쪽에만 선다.
// 표·그림 줄과 언어가 없는 줄(neutral·ref)은 짝을 맞추지 않고 두 절반에 같이 그린다.
import type { AutoItem, NumberStyle, OutlineKind, ToBe } from "./api-sop";
import { formatSectionPath } from "./composed-model";
import { getSectionDepths, readBulletSymbol } from "./section-number";

/** 템플릿 보기가 읽는 줄 - 결과물 C 항목(OutputCItem)과 엮은 문서 항목(ComposedItem) 둘 다 이 꼴을 갖는다 */
export interface TemplateItem {
  target_id: number;
  kind: string;
  lang: string;
  text: string;
  number: string | null;
  number_style: NumberStyle;
  indent_level: number;
  meaning_key: string | null;
}

/** 템플릿 보기가 읽는 칸 - 결과물 C 칸과 엮은 문서 칸의 공통 */
export interface TemplateSection<T extends TemplateItem> {
  location_key: string;
  label: string;
  number: string | null;
  na_reason: string | null;
  kind: OutlineKind | null;
  level: number;
  counts_lines: boolean;
  shows_number: boolean;
  auto_items: readonly AutoItem[];
  deviation_reason: string | null;
  is_empty_required: boolean;
  items: readonly T[];
}

export interface TemplateDoc<T extends TemplateItem> {
  code: string;
  title: string;
  doc_type: string;
  sections: readonly TemplateSection<T>[];
}

/** 이름 사전 - SOP 칸의 한글 이름(골격 title_ko, 빈 이름은 없음)과 WI 단계 이름 */
export interface TemplateTitles {
  ko: ReadonlyMap<string, string>;
  steps: ReadonlyMap<number, string>;
}

export type HalfLang = "en" | "ko";

/** 줄 앞 표시 - C 번호, 글머리 기호(깊이별 • ○ ▪), 주석 "Note.", 없음 */
export type TemplateMarker = { kind: "number"; text: string } | { kind: "bullet"; symbol: string } | { kind: "note" } | { kind: "none" };

export interface TemplateLine<T extends TemplateItem> {
  /** 절반 안에서 고유한 키 - 줄은 "t:<id>", 번역 없음 자리는 "miss:<비춘 줄 id>" */
  key: string;
  /** 그릴 줄 - null이면 "번역 없음" 자리 */
  item: T | null;
  /** "번역 없음" 자리가 비춘 반대 절반의 줄(그 밖은 null) */
  source: T | null;
  marker: TemplateMarker;
  /** 들여쓰기 깊이(0부터) */
  depth: number;
  /** 거울 줄의 새 문장 id(두 절반 모두) - 하나라도 고르면 두 절반에서 함께 칠한다 */
  mirrorIds: readonly number[];
}

/** 칸 머리에 붙는 알림 - 골격 스텝 6의 표준과 다름 · 비어 있음 */
export interface TemplateMarks {
  deviationReason: string | null;
  isEmptyRequired: boolean;
}

export interface TemplateCategoryRow<T extends TemplateItem> extends TemplateMarks {
  sectionKey: string;
  title: string;
  lines: TemplateLine<T>[];
  na: boolean;
}

export interface TemplateWiRow<T extends TemplateItem> {
  line: TemplateLine<T>;
  /** Why 칸의 줄 - 기울여 그린다 */
  why: boolean;
}

export type TemplateBlock<T extends TemplateItem> =
  | ({ kind: "heading"; key: string; sectionKey: string; level: number; text: string } & TemplateMarks)
  | { kind: "lines"; key: string; sectionKey: string; lines: TemplateLine<T>[]; nested: boolean }
  | { kind: "empty"; key: string; sectionKey: string; na: boolean }
  | { kind: "auto"; key: string; sectionKey: string; items: readonly AutoItem[] }
  /** 템플릿의 빈 표(2장 Site…)나 머리만 있는 표(3장 Term | Definition) - blankRow면 빈 행 하나 */
  | { kind: "grid"; key: string; sectionKey: string; heads: readonly string[]; blankRow: boolean }
  /** 템플릿 글머리 기호 라벨(2장 "In Scope") */
  | { kind: "label"; key: string; sectionKey: string; text: string }
  /** 앱이 넣는 시스템 항목(8장 Attachment 1) */
  | { kind: "system"; key: string; sectionKey: string; text: string }
  | { kind: "categories"; key: string; sectionKey: string; rows: TemplateCategoryRow<T>[] }
  | { kind: "wi_chapter"; key: string; sectionKey: string; title: string; rows: TemplateWiRow<T>[]; figures: TemplateLine<T>[] };

export interface TemplateHalf<T extends TemplateItem> {
  lang: HalfLang;
  blocks: TemplateBlock<T>[];
}

export interface TemplateTocEntry {
  key: string;
  level: number;
  text: string;
}

export interface TemplateLayout<T extends TemplateItem> {
  docType: "sop" | "wi";
  code: string;
  title: string;
  toc: TemplateTocEntry[];
  halves: [TemplateHalf<T>, TemplateHalf<T>];
}

// 템플릿 글(문서 내용이라 화면 언어와 상관없이 영어 - 한글 절반에서도 표 머리·시스템 항목은 영어다, MD 1 F8c)
export const SCOPE_HEADS = ["Site", "Building", "Functional Unit", "Product"] as const;
export const TERM_HEADS = ["Term", "Definition"] as const;
export const ROLE_HEADS = ["Role", "Responsibility"] as const;
export const CATEGORY_HEADS = ["Category", "Requirement"] as const;
export const IN_SCOPE = "In Scope";
export const CHANGE_HISTORY = "Attachment 1. Document Change History";
// 템플릿 골격의 표준 키(backend app/sop/outline.py _TEMPLATE_ITEMS) - 장마다 모양이 다른 곳
const SCOPE_KEY = "scope";
const TABLE_HEADS: Readonly<Record<string, readonly string[]>> = { definitions: TERM_HEADS, responsibilities: ROLE_HEADS };
const ATTACHMENTS_KEY = "attachments";
// 한글 절반에서 한글 이름을 쓰는 칸 - 6장 절 이름과 5장 범주 이름만(장 제목 · 7.x · 부록은 영어 그대로)
const KO_TITLE_PARENTS = ["procedures", "general_requirements"] as const;
const LABEL_SEPARATOR = " › ";

/** 이 문서의 이름 사전 - To-Be의 골격 항목(그 문서 코드)과 WI 단계 */
export function buildTemplateTitles(tobe: Pick<ToBe, "outline_items" | "wi_steps">, code: string): TemplateTitles {
  return {
    ko: new Map(tobe.outline_items.filter((item) => item.code === code && item.title_ko.trim() !== "").map((item) => [item.key, item.title_ko])),
    steps: new Map(tobe.wi_steps.filter((step) => step.code === code).map((step) => [step.step_no, step.title])),
  };
}

function isHalfLine(item: TemplateItem): item is TemplateItem & { lang: HalfLang } {
  return item.kind === "sentence" && (item.lang === "en" || item.lang === "ko");
}

function readOwnMarker(item: TemplateItem, depth: number): TemplateMarker {
  if (item.number_style === "bullet") return { kind: "bullet", symbol: readBulletSymbol(depth) };
  if (item.number_style === "note") return { kind: "note" };
  if (item.number_style === "numbered" && item.number !== null) return { kind: "number", text: item.number };
  return { kind: "none" };
}

interface Painted<T extends TemplateItem> {
  item: T;
  marker: TemplateMarker;
  depth: number;
}

/** 거울 줄 하나 - 영어·한글 칸(짝이 없는 쪽은 null), 또는 두 절반에 같이 그리는 줄(both) */
interface MirrorRow<T extends TemplateItem> {
  en: Painted<T> | null;
  ko: Painted<T> | null;
  both: Painted<T> | null;
  /** 묶음에 두 언어가 다 있다 - 수가 달라 빈 칸이 생겨도 "번역 없음"이 아니다 */
  translated: boolean;
}

/** 칸의 줄을 거울 줄로 - 묶음은 처음 나온 자리에 서고, 그 안은 언어마다 C 순서 그대로 맞댄다 */
function buildMirrorRows<T extends TemplateItem>(section: TemplateSection<T>): MirrorRow<T>[] {
  const depths = getSectionDepths(section);
  const painted = section.items.map((item, index): Painted<T> => ({ item, depth: depths[index] ?? 0, marker: readOwnMarker(item, depths[index] ?? 0) }));
  const groups = new Map<string, { en: Painted<T>[]; ko: Painted<T>[] }>();
  const sequence: Array<{ group: string } | { line: Painted<T> }> = [];
  for (const line of painted) {
    const { item } = line;
    if (!isHalfLine(item)) {
      sequence.push({ line });
      continue;
    }
    const key = item.meaning_key ?? `t:${item.target_id}`;
    let group = groups.get(key);
    if (!group) {
      group = { en: [], ko: [] };
      groups.set(key, group);
      sequence.push({ group: key });
    }
    group[item.lang].push(line);
  }
  return sequence.flatMap((entry): MirrorRow<T>[] => {
    if ("line" in entry) return [{ en: null, ko: null, both: entry.line, translated: true }];
    const group = groups.get(entry.group) ?? { en: [], ko: [] };
    const translated = group.en.length > 0 && group.ko.length > 0;
    return Array.from({ length: Math.max(group.en.length, group.ko.length) }, (_, index) => ({ en: group.en[index] ?? null, ko: group.ko[index] ?? null, both: null, translated }));
  });
}

/** 거울 줄의 한 절반 줄 - 없으면(1:2의 남는 자리) null */
function readHalfLine<T extends TemplateItem>(row: MirrorRow<T>, lang: HalfLang): TemplateLine<T> | null {
  const mirrorIds = [row.en, row.ko, row.both].flatMap((cell) => (cell ? [cell.item.target_id] : []));
  if (row.both) return { key: `t:${row.both.item.target_id}`, item: row.both.item, source: null, marker: row.both.marker, depth: row.both.depth, mirrorIds };
  const own = row[lang];
  const other = row[lang === "en" ? "ko" : "en"];
  if (own) {
    // 짝으로 함께 놓여 생략이 된 줄은 상대의 표시를 빌린다 - 그 밖(사람이 고른 표시 · C가 준 번호)은 자기 것
    const borrow = own.item.number_style === "omitted" && other !== null && other.marker.kind !== "none";
    const shown = borrow ? other : own;
    return { key: `t:${own.item.target_id}`, item: own.item, source: null, marker: shown.marker, depth: shown.depth, mirrorIds };
  }
  if (!other || row.translated) return null;
  return { key: `miss:${other.item.target_id}`, item: null, source: other.item, marker: other.marker, depth: other.depth, mirrorIds };
}

function buildLines<T extends TemplateItem>(section: TemplateSection<T>, lang: HalfLang): TemplateLine<T>[] {
  return buildMirrorRows(section).flatMap((row) => readHalfLine(row, lang) ?? []);
}

/** 칸 자기 이름(조상 이름 없이) - 부록은 "Appendix n. 이름" 그대로, 한글 절반의 6장 절 · 5장 범주는 한글 이름(없으면 영어) */
function readTitle(section: TemplateSection<TemplateItem>, lang: HalfLang, titles: TemplateTitles): string {
  const english = section.shows_number ? (section.label.split(LABEL_SEPARATOR).at(-1) ?? section.label) : section.label;
  if (lang !== "ko" || !KO_TITLE_PARENTS.some((parent) => section.location_key.startsWith(`${parent}.`))) return english;
  return titles.ko.get(section.location_key) ?? english;
}

function readHeading(section: TemplateSection<TemplateItem>, lang: HalfLang, titles: TemplateTitles): string {
  return formatSectionPath(section.shows_number ? section.number : null, readTitle(section, lang, titles));
}

function readMarks(section: TemplateSection<TemplateItem>): TemplateMarks {
  return { deviationReason: section.deviation_reason, isEmptyRequired: section.is_empty_required };
}

function isChildOf(section: TemplateSection<TemplateItem> | undefined, parentKey: string): boolean {
  return section !== undefined && section.location_key.startsWith(`${parentKey}.`);
}

/** SOP 한 절반 - 칸 순서대로 머리와 줄, 장마다 템플릿 모양(2장 빈 표 · 3·4장 표 머리 · 5장 범주 표 · 7.2 자동 목록 · 8장 시스템 항목) */
function buildSopHalf<T extends TemplateItem>(doc: TemplateDoc<T>, lang: HalfLang, titles: TemplateTitles): TemplateBlock<T>[] {
  const blocks: TemplateBlock<T>[] = [];
  const sections = doc.sections;
  for (let index = 0; index < sections.length; index += 1) {
    const section = sections[index];
    const key = section.location_key;
    const hasChildren = isChildOf(sections[index + 1], key);
    const isChapter = section.level === 0;
    blocks.push({ kind: "heading", key: `h:${key}`, sectionKey: key, level: section.level, text: readHeading(section, lang, titles), ...readMarks(section) });
    const lines = buildLines(section, lang);
    const na = section.na_reason !== null;
    if (section.kind === "category_table") {
      // 5장 - 범주(하위 칸)마다 한 행, 오른쪽 칸에 그 범주의 줄. 장에 바로 놓인 줄은 표 위에
      if (lines.length > 0) blocks.push({ kind: "lines", key: `l:${key}`, sectionKey: key, lines, nested: false });
      const rows: TemplateCategoryRow<T>[] = [];
      while (isChildOf(sections[index + 1], key)) {
        index += 1;
        const child = sections[index];
        rows.push({ sectionKey: child.location_key, title: readTitle(child, lang, titles), lines: buildLines(child, lang), na: child.na_reason !== null, ...readMarks(child) });
      }
      if (rows.length > 0) blocks.push({ kind: "categories", key: `c:${key}`, sectionKey: key, rows });
      else if (lines.length === 0) blocks.push({ kind: "empty", key: `e:${key}`, sectionKey: key, na });
      continue;
    }
    if (section.kind === "auto_list") {
      blocks.push(na ? { kind: "empty", key: `e:${key}`, sectionKey: key, na } : { kind: "auto", key: `a:${key}`, sectionKey: key, items: section.auto_items });
      continue;
    }
    const tableHeads = isChapter ? (key === SCOPE_KEY ? SCOPE_HEADS : TABLE_HEADS[key]) : undefined;
    if (tableHeads) blocks.push({ kind: "grid", key: `g:${key}`, sectionKey: key, heads: tableHeads, blankRow: key === SCOPE_KEY });
    if (isChapter && key === ATTACHMENTS_KEY) blocks.push({ kind: "system", key: `s:${key}`, sectionKey: key, text: CHANGE_HISTORY });
    if (lines.length > 0) {
      // 2장의 줄은 "In Scope" 글머리 기호 아래에 든다(Out of Scope 구분은 하지 않는다 - 설계 작업 5)
      const isScope = isChapter && key === SCOPE_KEY;
      if (isScope) blocks.push({ kind: "label", key: `i:${key}`, sectionKey: key, text: IN_SCOPE });
      blocks.push({ kind: "lines", key: `l:${key}`, sectionKey: key, lines, nested: isScope });
      continue;
    }
    // 묶음 제목(7 · 7.1)과 하위 칸이 있는 칸은 머리만 - 비어 있다고 적지 않는다(N/A면 적는다). 시스템 항목이 있는 8장도
    const isFilledByOthers = section.kind === "group" || hasChildren || (isChapter && key === ATTACHMENTS_KEY);
    if (!isFilledByOthers || na) blocks.push({ kind: "empty", key: `e:${key}`, sectionKey: key, na });
  }
  return blocks;
}

// WI 칸 키 "step:<n>:<부분>" · "unstepped:<부분>" - 단계 하나가 장 하나다
const WI_KEY = /^(step:(\d+)|unstepped):(\w+)$/;

/** WI 한 절반 - 단계 하나 = 장 표 하나(머리 행 "Chapter N. 제목", 줄마다 세부 단계 행, Why 줄은 같은 장 아래쪽에 기울여, 그림은 그림 칸에) */
function buildWiHalf<T extends TemplateItem>(doc: TemplateDoc<T>, lang: HalfLang, titles: TemplateTitles): TemplateBlock<T>[] {
  const blocks: TemplateBlock<T>[] = [];
  // 지금 그리는 장 - 선언에서 null로 좁혀지지 않게 단언으로 둔다(반복 안에서 바뀐다)
  let current = null as Extract<TemplateBlock<T>, { kind: "wi_chapter" }> | null;
  for (const section of doc.sections) {
    const match = WI_KEY.exec(section.location_key);
    const chapterKey = match?.[1] ?? section.location_key;
    if (current?.sectionKey !== chapterKey) {
      const stepNo = match?.[2] === undefined ? null : Number(match[2]);
      // 단계 없는 칸은 서버 라벨("No step · Instruction")의 앞부분
      const title = stepNo === null ? (section.label.split(" · ")[0] ?? section.label) : `Chapter ${stepNo}. ${titles.steps.get(stepNo) ?? ""}`.trim();
      current = { kind: "wi_chapter", key: `w:${chapterKey}`, sectionKey: chapterKey, title, rows: [], figures: [] };
      blocks.push(current);
    }
    const why = match?.[3] === "why";
    for (const line of buildLines(section, lang)) {
      if (line.item?.kind === "figure") current.figures.push(line);
      else current.rows.push({ line, why });
    }
  }
  return blocks;
}

/** 앱이 만드는 목차 - 장과, 하위를 선언하는 장(6장 절차 · 9장 부록)의 하위. WI는 단계(장) */
function buildToc<T extends TemplateItem>(doc: TemplateDoc<T>, halves: readonly TemplateHalf<T>[], titles: TemplateTitles): TemplateTocEntry[] {
  if (doc.doc_type === "wi") {
    return halves[0].blocks.flatMap((block) => (block.kind === "wi_chapter" ? [{ key: block.key, level: 0, text: block.title }] : []));
  }
  const declaring = new Set(doc.sections.filter((section) => section.level === 0 && section.kind === "named_children").map((section) => section.location_key));
  return doc.sections
    .filter((section) => section.level === 0 || (section.level === 1 && declaring.has(section.location_key.split(".")[0])))
    .map((section) => ({ key: section.location_key, level: section.level, text: readHeading(section, "en", titles) }));
}

/** 문서 하나의 템플릿 모양 - SOP는 영어 → 한글, WI는 한글 → 영어 */
export function buildTemplateLayout<T extends TemplateItem>(doc: TemplateDoc<T>, titles: TemplateTitles): TemplateLayout<T> {
  const docType = doc.doc_type === "wi" ? "wi" : "sop";
  const order: [HalfLang, HalfLang] = docType === "wi" ? ["ko", "en"] : ["en", "ko"];
  const build = docType === "wi" ? buildWiHalf : buildSopHalf;
  const halves = order.map((lang) => ({ lang, blocks: build(doc, lang, titles) })) as [TemplateHalf<T>, TemplateHalf<T>];
  return { docType, code: doc.code, title: doc.title, toc: buildToc(doc, halves, titles), halves };
}

/** 한 절반의 줄 전부(블록 순서) - 시험과 쓰는 쪽이 줄 단위로 훑을 때 */
export function listHalfLines<T extends TemplateItem>(half: TemplateHalf<T>): TemplateLine<T>[] {
  return half.blocks.flatMap((block) => {
    if (block.kind === "lines") return block.lines;
    if (block.kind === "categories") return block.rows.flatMap((row) => row.lines);
    if (block.kind === "wi_chapter") return [...block.rows.map((row) => row.line), ...block.figures];
    return [];
  });
}

/** 줄이 칠해지는가 - 거울 줄의 어느 문장이든 골라져 있으면 두 절반이 함께 */
export function isLineSelected(line: Pick<TemplateLine<TemplateItem>, "mirrorIds">, selectedIds: ReadonlySet<number>): boolean {
  return line.mirrorIds.some((id) => selectedIds.has(id));
}
