// 결과물 C 섹션 번호(들여쓰기·번호 표시) - 줄마다 보이는 깊이, 들여/내어쓰기를 할 수 있는지, 보낼 깊이와 한/영 짝 상대를 정한다.
// 번호 자체는 서버(outputs.number_lines)가 센다. 화면은 그 번호에서 깊이를 읽어 그리고, 서버와 같은 상한(앞 번호 줄 깊이 + 1)을 넘지 않게 막는다.
// 번호 생략·주석 줄은 번호가 없고 세지 않는다 - 깊이 상한도 앞 "번호 줄"만 본다(서버와 같은 규칙).
import type { NumberStyle, OutputC, OutputCItem, UnitRow } from "./api-sop";

export type IndentDir = -1 | 1;

type Section = OutputC["docs"][number]["sections"][number];

/** 고를 수 있는 번호 표시 - 화면 단추 순서이기도 하다. backend app/sop/constants.py NUMBER_STYLES와 같은 값 */
export const NUMBER_STYLES: readonly NumberStyle[] = ["numbered", "omitted", "note"];

/** 번호를 세는 줄인가 - 생략·주석 줄은 세지 않고 다음 번호 줄이 이어 센다 */
export function isCounted(item: Pick<OutputCItem, "number_style">): boolean {
  return item.number_style === "numbered";
}

/**
 * 칸 안 줄마다 지금 보이는 깊이. 번호가 있으면 번호 마디 수에서 읽고(칸 번호 5.1 아래 5.1.2.1 = 깊이 1),
 * 번호가 없는 줄(생략·주석 줄, 단계 없는 WI·입구 2 문서의 칸)은 저장값을 서버와 같은 규칙으로 눌러 읽는다 - 첫 번호 줄 앞은 0,
 * 그 뒤는 앞 번호 줄 깊이 + 1까지. 생략·주석 줄은 다음 줄의 상한에 끼지 않는다. 0으로 그리면 사람이 정한 들여쓰기가 사라진다.
 */
export function getSectionDepths(section: Pick<Section, "number" | "items">): number[] {
  const baseParts = section.number === null ? 0 : section.number.split(".").length;
  const depths: number[] = [];
  let previous: number | null = null;
  for (const item of section.items) {
    const fromNumber = section.number !== null && item.number !== null ? Math.max(0, item.number.split(".").length - baseParts - 1) : null;
    const depth: number = fromNumber ?? Math.max(0, Math.min(item.indent_level, previous === null ? 0 : previous + 1));
    depths.push(depth);
    if (isCounted(item)) previous = depth;
  }
  return depths;
}

/**
 * 한 단계 들이거나 내어 쓸 수 있는가. 들이기는 앞 번호 줄 깊이 + 1까지(counted가 false인 생략·주석 줄은 건너뛴다. 칸의 첫 번호 줄 앞은 0 -
 * WI의 Why 첫 줄처럼 앞 칸에 이어 세는 경우도 0으로 둔다),
 * 내어쓰기는 0보다 깊을 때만. 입구 2 문서(번호를 새로 매기지 않음)와 번역 줄(출처를 따라감)은 깊이를 따로 바꾸지 않는다.
 */
/** backend app/sop/constants.py MAX_INDENT_LEVEL과 같은 값 - 넘기면 API가 422로 거절한다 */
const MAX_INDENT_LEVEL = 9;

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

/** 깊이·번호 표시를 바꿀 수 있는 줄인가 - 입구 2 문서는 서버가 422, 번역 줄은 출처를 따라가므로 단추를 두지 않는다 */
export function isIndentable(entrance: string, item: Pick<OutputCItem, "change_type">): boolean {
  return entrance !== "match" && item.change_type !== "translated";
}

/**
 * 한/영 짝 원문 줄의 상대 새 문장 - 두 판이 같은 번호가 되게 같은 깊이를 함께 보낸다.
 * 이 줄의 출처 Unit이 하나이고 그 Unit의 짝(2개)의 다른 Unit이 이 문서에 새 문장을 딱 하나 만들었을 때만 정한다(1:N이면 상대를 하나로 정할 수 없다).
 */
export function findPartnerTarget(targetId: number, units: readonly UnitRow[], docTargetIds: ReadonlySet<number>): number | null {
  const sources = units.filter((unit) => unit.target_ids.includes(targetId));
  if (sources.length !== 1 || sources[0].pair_id === null) return null;
  const pairId = sources[0].pair_id;
  const members = units.filter((unit) => unit.pair_id === pairId);
  if (members.length !== 2) return null;
  const other = members.find((unit) => unit.unit_id !== sources[0].unit_id);
  const targets = (other?.target_ids ?? []).filter((id) => id !== targetId && docTargetIds.has(id));
  return targets.length === 1 ? targets[0] : null;
}
