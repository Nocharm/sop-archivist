// Assign Old 문장 우클릭 메뉴의 항목과 가능/불가 - 화면은 이 결과대로 항목을 켜고 끄며 까닭을 툴팁으로 보인다.
// 두 묶음이다: 배정(지금 고른 곳으로 확정·배정 취소)과 문장 고치기(여기서 나누기·앞뒤 문장과 합치기·언어).
// 고치기는 Split의 편집을 그대로 부르므로 판단이 없는 단위만 받는다 - 배정된 문장은 먼저 배정을 취소한다(서버도 판단이 걸린 단위는 확인을 요구한다).
import type { CoverStatus, ViewUnit } from "./api-sop";
import { planJoin } from "./split-menu-model";

export type AssignMenuAction = "confirm" | "clear" | "split" | "merge_prev" | "merge_next" | "lang";

export interface AssignMenuItem {
  action: AssignMenuAction;
  enabled: boolean;
  /** 꺼진 까닭의 문구 키 - 켜져 있으면 없다 */
  reasonKey?: string;
  /** 언어 줄의 지금 언어 */
  lang?: ViewUnit["lang"];
}

export interface AssignMenuGroups {
  assign: AssignMenuItem[];
  edit: AssignMenuItem[];
}

export interface AssignMenuContext {
  /** 우클릭한 문장(지금 보기의 단위) */
  target: ViewUnit;
  /** 용지 순서로 바로 앞·뒤 단위 - 없으면 null */
  prev: ViewUnit | null;
  next: ViewUnit | null;
  readOnly: boolean;
  /** 우클릭한 문장의 줄 상태 */
  rowStatus: CoverStatus;
  /** 줄에 보낼 곳이 있다(저장 전 고름 또는 저장된 곳·AI 제안) */
  hasDestination: boolean;
  /** 저장 전 고름이 없고 줄이 이미 확정됐다 - 확정할 것이 없다 */
  isConfirmedAsIs: boolean;
  /** 단위(칸 문장이면 묶인 표·행)에 판단이 있다 - 미배정이 아닌 상태나 처분 */
  isDecided: (unit: ViewUnit) => boolean;
  /** 단위의 줄에 저장 전 고름·고친 글이 있다 */
  hasDraft: (unit: ViewUnit) => boolean;
  /** 글 안에 나눌 수 있는 자리가 있다 */
  canSplit: boolean;
}

const EDITABLE_KINDS = new Set(["sentence", "heading", "cell_sentence"]);

function why(reason: string): string {
  return `assign.ctx.why.${reason}`;
}

function build(action: AssignMenuAction, reasonKey: string | null): AssignMenuItem {
  return reasonKey === null ? { action, enabled: true } : { action, enabled: false, reasonKey };
}

/** 문장 고치기를 막는 까닭 - 읽기 전용 → 글이 아님 → 판단 있음 → 저장 전 고름 순(앞의 것이 더 근본적인 까닭) */
function getEditBlocker(ctx: AssignMenuContext, unit: ViewUnit): string | null {
  if (ctx.readOnly) return why("readOnly");
  if (!EDITABLE_KINDS.has(unit.kind)) return why("notText");
  if (ctx.isDecided(unit)) return why("assigned");
  return ctx.hasDraft(unit) ? why("unsaved") : null;
}

function getMergeReason(ctx: AssignMenuContext, neighbor: ViewUnit | null): string | null {
  const own = getEditBlocker(ctx, ctx.target);
  if (own !== null) return own;
  if (neighbor === null) return why("noNeighbor");
  if (!EDITABLE_KINDS.has(neighbor.kind)) return why("neighborNotText");
  if (ctx.isDecided(neighbor)) return why("neighborAssigned");
  if (ctx.hasDraft(neighbor)) return why("neighborUnsaved");
  const plan = planJoin([ctx.target, neighbor], true);
  // 언어가 다른 두 문장은 합치지 않고 한/영 짝이 된다 - 짝 맺기는 Split에서 한다
  if (plan.kind === "pair") return why("otherLanguage");
  return plan.kind === "merge" ? null : (plan.reasonKey ?? why("cannotMerge"));
}

export function buildAssignMenu(ctx: AssignMenuContext): AssignMenuGroups {
  const confirmReason = ctx.readOnly ? why("readOnly") : !ctx.hasDestination ? why("noDestination") : ctx.isConfirmedAsIs ? why("alreadyConfirmed") : null;
  const clearReason = ctx.readOnly ? why("readOnly") : ctx.rowStatus === "unassigned" && !ctx.isDecided(ctx.target) ? why("notAssigned") : null;
  const editReason = getEditBlocker(ctx, ctx.target);
  return {
    assign: [build("confirm", confirmReason), build("clear", clearReason)],
    edit: [
      build("split", editReason ?? (ctx.canSplit ? null : why("nothingToSplit"))),
      build("merge_prev", getMergeReason(ctx, ctx.prev)),
      build("merge_next", getMergeReason(ctx, ctx.next)),
      { ...build("lang", editReason), lang: ctx.target.lang },
    ],
  };
}
