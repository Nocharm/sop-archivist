// Assign Old 문장 우클릭 메뉴의 항목과 가능/불가 - 화면은 이 결과대로 항목을 켜고 끄며 까닭을 툴팁으로 보인다.
// 두 묶음이다: 배정(지금 고른 곳으로 확정·배정 취소)과 문장 고치기(여기서 나누기·앞뒤 문장과 합치기 또는 한/영 짝 맺기·짝 풀기·언어).
// 고치기는 Split의 편집을 그대로 부르므로 판단이 없는 단위만 받는다 - 배정된 문장은 먼저 배정을 취소한다(서버도 판단이 걸린 단위는 확인을 요구한다).
import type { CoverStatus, ViewUnit } from "./api-sop";
import { getPairMergeReason, hasBothScripts, planJoin, type JoinPlan } from "./split-menu-model";

export type AssignMenuAction =
  | "confirm" | "clear"
  | "split" | "merge_prev" | "merge_next" | "pair_prev" | "pair_next" | "pair_pick" | "unpair" | "lang"
  | "ref_mark" | "ref_clear"
  | "table_rows" | "table_merge" | "table_layout";

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
  /** 우클릭한 것이 든 표(또는 행) 단위 - 표·행 단위를 직접 눌렀으면 그 단위, 표 밖이면 null */
  table: ViewUnit | null;
  /** 그 표의 행 단위 전부(행으로 나눈 표일 때) - 다시 합치려면 모든 행에 판단이 없어야 한다 */
  tableRows?: readonly ViewUnit[];
}

const EDITABLE_KINDS = new Set(["sentence", "heading", "cell_sentence"]);

function why(reason: string): string {
  return `assign.ctx.why.${reason}`;
}

function build(action: AssignMenuAction, reasonKey: string | null): AssignMenuItem {
  return reasonKey === null ? { action, enabled: true } : { action, enabled: false, reasonKey };
}

/**
 * 문장을 새 문장으로 바꾸는 고치기(자르기·합치기)를 막는 까닭 - 읽기 전용 → 글이 아님 → 저장 전 고름 순(앞의 것이 더 근본적인 까닭).
 * 배정이 있어도 막지 않는다: 서버가 409 confirm_required로 묻고, 화면이 확인을 받아 배정을 풀며 고친다(설계 2026-11-15 §3.5).
 */
function getRetireBlocker(ctx: AssignMenuContext, unit: ViewUnit): string | null {
  if (ctx.readOnly) return why("readOnly");
  if (!EDITABLE_KINDS.has(unit.kind)) return why("notText");
  return ctx.hasDraft(unit) ? why("unsaved") : null;
}

/** 문장을 제자리에서 바꾸는 고치기(언어·짝·참조)를 막는 까닭 - 위에 더해 판단이 있으면 막는다(서버가 묻지 않고 거절한다) */
function getEditBlocker(ctx: AssignMenuContext, unit: ViewUnit): string | null {
  if (ctx.readOnly) return why("readOnly");
  if (!EDITABLE_KINDS.has(unit.kind)) return why("notText");
  if (ctx.isDecided(unit)) return why("assigned");
  return ctx.hasDraft(unit) ? why("unsaved") : null;
}

/** 한글 문장과 영어 문장인가 - 이런 이웃은 합치지 않고 한/영 짝으로 맺는다 */
function isOtherLanguage(a: ViewUnit, b: ViewUnit): boolean {
  return (a.lang === "ko" && b.lang === "en") || (a.lang === "en" && b.lang === "ko");
}

/** 앞(뒤) 문장과 묶는 항목 하나 - 같은 언어면 합치기, 한글·영어면 짝 맺기. 묶는 규칙은 Split과 같다(planJoin) */
function buildJoin(ctx: AssignMenuContext, neighbor: ViewUnit | null, side: "prev" | "next"): AssignMenuItem {
  const isPair = neighbor !== null && isOtherLanguage(ctx.target, neighbor);
  const action: AssignMenuAction = isPair ? `pair_${side}` : `merge_${side}`;
  // 합치기는 두 문장을 새 문장 하나로 바꾸니 배정이 있어도 묻고 한다. 짝은 제자리에서 맺어 배정이 있으면 막는다
  const own = isPair ? getEditBlocker(ctx, ctx.target) : getRetireBlocker(ctx, ctx.target);
  if (own !== null) return build(action, own);
  if (neighbor === null) return build(action, why("noNeighbor"));
  if (!EDITABLE_KINDS.has(neighbor.kind)) return build(action, why("neighborNotText"));
  if (isPair && ctx.isDecided(neighbor)) return build(action, why("neighborAssigned"));
  if (ctx.hasDraft(neighbor)) return build(action, why("neighborUnsaved"));
  const plan = planJoin([ctx.target, neighbor], true);
  return build(action, plan.kind === (isPair ? "pair" : "merge") ? null : (plan.reasonKey ?? why("cannotMerge")));
}

/** 참조 줄 항목 - 참조도 제안도 아닌 글에는 "참조 줄로 표시", 그 밖에는 "참조 아님". 제안을 물리는 것은 언어를 바꾸지 않아 배정이 있어도 된다 */
function buildRefItem(ctx: AssignMenuContext, editReason: string | null): AssignMenuItem {
  const { ref } = ctx.target;
  if (ref === null) return build("ref_mark", editReason);
  return build("ref_clear", ref.state === "proposed" ? (ctx.readOnly ? why("readOnly") : null) : editReason);
}

/** 표 항목 - 통째인 표는 행으로 나누거나 레이아웃 표로 바꾸고, 행으로 나눈 표는 다시 합친다. 저장 전 고름이 있으면 잠근다(배정이 있으면 묻고 한다) */
function buildTableItems(ctx: AssignMenuContext): AssignMenuItem[] {
  const { table } = ctx;
  if (table === null) return [];
  const blocker = ctx.readOnly ? why("readOnly") : ctx.hasDraft(table) ? why("unsaved") : null;
  if (table.kind === "table") return [build("table_rows", blocker), build("table_layout", blocker)];
  // 행을 다시 합치면 모든 행이 한 단위가 된다 - 다른 행에 판단이나 저장 전 고름이 있어도 못 합친다(서버도 거절한다)
  const others = (ctx.tableRows ?? []).filter((row) => row.id !== table.id);
  const rowBlocker = others.some((row) => ctx.isDecided(row)) ? why("rowAssigned") : others.some((row) => ctx.hasDraft(row)) ? why("rowUnsaved") : null;
  return [build("table_merge", blocker ?? rowBlocker)];
}

export function buildAssignMenu(ctx: AssignMenuContext): AssignMenuGroups {
  const confirmReason = ctx.readOnly ? why("readOnly") : !ctx.hasDestination ? why("noDestination") : ctx.isConfirmedAsIs ? why("alreadyConfirmed") : null;
  const clearReason = ctx.readOnly ? why("readOnly") : ctx.rowStatus === "unassigned" && !ctx.isDecided(ctx.target) ? why("notAssigned") : null;
  const editReason = getEditBlocker(ctx, ctx.target);
  const retireReason = getRetireBlocker(ctx, ctx.target);
  return {
    assign: [build("confirm", confirmReason), build("clear", clearReason)],
    // 표·행 단위에는 문장 항목이 뜻이 없어 표 항목만 둔다
    edit: ctx.target.kind === "table" || ctx.target.kind === "table_row" ? buildTableItems(ctx) : [
      build("split", retireReason ?? (ctx.canSplit ? null : why("nothingToSplit"))),
      buildJoin(ctx, ctx.prev, "prev"),
      buildJoin(ctx, ctx.next, "next"),
      // 떨어져 있는 문장과 짝 맺기 - 짝이 없는 한글·영어 문장에서만. 누르면 다른 문장을 하나 고른다
      ...(ctx.target.pair_id === null && (ctx.target.lang === "ko" || ctx.target.lang === "en") ? [build("pair_pick", editReason)] : []),
      // 짝 풀기는 짝인 문장에서만 보인다
      ...(ctx.target.pair_id !== null ? [build("unpair", editReason)] : []),
      // 참조 줄은 언어가 없다 - 언어를 주려면 먼저 "참조 아님"으로 돌린다
      { ...build("lang", editReason ?? (ctx.target.lang === "ref" ? why("refLang") : null)), lang: ctx.target.lang },
      buildRefItem(ctx, editReason),
      ...buildTableItems(ctx),
    ],
  };
}

/**
 * 조각 사이 붙이기 단추의 계획 - 묶는 규칙은 원문 고치기와 같고(planJoin) Assign의 막는 까닭을 더한다:
 * 저장 전 고름이 있는 문장은 막고, 한/영 짝은 배정이 있으면 막는다(합치기는 서버가 묻고 배정을 풀어 준다).
 */
export function planAssignJoin(first: ViewUnit | undefined, second: ViewUnit | undefined, state: Pick<AssignMenuContext, "isDecided" | "hasDraft">): JoinPlan {
  if (first === undefined || second === undefined) return { kind: null };
  if (state.hasDraft(first) || state.hasDraft(second)) return { kind: null, reasonKey: why("unsaved") };
  const plan = planJoin([first, second], true);
  if (plan.kind === "pair" && (state.isDecided(first) || state.isDecided(second))) return { kind: null, reasonKey: why("assigned") };
  return plan;
}

export interface ShapeMode {
  /** 고른 줄의 지금 모양 - 합친 한 문장 또는 한/영 짝 */
  current: "one" | "pair";
  /** 다른 모양으로 바꿀 수 없는 까닭의 문구 키 - 바꿀 수 있으면 null */
  reasonKey: string | null;
}

/**
 * 오른쪽 칸 다듬기의 `One sentence | KO/EN pair` - 고른 줄이 한/영 짝이면 한 문장으로 합칠 수 있고, 합친 한 문장이면 풀어서 짝으로 맺을 수 있다.
 * 둘 다 아닌 줄(합친 적 없는 한 문장, 표)은 null - 전환을 보이지 않는다. 배정이 있어도 막지 않는다(합치기·풀기는 서버가 묻고 배정을 풀어 준다).
 */
export function planShapeMode(units: readonly ViewUnit[], order: readonly number[], hasDraft: (unit: ViewUnit) => boolean): ShapeMode | null {
  const pairId = units[0]?.pair_id ?? null;
  const isPair = units.length > 1 && pairId !== null && units.every((unit) => unit.pair_id === pairId);
  if (!isPair && !(units.length === 1 && units[0].can_unmerge)) return null;
  const current = isPair ? "pair" : "one";
  if (units.some(hasDraft)) return { current, reasonKey: why("unsaved") };
  if (isPair) return { current, reasonKey: getPairMergeReason([...units], order) };
  // 풀어서 짝이 되려면 한글과 라틴 글자가 모두 있어야 한다
  return { current, reasonKey: hasBothScripts(units[0].text) ? null : "split.menu.why.oneLanguage" };
}
