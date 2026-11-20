// 번호 칸 종류의 순수 모델(시안 2 D1) - 종류는 저장하지 않고 번호 칸 값에서 읽는다(새 열 없음). 연속 번호 세기 · 점 기호 줄의 들여쓰기 단계.
// 연속 값은 프런트 전용이다 - 저장되는 것은 사람이 확인한 글이라 서버 사본이 필요 없다.

import type { ViewUnit } from "./api-sop";
import { listNumberSiblings } from "./number-model";
import { BULLET_SYMBOLS } from "./section-number";

export type NumberKind = "continuous" | "bullet" | "custom" | "none";

// 서버 쪽 절 번호 꼴과 같다("3" "6.1" "6.1.1.") - 이 꼴만 셀 수 있는 연속 번호다
const CONTINUOUS_RE = /^\d+(\.\d+)*\.?$/;

/** 점 기호의 순번(• 0 · ○ 1 · ▪ 2) - 점 기호가 아니면 -1 */
export function getBulletIndex(value: string): number {
  return (BULLET_SYMBOLS as readonly string[]).indexOf(value);
}

/** 번호 칸 값의 종류 - 빈 값 · null은 없음, 점 기호 하나는 점 기호, 숫자 마디 번호는 연속, 그 밖(A-1 · 가. · 3))은 직접 */
export function readNumberKind(value: string | null | undefined): NumberKind {
  if (!value) return "none";
  if (getBulletIndex(value) >= 0) return "bullet";
  return CONTINUOUS_RE.test(value) ? "continuous" : "custom";
}

function splitCounts(number: string): number[] {
  return number.replace(/\.$/, "").split(".").map(Number);
}

/**
 * 연속 번호로 채울 값 - numbers는 같은 목록 후보의 지금 번호(문서 순서), read는 그 줄이 읽은 원문 번호.
 * 그 줄 앞의 가장 가까운 연속 번호를 본다(점 기호 · 직접 번호 · 번호 없는 줄은 건너뛴다). 깊이는 그 줄이 읽은 번호의 깊이, 없으면 앞 번호의 깊이 -
 * 같은 깊이면 다음 순번(3. → 4.), 더 깊으면 앞 번호 아래 첫째(3 → 3.1), 더 얕으면 앞 번호의 그 깊이 마디 다음(3.2 → 4). 끝 점은 앞 번호를 따른다.
 * 앞에 연속 번호가 없으면 1(끝 점은 읽은 번호를 따른다).
 */
export function suggestContinuous(numbers: readonly (string | null)[], index: number, read: string | null = null): string {
  let previous: string | null = null;
  for (let at = index - 1; at >= 0; at -= 1) {
    const number = numbers[at];
    if (number && readNumberKind(number) === "continuous") {
      previous = number;
      break;
    }
  }
  const own = read !== null && readNumberKind(read) === "continuous" ? splitCounts(read) : null;
  if (previous === null) return read?.endsWith(".") ? "1." : "1";
  const counts = splitCounts(previous);
  const depth = own?.length ?? counts.length;
  const next = depth > counts.length ? [...counts, ...Array<number>(depth - counts.length).fill(1)] : [...counts.slice(0, depth - 1), counts[depth - 1] + 1];
  return next.join(".") + (previous.endsWith(".") ? "." : "");
}

/** 한 줄의 연속 번호 값 - 같은 목록 후보(listNumberSiblings - 같은 언어 · 같은 표)에서 센다. units는 용지 순서로 넘긴다 */
export function suggestUnitContinuous(units: readonly ViewUnit[], unitId: number): string | null {
  const found = listNumberSiblings(units, unitId);
  if (!found || found.index < 0) return null;
  const { siblings, index } = found;
  return suggestContinuous(
    siblings.map((unit) => unit.number?.value ?? null),
    index,
    siblings[index].number?.read ?? null,
  );
}

/** 점 기호 줄의 들여쓰기 단계 - 앞의 가장 가까운 숫자 번호 줄 깊이 + 1 + 기호 순번(• 0 · ○ 1 · ▪ 2). 번호 칸 폭(getLevelWidths)에 그대로 들어간다 */
export function getBulletLevel(previousLevel: number, symbol: string): number {
  return previousLevel + 1 + Math.max(0, getBulletIndex(symbol));
}
