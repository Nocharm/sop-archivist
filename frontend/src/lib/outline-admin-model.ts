// SOP 표준 골격 관리 화면의 규칙 - 번호 미리 세기, 줄 더하기·빼기·옮기기, 저장 전 검사, 바뀜 판정.
// 검사 사유는 backend app/sop/outline.py `_check_standard_items`와 같다(서버가 거절할 것을 저장을 누르기 전에 알린다) - 서버 규칙을 바꾸면 함께 고친다.
import type { OutlineStandardItem } from "./api-manage";
import type { NumberStyle, OutlineKind } from "./api-sop";

/** 종류 고르기 목록의 순서 */
export const OUTLINE_KINDS: readonly OutlineKind[] = ["general", "category_table", "named_children", "group", "auto_list"];
/** 기본 표시 고르기 목록의 순서 - 결과물 C의 번호 표시 단추와 같은 순서 */
export const NUMBER_STYLES: readonly NumberStyle[] = ["numbered", "bullet", "omitted", "note"];

// 아래 값은 backend app/sop/outline.py(KEY_PATTERN·MAX_KEY_CHARS·LEAF_KINDS·OutlineStandardItemIn)와 같아야 한다 - 넘기면 422로 돌아온다
const KEY_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;
/** 하위 항목을 두지 않는 종류 */
const LEAF_KINDS: readonly OutlineKind[] = ["general", "auto_list"];
export const KEY_MAX = 100;
export const TITLE_MAX = 200;
export const CHILD_PREFIX_MAX = 40;
const SUGGESTION_MAX = 200;
const SUGGESTIONS_MAX = 50;

/** 화면에서 고치는 한 줄 - 권장 이름은 적는 동안의 글 그대로 든다(쉼표로 가른다) */
export interface OutlineRow {
  /** 화면 안에서만 쓰는 줄 이름 - 새 줄은 키를 적는 동안에도 같은 줄이다 */
  rowId: string;
  /** 아직 저장하지 않은 줄 - 이 줄만 키를 고칠 수 있다(저장한 키는 문서가 가리킨다) */
  isNew: boolean;
  key: string;
  title_en: string;
  title_ko: string;
  kind: OutlineKind;
  is_required: boolean;
  default_style: NumberStyle;
  child_prefix: string;
  suggestions: string;
}

/** 서버가 거절하는 사유(rule.outline_invalid.<사유>)와 화면에서만 미리 막는 입력 형식 둘 */
export type OutlineProblemReason = "empty" | "bad_key" | "duplicate_key" | "missing_parent" | "children_under_leaf" | "title_required" | "bad_suggestions";

export interface OutlineProblem {
  reason: OutlineProblemReason;
  /** 걸린 줄 - 목록이 비었을 때는 null */
  rowId: string | null;
}

/** 부모 항목의 키 - 마지막 점 앞. 적다 만 하위 키("a.")도 그 부모 아래로 본다(부모와 함께 옮기고 지우게) */
export function getParentKey(key: string): string | null {
  const cut = key.lastIndexOf(".");
  return cut > 0 ? key.slice(0, cut) : null;
}

function isWithin(key: string, ancestorKey: string): boolean {
  return ancestorKey !== "" && key.startsWith(`${ancestorKey}.`);
}

export function parseSuggestions(text: string): string[] {
  return text
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "");
}

export function buildRows(items: readonly OutlineStandardItem[]): OutlineRow[] {
  return items.map((item) => ({ ...item, rowId: item.key, isNew: false, suggestions: item.suggestions.join(", ") }));
}

/** 저장 요청에 싣는 목록 - 앞뒤 공백은 서버도 걷으므로 여기서 걷어 바뀜 판정이 저장 뒤 값과 맞게 한다 */
export function buildItems(rows: readonly OutlineRow[]): OutlineStandardItem[] {
  return rows.map((row) => ({
    key: row.key,
    title_en: row.title_en.trim(),
    title_ko: row.title_ko.trim(),
    kind: row.kind,
    is_required: row.is_required,
    default_style: row.default_style,
    child_prefix: row.child_prefix.trim(),
    suggestions: parseSuggestions(row.suggestions),
  }));
}

function serializeItems(items: readonly OutlineStandardItem[]): string {
  return JSON.stringify(items.map((item) => [item.key, item.title_en, item.title_ko, item.kind, item.is_required, item.default_style, item.child_prefix, item.suggestions]));
}

export function isChanged(rows: readonly OutlineRow[], items: readonly OutlineStandardItem[]): boolean {
  return serializeItems(buildItems(rows)) !== serializeItems(items);
}

/**
 * 줄마다의 번호(줄 순서대로) - 최상위는 1..n, 하위는 "부모 번호.형제 중 자리". 서버 `DocOutline`이 새 문서에 매길 번호와 같다.
 * 키가 꼴에 맞지 않거나 부모가 앞에 없는 줄은 null이다.
 */
export function numberRows(rows: readonly OutlineRow[]): Array<string | null> {
  const numbers = new Map<string, string>();
  const childCounts = new Map<string, number>();
  let topCount = 0;
  return rows.map((row) => {
    if (!KEY_PATTERN.test(row.key)) return null;
    const parentKey = getParentKey(row.key);
    let number: string;
    if (parentKey === null) {
      topCount += 1;
      number = String(topCount);
    } else {
      const parentNumber = numbers.get(parentKey);
      if (parentNumber === undefined) return null;
      const position = (childCounts.get(parentKey) ?? 0) + 1;
      childCounts.set(parentKey, position);
      number = `${parentNumber}.${position}`;
    }
    numbers.set(row.key, number);
    return number;
  });
}

/** 하위 항목을 달 수 있는 줄인가 - 키가 맞고 하위를 두는 종류일 때 */
export function canAddChild(row: OutlineRow): boolean {
  return KEY_PATTERN.test(row.key) && !LEAF_KINDS.includes(row.kind);
}

export function hasChildren(rows: readonly OutlineRow[], rowId: string): boolean {
  const row = rows.find((item) => item.rowId === rowId);
  return row !== undefined && rows.some((item) => isWithin(item.key, row.key));
}

/**
 * 새 줄을 더한다 - parentRowId가 없으면 최상위로 맨 끝에, 있으면 그 줄의 하위로 그 줄의 마지막 하위 바로 뒤에.
 * 하위 줄의 키는 "부모."까지 채워 두고 나머지를 사람이 적는다.
 */
export function addRow(rows: readonly OutlineRow[], rowId: string, parentRowId: string | null): OutlineRow[] {
  const blank: OutlineRow = { rowId, isNew: true, key: "", title_en: "", title_ko: "", kind: "general", is_required: true, default_style: "numbered", child_prefix: "", suggestions: "" };
  const parentIndex = parentRowId === null ? -1 : rows.findIndex((row) => row.rowId === parentRowId);
  if (parentIndex < 0) return [...rows, blank];
  const parent = rows[parentIndex];
  const lastIndex = rows.reduce((last, row, index) => (isWithin(row.key, parent.key) ? index : last), parentIndex);
  return [...rows.slice(0, lastIndex + 1), { ...blank, key: `${parent.key}.` }, ...rows.slice(lastIndex + 1)];
}

/** 줄과 그 하위를 함께 뺀다 - 부모 없는 하위는 저장할 수 없다 */
export function removeRow(rows: readonly OutlineRow[], rowId: string): OutlineRow[] {
  const row = rows.find((item) => item.rowId === rowId);
  if (row === undefined) return [...rows];
  return rows.filter((item) => item.rowId !== rowId && !isWithin(item.key, row.key));
}

function findSibling(rows: readonly OutlineRow[], rowId: string, direction: -1 | 1): OutlineRow | null {
  const row = rows.find((item) => item.rowId === rowId);
  if (row === undefined) return null;
  const parentKey = getParentKey(row.key);
  const siblings = rows.filter((item) => getParentKey(item.key) === parentKey);
  return siblings[siblings.indexOf(row) + direction] ?? null;
}

export function canMoveRow(rows: readonly OutlineRow[], rowId: string, direction: -1 | 1): boolean {
  return findSibling(rows, rowId, direction) !== null;
}

/** 같은 부모의 형제 사이에서 한 자리 옮긴다 - 하위는 부모를 따라간다. 끝이면 그대로 */
export function moveRow(rows: readonly OutlineRow[], rowId: string, direction: -1 | 1): OutlineRow[] {
  const sibling = findSibling(rows, rowId, direction);
  const row = rows.find((item) => item.rowId === rowId);
  if (sibling === null || row === undefined) return [...rows];
  const block = rows.filter((item) => item === row || isWithin(item.key, row.key));
  const rest = rows.filter((item) => !block.includes(item));
  // 위로는 형제 바로 앞, 아래로는 형제의 마지막 하위 바로 뒤
  const at =
    direction < 0
      ? rest.indexOf(sibling)
      : rest.reduce((last, item, index) => (item === sibling || isWithin(item.key, sibling.key) ? index : last), -1) + 1;
  return [...rest.slice(0, at), ...block, ...rest.slice(at)];
}

/** 저장을 막는 첫 문제 - 없으면 null. 줄 순서대로, 한 줄 안에서는 서버가 보는 순서대로 본다 */
export function findProblem(rows: readonly OutlineRow[]): OutlineProblem | null {
  if (rows.length === 0) return { reason: "empty", rowId: null };
  const kinds = new Map<string, OutlineKind>();
  for (const row of rows) {
    const fail = (reason: OutlineProblemReason): OutlineProblem => ({ reason, rowId: row.rowId });
    if (row.key.length > KEY_MAX || !KEY_PATTERN.test(row.key)) return fail("bad_key");
    if (kinds.has(row.key)) return fail("duplicate_key");
    const parentKey = getParentKey(row.key);
    if (parentKey !== null) {
      const parentKind = kinds.get(parentKey);
      if (parentKind === undefined) return fail("missing_parent");
      if (LEAF_KINDS.includes(parentKind)) return fail("children_under_leaf");
    }
    if (row.title_en.trim() === "") return fail("title_required");
    const names = parseSuggestions(row.suggestions);
    if (names.length > SUGGESTIONS_MAX || names.some((name) => name.length > SUGGESTION_MAX)) return fail("bad_suggestions");
    kinds.set(row.key, row.kind);
  }
  return null;
}
