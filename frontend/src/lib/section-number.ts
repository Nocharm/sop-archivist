// 결과물 C 섹션 번호(들여쓰기·번호 표시) - 줄마다 보이는 깊이, 들여/내어쓰기를 할 수 있는지, 깊이·표시 단추를 둘 줄인지 정한다.
// 번호 자체는 서버(outputs.number_lines)가 칸의 두 언어 문장을 한 줄로 세어 매긴다. 화면은 그 번호에서 깊이를 읽어 그리고, 서버와 같은 상한(앞 번호 줄 깊이 + 1)을 넘지 않게 막는다.
// numberLines는 그 서버 함수의 사본이다 - 순서·깊이·표시를 바꾼 뒤 저장 응답이 오기 전에만 번호를 미리 센다(응답의 번호가 늘 이긴다). 서버 규칙을 바꾸면 함께 고친다.
// 어느 줄을 세는지(서버 outputs.number_targets)의 사본은 c-edit-model.numberDoc이다.
// 번호 생략·주석 줄은 번호가 없고 세지 않는다 - 깊이 상한도 앞 "번호 줄"만 본다(서버와 같은 규칙). 깊이·표시는 바꾼 그 줄에만 붙는다(짝 상대에 옮기지 않는다).
// 줄을 세지 않는 칸(서버가 절마다 주는 counts_lines가 false - 하위 칸을 선언하는 칸)에 직접 놓인 줄은 저장된 표시와 상관없이 번호가 없고 세지 않는다.
// 어느 칸이 그런지는 그 문서의 골격이 정하므로 화면은 칸 키로 풀지 않고 절의 값을 읽는다. 이 파일에서 읽는 곳은 listCounted(세는 줄)와 readStyleChoices(표시 단추) 둘이다.
import type { NumberStyle, OutputC, OutputCItem } from "./api-sop";

export type IndentDir = -1 | 1;

type Section = OutputC["docs"][number]["sections"][number];

/** 고를 수 있는 번호 표시 - 화면 단추 순서이기도 하다. backend app/sop/constants.py NUMBER_STYLES와 같은 값 */
export const NUMBER_STYLES: readonly NumberStyle[] = ["numbered", "bullet", "omitted", "note"];

/** 번호를 세는 표시인가 - 생략·주석 줄은 세지 않고 다음 번호 줄이 이어 센다. 칸까지 본 답은 listCounted */
export function isCounted(item: Pick<OutputCItem, "number_style">): boolean {
  return item.number_style === "numbered";
}

/** 칸의 줄마다 번호를 세는가 - 줄을 세지 않는 칸(counts_lines false)의 줄은 표시와 상관없이 세지 않는다(깊이 상한에도 끼지 않는다) */
export function listCounted(section: { counts_lines: boolean; items: readonly Pick<OutputCItem, "number_style">[] }): boolean[] {
  return section.items.map((item) => section.counts_lines && isCounted(item));
}

/**
 * 그 칸의 줄에 보일 번호 표시 단추 - choices는 고를 수 있는 표시(단추 순서), pressed는 눌린 것으로 보일 표시.
 * 줄을 세지 않는 칸의 줄은 번호를 받지 않아 번호(numbered)를 내놓지 않고(쓸 수 없는 단추는 숨긴다), 번호로 저장된 줄은 생략으로 보인다.
 * 저장값은 그대로다 - 하위 칸으로 옮기면 다시 번호 줄이고, 여기서 생략·주석을 고르면 그 값을 저장한다.
 */
export function readStyleChoices(section: { counts_lines: boolean }, style: NumberStyle): { choices: readonly NumberStyle[]; pressed: NumberStyle } {
  if (section.counts_lines) return { choices: NUMBER_STYLES, pressed: style };
  return { choices: NUMBER_STYLES.filter((choice) => choice !== "numbered"), pressed: style === "numbered" ? "omitted" : style };
}

/**
 * 칸 번호 base 아래 줄 번호 - backend outputs.number_lines의 사본(저장 응답 전 미리 보기 전용). 깊이 d 줄은 base 뒤에 d + 1 마디이고,
 * 앞 번호 줄의 눌러 읽은 깊이 + 1을 넘으면 그만큼으로 눌러 읽는다. null(생략·주석 줄)은 번호가 없고 세지 않는다.
 */
export function numberLines(base: string, depths: readonly (number | null)[]): (string | null)[] {
  // 깊이별 지금 번호 - 길이가 앞 번호 줄의 눌러 읽은 깊이 + 1이다
  const counters: number[] = [];
  return depths.map((depth) => {
    if (depth === null) return null;
    const level = Math.max(0, Math.min(depth, counters.length));
    counters.length = Math.min(counters.length, level + 1);
    if (counters.length === level) counters.push(0);
    counters[level] += 1;
    return [base, ...counters].join(".");
  });
}

/**
 * 칸 안 줄마다 지금 보이는 깊이. 번호가 있으면 번호 마디 수에서 읽고(칸 번호 5.1 아래 5.1.2.1 = 깊이 1),
 * 번호가 없는 줄(생략·주석 줄, 단계 없는 WI·입구 2 문서의 칸)은 저장값을 서버와 같은 규칙으로 눌러 읽는다 - 첫 번호 줄 앞은 0,
 * 그 뒤는 앞 번호 줄 깊이 + 1까지. 생략·주석 줄은 다음 줄의 상한에 끼지 않는다. 0으로 그리면 사람이 정한 들여쓰기가 사라진다.
 * 줄을 세지 않는 칸은 세는 줄이 없어(listCounted) 모든 줄이 0이다 - 번호 줄이 하나도 없는 칸의 생략·주석 줄과 같다.
 */
export function getSectionDepths(section: Pick<Section, "counts_lines" | "number" | "items">): number[] {
  const baseParts = section.number === null ? 0 : section.number.split(".").length;
  const counted = listCounted(section);
  const depths: number[] = [];
  let previous: number | null = null;
  for (const [index, item] of section.items.entries()) {
    const fromNumber = section.number !== null && item.number !== null ? Math.max(0, item.number.split(".").length - baseParts - 1) : null;
    const depth: number = fromNumber ?? Math.max(0, Math.min(item.indent_level, previous === null ? 0 : previous + 1));
    depths.push(depth);
    if (counted[index]) previous = depth;
  }
  return depths;
}

/**
 * 한 단계 들이거나 내어 쓸 수 있는가. 들이기는 앞 번호 줄 깊이 + 1까지(counted가 false인 생략·주석 줄은 건너뛴다. 칸의 첫 번호 줄 앞은 0 -
 * WI의 Why 첫 줄처럼 앞 칸에 이어 세는 경우도 0으로 둔다),
 * 내어쓰기는 0보다 깊을 때만. 입구 2 문서(번호를 새로 매기지 않음)와 AI 번역 줄(출처를 따라감)은 깊이를 따로 바꾸지 않는다(canChangeDepth).
 */
/** backend app/sop/constants.py MAX_INDENT_LEVEL과 같은 값 - 넘기면 API가 422로 거절한다 */
export const MAX_INDENT_LEVEL = 9;

export function canIndent(depths: readonly number[], counted: readonly boolean[], index: number, dir: IndentDir): boolean {
  const depth = depths[index];
  if (depth === undefined) return false;
  if (dir < 0) return depth > 0;
  // 상한은 앞 번호 줄 깊이 + 1 - 생략·주석 줄은 건너뛰고, 앞에 번호 줄이 없으면 들일 수 없다
  let previous = index - 1;
  while (previous >= 0 && !counted[previous]) previous -= 1;
  return previous >= 0 && depth <= depths[previous] && depth < MAX_INDENT_LEVEL;
}

/**
 * 고른 줄에서 누른 글쇠가 들이기·내어쓰기인가 - 지금 그 방향으로 바꿀 수 있을 때만 방향을 돌려준다.
 * null이면 화면은 기본 동작(포커스 이동)을 막지 않는다 - 바꿀 수 없는 Tab까지 삼키면 키보드가 그 줄에 갇힌다(WCAG 2.1.2).
 */
export function readIndentKey(
  event: { key: string; shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean },
  state: { canOut: boolean; canIn: boolean; busy: boolean },
): IndentDir | null {
  if (event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey || state.busy) return null;
  if (event.shiftKey) return state.canOut ? -1 : null;
  return state.canIn ? 1 : null;
}

/**
 * 깊이를 바꿀 수 있는 줄인가 - 입구 2 문서는 서버가 422, AI 번역(기원 translation)은 깊이가 출처를 따라 잠겨 있다.
 * 사람이 쓴 다른 언어 문장(기원 units, 종류 translated)은 일반 새 문장이라 바꾼다.
 */
export function canChangeDepth(entrance: string, item: Pick<OutputCItem, "origin">): boolean {
  return entrance !== "match" && item.origin !== "translation";
}

/** 번호 표시를 바꿀 수 있는 줄인가 - 입구 2 문서만 막는다(번역도 출처와 다른 표시를 가진다: 영어 번호, 한글 생략) */
export function canChangeStyle(entrance: string): boolean {
  return entrance !== "match";
}
