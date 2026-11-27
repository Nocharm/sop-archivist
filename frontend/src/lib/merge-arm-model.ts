// ⇧J ⇧J · ⇧K ⇧K 합치기의 무장 - 첫 누름은 미리 보이기만 하고 같은 글쇠를 한 번 더 누르면 실행한다(명세 2026-11-23-assign-feedback-2 J1).
import type { JoinKind, JoinPlan } from "./split-menu-model";

/** 무장한 합치기 - fromId(고른 박스)와 그 dir쪽 이웃 toId. 시간 제한은 없다 */
export interface MergeArm {
  fromId: number;
  toId: number;
  dir: 1 | -1;
  kind: JoinKind;
}

/** key = ⇧J(dir 1) · ⇧K(dir -1) - toId는 그 쪽 이웃(없으면 null), plan은 그 둘의 planJoin 답. other = 다른 글쇠 · 클릭 · Esc */
export type ArmEvent = { type: "key"; dir: 1 | -1; fromId: number; toId: number | null; plan: JoinPlan } | { type: "other" };

/** arm = 다음 무장, run = 지금 실행할 것, refuseKey = 알릴 까닭(무장하지 않는다) */
export interface ArmResult {
  arm: MergeArm | null;
  run: MergeArm | null;
  refuseKey: string | null;
}

/** 무장 상태에서 사건 하나를 받은 다음 자리 */
export function stepMergeArm(arm: MergeArm | null, event: ArmEvent): ArmResult {
  if (event.type === "other") return { arm: null, run: null, refuseKey: null };
  if (event.toId === null) return { arm: null, run: null, refuseKey: "assign.ctx.why.noNeighbor" };
  if (event.plan.kind === null) return { arm: null, run: null, refuseKey: event.plan.reasonKey ?? "assign.ctx.why.noNeighbor" };
  const next: MergeArm = { fromId: event.fromId, toId: event.toId, dir: event.dir, kind: event.plan.kind };
  // 같은 박스에서 같은 쪽 글쇠를 다시 눌렀을 때만 실행한다 - 다른 쪽이거나 고름이 옮겨 갔으면 새로 무장한다
  const isSame = arm !== null && arm.fromId === next.fromId && arm.toId === next.toId && arm.dir === next.dir;
  return isSame ? { arm: null, run: next, refuseKey: null } : { arm: next, run: null, refuseKey: null };
}

/** 용지 순서에서 dir쪽 이웃 - 용지에 없거나 끝이면 null */
export function findJoinNeighbor(order: readonly number[], unitId: number, dir: 1 | -1): number | null {
  const at = order.indexOf(unitId);
  return at < 0 ? null : (order[at + dir] ?? null);
}
