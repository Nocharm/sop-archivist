// Split 문장 우클릭 메뉴의 가능/불가 판정 - 화면은 이 결과대로 항목을 켜고 끄며 까닭을 툴팁으로 보인다.
import type { ViewUnit } from "./api-sop";
import { getMergeBlocker, type MergeBlocker } from "./paper-model";

export type SplitMenuAction = "pair" | "unpair" | "merge" | "check_both" | "check" | "split" | "ai_split" | "hold" | "lang_ko" | "lang_en";

export interface SplitMenuItem {
  action: SplitMenuAction;
  enabled: boolean;
  /** 꺼진 까닭의 문구 키 - 켜져 있으면 없다 */
  reasonKey?: string;
}

export interface SplitMenuContext {
  /** 지금 고른 문장 */
  selected: ViewUnit | null;
  /** 우클릭한 문장 */
  target: ViewUnit;
  /** 두 문장이 위아래로 이웃하다(용지 순서) */
  adjacent: boolean;
  readOnly: boolean;
  aiEnabled: boolean;
  /** 경계 확인 여부(화면이 먼저 칠한 것까지) - 없으면 서버 값 */
  isChecked?: (unit: ViewUnit) => boolean;
  /** 우클릭한 문장에 나눌 선이 놓여 있다 */
  hasCut?: boolean;
  /** 우클릭한 문장이 이미 판단을 받았다(보류는 판단 전 단위만) */
  isDecided?: boolean;
}

/** 합칠 수 없는 까닭 → 기존 합치기 단추 툴팁과 같은 문구 */
export const MERGE_BLOCKER_KEYS: Record<MergeBlocker, string> = {
  mixed_language: "split.noMergeLanguage",
  not_text: "split.noMergeKind",
  cell: "split.noMergeCell",
};

const EDITABLE_KINDS = new Set(["sentence", "heading", "cell_sentence"]);

function why(reason: string): string {
  return `split.menu.why.${reason}`;
}

function build(action: SplitMenuAction, reasonKey: string | null): SplitMenuItem {
  return reasonKey === null ? { action, enabled: true } : { action, enabled: false, reasonKey };
}

function isLangUnit(unit: ViewUnit): boolean {
  return unit.lang === "ko" || unit.lang === "en";
}

function getPairReason(selected: ViewUnit, target: ViewUnit): string | null {
  if (!isLangUnit(selected) || !isLangUnit(target)) return why("noLanguage");
  if (selected.lang === target.lang) return why("sameLanguage");
  if (selected.pair_id !== null || target.pair_id !== null) return why("alreadyPaired");
  return null;
}

function buildPair(ctx: SplitMenuContext & { selected: ViewUnit }): SplitMenuItem[] {
  const { selected, target } = ctx;
  const isChecked = ctx.isChecked ?? ((unit: ViewUnit) => unit.boundary_confirmed);
  const mergeBlocker = getMergeBlocker(selected, target);
  const isPaired = selected.pair_id !== null && selected.pair_id === target.pair_id;
  const guard = (reason: string | null) => (ctx.readOnly ? why("readOnly") : reason);
  return [
    build("pair", guard(getPairReason(selected, target))),
    build("unpair", guard(isPaired ? null : why("notPaired"))),
    build("merge", guard(!ctx.adjacent ? why("notAdjacent") : mergeBlocker ? MERGE_BLOCKER_KEYS[mergeBlocker] : null)),
    build("check_both", guard(isChecked(selected) && isChecked(target) ? why("allChecked") : null)),
  ];
}

function buildSingle(ctx: SplitMenuContext): SplitMenuItem[] {
  const { target } = ctx;
  const guard = (reason: string | null) => (ctx.readOnly ? why("readOnly") : reason);
  const isText = EDITABLE_KINDS.has(target.kind);
  const langReason = (lang: "ko" | "en") => (!isText ? why("notText") : target.lang === lang ? why("alreadyLang") : null);
  return [
    build("check", guard(null)),
    build("split", guard(ctx.hasCut ? null : why("noCut"))),
    build("ai_split", guard(!ctx.aiEnabled ? why("aiOff") : !isText ? why("notText") : null)),
    build("hold", guard(ctx.isDecided ? why("decided") : null)),
    build("lang_ko", guard(langReason("ko"))),
    build("lang_en", guard(langReason("en"))),
    build("unpair", guard(target.pair_id !== null ? null : why("notPaired"))),
  ];
}

/** 고른 문장이 있고 다른 문장을 눌렀으면 두 문장 동작, 아니면 오른쪽 칸과 같은 한 문장 동작 */
export function buildSplitMenu(ctx: SplitMenuContext): SplitMenuItem[] {
  return ctx.selected !== null && ctx.selected.id !== ctx.target.id ? buildPair({ ...ctx, selected: ctx.selected }) : buildSingle(ctx);
}
