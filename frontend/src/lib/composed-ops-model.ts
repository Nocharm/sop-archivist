// 빈 템플릿(엮은 New) 용지 위 나누기 · 합치기 · 짝(시안 2 확인할 것 5, 스텝 8) - Old 용지와 같은 손짓을 새 문장의 묶음 저장으로 옮긴다.
// 나누기 = 그 새 문장은 앞 글, 바로 뒤에 같은 출처의 새 문장(뒤 글). 합치기 = 위 문장에 아래 글 · 출처를 더하고 아래 문장은 지운다.
// 변경 종류(나눔 · 합침 · 수정)는 서버가 정한다. 짝은 Old 짝(createPair)이라 여기서는 고르기만 한다.
import type { ComposedItem, Group, GroupSaveInput, TargetInput, ViewUnit } from "./api-sop";
import { echoTarget } from "./classify-model";
import { planJoin, type JoinPlan } from "./split-menu-model";

/** 손짓이 닿는 박스 - Old 줄에서 온 문장. 번역은 원문 문장을 따르고, 표 · 그림 · 출처 없는 줄은 Old 줄이 없다 */
export function canEditComposed(item: Pick<ComposedItem, "kind" | "source_unit_ids" | "change_type">): boolean {
  return item.kind === "sentence" && item.source_unit_ids.length > 0 && item.change_type !== "translated";
}

/** 나눌 수 있는 자리인가 - 앞뒤 모두 빈칸 아닌 글이 남는다 */
export function canCutComposed(text: string, at: number): boolean {
  return at > 0 && at < text.length && text.slice(0, at).trim().length > 0 && text.slice(at).trim().length > 0;
}

/** at에서 가장 가까운 나눌 자리(같으면 앞쪽), 없으면 null - 두 번 누른 자리와 끄는 자리를 이리로 맞춘다 */
export function findComposedCut(text: string, at: number): number | null {
  const start = Math.min(Math.max(at, 0), text.length);
  for (let distance = 0; distance <= text.length; distance += 1) {
    if (canCutComposed(text, start - distance)) return start - distance;
    if (canCutComposed(text, start + distance)) return start + distance;
  }
  return null;
}

/** 다음 나눌 자리(←→) - 없으면 그대로 */
export function stepComposedCut(text: string, at: number, step: 1 | -1): number {
  for (let next = at + step; next > 0 && next < text.length; next += step) if (canCutComposed(text, next)) return next;
  return at;
}

/**
 * 이웃한 두 박스의 틈 - 같은 언어면 합치기, 한/영이면 두 박스의 Old 줄을 짝으로(Old 틈과 같은 규칙 planJoin). 짝은 박스마다 Old 줄이
 * 하나이고 그 줄이 지금 연 Old 문서에 있을 때만(findUnit이 그 문서의 단위를 찾는다).
 */
export function planComposedJoin(upper: ComposedItem, lower: ComposedItem, findUnit: (unitId: number) => ViewUnit | undefined): JoinPlan {
  if (!canEditComposed(upper) || !canEditComposed(lower)) return { kind: null, reasonKey: "assign.composedOps.why.notOld" };
  if (upper.lang === lower.lang) return { kind: "merge" };
  if (upper.meaning_key !== null && upper.meaning_key === lower.meaning_key) return { kind: null, reasonKey: "split.menu.why.alreadyPaired" };
  if (upper.source_unit_ids.length !== 1 || lower.source_unit_ids.length !== 1) return { kind: null, reasonKey: "assign.composedOps.why.pairOneLine" };
  const units = [findUnit(upper.source_unit_ids[0]), findUnit(lower.source_unit_ids[0])];
  if (units.some((unit) => unit === undefined)) return { kind: null, reasonKey: "assign.composedOps.why.pairOtherDoc" };
  return planJoin(units as ViewUnit[], false);
}

/** 묶음의 단위를 지금 판단 그대로 - 아직 보낼 곳 없는 판단(AI 제안 줄)은 이 박스가 곧 보낸 곳이라 배정으로 확정한다 */
function echoUnits(group: Group): GroupSaveInput["units"] {
  const cellUnits = new Set(group.units.flatMap((unit) => unit.cell_unit_ids));
  return group.units
    .filter((unit) => !cellUnits.has(unit.unit_id))
    .map((unit) => ({
      unit_id: unit.unit_id,
      revision: unit.decision.revision,
      disposition: unit.decision.disposition === "unassigned" ? "assigned" : unit.decision.disposition,
      move_target_code: unit.decision.move_target_code,
      reason: unit.decision.reason,
    }));
}

/** 박스 하나를 at에서 둘로 - text는 화면의 그 박스 글(AI 제안 줄이면 AI 글) */
export function buildComposedSplit(group: Group, targetId: number, text: string, at: number): GroupSaveInput {
  const own = group.targets.find((target) => target.id === targetId);
  if (!own) throw new Error(`target ${targetId} is not in the group`);
  const place = { target_doc_id: own.target_doc_id, slot_key: own.slot_key, wi_step: own.wi_step, wi_part: own.wi_part };
  const targets: TargetInput[] = group.targets.map((target) => (target.id === targetId ? { ...echoTarget(target), lang: target.lang, text: text.slice(0, at).trim() } : echoTarget(target)));
  targets.push({ key: "split", ...place, kind: "sentence", lang: own.lang, text: text.slice(at).trim(), source_unit_ids: own.source_unit_ids, position: { after_target_id: targetId } });
  return { action: "confirm", hold_reason: "", units: echoUnits(group), targets, removed_target_ids: [] };
}

/** 이웃한 두 박스를 하나로 - 위 글 + 공백 + 아래 글, 출처는 둘을 합친 것, 아래 문장의 Remark는 위 Remark 뒤에 줄을 바꿔 */
export function buildComposedMerge(group: Group, upper: { id: number; text: string }, lower: { id: number; text: string }): GroupSaveInput {
  const top = group.targets.find((target) => target.id === upper.id);
  const bottom = group.targets.find((target) => target.id === lower.id);
  if (!top || !bottom) throw new Error(`targets ${upper.id} and ${lower.id} must be in the group`);
  const sources = [...new Set([...top.source_unit_ids, ...bottom.source_unit_ids])];
  const remark = [top.remark, bottom.remark].map((value) => value.trim()).filter(Boolean).join("\n");
  const targets = group.targets
    .filter((target) => target.id !== lower.id)
    .map((target) => (target.id === upper.id ? { ...echoTarget(target, sources), lang: target.lang, text: `${upper.text.trim()} ${lower.text.trim()}`, remark } : echoTarget(target)));
  return { action: "confirm", hold_reason: "", units: echoUnits(group), targets, removed_target_ids: [lower.id] };
}
