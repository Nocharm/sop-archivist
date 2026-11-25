// Assign의 다시 읽기를 모은다 - 큐가 도는 동안 저장마다 다시 읽지 않고, 걸린 것을 합쳐 두었다가 큐가 비면 한 번에 받는다(A1-R6).
// 장벽은 그 문서 보기만 곧바로 받고(splitReload) 나머지는 여기 모은다.

import type { ReloadPlan } from "./assign-focus-model";

/** 다시 받을 문서 - 번호 목록 또는 모두 */
type DocSet = readonly number[] | "all";

export interface ReloadAsk {
  /** Old 문서 보기 */
  docs: DocSet;
  /** Unit 줄을 받을 문서(비었으면 받지 않는다) */
  units: DocSet;
  /** 한 단으로 연 New 문서 보기 */
  solo: boolean;
  /** 판단이 바꾸는 목록 모두(To-Be · New 문장 · 같은 글자 · 제안) */
  lists: boolean;
  /** 편집이 바꾼 목록만 하나씩 */
  tobe: boolean;
  written: boolean;
  identical: boolean;
  split: boolean;
  bundle: boolean;
}

export const NO_RELOAD_ASK: ReloadAsk = { docs: [], units: [], solo: false, lists: false, tobe: false, written: false, identical: false, split: false, bundle: false };

function mergeDocs(a: DocSet, b: DocSet): DocSet {
  return a === "all" || b === "all" ? "all" : [...new Set([...a, ...b])];
}

export function mergeReloads(a: ReloadAsk, b: ReloadAsk): ReloadAsk {
  return {
    docs: mergeDocs(a.docs, b.docs),
    units: mergeDocs(a.units, b.units),
    solo: a.solo || b.solo,
    lists: a.lists || b.lists,
    tobe: a.tobe || b.tobe,
    written: a.written || b.written,
    identical: a.identical || b.identical,
    split: a.split || b.split,
    bundle: a.bundle || b.bundle,
  };
}

export function isDocReload(ask: Pick<ReloadAsk, "docs" | "units">): boolean {
  return ask.docs === "all" || ask.docs.length > 0 || ask.units === "all" || ask.units.length > 0;
}

export function isEmptyReload(ask: ReloadAsk): boolean {
  return !isDocReload(ask) && !(ask.solo || ask.lists || ask.tobe || ask.written || ask.identical || ask.split || ask.bundle);
}

/** 편집 뒤 다시 받을 것(planReload) → 모을 것. Old 문서가 아닌 문서(한 단으로 연 New 문서)는 그 보기와, Unit이 바뀌는 편집이면 New 문장 · To-Be도 */
export function buildReloadAsk(plan: ReloadPlan, oldDocIds: readonly number[]): ReloadAsk {
  const docs = plan.docs === "all" ? "all" : plan.docs.filter((id) => oldDocIds.includes(id));
  const isNewDoc = docs !== "all" && docs.length < plan.docs.length;
  return {
    ...NO_RELOAD_ASK,
    docs,
    units: plan.units ? docs : [],
    solo: plan.newDoc !== null || isNewDoc,
    tobe: plan.tobe || (isNewDoc && plan.units),
    written: plan.written || (isNewDoc && plan.units),
    identical: plan.identical,
    split: plan.splitSuggestions !== null,
    bundle: plan.bundle,
  };
}

/** 장벽이 기다리는 것(문서 보기 · 그 줄)과 큐가 빌 때까지 모을 것 */
export function splitReload(ask: ReloadAsk): { views: Pick<ReloadAsk, "docs" | "units" | "solo">; rest: ReloadAsk } {
  return { views: { docs: ask.docs, units: ask.units, solo: ask.solo }, rest: { ...ask, docs: [], units: [], solo: false } };
}
