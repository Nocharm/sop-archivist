// Assign 놓인 New 문장 잇기(MD 2 S3의 일부) - 아직 안 쓴 문서에 사람이 확정해 놓은 문장에 고른 Old 줄을 출처로 더하는 때(Old 2줄 → New 1문장)와,
// 저장 응답으로 엮은 문서를 미리 고치는 법을 정한다. 저장 요청은 classify-model buildGroupSave의 join 갈래가 만든다.
import type { ComposedDoc, ComposedItem } from "./api-sop";

/** 고른 Old 줄의 글 단위 - id와 언어. 표·그림 줄은 글 단위가 없어 잇지 못한다 */
export interface JoinRowUnit {
  id: number;
  lang: string;
}

/** 이 문장에 고른 줄을 잇을 수 있나 - 사람이 확정한 출처 있는 문장이고, 줄에 같은 언어 글 단위가 있고, 그 줄이 이미 출처가 아닐 때 */
export function isJoinable(item: Pick<ComposedItem, "kind" | "status" | "lang" | "source_unit_ids">, rowUnits: readonly JoinRowUnit[]): boolean {
  if (item.kind !== "sentence" || item.status !== "confirmed" || item.source_unit_ids.length === 0) return false;
  if (!rowUnits.some((unit) => unit.lang === item.lang)) return false;
  return rowUnits.some((unit) => !item.source_unit_ids.includes(unit.id));
}

/** 엮은 문서에서 줄을 이을 수 있는 문장들(target id) - 고른 줄이 없거나 잇을 수 없는 때(편집 권한 없음 등)는 빈 집합 */
export function listJoinableIds(doc: ComposedDoc | null, rowUnits: readonly JoinRowUnit[], isEnabled: boolean): Set<number> {
  const ids = new Set<number>();
  if (!doc || !isEnabled || rowUnits.length === 0) return ids;
  for (const section of doc.sections) for (const item of section.items) if (isJoinable(item, rowUnits)) ids.add(item.target_id);
  return ids;
}

/** 잇고 나면 한 문장에 든 Old 줄 수 - 그 문장의 출처 단위가 든 줄(줄 키)과 고른 줄을 중복 없이 센다. 줄을 모르는 단위는 단위 하나가 줄 하나 */
export function countJoinedLines(sourceUnitIds: readonly number[], pickedRowKey: string, rowKeyOf: (unitId: number) => string | undefined): number {
  return new Set([pickedRowKey, ...sourceUnitIds.map((id) => rowKeyOf(id) ?? `u${id}`)]).size;
}

/** 저장 응답으로 미리 고친 문서 - 그 문장의 출처 단위만 늘리고 종류는 합침으로(번호·자리·글은 그대로 - 곧 다시 읽는 서버 값이 맞춘다) */
export function applyJoinedSources(doc: ComposedDoc, targetId: number, unitIds: readonly number[]): ComposedDoc {
  return {
    ...doc,
    sections: doc.sections.map((section) => ({
      ...section,
      items: section.items.map((item) => (item.target_id === targetId ? { ...item, change_type: "merged" as const, source_unit_ids: [...new Set([...item.source_unit_ids, ...unitIds])] } : item)),
    })),
  };
}
