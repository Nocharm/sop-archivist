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

const isCellTranslation = (target: GroupTarget) => target.parent_target_id !== null;

/**
 * 남은 번역을 여기서 정할 수 없는가 - 칸 번역은 서버가 닫힌 표 묶음 전체를 받아 되보낸 것도 모두 확정으로 쓴다.
 * 그래서 이 번역들 밖의 단위나 새 문장 하나라도 확정 전이면 막는다(남의 줄을 함께 확정하지 않는다). 문장 번역은 저만 저장해 막지 않는다
 */
export function isTranslationBlocked(group: Group | null, rowUnitIds: readonly number[]): boolean {
  const open = listOpenTranslations(group, rowUnitIds);
  if (group === null || !open.some(isCellTranslation)) return false;
  const openIds = new Set(open.map((target) => target.id));
  return group.units.some((unit) => unit.decision.status !== "confirmed") || group.targets.some((target) => target.status !== "confirmed" && !openIds.has(target.id));
}

/**
 * 줄의 남은 번역을 한 번에 확정하거나 지우는 저장. 문장 번역은 묶음이 저 하나라 그것만 보낸다 - 줄의 판단(누가 언제 확정했는지)을 다시 쓰지 않는다.
 * 칸 번역이 있으면 표 묶음 전체를 지금 그대로 함께 되보낸다(서버는 닫힌 묶음만 받는다). 지울 번역은 본 revision을 함께 보내 그 사이 남이 고친 것을 지우지 않는다.
 * 남은 번역이 없거나 여기서 정할 수 없으면(isTranslationBlocked) null
 */
export function buildTranslationDecision(group: Group | null, rowUnitIds: readonly number[], action: "confirm" | "remove"): GroupSaveInput | null {
  const open = listOpenTranslations(group, rowUnitIds);
  if (group === null || open.length === 0 || isTranslationBlocked(group, rowUnitIds)) return null;
  const removing = action === "remove" ? open : [];
  const removed = new Set(removing.map((target) => target.id));
  const isCell = open.some(isCellTranslation);
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
    removed_revisions: Object.fromEntries(removing.map((target) => [target.id, target.revision])),
  };
}
