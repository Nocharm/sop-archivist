/** Assign을 줄 하나로 여는 주소(?doc=&unit=)의 풀이 - 값은 사람이 고칠 수 있어 어떤 값이 와도 줄·문서·아무 일 없음 셋 가운데 하나로 떨어진다(설계 2026-11-17 참조 지도 §6.8) */

export type LineTarget =
  | { kind: "row"; rowKey: string; unitId: number }
  /** isGone - unit 값이 있었는데 그 문서에서 줄을 찾지 못했다(쪼개기 편집으로 사라짐·다른 문서의 Unit·수가 아님) */
  | { kind: "document"; docId: number; isGone: boolean }
  | { kind: "none" };

export interface LineParamInput {
  doc: string | null;
  unit: string | null;
  /** 이 Bundle의 읽힌 Old 문서 id */
  oldDocIds: readonly number[];
  /** Unit id → 그 Unit이 든 문서 id(원문 보기에 있는 활성 Unit만) */
  docOfUnit: (unitId: number) => number | undefined;
  /** Unit(칸 문장이면 묶인 표·행)의 줄 열쇠 */
  findRowKey: (unitId: number) => string | undefined;
}

// DB 정수 id의 꼴 - 부호·빈칸·소수·지수 표기를 받지 않는다(Number()는 " 12 "나 "1e3"도 수로 읽는다)
const ID_PATTERN = /^\d{1,10}$/;

export function resolveLineParam({ doc, unit, oldDocIds, docOfUnit, findRowKey }: LineParamInput): LineTarget {
  if (doc === null || !ID_PATTERN.test(doc)) return { kind: "none" };
  const docId = Number(doc);
  if (!oldDocIds.includes(docId)) return { kind: "none" };
  if (unit === null) return { kind: "document", docId, isGone: false };
  const unitId = ID_PATTERN.test(unit) ? Number(unit) : null;
  const rowKey = unitId !== null && docOfUnit(unitId) === docId ? findRowKey(unitId) : undefined;
  if (unitId === null || rowKey === undefined) return { kind: "document", docId, isGone: true };
  return { kind: "row", rowKey, unitId };
}
