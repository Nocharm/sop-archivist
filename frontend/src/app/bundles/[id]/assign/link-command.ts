// 단추 줄의 잇기에 실을 값 - 누른 New 박스의 문장(짝까지 편다)과 마지막 박스의 손질 네 개. 화면 훅(use-assign-page)이 고름에서 부른다.
import type { WrittenSentence } from "@/lib/api-sop";
import { addPartnerTargets } from "@/lib/assign-model";
import type { AssignMenuAction, AssignMenuItem } from "@/lib/assign-context-menu-model";
import type { PickTool, PickToolId } from "@/lib/pick-bar-model";

/**
 * 이을 문장 - 누른 것이 모두 이미 그 줄에 이어져 있으면 끊을 것(누른 것과 그 짝 가운데 이어진 것만), 아니면 짝까지 편다(addPartnerTargets).
 * 이미 이은 문장의 짝을 전에 Ctrl로 뺐으면 끊기가 그 짝을 다시 붙이지 않게
 */
export function readLinkTargets(pressed: readonly number[], saved: readonly number[], written: Map<number, WrittenSentence>): number[] {
  if (pressed.length > 0 && pressed.every((id) => saved.includes(id))) {
    const partners = pressed.map((id) => written.get(id)?.partner_target_id ?? null).filter((id): id is number => id !== null && saved.includes(id));
    return [...new Set([...pressed, ...partners])];
  }
  return addPartnerTargets([...pressed], written);
}

/** 손질 단추가 하는 일 - 한/영 짝은 앞 · 뒤 · 고르기 가운데 되는 것, 이미 짝이면 풀기 */
const PAIR_ACTIONS: readonly AssignMenuAction[] = ["pair_prev", "pair_next", "pair_pick", "unpair"];
const TOOL_ACTIONS: Record<PickToolId, readonly AssignMenuAction[]> = { split: ["split"], merge_prev: ["merge_prev"], merge_next: ["merge_next"], pair: PAIR_ACTIONS };
const MISSING_KEYS: Record<PickToolId, string> = { split: "assign.ctx.why.nothingToSplit", merge_prev: "assign.ctx.why.noNeighbor", merge_next: "assign.ctx.why.noNeighbor", pair: "assign.key.why.noPair" };

/** 손질 넷과 각각 할 일 - 다듬기 메뉴(buildUnitMenu의 edit)에서 고른다. 되는 것이 없으면 첫 항목의 까닭, 항목이 없으면 정한 까닭 */
export function readPickTools(items: readonly AssignMenuItem[]): Array<PickTool & { action: AssignMenuAction | null }> {
  return (Object.keys(TOOL_ACTIONS) as PickToolId[]).map((id) => {
    const found = TOOL_ACTIONS[id].flatMap((action) => items.filter((item) => item.action === action));
    const item = found.find((candidate) => candidate.enabled) ?? found[0];
    if (!item) return { id, reasonKey: MISSING_KEYS[id], action: null };
    return { id, reasonKey: item.enabled ? null : (item.reasonKey ?? MISSING_KEYS[id]), action: item.action };
  });
}
