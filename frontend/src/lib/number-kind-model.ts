// 번호 칸 종류의 순수 모델(시안 2 D1) - 종류는 저장하지 않고 번호 칸 값에서 읽는다(새 열 없음). 연속 번호 세기 · 점 기호 줄의 들여쓰기 단계.
// 연속 값은 프런트 전용이다 - 저장되는 것은 사람이 확인한 글이라 서버 사본이 필요 없다.

import type { ViewUnit } from "./api-sop";
import { listSuggestSiblings } from "./number-model";
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

/** 그 줄 앞의 가장 가까운 연속 번호(점 기호 · 직접 번호 · 번호 없는 줄은 건너뛴다) - 없으면 null */
function findPreviousContinuous(numbers: readonly (string | null)[], index: number): string | null {
  for (let at = index - 1; at >= 0; at -= 1) {
    const number = numbers[at];
    if (number && readNumberKind(number) === "continuous") return number;
  }
  return null;
}

/** 앞 번호 다음으로 depth 깊이의 번호 - 같은 깊이면 다음 순번(3. → 4.), 더 깊으면 앞 번호 아래 첫째(3 → 3.1), 더 얕으면 앞 번호의 그 깊이 마디 다음(3.2 → 4). 끝 점은 앞 번호를 따른다 */
function buildNextAt(previous: string, depth: number): string {
  const counts = splitCounts(previous);
  const next = depth > counts.length ? [...counts, ...Array<number>(depth - counts.length).fill(1)] : [...counts.slice(0, depth - 1), counts[depth - 1] + 1];
  return next.join(".") + (previous.endsWith(".") ? "." : "");
}

/**
 * 연속 번호로 채울 값 - numbers는 같은 목록 후보의 지금 번호(문서 순서), read는 그 줄이 읽은 원문 번호.
 * 그 줄 앞의 가장 가까운 연속 번호 다음(buildNextAt). 깊이는 그 줄이 읽은 번호의 깊이, 없으면 앞 번호의 깊이.
 * 앞에 연속 번호가 없으면 1(끝 점은 읽은 번호를 따른다).
 */
export function suggestContinuous(numbers: readonly (string | null)[], index: number, read: string | null = null): string {
  const previous = findPreviousContinuous(numbers, index);
  if (previous === null) return read?.endsWith(".") ? "1." : "1";
  const own = read !== null && readNumberKind(read) === "continuous" ? splitCounts(read) : null;
  return buildNextAt(previous, own?.length ?? splitCounts(previous).length);
}

/**
 * 번호 칸 창의 ◀ ▶(B8 7-c) - 지금 입력한 번호(current)를 한 단계 얕게(-1) · 깊게(+1) 바꾼 값. 앞의 가장 가까운 연속 번호 다음으로 센다
 * (위가 "5"면 ▶ "5.1", 위가 "5.1"이면 "5.2", ◀ "5.1" → 위 "5" 다음 "6"). 맨 위 단계의 ◀, 위 번호 깊이 + 1을 넘는 ▶(두 단계 이상 뛰기),
 * 앞 번호가 없거나 current가 연속 번호가 아니면 null(단추를 끈다)
 */
export function stepContinuous(numbers: readonly (string | null)[], index: number, current: string, delta: -1 | 1): string | null {
  if (readNumberKind(current) !== "continuous") return null;
  const previous = findPreviousContinuous(numbers, index);
  const depth = splitCounts(current).length + delta;
  if (previous === null || depth < 1 || depth > splitCounts(previous).length + 1) return null;
  return buildNextAt(previous, depth);
}

/** 한 줄의 연속 번호 값 - 문서 차례로 위의 번호에서 센다(listSuggestSiblings - 같은 언어, 표 경계 무시: 제목 "5" 아래 벗긴 표의 줄은 "6"). units는 용지 순서로 넘긴다 */
export function suggestUnitContinuous(units: readonly ViewUnit[], unitId: number): string | null {
  const found = listSuggestSiblings(units, unitId);
  if (!found || found.index < 0) return null;
  const { siblings, index } = found;
  return suggestContinuous(
    siblings.map((unit) => unit.number?.value ?? null),
    index,
    siblings[index].number?.read ?? null,
  );
}

/** 한 줄의 번호를 한 단계 얕게 · 깊게(stepContinuous) - 후보는 suggestUnitContinuous와 같다 */
export function stepUnitContinuous(units: readonly ViewUnit[], unitId: number, current: string, delta: -1 | 1): string | null {
  const found = listSuggestSiblings(units, unitId);
  if (!found || found.index < 0) return null;
  return stepContinuous(
    found.siblings.map((unit) => unit.number?.value ?? null),
    found.index,
    current.trim(),
    delta,
  );
}

/** 점 기호 줄의 들여쓰기 단계 - 앞의 가장 가까운 숫자 번호 줄 깊이 + 1 + 기호 순번(• 0 · ○ 1 · ▪ 2). 번호 칸 폭(getLevelWidths)에 그대로 들어간다 */
export function getBulletLevel(previousLevel: number, symbol: string): number {
  return previousLevel + 1 + Math.max(0, getBulletIndex(symbol));
}
