// 잇기 · 바꿔 잇기 · 더해 잇기 · 끊기를 저장 하나로(쪼개기 먼저 §8) - 단추 줄 · Enter · 끌어 놓기 · 칸 칩 ×가 모두 이것을 지난다.
// result는 저장 뒤 그 Old 줄의 이음이고, 비면 배정을 지운다(옛 linkAsSource · unlinkCell · 그 자리 메뉴의 끊기를 하나로).
import type { Group, GroupSaveInput, UnitRow } from "./api-sop";
import { mergeGroups } from "./assign-model";
import { buildGroupSave, type CellSource, type ClassifyRow } from "./classify-model";

export interface LinkRequest {
  row: Pick<ClassifyRow, "unitIds">;
  /** 그 줄의 Unit - 판단 revision은 보낼 때의 것(부르는 쪽이 앞 응답의 것으로 맞춘다) */
  units: readonly UnitRow[];
  /** 그 줄의 묶음과 result의 문장들이 든 묶음 - 보낼 때 새로 읽은 것 */
  groups: readonly Group[];
  result: readonly number[];
  reason: string;
  tables?: Map<number, { rows: number; cols: number; cells: CellSource[] }>;
}

export type LinkSave = { kind: "save"; body: GroupSaveInput; released: number[] } | { kind: "clear"; units: { unit_id: number; revision: number }[] };

export function buildLinkSave({ row, units, groups, result, reason, tables }: LinkRequest): LinkSave {
  const own = units.filter((unit) => row.unitIds.includes(unit.unit_id));
  if (result.length === 0) {
    const decided = own.filter((unit) => unit.decision.disposition !== "unassigned" || unit.status !== "unassigned");
    return { kind: "clear", units: decided.map((unit) => ({ unit_id: unit.unit_id, revision: unit.decision.revision })) };
  }
  const context = {
    units: own.map((unit) => ({ id: unit.unit_id, kind: unit.kind, lang: unit.lang, text: unit.text, content_start: unit.content_start, revision: unit.decision.revision })),
    group: mergeGroups([...groups]),
    tables: tables ?? new Map(),
  };
  const body = buildGroupSave({ destination: { kind: "link", targetIds: [...result] }, texts: {}, reason, moveCode: "" }, context, "confirm");
  return { kind: "save", body, released: body.release_unit_ids ?? [] };
}
