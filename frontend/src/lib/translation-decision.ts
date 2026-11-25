// 남은 번역 줄(확정하지 않은 AI 번역 · 보류로 돌아간 번역)의 확정 · 지우기 저장 - 검토 요청을 막는 줄이라 새 번역을 숨긴 동안에도 오른쪽 칸에서 정한다(쪼개기 먼저 설계 §5 H5).

import type { Group, GroupSaveInput, GroupTarget } from "./api-sop";
import { echoTarget } from "./classify-model";

/** 묶음 · 짝에 실린 번역 전부 - 칸 번역은 targets에, 문장 번역은 translations에 온다 */
function listTranslations(group: Group): GroupTarget[] {
  return [...group.targets.filter((target) => target.origin === "translation"), ...(group.translations ?? [])];
}

/** 줄의 단위(표면 칸 문장까지)에서 옮긴, 아직 확정하지 않은 번역 */
export function listOpenTranslations(group: Group | null, rowUnitIds: readonly number[]): GroupTarget[] {
  if (group === null) return [];
  const unitIds = new Set(group.units.filter((unit) => rowUnitIds.includes(unit.unit_id)).flatMap((unit) => [unit.unit_id, ...unit.cell_unit_ids]));
  return listTranslations(group).filter((target) => target.status !== "confirmed" && target.translation_source_unit_id !== null && unitIds.has(target.translation_source_unit_id));
}

/**
 * 줄의 남은 번역을 한 번에 확정하거나 지우는 저장. 문장 번역은 묶음이 저 하나라 그것만 보낸다 - 줄의 판단(누가 언제 확정했는지)을 다시 쓰지 않는다.
 * 칸 번역이 있으면 표 묶음 전체를 지금 그대로 함께 되보낸다(서버는 닫힌 묶음만 받는다). 남은 번역이 없으면 null
 */
export function buildTranslationDecision(group: Group | null, rowUnitIds: readonly number[], action: "confirm" | "remove"): GroupSaveInput | null {
  const open = listOpenTranslations(group, rowUnitIds);
  if (group === null || open.length === 0) return null;
  const removed = new Set(action === "remove" ? open.map((target) => target.id) : []);
  const isCell = open.some((target) => target.parent_target_id !== null);
  const cellUnits = new Set(group.units.flatMap((unit) => unit.cell_unit_ids));
  const units = isCell ? group.units.filter((unit) => !cellUnits.has(unit.unit_id)) : [];
  const grouped = new Set(isCell ? group.targets.map((target) => target.id) : []);
  const echoed = [...(isCell ? group.targets : []), ...open.filter((target) => !grouped.has(target.id))];
  return {
    action: "confirm",
    hold_reason: "",
    units: units.map(({ unit_id, decision }) => ({ unit_id, revision: decision.revision, disposition: decision.disposition, move_target_code: decision.move_target_code, reason: decision.reason })),
    targets: echoed.filter((target) => !removed.has(target.id)).map((target) => echoTarget(target)),
    removed_target_ids: [...removed],
  };
}
