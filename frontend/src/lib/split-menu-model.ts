// Split 문장 우클릭 메뉴의 가능/불가 판정 - 화면은 이 결과대로 항목을 켜고 끄며 까닭을 툴팁으로 보인다.
import type { ViewUnit } from "./api-sop";
import { getMergeBlocker, MERGE_BLOCKER_KEYS } from "./paper-model";

export type SplitMenuAction = "join" | "unpair" | "check_both" | "check" | "split" | "ai_split" | "hold" | "lang_ko" | "lang_en";

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
  /** 우클릭한 문장에 아직 정하지 않은 AI 나누기 제안이 있다 */
  hasSuggestion?: boolean;
  /** 우클릭한 문장의 AI 나누기 요청이 대기·실행 중이다 */
  isAiWaiting?: boolean;
  /** 우클릭한 문장이 이미 판단을 받았다(보류는 판단 전 단위만) */
  isDecided?: boolean;
}

const EDITABLE_KINDS = new Set(["sentence", "heading", "cell_sentence"]);
/** AI 나누기가 받는 종류 - 백엔드(split.py)는 문장·칸 문장만 쪼갠다. 오른쪽 칸 단추와 우클릭 메뉴가 같이 쓴다 */
const AI_SPLIT_KINDS = new Set(["sentence", "cell_sentence"]);

export function isAiSplitKind(kind: string): boolean {
  return AI_SPLIT_KINDS.has(kind);
}

function why(reason: string): string {
  return `split.menu.why.${reason}`;
}

function build(action: SplitMenuAction, reasonKey: string | null): SplitMenuItem {
  return reasonKey === null ? { action, enabled: true } : { action, enabled: false, reasonKey };
}

/** AI 나누기를 못 쓰는 까닭의 문구 키 - 오른쪽 칸 단추와 우클릭 메뉴가 같은 규칙을 쓴다. 쓸 수 있으면 null */
export function getAiSplitReason(input: { aiEnabled: boolean; isText: boolean; hasSuggestion?: boolean; isWaiting?: boolean }): string | null {
  if (!input.aiEnabled) return why("aiOff");
  if (!input.isText) return why("notText");
  if (input.isWaiting) return why("aiWaiting");
  return input.hasSuggestion ? why("hasSuggestion") : null;
}

/** 묶기의 결과 - 언어가 모두 같으면 한 문장으로 합치기, 한글과 영어가 섞였으면 한/영 짝 */
export type JoinKind = "merge" | "pair";

export interface JoinPlan {
  /** 묶을 수 없으면 null */
  kind: JoinKind | null;
  /** 꺼진 까닭의 문구 키 - 묶을 수 있으면 없다 */
  reasonKey?: string;
}

function refuse(reasonKey: string): JoinPlan {
  return { kind: null, reasonKey };
}

/**
 * 조각들을 묶을 때 시스템이 고르는 결과 - 틈의 Join, 우클릭 메뉴, 떨어진 조각 고르기가 같은 규칙을 쓴다.
 * adjacent는 조각들이 용지에서 이웃한가 - 같은 언어의 떨어진 조각은 화면에서 합치지 않는다.
 */
export function planJoin(units: ViewUnit[], adjacent: boolean): JoinPlan {
  if (units.some((unit) => !EDITABLE_KINDS.has(unit.kind))) return refuse(why("notText"));
  const langs = new Set(units.map((unit) => unit.lang));
  if (langs.size === 1) {
    if (!adjacent) return refuse(why("notAdjacent"));
    for (let index = 1; index < units.length; index += 1) {
      const blocker = getMergeBlocker(units[index - 1], units[index]);
      if (blocker) return refuse(MERGE_BLOCKER_KEYS[blocker]);
    }
    return { kind: "merge" };
  }
  if (langs.size === 2 && langs.has("ko") && langs.has("en")) {
    return units.some((unit) => unit.pair_id !== null) ? refuse(why("alreadyPaired")) : { kind: "pair" };
  }
  return refuse(why("noLanguage"));
}

/**
 * 짝을 한 문장으로 합칠 수 없는 까닭(전환의 One sentence) - 합칠 수 있으면 null. order는 용지의 단위 순서.
 * 구성 단위가 문서 순서로 끊김 없이 이어져야 한다(떨어진 조각의 합치기는 서버가 받지만 화면에서는 이웃한 조각만 합친다).
 */
export function getPairMergeReason(members: ViewUnit[], order: readonly number[]): string | null {
  const placed = members.map((unit) => ({ unit, at: order.indexOf(unit.id) })).sort((a, b) => a.at - b.at);
  const isRun = placed.every((item, index) => item.at >= 0 && (index === 0 || item.at === placed[index - 1].at + 1));
  if (!isRun) return why("notAdjacent");
  for (let index = 1; index < placed.length; index += 1) {
    const blocker = getMergeBlocker(placed[index - 1].unit, placed[index].unit);
    if (blocker) return MERGE_BLOCKER_KEYS[blocker];
  }
  return null;
}

const HANGUL_SYLLABLE = /[\uAC00-\uD7A3]/;
const LATIN_LETTER = /[A-Za-z]/;

/** 글에 한글 음절과 라틴 글자가 모두 있다 - 합친 한 문장을 한/영 짝으로 되돌릴 수 있는지의 기준 */
export function hasBothScripts(text: string): boolean {
  return HANGUL_SYLLABLE.test(text) && LATIN_LETTER.test(text);
}

/** 글자(모든 문자) 중 라틴 글자의 비율 - 글자가 없으면 0 */
function readLatinRatio(text: string): number {
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  const latin = text.match(/[A-Za-z]/g)?.length ?? 0;
  return letters === 0 ? 0 : latin / letters;
}

/** 같은 언어로 잡힌 단위들을 짝으로 맺을 때 EN으로 바꿀 쪽 - 라틴 글자 비율이 가장 높은 단위, 라틴 글자가 하나도 없으면 null */
export function pickEnglishSide(units: Pick<ViewUnit, "id" | "text">[]): number | null {
  let best: { id: number; ratio: number } | null = null;
  for (const unit of units) {
    const ratio = readLatinRatio(unit.text);
    if (ratio > 0 && (best === null || ratio > best.ratio)) best = { id: unit.id, ratio };
  }
  return best?.id ?? null;
}

function buildPair(ctx: SplitMenuContext & { selected: ViewUnit }): SplitMenuItem[] {
  const { selected, target } = ctx;
  const isChecked = ctx.isChecked ?? ((unit: ViewUnit) => unit.boundary_confirmed);
  const isPaired = selected.pair_id !== null && selected.pair_id === target.pair_id;
  const guard = (reason: string | null) => (ctx.readOnly ? why("readOnly") : reason);
  return [
    build("join", guard(planJoin([selected, target], ctx.adjacent).reasonKey ?? null)),
    build("unpair", guard(isPaired ? null : why("notPaired"))),
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
    build("ai_split", guard(getAiSplitReason({ aiEnabled: ctx.aiEnabled, isText: isAiSplitKind(target.kind), hasSuggestion: ctx.hasSuggestion, isWaiting: ctx.isAiWaiting }))),
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

/** 보류는 아직 판단이 없는 단위만 - 오른쪽 칸 H와 우클릭 메뉴가 같은 규칙을 쓴다(칸 문장은 묶인 표·행 단위를 본다) */
export function isUnitDecided(unit: ViewUnit, units: ReadonlyMap<number, ViewUnit>): boolean {
  return units.get(unit.group_unit_id ?? unit.id)?.status !== "unassigned";
}
