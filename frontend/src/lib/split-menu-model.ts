// 문장을 묶는 규칙 - 같은 언어의 이웃은 한 문장으로 합치고 한글·영어는 짝으로 맺는다. 용지의 조각 사이 단추·우클릭 메뉴·떨어진 문장 고르기가 같은 답을 쓴다.
// (옛 쪼개기 화면의 메뉴 판정이 있던 파일이다 - 그 화면은 배정 화면에 합쳐졌고 묶는 규칙만 남았다. 문구 키는 split.menu.why.* 그대로다)
import type { ViewUnit } from "./api-sop";
import { getMergeBlocker, MERGE_BLOCKER_KEYS } from "./paper-model";

const EDITABLE_KINDS = new Set(["sentence", "heading", "cell_sentence"]);
function why(reason: string): string {
  return `split.menu.why.${reason}`;
}

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

export interface LanguageChange {
  lang: "ko" | "en";
  unitIds: number[];
}

/**
 * 합치기를 풀어 되살아난 단위들을 한/영 짝으로 맺기 전에 바꿀 언어 - 이미 짝이 되는 언어면 빈 목록.
 * 언어가 같게(또는 없게) 잡혔으면 라틴 글자 비율이 가장 높은 쪽을 EN, 나머지를 KO로 맞춘다. 라틴 글자가 하나도 없어 정할 수 없으면 null.
 */
export function planPairLanguages(units: ViewUnit[]): LanguageChange[] | null {
  if (planJoin(units, false).kind === "pair") return [];
  const enId = pickEnglishSide(units);
  if (enId === null) return null;
  const changes: LanguageChange[] = [
    { lang: "en", unitIds: units.filter((unit) => unit.id === enId && unit.lang !== "en").map((unit) => unit.id) },
    { lang: "ko", unitIds: units.filter((unit) => unit.id !== enId && unit.lang !== "ko").map((unit) => unit.id) },
  ];
  return changes.filter((change) => change.unitIds.length > 0);
}

/**
 * 합친 한 문장 → 한/영 짝을 서버 편집 하나(switch_language piece, B6)로 할 수 있으면 그 조각 - Undo 한 번에 돌아간다.
 * planPairLanguages와 같은 기준(라틴 글자 비율이 가장 높은 조각이 EN, 나머지 KO)에서 EN 조각이 맨 앞이나 맨 뒤이고 합친 문장이 KO일 때만(남은 쪽은 합친 문장의 언어를 따른다).
 * 아니면 null - 풀기 · 언어 · 짝 맺기를 따로 한다.
 */
export function pickPairPiece(pieces: readonly string[], mergedLang: ViewUnit["lang"]): { piece: number; lang: "en" } | null {
  if (pieces.length < 2 || mergedLang !== "ko") return null;
  const enId = pickEnglishSide(pieces.map((text, id) => ({ id, text })));
  return enId === 0 || enId === pieces.length - 1 ? { piece: enId, lang: "en" } : null;
}
