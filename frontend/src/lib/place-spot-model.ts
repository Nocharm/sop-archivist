// New 칸 자리 목록(MD 1 F9 끌어 놓기 · MD 2 S3 클릭 배치가 같이 쓴다) - 엮은 문서의 자리(칸 머리 · 범주 행 · 빈 칸 · 줄 사이 · 앱이 만드는 것)마다
// 놓으면 갈 칸, 저장할 자리(position), 꼬리표 글, 못 놓는 까닭을 정한다. 줄 사이는 기본 보기 끌어 놓기(assign-drop-model)의 판단을 그대로 쓴다 - 두 보기의 답이 같다.
// 자리 모양은 화면이 읽어 넘긴다(템플릿 보기 data-tpl-spot · 기본 보기 data-row). 이 모델은 DOM을 모른다.
import type { ComposedSection, OutlineKind } from "./api-sop";
import { buildDropSections, findDropBlock, REFUSAL_KEYS, resolveGapDrop, type DropBlock, type DropSection, type SendRefusal } from "./assign-drop-model";
import { readSectionHead } from "./composed-model";

/** 못 놓는 까닭 - 기본 보기의 넷(na_slot · not_assignable · written_doc · same_slot)에 템플릿에만 있는 자리의 까닭을 더한다 */
export type PlaceRefusal = SendRefusal | "group_title" | "auto_list" | "toc" | "cover" | "scope_table" | "system";

export const PLACE_REFUSAL_KEYS: Record<PlaceRefusal, string> = {
  ...REFUSAL_KEYS,
  group_title: "template.drop.groupTitle",
  auto_list: "template.drop.autoList",
  toc: "template.drop.toc",
  cover: "template.drop.cover",
  scope_table: "template.drop.scopeTable",
  system: "template.drop.system",
};

/** 앱이 만드는 것(템플릿 보기의 fixed 자리) */
export type FixedSpot = "toc" | "cover" | "scope_table" | "system";
const FIXED_SPOTS: readonly string[] = ["toc", "cover", "scope_table", "system"] satisfies FixedSpot[];

/** 템플릿 보기 data-tpl-fixed 값 - 모르는 값은 null */
export function readFixedSpot(value: string | undefined): FixedSpot | null {
  return value !== undefined && FIXED_SPOTS.includes(value) ? (value as FixedSpot) : null;
}

/** 누르거나 끄는 자리 - section은 칸 머리 · 5장 범주 행 · 빈 칸(칸 끝에 놓는다), line은 놓인 줄(그 의미 묶음 앞·뒤), fixed는 앱이 만드는 것 */
export type PlaceSpot = { kind: "section"; sectionKey: string } | { kind: "line"; targetId: number; isUpperHalf: boolean } | { kind: "fixed"; what: FixedSpot };

/** 자리 목록의 칸 - 기본 보기 끌어 놓기의 칸(DropSection)에 꼬리표 · 번호에 쓰는 것을 더한다 */
export interface PlaceSection extends DropSection {
  /** 칸 머리 글(기본 보기 꼬리표와 같은 readSectionHead) */
  head: string;
  kind: OutlineKind | null;
  /** 칸 번호 - 줄 번호의 머리 */
  number: string | null;
  countsLines: boolean;
  /** 줄마다 결과물 C 번호(items와 같은 순서, 생략 · 글머리 기호는 null) */
  numbers: readonly (string | null)[];
  /** 하위 칸이 있다(6장 절 · 9장 부록을 선언함) */
  hasChildren: boolean;
}

// 9장 부록 칸 키(backend app/sop/outline.py _TEMPLATE_ITEMS) - 선언한 부록이 없으면 놓을 수는 있지만 알림을 단다(사용자 결정 C, 2026-11-18)
const APPENDICES_KEY = "appendices";
// WI 장(단계) 키 "step:<n>" · "unstepped" - 템플릿 보기는 장 하나를 한 자리로 그린다. 놓으면 그 단계의 instruction 칸이다
const WI_CHAPTER = /^(step:\d+|unstepped)$/;

export function buildPlaceSections(sections: readonly ComposedSection[], rowKeyOf: (unitId: number) => string | undefined): PlaceSection[] {
  const drops = buildDropSections(sections, rowKeyOf);
  return sections.map((section, index) => ({
    ...drops[index],
    head: readSectionHead(section),
    kind: section.kind,
    number: section.number,
    countsLines: section.counts_lines,
    numbers: section.items.map((item) => item.number),
    hasChildren: sections[index + 1]?.location_key.startsWith(`${section.location_key}.`) ?? false,
  }));
}

/** 줄 번호 글 - after는 기준 줄의 번호(null이면 칸 맨 앞), becomes는 놓은 줄이 받을 번호. 번호를 세지 않는 칸은 null */
export interface PlaceNumbers {
  after: string | null;
  becomes: string;
}

export type Placement =
  | {
      kind: "place";
      sectionKey: string;
      head: string;
      /** 저장할 자리 - after는 그 뒤에 끼울 새 문장(null이면 칸 맨 앞). null이면 position 키를 넣지 않는다(빈 칸) */
      position: { after: number | null } | null;
      /** 줄 사이 선을 긋는 기준 줄과 변 - 칸 자리(머리 · 범주 · 빈 칸)는 자리 자체를 칠하므로 null */
      edge: { targetId: number; side: "top" | "bottom" } | null;
      numbers: PlaceNumbers | null;
      /** 놓을 수는 있지만 알릴 것 - 선언한 부록이 없는 9장 */
      hint: "declare_appendix" | null;
    }
  | { kind: "refused"; reason: PlaceRefusal }
  | { kind: "none" };

/** 자리 키로 칸 찾기 - WI 장 키는 그 단계의 instruction 칸 */
function findSection(sections: readonly PlaceSection[], key: string): PlaceSection | undefined {
  const found = sections.find((section) => section.key === key);
  if (found || !WI_CHAPTER.test(key)) return found;
  return sections.find((section) => section.key === `${key}:instruction`);
}

function readAfterNumber(section: PlaceSection, index: number): string | null {
  for (let at = index; at >= 0; at -= 1) {
    const number = section.numbers[at];
    if (number) return number;
  }
  return null;
}

/** 놓은 줄의 번호 - 기준 줄(없으면 바로 앞의 번호 있는 줄) 번호를 칸 바로 아래 깊이로 자르고 끝을 하나 올린다. 앞에 번호가 없으면 "<칸>.1" */
function readNumbers(section: PlaceSection, after: number | null): PlaceNumbers | null {
  if (!section.countsLines || section.number === null) return null;
  const index = after === null ? -1 : section.items.findIndex((item) => item.targetId === after);
  const shown = index < 0 ? null : readAfterNumber(section, index);
  const depth = section.number.split(".").length + 1;
  const base = shown?.startsWith(`${section.number}.`) ? shown.split(".").slice(0, depth) : null;
  const becomes = base ? [...base.slice(0, -1), String(Number(base[depth - 1]) + 1)].join(".") : `${section.number}.1`;
  return { after: index < 0 ? null : shown, becomes };
}

function readHint(section: PlaceSection): "declare_appendix" | null {
  return section.key === APPENDICES_KEY && !section.hasChildren ? "declare_appendix" : null;
}

function placeIn(section: PlaceSection, position: { after: number | null } | null, edge: { targetId: number; side: "top" | "bottom" } | null): Placement {
  return { kind: "place", sectionKey: section.key, head: section.head, position, edge, numbers: position ? readNumbers(section, position.after) : null, hint: readHint(section) };
}

function hasDragUnits(section: PlaceSection, dragUnitIds: readonly number[]): boolean {
  const drag = new Set(dragUnitIds);
  return section.items.some((item) => item.sourceUnitIds.some((id) => drag.has(id)));
}

/** 자리 하나에 놓으면 - 줄 사이는 기본 보기와 같은 판단(resolveGapDrop), 칸 자리는 N/A → 묶음 · 자동 목록 → 같은 칸 순서로 거절하고 아니면 칸 끝 */
export function resolvePlaceSpot(sections: readonly PlaceSection[], spot: PlaceSpot, dragUnitIds: readonly number[]): Placement {
  if (spot.kind === "fixed") return { kind: "refused", reason: spot.what };
  if (spot.kind === "line") {
    const section = sections.find((candidate) => candidate.items.some((item) => item.targetId === spot.targetId));
    if (!section) return { kind: "none" };
    const drop = resolveGapDrop(section, spot.targetId, spot.isUpperHalf, dragUnitIds);
    if (drop.kind === "refused") return drop;
    if (drop.kind !== "gap") return { kind: "none" };
    return placeIn(section, { after: drop.after }, drop.edge);
  }
  const section = findSection(sections, spot.sectionKey);
  if (!section) return { kind: "none" };
  if (section.isNa) return { kind: "refused", reason: "na_slot" };
  if (section.kind === "group") return { kind: "refused", reason: "group_title" };
  if (section.kind === "auto_list") return { kind: "refused", reason: "auto_list" };
  if (!section.isAssignable) return { kind: "refused", reason: "not_assignable" };
  if (hasDragUnits(section, dragUnitIds)) return { kind: "refused", reason: "same_slot" };
  // 칸 끝 - 줄이 있으면 마지막 줄 뒤(기본 보기에서 마지막 묶음 아래 절반에 놓은 것과 같다), 없으면 자리 없음
  const last = section.items.at(-1);
  return placeIn(section, last ? { after: last.targetId } : null, null);
}

/** 줄 자리가 든 의미 묶음 - 화면이 이 상자의 중간선으로 앞·뒤(isUpperHalf)를 잰다 */
export function findPlaceBlock(sections: readonly PlaceSection[], targetId: number): DropBlock | null {
  for (const section of sections) {
    const block = findDropBlock(section, targetId);
    if (block) return block;
  }
  return null;
}

/** 칠할 자리인가 - 칸 자리만 본다(줄 자리는 올렸을 때 선으로 보인다) */
export function isSpotOpen(sections: readonly PlaceSection[], spot: PlaceSpot, dragUnitIds: readonly number[]): boolean {
  return spot.kind === "section" && resolvePlaceSpot(sections, spot, dragUnitIds).kind === "place";
}

// --- 클릭 배치(MD 2 S3) - 끌기와 같은 자리 목록. 틈은 끌기의 줄 자리(위·아래 절반) 꼴로 만들어 resolvePlaceSpot이 같은 답을 낸다 ---

/** 번호를 세는 칸의 줄마다 그 줄이 든 의미 묶음(첫 · 끝 줄) - 틈 자리를 한 번에(긴 문서) 읽으려고 문서마다 한 번 짓는다 */
export function buildGapBlocks(sections: readonly PlaceSection[]): Map<number, DropBlock> {
  const blocks = new Map<number, DropBlock>();
  for (const section of sections) {
    if (!section.countsLines) continue;
    let start = 0;
    section.items.forEach((item, index) => {
      const next = section.items[index + 1];
      // 묶음은 groupKey(null 아님)가 같은 이웃 줄들 - findDropBlock과 같은 규칙
      if (next && item.groupKey !== null && next.groupKey === item.groupKey) return;
      const block = { firstId: section.items[start].targetId, lastId: item.targetId };
      for (let at = start; at <= index; at += 1) blocks.set(section.items[at].targetId, block);
      start = index + 1;
    });
  }
  return blocks;
}

/**
 * 두 줄 사이(prev 뒤 · next 앞, 맨 앞 · 맨 끝은 null)의 틈 자리 키 - 번호를 세는 칸의 의미 묶음 경계에만 있다(묶음 안을 가르지 않는다, 끌기와 같다).
 * 칸 첫 줄 앞은 "before:<첫 줄>", 그 밖은 "after:<앞 묶음의 끝 줄>". 템플릿 두 절반의 줄(영어 줄 · 한글 줄)도 같은 묶음이면 같은 키다. 없으면 null
 */
export function readGapKey(blocks: ReadonlyMap<number, DropBlock>, prevId: number | null, nextId: number | null): string | null {
  const before = prevId === null ? null : blocks.get(prevId);
  const after = nextId === null ? null : blocks.get(nextId);
  if (before === undefined || after === undefined || (before === null && after === null)) return null;
  if (before && after && before.firstId === after.firstId) return null;
  return before ? `after:${before.lastId}` : `before:${after?.firstId}`;
}

/** 클릭 배치의 틈 - key는 readGapKey와 같은 키, spot은 끌기의 줄 자리 꼴(첫 줄 앞은 그 묶음의 위 절반, 그 밖은 앞 묶음의 아래 절반)이라 resolvePlaceSpot이 끌기와 같은 답을 낸다 */
export interface GapSpot {
  key: string;
  anchorId: number;
  side: "before" | "after";
  spot: PlaceSpot;
}

/** 번호를 세는 칸마다 첫 줄 앞과 의미 묶음마다 끝 줄 뒤의 틈 - 기본 보기는 anchorId 줄의 앞 · 뒤에 그린다 */
export function listGapSpots(sections: readonly PlaceSection[], blocks: ReadonlyMap<number, DropBlock> = buildGapBlocks(sections)): GapSpot[] {
  const gaps: GapSpot[] = [];
  for (const section of sections) {
    if (!section.countsLines || section.items.length === 0) continue;
    const first = section.items[0].targetId;
    gaps.push({ key: `before:${first}`, anchorId: first, side: "before", spot: { kind: "line", targetId: first, isUpperHalf: true } });
    for (const item of section.items) {
      if (blocks.get(item.targetId)?.lastId !== item.targetId) continue;
      gaps.push({ key: `after:${item.targetId}`, anchorId: item.targetId, side: "after", spot: { kind: "line", targetId: item.targetId, isUpperHalf: false } });
    }
  }
  return gaps;
}

/** 고른 곳 상자의 위치 - 번호를 세는 칸은 번호 글, 아니면 줄의 맨 앞 · 사이 · 끝 */
export type PlacePosition = { kind: "number"; numbers: PlaceNumbers } | { kind: "line"; at: "start" | "between" | "end"; isBullet: boolean };

/**
 * 칸과 저장할 자리로 위치를 읽는다 - after가 undefined면 position 키를 넣지 않는 저장(서버가 칸 끝에 넣는다)이라 마지막 줄 뒤로, 빈 칸이면 첫 줄로 센다.
 * isBullet은 SOP 골격 칸(kind 있음) - 번호를 세지 않는 SOP 칸은 템플릿에서 글머리 기호 줄이다. 모르는 칸이면 null
 */
export function readPlacePosition(sections: readonly PlaceSection[], sectionKey: string, after: number | null | undefined): { position: PlacePosition; hint: "declare_appendix" | null } | null {
  const section = findSection(sections, sectionKey);
  if (!section) return null;
  const last = section.items.at(-1)?.targetId ?? null;
  const at = after === undefined ? last : after;
  const hint = readHint(section);
  const numbers = readNumbers(section, at);
  if (numbers) return { position: { kind: "number", numbers }, hint };
  const where = at === last ? "end" : at === null ? "start" : "between";
  return { position: { kind: "line", at: where, isBullet: section.kind !== null }, hint };
}

/** 한글 번호 뒤 주격 조사 - 끝자리를 읽은 소리로(2 이 · 4 사 · 5 오 · 9 구는 "가", 나머지는 "이") */
export function readSubjectParticle(number: string): "이" | "가" {
  return /[2459]$/.test(number) ? "가" : "이";
}

/** 한글 번호 뒤 목적격 조사 - 끝자리를 읽은 소리로(2 이 · 4 사 · 5 오 · 9 구는 "를", 나머지는 "을" - 0으로 끝나면 영 · 십 · 백 · 천도 받침이 있다) */
export function readObjectParticle(number: string | number): "을" | "를" {
  return /[2459]$/.test(String(number)) ? "를" : "을";
}

type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** 끌기 꼬리표 · 고른 곳 글 - "→ 칸 머리", 번호를 세는 칸은 "· 6.1.1 다음 (6.1.2가 된다)", 선언한 부록이 없는 9장은 알림을 붙인다 */
export function formatPlacement(placement: Extract<Placement, { kind: "place" }>, t: Translate): string {
  const parts = [`→ ${placement.head}`];
  const numbers = placement.numbers;
  if (numbers) {
    const vars = { n: numbers.becomes, p: readSubjectParticle(numbers.becomes) };
    parts.push(numbers.after === null ? t("template.drop.first", vars) : t("template.drop.after", { ...vars, after: numbers.after }));
  }
  if (placement.hint === "declare_appendix") parts.push(t("template.drop.declareAppendix"));
  return parts.join(" · ");
}

function readNumberVars(numbers: PlaceNumbers): Record<string, string> {
  return { n: numbers.becomes, p: readSubjectParticle(numbers.becomes), after: numbers.after ?? "" };
}

/** 틈 꼬리표 - "6.1.1 다음 — 6.1.2가 된다", 맨 앞은 "첫 줄 — 6.1.1이 된다". 번호가 없으면(번호를 세지 않는 칸) 빈 글 */
export function formatGapLabel(placement: Extract<Placement, { kind: "place" }>, t: Translate): string {
  const numbers = placement.numbers;
  if (!numbers) return "";
  return t(numbers.after === null ? "assign.place.gapFirst" : "assign.place.gapAfter", readNumberVars(numbers));
}

/** 고른 곳 상자의 위치 글 - "6.1.1 다음 (6.1.2가 된다)" · "첫 줄 (6.1.1이 된다)" · "글머리 기호 줄 · 끝에", 선언한 부록이 없는 9장은 알림을 붙인다 */
export function formatPlacePosition(place: NonNullable<ReturnType<typeof readPlacePosition>>, t: Translate): string {
  const { position } = place;
  const parts =
    position.kind === "number"
      ? [t(position.numbers.after === null ? "template.drop.first" : "template.drop.after", readNumberVars(position.numbers))]
      : [...(position.isBullet ? [t("assign.place.bullet")] : []), t(`assign.place.at.${position.at}`)];
  if (place.hint === "declare_appendix") parts.push(t("template.drop.declareAppendix"));
  return parts.join(" · ");
}
