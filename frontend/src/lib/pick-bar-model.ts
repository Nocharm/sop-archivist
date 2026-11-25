// 고름 → 박스 아래 단추 줄 · 더보기 · Enter의 뜻(쪼개기 먼저 §8). 화면 · 글쇠 · 확정 단추가 이 한 곳의 답을 함께 읽는다.
import type { PickSide } from "./doc-shape-model";

export type PickToolId = "split" | "merge_prev" | "merge_next" | "pair";

/** 손질 하나 - reasonKey가 있으면 못 하는 까닭(단추는 남고 누름은 무시된다) */
export interface PickTool {
  id: PickToolId;
  reasonKey: string | null;
}

export type PickMoreId = "show_linked" | "unlink" | "tools";

/** 잇기 단추 - result는 저장 뒤 그 Old 줄의 이음(빈 목록 = 배정 취소), isEnter면 Enter가 이 단추다 */
export interface PickLink {
  kind: "link" | "replace" | "add" | "unlink";
  rowKey: string;
  unitId: number;
  targetIds: readonly number[];
  result: readonly number[];
  reasonKey: string | null;
  isEnter: boolean;
}

export type PickEnter = { kind: "link" } | { kind: "confirm" } | { kind: "noop"; noticeKey: string } | { kind: "none" };

export interface PickBar {
  /** 단추 줄이 붙는 박스 - 마지막에 누른 쪽 */
  at: { side: PickSide; unitId: number } | null;
  link: PickLink | null;
  /** 한쪽만 골랐다 - 반대쪽에서 이을 상대를 고르기 */
  startLink: PickSide | null;
  tools: readonly PickTool[];
  more: readonly PickMoreId[];
  enter: PickEnter;
}

export interface PickBarState {
  canEdit: boolean;
  mode: "old" | "unsourced";
  /** 짝 · 캡션 고르는 중 */
  isPicking: boolean;
  /** Shift+클릭 여럿 고르기 중 */
  isMultiPick: boolean;
  /** 마지막에 누른 박스가 표 칸이다 - 칸 안은 잇기와 ⋯만 */
  isCell: boolean;
  last: PickSide | null;
  act: "pick" | "destination" | null;
  /** 보이는 Old 고름(그 줄) - savedTargetIds는 줄을 고른 즉시 아는 저장된 이음, blockKey는 확정을 막는 까닭 */
  old: { rowKey: string; unitId: number; isConfirmed: boolean; savedTargetIds: readonly number[]; blockKey: string | null } | null;
  /** 보이는 New 고름 - targetIds는 짝까지 편 New 문장, hasSources는 그 박스에 출처가 있나, whyKey는 이을 수 없는 까닭 */
  new: { unitId: number; targetIds: readonly number[]; additive: boolean; hasSources: boolean; whyKey: string | null } | null;
  /** 마지막 박스의 손질(buildUnitMenu의 edit에서) */
  tools: readonly PickTool[];
}

const NONE: PickBar = { at: null, link: null, startLink: null, tools: [], more: [], enter: { kind: "none" } };

/** 이미 이어진 둘을 다시 누르면 끊기, Ctrl로 더했으면 더해 잇기, 이음 · 판단이 있으면 바꿔 잇기 */
function readLinkKind(old: NonNullable<PickBarState["old"]>, next: NonNullable<PickBarState["new"]>): PickLink["kind"] {
  const saved = new Set(old.savedTargetIds);
  if (next.targetIds.length > 0 && next.targetIds.every((id) => saved.has(id))) return "unlink";
  if (next.additive && saved.size > 0) return "add";
  return old.isConfirmed || saved.size > 0 ? "replace" : "link";
}

function readResult(kind: PickLink["kind"], saved: readonly number[], targetIds: readonly number[]): number[] {
  if (kind === "unlink") return saved.filter((id) => !targetIds.includes(id));
  if (kind === "add") return [...saved, ...targetIds.filter((id) => !saved.includes(id))];
  return [...targetIds];
}

export function buildPickBar(state: PickBarState): PickBar {
  if (!state.canEdit || state.isPicking || state.isMultiPick || state.last === null) return NONE;
  const { old, last } = state;
  const next = state.new;
  const atUnit = last === "old" ? old?.unitId : next?.unitId;
  if (atUnit === undefined) return NONE;
  const at = { side: last, unitId: atUnit };
  const tools = state.isCell ? [] : state.tools;
  const extra: PickMoreId[] = state.isCell || state.tools.length > 0 ? ["tools"] : [];
  if (old !== null && next !== null) {
    const kind = readLinkKind(old, next);
    // 끊기는 막지 않는다 - 확정을 막는 까닭(참조 번호 · 캡션)은 잇는 쪽에만 걸린다
    const reasonKey = kind === "unlink" ? null : (old.blockKey ?? next.whyKey);
    const isPress = state.act === "pick";
    const enter: PickEnter = !isPress ? (state.mode === "old" ? { kind: "confirm" } : { kind: "none" }) : kind === "unlink" ? { kind: "noop", noticeKey: "assign.pick.alreadyLinked" } : reasonKey !== null ? { kind: "noop", noticeKey: reasonKey } : { kind: "link" };
    const link: PickLink = { kind, rowKey: old.rowKey, unitId: old.unitId, targetIds: next.targetIds, result: readResult(kind, old.savedTargetIds, next.targetIds), reasonKey, isEnter: enter.kind === "link" };
    const hasLinks = last === "old" ? old.savedTargetIds.length > 0 : next.hasSources;
    return { at, link, startLink: null, tools, more: [...(hasLinks ? (["show_linked"] as const) : []), ...extra], enter };
  }
  const hasLinks = last === "old" ? (old?.savedTargetIds.length ?? 0) > 0 : (next?.hasSources ?? false);
  const enter: PickEnter = last === "old" && state.mode === "old" ? { kind: "confirm" } : { kind: "none" };
  const more: PickMoreId[] = [...(hasLinks ? (["show_linked", "unlink"] as const) : []), ...extra];
  return { at, link: null, startLink: last === "old" ? "new" : "old", tools, more, enter };
}
