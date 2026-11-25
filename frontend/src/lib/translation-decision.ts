// 남은 번역(확정하지 않은 AI 번역 · 보류로 돌아간 번역)의 확정 · 지우기 저장 - 검토 요청을 막는 것이라 새 번역을 숨긴 동안에도 Assign에서 정한다(쪼개기 먼저 설계 §5 H5).
// 오른쪽 칸(고른 줄의 것 모두)과 묶음의 남은 번역 목록(하나씩)이 같은 것을 쓴다.

import type { Group, GroupSaveInput, OpenTranslation } from "./api-sop";
import { echoTarget } from "./classify-model";

const isCellTranslation = (item: OpenTranslation) => item.parent_target_id !== null;

/** 그 줄의 남은 번역 - 칸 번역은 표 줄의 것이고, 출처가 은퇴한 번역은 어느 줄에도 없다 */
export function listRowTranslations(items: readonly OpenTranslation[], rowUnitIds: readonly number[]): OpenTranslation[] {
  return items.filter((item) => item.row_unit_id !== null && rowUnitIds.includes(item.row_unit_id));
}

/**
 * 여기서 정할 수 없는가 - 칸 번역은 서버가 닫힌 표 묶음 전체를 받아 되보낸 것도 모두 확정으로 쓴다.
 * 그래서 이 번역들 밖의 단위나 새 문장 하나라도 확정 전이면 막는다(남의 줄을 함께 확정하지 않는다). 문장 번역은 저만 저장해 막지 않는다
 */
export function isTranslationBlocked(items: readonly OpenTranslation[], group: Group): boolean {
  if (!items.some(isCellTranslation)) return false;
  const ids = new Set(items.map((item) => item.id));
  return group.units.some((unit) => unit.decision.status !== "confirmed") || group.targets.some((target) => target.status !== "confirmed" && !ids.has(target.id));
}

/**
 * 번역들을 한 번에 확정하거나 지우는 저장. 문장 번역은 묶음이 저 하나라 그것만 보낸다 - 줄의 판단(누가 언제 확정했는지)을 다시 쓰지 않는다.
 * 출처가 없는 번역(can_confirm 거짓)은 확정하지 않고 지우기만 한다. 지울 번역은 본 revision을 함께 보내 그 사이 남이 고친 것을 지우지 않는다.
 * 칸 번역이 있으면 group(칸 번역으로 방금 읽은 표 묶음) 전체를 지금 그대로 함께 되보낸다(서버는 닫힌 묶음만 받는다).
 * 할 것이 없거나, 묶음이 없거나, 여기서 정할 수 없으면(isTranslationBlocked) null
 */
export function buildTranslationDecision(items: readonly OpenTranslation[], group: Group | null, action: "confirm" | "remove"): GroupSaveInput | null {
  const acting = action === "confirm" ? items.filter((item) => item.can_confirm) : items;
  if (acting.length === 0) return null;
  const closure = acting.some(isCellTranslation) ? group : { units: [], targets: [] };
  if (closure === null || isTranslationBlocked(acting, closure)) return null;
  const grouped = new Set(closure.targets.map((target) => target.id));
  if (acting.some((item) => isCellTranslation(item) && !grouped.has(item.id))) return null;
  const removed = new Set(action === "remove" ? acting.map((item) => item.id) : []);
  const alone = acting.filter((item) => !grouped.has(item.id) && !removed.has(item.id));
  return {
    action: "confirm",
    hold_reason: "",
    units: closure.units.map(({ unit_id, decision }) => ({ unit_id, revision: decision.revision, disposition: decision.disposition, move_target_code: decision.move_target_code, reason: decision.reason })),
    targets: [
      ...closure.targets.filter((target) => !removed.has(target.id)).map((target) => echoTarget(target)),
      ...alone.map((item) => ({ key: `t${item.id}`, id: item.id, revision: item.revision, kind: "sentence" as const, source_unit_ids: [] })),
    ],
    removed_target_ids: [...removed],
    removed_revisions: Object.fromEntries(acting.filter((item) => removed.has(item.id)).map((item) => [item.id, item.revision])),
  };
}
