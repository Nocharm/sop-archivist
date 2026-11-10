// 결과물 C 섹션 번호(들여쓰기) - 줄마다 보이는 깊이, 들여/내어쓰기를 할 수 있는지, 보낼 깊이와 한/영 짝 상대를 정한다.
// 번호 자체는 서버(outputs.number_lines)가 센다. 화면은 그 번호에서 깊이를 읽어 그리고, 서버와 같은 상한(앞줄 깊이 + 1)을 넘지 않게 막는다.
import type { OutputC, OutputCItem, UnitRow } from "./api-sop";

export type IndentDir = -1 | 1;

type Section = OutputC["docs"][number]["sections"][number];

/** 깊이 상한 - 서버가 저장값을 읽을 때 눌러 읽는 규칙(첫 줄 0, 앞줄의 눌러 읽은 깊이 + 1까지) */
export function clampDepths(stored: readonly number[]): number[] {
  const depths: number[] = [];
  for (const depth of stored) depths.push(Math.max(0, Math.min(depth, depths.length === 0 ? 0 : depths[depths.length - 1] + 1)));
  return depths;
}

/**
 * 칸 안 줄마다 지금 보이는 깊이. 번호가 있으면 번호 마디 수에서 읽고(칸 번호 5.1 아래 5.1.2.1 = 깊이 1),
 * 번호가 없는 칸(단계 없는 WI)은 저장값을 같은 규칙으로 눌러 읽는다 - 저장값 그대로 그리면 눌린 줄이 번호와 어긋나 보인다.
 */
export function getSectionDepths(section: Pick<Section, "number" | "items">): number[] {
  const base = section.number;
  if (base === null) return clampDepths(section.items.map((item) => item.indent_level));
  const baseParts = base.split(".").length;
  return section.items.map((item) => (item.number === null ? 0 : Math.max(0, item.number.split(".").length - baseParts - 1)));
}

/**
 * 한 단계 들이거나 내어 쓸 수 있는가. 들이기는 앞줄 깊이 + 1까지(칸 첫 줄은 0 - WI의 Why 첫 줄처럼 앞 칸에 이어 세는 경우도 0으로 둔다),
 * 내어쓰기는 0보다 깊을 때만. 입구 2 문서(번호를 새로 매기지 않음)와 번역 줄(출처를 따라감)은 깊이를 따로 바꾸지 않는다.
 */
export function canIndent(depths: readonly number[], index: number, dir: IndentDir): boolean {
  const depth = depths[index];
  if (depth === undefined) return false;
  if (dir < 0) return depth > 0;
  return index > 0 && depth <= depths[index - 1];
}

/** 깊이를 바꿀 수 있는 줄인가 - 입구 2 문서는 서버가 422, 번역 줄은 출처를 따라가므로 단추를 두지 않는다 */
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
