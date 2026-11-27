// 캡션 자리(표 풀기·표준화 명세 F7) - 표·그림마다 캡션이 들어갈 자리(템플릿 규칙: 표는 위, 그림은 아래, §11-5)와 비어 있을 때의 후보,
// 붙은 캡션이 문장 같은지(칩 테두리 주황), 한/영 한 줄 캡션을 나눌 자리, 끌어 놓은 문장을 붙이거나 칩을 끌어내 뗄 수 있는지를 정한다.
// 오른쪽 칸 캡션 자리(components/assign/caption-slot.tsx)와 용지 끌어 놓기(assign/page.tsx)가 이 답대로 그린다.
// 블록 자리(buildBlockPlaces)는 backend app/sop/caption_slot.py의 사본이다(rule-cases.json block_places) - 후보를 가까운 순으로
// 늘어놓는 잣대이고, 붙이기에 거리 제한은 없다(B10 8-b). 캡션이 될 수 있는 글(getCaptionRefusal)은 서버 editing.CAPTIONABLE_KINDS와 같다.
import type { EditOp, ViewBlock, ViewTable, ViewUnit } from "./api-sop";
import { hasBothScripts } from "./split-menu-model";

/** 캡션 있는 이웃 그림과 묶기 후보를 찾는 거리(블록 자리 수) - 묶기는 이웃 그림끼리의 일이라 가까운 것만 띄운다 */
const FIGURE_GROUP_REACH = 2;
/** 캡션 자리에 처음 펼쳐 둘 글 후보 수 - 나머지는 "더 보기" 뒤에(가까운 순) */
export const NEAR_SHOWN = 4;
/** 캡션 번호 뒤 글이 이보다 길고 마침표로 끝나면 문장 같은 캡션이다(동사 판정은 하지 않는다, §11-5) */
const SENTENCE_LIKE_CHARS = 40;

// backend renumber.py TABLE_CAPTION_RE · FIGURE_CAPTION_RE와 같다(rule-cases.json caption_heads) - 숫자 바로 뒤에 조사가 오면("표 1에")
// 캡션 머리가 아니다. 괄호 꼴(<표 1> · [Table 3] · (표 2))과 줄표 꼴(표-1)도 머리다
const CAPTION_TAIL = "(?:\\s*[>\\]])?(?=$|[\\s.:)\\-–—])";
const CAPTION_HEADS = {
  table: new RegExp(`^[<\\[(]?\\s*(?:표|Table)\\s*[.\\-]?\\s*(\\d+)${CAPTION_TAIL}`),
  figure: new RegExp(`^[<\\[(]?\\s*(?:그림|Figure|Fig)\\s*[.\\-]?\\s*(\\d+)${CAPTION_TAIL}`),
} as const;
// 한 줄 한/영 캡션의 둘째 머리 - "표 2. 경보 목록 Table 2. Alarm list"의 "Table 2"(괄호 꼴 "<Table 2>"도)
const ANY_HEAD = /[<[(]?(?:표|그림|Table|Figure|Fig)\s*[.\-]?\s*\d/g;
const HANGUL = /[가-힣]/;
const LATIN = /[A-Za-z]/;
// segment.is_blank_char와 같다(str.isspace() + INVISIBLE_CHARS) - 빈 문단 판정. JS \s에는 Python isspace의 \x1c-\x1f·\x85가 없어 더한다(rule-cases.json)
const VISIBLE = /[^\s\x1c-\x1f\x85​‌‍⁠﻿]/;

export type BundleShape = "table" | "figure";

/** 묶음 단위의 꼴 - 그림 단위는 그림, 표는 표 */
export function getBundleShape(kind: string): BundleShape {
  return kind === "figure" ? "figure" : "table";
}

/** 캡션 머리("표 3." · "Figure 1") - 그 꼴의 머리가 아니면 null. end는 번호 끝 자리 */
export function readCaptionHead(text: string, shape: BundleShape): { number: string; end: number } | null {
  const trimmed = text.trim();
  const match = CAPTION_HEADS[shape].exec(trimmed);
  return match ? { number: match[1], end: match[0].length } : null;
}

/** 캡션 꼴인가 - 그 꼴의 머리로 시작한다(표면 "표 3"·"Table 3", 그림이면 "그림 1"·"Figure 1"·"Fig 1") */
export function isCaptionShaped(text: string, shape: BundleShape): boolean {
  return readCaptionHead(text, shape) !== null;
}

/** 문장 같은 캡션인가 - 캡션 꼴이 아니거나, 마침표(·"다.")로 끝나고 캡션 번호 뒤 글이 40자를 넘는다 */
export function isSentenceLike(text: string, shape: BundleShape): boolean {
  const trimmed = text.trim();
  const head = readCaptionHead(trimmed, shape);
  if (head === null) return true;
  const rest = trimmed.slice(head.end).replace(/^[\s.:)\-–—]+/, "");
  return trimmed.endsWith(".") && [...rest].length > SENTENCE_LIKE_CHARS;
}

/** 앞에 붙은 여는 괄호까지 오른쪽 조각에 넣는다 - "그림 1. 구조 (Figure 1. Layout)"는 "(" 앞에서 나눈다 */
function backOverOpeners(text: string, at: number): number {
  let index = at;
  while (index > 0 && "([（".includes(text[index - 1])) index -= 1;
  return index;
}

/**
 * 한/영 한 줄 캡션을 나눌 자리(오른쪽 조각의 첫 글자) - 다른 글자(한글 · 라틴)로 시작하는 둘째 캡션 머리, 없으면 처음 글자와 다른 글자가
 * 처음 나오는 곳. 한글과 라틴 글자가 함께 없으면 null. 나눌 수 있는 자리로 맞추는 것은 화면이 한다(findNearestCut)
 */
export function findLangCut(text: string): number | null {
  if (!hasBothScripts(text)) return null;
  for (const match of text.matchAll(ANY_HEAD)) {
    const at = match.index ?? 0;
    if (at === 0) continue;
    const before = text.slice(0, at);
    const isLatinHead = LATIN.test(match[0][0]);
    if (isLatinHead ? HANGUL.test(before) : LATIN.test(before)) return backOverOpeners(text, at);
  }
  const first = text.search(/[A-Za-z가-힣]/);
  const other = HANGUL.test(text[first]) ? LATIN : HANGUL;
  const offset = text.slice(first).search(other);
  return offset < 0 ? null : backOverOpeners(text, first + offset);
}

type PlaceBlock = Pick<ViewBlock, "id" | "seq" | "kind" | "text" | "table_id">;

function findTopTable(tableId: number, parentOf: ReadonlyMap<number, number | null>): number {
  const seen = new Set([tableId]);
  let current = tableId;
  for (let parent = parentOf.get(current); parent !== undefined && parent !== null && !seen.has(parent); parent = parentOf.get(current)) {
    seen.add(parent);
    current = parent;
  }
  return current;
}

/** 블록 → 자리 번호(원문 순) - 표는 칸 블록 모두가 바깥 표 하나의 자리, 그림·글 있는 문단은 제 자리, 빈 문단은 자리가 없다 */
export function buildBlockPlaces(blocks: readonly PlaceBlock[], tables: readonly Pick<ViewTable, "id" | "parent_table_id">[]): Map<number, number> {
  const parentOf = new Map(tables.map((table) => [table.id, table.parent_table_id]));
  const places = new Map<number, number>();
  let index = -1;
  let lastTable: number | null = null;
  for (const block of [...blocks].sort((a, b) => a.seq - b.seq)) {
    if (block.kind === "table_cell" && block.table_id !== null) {
      const top = findTopTable(block.table_id, parentOf);
      if (top !== lastTable) {
        index += 1;
        lastTable = top;
      }
      places.set(block.id, index);
      continue;
    }
    lastTable = null;
    if (block.kind !== "figure" && !VISIBLE.test(block.text)) continue;
    index += 1;
    places.set(block.id, index);
  }
  return places;
}

/** 단위가 놓인 자리들 - 범위의 블록, 범위가 없는 단위(표·그림)는 자리 블록 */
function readUnitPlaces(unit: Pick<ViewUnit, "spans" | "block_id">, places: ReadonlyMap<number, number>): number[] {
  const blockIds = unit.spans.length > 0 ? unit.spans.map(([blockId]) => blockId) : [unit.block_id];
  return blockIds.flatMap((blockId) => {
    const place = places.get(blockId);
    return place === undefined ? [] : [place];
  });
}

/** 두 단위 사이의 가장 가까운 자리 거리(앞이면 음수) - 어느 쪽이든 자리가 없으면 null */
export function getPlaceOffset(unit: Pick<ViewUnit, "spans" | "block_id">, bundle: Pick<ViewUnit, "spans" | "block_id">, places: ReadonlyMap<number, number>): number | null {
  const left = readUnitPlaces(unit, places);
  const right = readUnitPlaces(bundle, places);
  let best: number | null = null;
  for (const a of left) for (const b of right) if (best === null || Math.abs(a - b) < Math.abs(best)) best = a - b;
  return best;
}

/**
 * 이 줄이 캡션이 될 수 없는 까닭(문구 키) - 될 수 있으면 null. 문장 · 제목 · 묶음이 풀린 칸 문장(벗긴 표의 줄)이고, 참조 줄 · 저절로 삭제된 줄이
 * 아니다(서버 editing.CAPTIONABLE_KINDS · group_unit_id 검사와 같다). 까닭은 종류마다 캡션 문구로 따로 둔다
 */
export function getCaptionRefusal(unit: ViewUnit): string | null {
  if (unit.kind === "caption") return "assign.captionSlot.why.alreadyCaption";
  if (unit.kind === "cell_sentence" && unit.group_unit_id !== null) return "assign.captionSlot.why.inTable";
  // 아직 표인 표의 행을 누르거나 끌면 표 전체가 잡힌다(용지가 표 단위로 올린다) - 줄 하나를 쓰려면 먼저 벗긴다
  if (unit.kind === "table") return "assign.captionSlot.why.wholeTable";
  if (unit.kind !== "sentence" && unit.kind !== "heading" && unit.kind !== "cell_sentence") return "assign.captionSlot.why.notLine";
  if (unit.noise_kind) return "assign.captionSlot.why.tocLine";
  if (unit.lang === "ref") return "assign.captionSlot.why.refLine";
  return null;
}

/** 캡션으로 붙일 수 있는 글(getCaptionRefusal이 없다) */
export function isCaptionableText(unit: ViewUnit): boolean {
  return getCaptionRefusal(unit) === null;
}

function comparePosition(a: ViewUnit, b: ViewUnit): number {
  return a.pos_seq - b.pos_seq || (a.spans[0]?.[1] ?? -1) - (b.spans[0]?.[1] ?? -1) || a.id - b.id;
}

/** 묶음에 묶인 캡션 단위(원문 순) */
export function listSlotCaptions(bundle: ViewUnit, units: ReadonlyMap<number, ViewUnit>): ViewUnit[] {
  return [...units.values()].filter((unit) => unit.kind === "caption" && unit.group_unit_id === bundle.id).sort(comparePosition);
}

/** 그림 묶음의 첫 그림 - 다른 그림의 캡션을 같이 쓰면 그 그림, 아니면 자기 */
function getFigureHead(figure: ViewUnit): number {
  return figure.caption_figure_id ?? figure.id;
}

/** 첫 그림의 캡션을 같이 쓰는 그림이고 그 첫 그림에 캡션 단위가 있다(서버 decisions._find_shared_captioned와 같다) */
export function isSharedCaptioned(unit: ViewUnit, units: ReadonlyMap<number, ViewUnit>): boolean {
  const head = unit.caption_figure_id ?? null;
  return head !== null && [...units.values()].some((other) => other.kind === "caption" && other.group_unit_id === head);
}

export type CaptionCandidate =
  /** 글 후보(거리 제한 없음, 가까운 순) - 캡션 꼴이면 모두, 아니면 위·아래 가장 가까운 글 하나씩. distance 0은 같은 표(바깥 표) 안 */
  | { kind: "near"; unitId: number; side: "above" | "below"; distance: number; text: string; lang: string; isShaped: boolean; number: string | null; isBest: boolean }
  /** 표 첫 행 - 첫 행 칸 문장들이 캡션이 된다(set_first_row_caption). reasonKey면 서버가 받지 않는 첫 행이라 꺼 둔다 */
  | { kind: "first_row"; text: string; isShaped: boolean; number: string | null; isBest: boolean; reasonKey: string | null }
  /** 캡션이 있는 이웃 그림 - 묶으면 그 캡션을 같이 쓴다(group_figures) */
  | { kind: "figure"; figureId: number; side: "above" | "below"; text: string; isBest: boolean }
  /** 써 넣기(KO · EN) - 출처 없는 캡션 */
  | { kind: "write" };

export type CaptionChipOrigin = "unit" | "first_row" | "written" | "shared";

export interface CaptionChip {
  key: string;
  /** 캡션 단위 - 써 넣은 캡션은 null */
  unitId: number | null;
  lang: string;
  text: string;
  origin: CaptionChipOrigin;
  /** 문장 같은 캡션 - 칩 테두리를 주황으로, 옆에 떼서 문장으로 */
  isOdd: boolean;
  /** 한/영 한 줄 캡션을 나눌 자리 - 나눌 수 없으면 null */
  splitAt: number | null;
}

export interface CaptionSlotView {
  /** 캡션을 받는 묶음 단위 */
  bundleId: number;
  shape: BundleShape;
  /** empty 비었음(후보) · filled 캡션 단위 · written 써 넣음 · shared 첫 그림의 캡션을 같이 씀 */
  state: "empty" | "filled" | "written" | "shared";
  chips: CaptionChip[];
  candidates: CaptionCandidate[];
  /** 첫 행에서 올린 캡션이 있다 - ↩ 다시 첫 행으로 */
  hasFirstRow: boolean;
  /** 이 그림이 든 그림 묶음의 첫 그림 - 묶이지 않았으면 null(그림 풀기) */
  groupHeadId: number | null;
}

export interface CaptionSlotInput {
  bundle: ViewUnit;
  units: ReadonlyMap<number, ViewUnit>;
  places: ReadonlyMap<number, number>;
  /** 표 칸 블록 → 그 표 - 캡션이 이 표의 칸 위에 있으면 첫 행에서 올린 것이다(바깥 칸 안 캡션은 다른 표의 칸이라 아니다) */
  cellTables: ReadonlyMap<number, number | null>;
  /** 써 넣은 캡션(출처 없음) - 저장된 것과 이번에 쓴 것 */
  written: readonly { lang: string; text: string }[];
}

const WHY_CAPTION_EXISTS = "assign.ctx.why.captionExists";

/**
 * 글 후보(B10 8-b) - 거리 제한 없이 캡션 꼴 글은 모두, 아니면 위 · 아래로 가장 가까운 글 하나씩. 가까운 순(블록 자리 거리 → 원문 자리 차이)이고
 * 같은 바깥 표 안의 줄(벗긴 표 줄 · 칸 안 줄, 자리 거리 0)이 가장 가깝다. 위 · 아래는 원문 차례로 정한다. 빈 자리에만 띄우니 언어가 겹칠 일이 없다
 */
function listNearCandidates(bundle: ViewUnit, shape: BundleShape, units: ReadonlyMap<number, ViewUnit>, places: ReadonlyMap<number, number>): Extract<CaptionCandidate, { kind: "near" }>[] {
  const near: { unit: ViewUnit; offset: number; isAbove: boolean; gap: number }[] = [];
  for (const unit of units.values()) {
    if (!isCaptionableText(unit)) continue;
    const offset = getPlaceOffset(unit, bundle, places);
    if (offset === null) continue;
    const isAbove = offset < 0 || (offset === 0 && comparePosition(unit, bundle) < 0);
    near.push({ unit, offset, isAbove, gap: Math.abs(unit.pos_seq - bundle.pos_seq) });
  }
  near.sort((a, b) => Math.abs(a.offset) - Math.abs(b.offset) || a.gap - b.gap || comparePosition(a.unit, b.unit));
  const above = near.find((entry) => entry.isAbove)?.unit;
  const below = near.find((entry) => !entry.isAbove)?.unit;
  return near
    .filter(({ unit }) => isCaptionShaped(unit.text, shape) || unit === above || unit === below)
    .map(({ unit, offset, isAbove }) => ({
      kind: "near", unitId: unit.id, side: isAbove ? "above" : "below", distance: Math.abs(offset), text: unit.text.trim(), lang: unit.lang,
      isShaped: isCaptionShaped(unit.text, shape), number: readCaptionHead(unit.text, shape)?.number ?? null, isBest: false,
    }));
}

/** 우클릭 "캡션으로 쓰기"에 띄울 표·그림 수 - 가까운 순(내 판단, 명세 B10 8-a) */
export const CAPTION_HOLDERS_SHOWN = 5;

export interface CaptionHolder {
  bundle: ViewUnit;
  /** 블록 자리 거리 - 0은 같은 바깥 표 안 */
  distance: number;
  /** 그 글에서 본 묶음 쪽 - 묶음이 글 위에 있으면 above */
  side: "above" | "below";
}

/** 글 한 줄을 캡션으로 받을 수 있는 표·그림 - 가까운 순(자리 거리 → 원문 자리 차이), 처음 limit개. 글 쪽에서 본 위·아래다 */
export function listCaptionHolders(unit: ViewUnit, units: ReadonlyMap<number, ViewUnit>, places: ReadonlyMap<number, number>, limit = CAPTION_HOLDERS_SHOWN): CaptionHolder[] {
  const found: (CaptionHolder & { gap: number })[] = [];
  for (const bundle of units.values()) {
    if (bundle.kind !== "table" && bundle.kind !== "figure") continue;
    const offset = getPlaceOffset(unit, bundle, places);
    if (offset === null) continue;
    const isAbove = offset > 0 || (offset === 0 && comparePosition(bundle, unit) < 0);
    found.push({ bundle, distance: Math.abs(offset), side: isAbove ? "above" : "below", gap: Math.abs(unit.pos_seq - bundle.pos_seq) });
  }
  found.sort((a, b) => a.distance - b.distance || a.gap - b.gap || comparePosition(a.bundle, b.bundle));
  return found.slice(0, limit).map(({ bundle, distance, side }) => ({ bundle, distance, side }));
}

/** 표 첫 행 후보 - 서버 set_first_row_caption이 받는 때만 켠다(행 둘 이상, 참조 줄 없음, 언어마다 하나) */
function buildFirstRowCandidate(bundle: ViewUnit, units: ReadonlyMap<number, ViewUnit>): Extract<CaptionCandidate, { kind: "first_row" }> | null {
  if (bundle.kind !== "table") return null;
  const cells = [...units.values()].filter((unit) => unit.kind === "cell_sentence" && unit.group_unit_id === bundle.id);
  if (cells.length === 0) return null;
  const firstRow = Math.min(...cells.map((cell) => cell.row_index ?? 0));
  const rowCells = cells.filter((cell) => (cell.row_index ?? 0) === firstRow).sort(comparePosition);
  const langs = rowCells.map((cell) => cell.lang);
  const reasonKey = rowCells.length === cells.length ? "assign.captionSlot.why.oneRow"
    : langs.includes("ref") ? "assign.captionSlot.why.refLine"
    : new Set(langs).size < langs.length ? "assign.captionSlot.why.firstRowLangs"
    : null;
  const head = rowCells.map((cell) => readCaptionHead(cell.text, "table")).find((found) => found !== null) ?? null;
  return { kind: "first_row", text: rowCells.map((cell) => cell.text.trim()).join(" | "), isShaped: head !== null, number: head?.number ?? null, isBest: false, reasonKey };
}

/** 캡션 있는 이웃 그림 후보 - FIGURE_GROUP_REACH 안의 그림 가운데 그 묶음(첫 그림)에 캡션이 있는 것, 묶음마다 하나 */
function listFigureCandidates(bundle: ViewUnit, units: ReadonlyMap<number, ViewUnit>, places: ReadonlyMap<number, number>): Extract<CaptionCandidate, { kind: "figure" }>[] {
  if (bundle.kind !== "figure") return [];
  const heads = new Set<number>();
  const found: Extract<CaptionCandidate, { kind: "figure" }>[] = [];
  for (const figure of [...units.values()].filter((unit) => unit.kind === "figure" && unit.id !== bundle.id).sort(comparePosition)) {
    const offset = getPlaceOffset(figure, bundle, places);
    const head = units.get(getFigureHead(figure));
    if (offset === null || offset === 0 || Math.abs(offset) > FIGURE_GROUP_REACH || !head || heads.has(head.id)) continue;
    const captions = listSlotCaptions(head, units);
    if (captions.length === 0) continue;
    heads.add(head.id);
    found.push({ kind: "figure", figureId: figure.id, side: offset < 0 ? "above" : "below", text: captions.map((caption) => caption.text.trim()).join(" / "), isBest: false });
  }
  return found;
}

/** 가장 그럴듯한 후보 하나 - 템플릿 쪽(표 위 · 그림 아래)의 가까운 캡션 꼴 글, 없으면 캡션 꼴 첫 행, 없으면 캡션 있는 이웃 그림 */
function markBest(candidates: CaptionCandidate[], shape: BundleShape): CaptionCandidate[] {
  const prefer = shape === "table" ? "above" : "below";
  const near = candidates
    .filter((candidate): candidate is Extract<CaptionCandidate, { kind: "near" }> => candidate.kind === "near" && candidate.isShaped)
    .sort((a, b) => a.distance - b.distance || Number(a.side !== prefer) - Number(b.side !== prefer));
  const best = near[0]
    ?? candidates.find((candidate) => candidate.kind === "first_row" && candidate.isShaped && candidate.reasonKey === null)
    ?? candidates.find((candidate) => candidate.kind === "figure");
  return candidates.map((candidate) => (best !== undefined && candidate === best ? { ...best, isBest: true } : candidate));
}

/** 캡션 자리 하나 - 채운 캡션 칩(첫 행에서 올림 · 써 넣음 · 같이 씀)과, 비었으면 후보 */
export function buildCaptionSlot({ bundle, units, places, cellTables, written }: CaptionSlotInput): CaptionSlotView {
  const shape = getBundleShape(bundle.kind);
  const isGroupHead = bundle.kind === "figure" && [...units.values()].some((unit) => unit.kind === "figure" && unit.caption_figure_id === bundle.id);
  const groupHeadId = bundle.kind !== "figure" ? null : (bundle.caption_figure_id ?? (isGroupHead ? bundle.id : null));
  const base = { bundleId: bundle.id, shape, groupHeadId, candidates: [] as CaptionCandidate[] };
  const sharedHead = bundle.caption_figure_id ? units.get(bundle.caption_figure_id) : undefined;
  if (sharedHead) {
    const chips = listSlotCaptions(sharedHead, units).map((caption): CaptionChip => ({ key: `s${caption.id}`, unitId: caption.id, lang: caption.lang, text: caption.text.trim(), origin: "shared", isOdd: false, splitAt: null }));
    return { ...base, state: "shared", chips, hasFirstRow: false };
  }
  const captions = listSlotCaptions(bundle, units);
  if (captions.length > 0) {
    const langs = captions.map((caption) => caption.lang);
    const chips = captions.map((caption): CaptionChip => {
      const others = langs.filter((lang, index) => index !== captions.indexOf(caption));
      const canSplit = !others.includes("ko") && !others.includes("en");
      return {
        key: `u${caption.id}`, unitId: caption.id, lang: caption.lang, text: caption.text.trim(),
        origin: bundle.table_id !== null && cellTables.get(caption.spans[0]?.[0] ?? -1) === bundle.table_id ? "first_row" : "unit",
        isOdd: isSentenceLike(caption.text, shape), splitAt: canSplit ? findLangCut(caption.text) : null,
      };
    });
    return { ...base, state: "filled", chips, hasFirstRow: bundle.kind === "table" && chips.some((chip) => chip.origin === "first_row") };
  }
  const writtenChips = written.filter((entry) => entry.text.trim() !== "").map((entry): CaptionChip => ({ key: `w${entry.lang}`, unitId: null, lang: entry.lang, text: entry.text.trim(), origin: "written", isOdd: false, splitAt: null }));
  if (writtenChips.length > 0) return { ...base, state: "written", chips: writtenChips, hasFirstRow: false };
  const firstRow = buildFirstRowCandidate(bundle, units);
  const candidates: CaptionCandidate[] = [
    ...listNearCandidates(bundle, shape, units, places),
    ...(firstRow ? [firstRow] : []),
    ...listFigureCandidates(bundle, units, places),
    { kind: "write" },
  ];
  return { ...base, state: "empty", chips: [], candidates: markBest(candidates, shape), hasFirstRow: false };
}

export type CaptionDrop = { kind: "attach"; unitId: number; bundleId: number } | { kind: "refused"; reasonKey: string } | { kind: "none" };

/**
 * 끈 줄을 캡션 자리에 놓으면 - 캡션이 될 수 있는 글 한 줄이고 그 언어 캡션이 없으면 붙인다(서버 attach_caption과 같은 판단, 거리 제한 없음).
 * 그 묶음 자신이나 묶인 단위를 끌어 왔으면 놓을 자리가 아니다
 */
export function resolveCaptionDrop(dragUnits: readonly ViewUnit[], bundle: ViewUnit, units: ReadonlyMap<number, ViewUnit>): CaptionDrop {
  if (dragUnits.some((unit) => unit.id === bundle.id || unit.group_unit_id === bundle.id)) return { kind: "none" };
  if (dragUnits.length !== 1) return { kind: "refused", reasonKey: "assign.captionSlot.why.oneLine" };
  const [unit] = dragUnits;
  const refusal = getCaptionRefusal(unit);
  if (refusal !== null) return { kind: "refused", reasonKey: refusal };
  if (bundle.caption_figure_id) return { kind: "refused", reasonKey: "assign.captionSlot.why.shared" };
  if (listSlotCaptions(bundle, units).some((caption) => caption.lang === unit.lang)) return { kind: "refused", reasonKey: WHY_CAPTION_EXISTS };
  return { kind: "attach", unitId: unit.id, bundleId: bundle.id };
}

export type CaptionDetach = { kind: "detach" } | { kind: "refused"; reasonKey: string } | { kind: "none" };

/** 캡션 칩을 끌어 놓으면 - 제 자리 밖 Old 용지 위면 떼서 문장으로, 그림 블록 위 옛 캡션은 뗄 수 없다 */
export function resolveCaptionDetach(input: { captionBundleId: number; slotBundleId: number | null; isOverOld: boolean; isFixed: boolean }): CaptionDetach {
  if (!input.isOverOld || input.slotBundleId === input.captionBundleId) return { kind: "none" };
  return input.isFixed ? { kind: "refused", reasonKey: "assign.ctx.why.captionInFigure" } : { kind: "detach" };
}

/** 캡션 자리의 전환 표시(data-unwrap-scope) - 칩이 그 안에서 나타나고 사라진다 */
export function getCaptionScope(bundleId: number): string {
  return `c${bundleId}`;
}

/**
 * 캡션 편집의 전환(F10 붙이기) - 글이 캡션 자리로 미끄러져 들어가고(붙이기 · 첫 행 올리기 · 묶기), 떼면 같은 길을 거꾸로 간다.
 * bundleId는 그 캡션 자리의 묶음(떼기·풀기는 부른 쪽이 안다). 캡션 편집이 아니면 null
 */
export function getCaptionMotion(op: EditOp, bundleId: number | null): { scopes: string[]; reverse: boolean } | null {
  const scope = bundleId === null ? [] : [getCaptionScope(bundleId)];
  switch (op.type) {
    case "attach_caption":
      return { scopes: [getCaptionScope(op.bundle_unit_id)], reverse: false };
    case "set_first_row_caption":
      return { scopes: [getCaptionScope(op.table_unit_id)], reverse: !op.caption };
    case "detach_caption":
    case "ungroup_figures":
      return { scopes: scope, reverse: true };
    case "group_figures":
      return { scopes: [...new Set([...scope, ...op.unit_ids.map(getCaptionScope)])], reverse: false };
    default:
      return null;
  }
}
