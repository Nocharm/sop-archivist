// Assign Old 문장 우클릭 메뉴의 항목과 가능/불가 - 화면은 이 결과대로 항목을 켜고 끄며 까닭을 툴팁으로 보인다.
// 두 묶음이다: 배정(삭제는 바로 확정, 배정 취소 - 그 밖의 확정은 Enter·오른쪽 칸·그 자리 메뉴가 맡는다)과 문장 고치기(여기서 나누기·앞뒤 문장과 합치기 또는 한/영 짝 맺기·짝 풀기·언어).
// 표·그림(묶음)은 묶음 도구(표 벗기기·캡션 붙이기)만, 캡션은 문장 도구 일부와 캡션 떼기를 받는다(명세 2026-11-16 §4.2).
// 고치기는 Split의 편집을 그대로 부르므로 판단이 없는 단위만 받는다 - 배정된 문장은 먼저 배정을 취소한다(서버도 판단이 걸린 단위는 확인을 요구한다).
import type { CoverStatus, ViewUnit } from "./api-sop";
import { isCaptionableText, type CaptionHolder } from "./caption-slot-model";
import { isBandHeading, MERGE_BLOCKER_KEYS } from "./paper-model";
import { getPairMergeReason, hasBothScripts, planJoin, type JoinPlan } from "./split-menu-model";

export type AssignMenuAction =
  | "delete" | "clear"
  | "split" | "merge_prev" | "merge_next" | "pair_prev" | "pair_next" | "pair_pick" | "unpair" | "lang" | "piece_lang"
  | "ref_mark" | "ref_clear"
  | "table_layout" | "table_rewrap" | "table_ai_order"
  | "caption_attach_prev" | "caption_attach_next" | "caption_of" | "caption_detach"
  | "to_sentence" | "to_heading" | "start_body";

export interface AssignMenuItem {
  action: AssignMenuAction;
  enabled: boolean;
  /** 꺼진 까닭의 문구 키 - 켜져 있으면 없다 */
  reasonKey?: string;
  /** 언어 줄의 지금 언어 */
  lang?: ViewUnit["lang"];
  /** 대상에 따라 이름이 바뀌는 항목의 문구 키 - 없으면 그 일의 기본 이름 */
  labelKey?: string;
  /** 언어 줄에서 그 언어 칸만 꺼진 까닭 - 캡션은 묶음마다 언어당 하나라 다른 캡션이 가진 언어, 캡션은 참조 줄이 될 수 없다 */
  langReasons?: Partial<Record<"ko" | "en" | "ref", string>>;
  /** 조각 언어 줄(piece_lang) - 합친 박스의 조각 순번(원문 순, 서버 switch_language piece)과 그 글 */
  piece?: { index: number; text: string };
  /** 캡션으로 쓰기 줄(caption_of) - 받을 표·그림과 글에서 본 거리 · 쪽 */
  holder?: { unitId: number; kind: "table" | "figure"; displayId: string; distance: number; side: "above" | "below" };
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
  /** Old 문서의 본문(머리말 · 꼬리말 등이 아닌) 단위다 - "여기부터 본문"을 둔다 */
  canStartBody?: boolean;
  /** 우클릭한 문장의 줄 상태 */
  rowStatus: CoverStatus;
  /** 우클릭한 줄이 삭제로 확정되어 있다(lib/deleted-fold-model isDeletedUnit) - 배정 취소를 "삭제 취소"로 부르고 삭제 항목을 숨긴다 */
  isDeleted?: boolean;
  /** 우클릭한 줄이 없앤 "다른 Bundle로 이동"으로 정해져 있다 - 읽기 전용이라 배정 취소만 남긴다 */
  isLegacyMove?: boolean;
  /** 단위(칸 문장이면 묶인 표)에 판단이 있다 - 미배정이 아닌 상태나 처분 */
  isDecided: (unit: ViewUnit) => boolean;
  /** 단위의 줄에 저장 전 고름·고친 글이 있다 */
  hasDraft: (unit: ViewUnit) => boolean;
  /** 글 안에 나눌 수 있는 자리가 있다 */
  canSplit: boolean;
  /** 우클릭한 것이 든 표 단위 - 표를 직접 눌렀으면 그 단위, 표 밖이면 null */
  table: ViewUnit | null;
  /** 글 대상을 캡션으로 받을 표·그림(가까운 순, caption-slot-model listCaptionHolders) - 우클릭 "캡션으로 쓰기" 줄들 */
  captionHolders?: readonly CaptionHolder[];
  /** 묶음에 이미 있는 캡션의 언어 - 묶음마다 언어당 캡션 하나(서버 caption_exists) */
  listCaptionLangs?: (bundle: ViewUnit) => readonly string[];
  /** 옛 이행(0020)이 그림 블록 위에 둔 캡션 - 떼면 그림 글이 문장이 되어 서버가 막는다(caption_in_figure_block) */
  isFixedCaption?: (unit: ViewUnit) => boolean;
  /** 캡션 대상의 묶음 - 다른 언어 캡션이 있는지 본다 */
  captionBundle?: ViewUnit | null;
  /** 대상이 든 짝의 구성원(대상 포함) - 짝이 아니면 빈 목록. 언어를 바꿔 짝이 한 언어가 되는지 본다(B6) */
  pairMembers?: readonly ViewUnit[];
}

/**
 * 언어 바꾸기가 모양을 바꾸는가(B6, 사용자 결정 2026-11-20 3-a · 3-c) - 짝 구성원의 언어를 바꿔 짝이 한 언어가 되면 서버 편집 switch_language로:
 * 구성원이 용지에서 끊김 없이 이웃이고 합칠 수 있으면 합치기(mergePair), 아니면 짝만 푼다. 그 밖은 보통 언어 바꾸기(set_language).
 * order는 용지의 단위 순서(paper-model buildPaperTabs order).
 */
export type LanguageChange = { kind: "plain" } | { kind: "switch"; mergePair: boolean };
export function planLanguageChange(target: ViewUnit, lang: "ko" | "en", members: readonly ViewUnit[], order: readonly number[]): LanguageChange {
  const others = members.filter((unit) => unit.id !== target.id);
  if (target.lang === lang || others.length === 0 || others.some((unit) => unit.lang !== lang)) return { kind: "plain" };
  return { kind: "switch", mergePair: getPairMergeReason([...members], order) === null };
}

const EDITABLE_KINDS = new Set(["sentence", "heading", "cell_sentence", "caption"]);
const BUNDLE_KINDS = new Set(["table", "figure"]);

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
  // 저절로 삭제된 줄은 나누거나 합치지 않는다 - 먼저 삭제 취소(서버 422 toc_line_locked, 사용자 결정 2026-11-19)
  if (unit.noise_kind) return why("tocLine");
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
  // 어느 한쪽이 이미 짝이면 배정을 풀어도 맺을 수 없다 - 먼저 할 일(배정·저장)보다 이 까닭이 앞선다(자기 짝과의 단추가 "배정됨"으로 보이던 것)
  if (isPair && (ctx.target.pair_id !== null || neighbor.pair_id !== null)) return build(action, "split.menu.why.alreadyPaired");
  // 합치기는 두 문장을 새 문장 하나로 바꾸니 배정이 있어도 묻고 한다. 짝은 제자리에서 맺어 배정이 있으면 막는다
  const own = (isPair ? getEditBlocker(ctx, ctx.target) : getRetireBlocker(ctx, ctx.target)) ?? (ctx.target.noise_kind ? why("tocLine") : null);
  if (own !== null) return build(action, own);
  if (neighbor === null) return build(action, why("noNeighbor"));
  // 저절로 삭제된 줄과는 합치지도 짝 맺지도 않는다(서버 toc_line_locked)
  if (neighbor.noise_kind) return build(action, MERGE_BLOCKER_KEYS.toc);
  // 캡션은 묶음에 딸린 글이라 이웃 문장과 합치거나 짝 맺지 않는다(떼고 나서)
  if (!EDITABLE_KINDS.has(neighbor.kind) || neighbor.kind === "caption") return build(action, why("neighborNotText"));
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

/** 표 항목 - 표는 레이아웃 표로 바꿔 벗긴다. 저장 전 고름이 있으면 잠근다(배정이 있으면 묻고 한다) */
function buildTableItems(ctx: AssignMenuContext): AssignMenuItem[] {
  const { table } = ctx;
  if (table === null) return [];
  const blocker = ctx.readOnly ? why("readOnly") : table.noise_kind ? why("tocLine") : ctx.hasDraft(table) ? why("unsaved") : null;
  return [build("table_layout", blocker)];
}

/** 벗긴 표 항목 - 다시 표로 · AI 순서(C2-R4). 까닭은 머리 단추 · ⇧O와 같다: 다시 표로는 읽기 전용 · 저장 전 고름, AI 순서는 읽기 전용과 orderReasonKey(unwrap-ai-model readUnwrapOrderReason) */
export function buildUnwrappedTableItems(ctx: { readOnly: boolean; hasDraft: boolean; orderReasonKey: string | null }): AssignMenuItem[] {
  const rewrap = ctx.readOnly ? why("readOnly") : ctx.hasDraft ? why("unsaved") : null;
  const order = ctx.readOnly ? why("readOnly") : ctx.orderReasonKey;
  return [build("table_rewrap", rewrap), build("table_ai_order", order)];
}

/**
 * 캡션 붙이기 하나 - 글 단위(text)를 묶음(bundle)의 캡션으로. 판단이 있어도 막지 않는다(서버가 묻고 묶음을 풀어 준다, 다른 고치기와 같다).
 * 까닭은 읽기 전용 → 저장 전 고름(대상 줄, 그다음 이웃 줄) → 그 언어 캡션이 이미 있음 순.
 */
function buildCaptionAttach(ctx: AssignMenuContext, side: "prev" | "next", text: ViewUnit, bundle: ViewUnit, labelKey: string): AssignMenuItem {
  const [own, other] = ctx.target.id === bundle.id ? [bundle, text] : [text, bundle];
  const reason = ctx.readOnly ? why("readOnly")
    : bundle.noise_kind || text.noise_kind ? why("tocLine")
    : ctx.hasDraft(own) ? why("unsaved")
    : ctx.hasDraft(other) ? why(other.id === bundle.id ? "bundleUnsaved" : "neighborUnsaved")
    : (ctx.listCaptionLangs?.(bundle) ?? []).includes(text.lang) ? why("captionExists") : null;
  return { ...build(`caption_attach_${side}`, reason), labelKey };
}

/**
 * 글 대상의 "캡션으로 쓰기" 줄들(B10 8-a) - 가까운 표·그림마다 한 줄(거리 제한 없음, 가까운 순 몇 개). 그 언어 캡션이 이미 있거나
 * 캡션을 같이 쓰는 그림이면 꺼 둔다. 서버 attach_caption이 같은 판단을 한다
 */
function buildTextCaptionItems(ctx: AssignMenuContext): AssignMenuItem[] {
  if (!isCaptionableText(ctx.target)) return [];
  return (ctx.captionHolders ?? []).map(({ bundle, distance, side }) => {
    const reason = ctx.readOnly ? why("readOnly")
      : bundle.noise_kind ? why("tocLine")
      : ctx.hasDraft(ctx.target) ? why("unsaved")
      : ctx.hasDraft(bundle) ? why("bundleUnsaved")
      : bundle.caption_figure_id ? "assign.captionSlot.why.shared"
      : (ctx.listCaptionLangs?.(bundle) ?? []).includes(ctx.target.lang) ? why("captionExists") : null;
    const kind = bundle.kind === "figure" ? "figure" : "table";
    return { ...build("caption_of", reason), holder: { unitId: bundle.id, kind, displayId: bundle.display_id, distance, side } };
  });
}

/**
 * 제목 ↔ 문장 항목(F8b) - 묶이지 않은 제목은 "문장으로 바꾸기", 문장은 "제목으로"(제목에서 바꾼 문장이면 "제목으로 되돌리기" - 그 조항 줄 전체).
 * 단위를 새로 만드는 고치기라 배정이 있어도 막지 않는다(서버가 묻고 배정을 풀어 준다). 목차 줄·참조 줄·칸 문장·캡션에는 없다
 */
function buildHeadingItems(ctx: AssignMenuContext, retireReason: string | null): AssignMenuItem[] {
  const { target } = ctx;
  // 띠 표 제목 줄(F4)의 반대 길은 다듬기 칸의 "표로 되돌리기"다 - 문장으로 바꾸지 않는다
  if (target.group_unit_id !== null || target.noise_kind || target.lang === "ref" || isBandHeading(target)) return [];
  if (target.kind === "heading") return [build("to_sentence", retireReason)];
  if (target.kind !== "sentence") return [];
  return [{ ...build("to_heading", retireReason), labelKey: target.from_heading ? "assign.headingShift.back" : "assign.ctx.toHeading" }];
}

/** 묶음 대상의 캡션 항목 - 묶음 바로 앞(뒤)이 묶이지 않은 글일 때만 "위(아래) 문장을 캡션으로 붙이기" */
function buildBundleCaptionItems(ctx: AssignMenuContext): AssignMenuItem[] {
  return (["prev", "next"] as const).flatMap((side) => {
    const text = side === "prev" ? ctx.prev : ctx.next;
    if (text === null || !isCaptionableText(text)) return [];
    return [buildCaptionAttach(ctx, side, text, ctx.target, `assign.ctx.captionAttach${side === "prev" ? "Prev" : "Next"}`)];
  });
}

/**
 * 배정된 짝 구성원의 언어 줄 - 짝을 한 언어로 만드는 칸은 배정을 풀며 바로 바꾼다(3-c, 모양 전환), 다른 칸은 지금처럼 배정 때문에 꺼진다.
 * 그 칸이 없으면(짝이 아니거나 두 언어가 남는다) 줄째 꺼진 그대로다.
 */
function buildShapeLangReasons(ctx: AssignMenuContext, editReason: string | null): Partial<AssignMenuItem> {
  if (editReason !== why("assigned")) return {};
  const shaping = (["ko", "en"] as const).filter((lang) => planLanguageChange(ctx.target, lang, ctx.pairMembers ?? [], []).kind === "switch");
  if (shaping.length === 0) return {};
  const langReasons: AssignMenuItem["langReasons"] = {};
  for (const lang of ["ko", "en"] as const) if (!shaping.includes(lang)) langReasons[lang] = editReason;
  return { enabled: true, reasonKey: undefined, langReasons };
}

/**
 * 합친 박스의 조각마다 언어(B6) - 맨 앞 · 맨 뒤 조각만 다른 언어로 떼어 남은 쪽과 짝을 맺는다(가운데 조각은 앞뒤가 떨어져 꺼진다, 내 판단).
 * 배정이 있어도 막지 않는다(3-c - 모양 전환은 배정을 풀며 바로 한다). 합쳐 생긴 박스(can_unmerge)에서만 조각이 둘 이상이면 뜬다.
 */
function buildPieceItems(ctx: AssignMenuContext, retireReason: string | null): AssignMenuItem[] {
  const pieces = ctx.target.can_unmerge ? (ctx.target.merge_pieces ?? []) : [];
  if (pieces.length < 2 || (ctx.target.lang !== "ko" && ctx.target.lang !== "en")) return [];
  const last = pieces.length - 1;
  return pieces.map((text, index) => ({
    ...build("piece_lang", retireReason ?? (index > 0 && index < last ? why("middlePiece") : null)),
    lang: ctx.target.lang,
    piece: { index, text },
  }));
}

export function buildAssignMenu(ctx: AssignMenuContext): AssignMenuGroups {
  const clearReason = ctx.readOnly ? why("readOnly") : ctx.rowStatus === "unassigned" && !ctx.isDecided(ctx.target) ? why("notAssigned") : null;
  // 삭제는 줄 전체의 판단이라 문장 모양과 상관없이 늘 뜬다(배정 취소 뒤, 삭제가 맨 끝) - 저장을 막는 까닭(캡션·참조 확인 등)은 확정 길이 알린다
  const decide = build("delete", ctx.readOnly ? why("readOnly") : null);
  // 삭제된 줄 - 삭제를 푸는 것은 배정 취소와 같은 일이라 이름만 "삭제 취소"(단축키 U 그대로), 이미 삭제라 삭제 항목은 숨긴다
  const assign = ctx.isDeleted ? [{ ...build("clear", clearReason), labelKey: "assign.ctx.undoDelete" }] : ctx.isLegacyMove ? [build("clear", clearReason)] : [build("clear", clearReason), decide];
  const editReason = getEditBlocker(ctx, ctx.target);
  const retireReason = getRetireBlocker(ctx, ctx.target);
  const splitItem = build("split", retireReason ?? (ctx.canSplit ? null : why("nothingToSplit")));
  const langItem = { ...build("lang", editReason ?? (ctx.target.lang === "ref" ? why("refLang") : null)), lang: ctx.target.lang, ...buildShapeLangReasons(ctx, editReason) };
  // 묶음(표·그림)에는 문장 항목이 뜻이 없어 묶음 항목만 둔다
  if (BUNDLE_KINDS.has(ctx.target.kind)) return { assign, edit: [...buildTableItems(ctx), ...buildBundleCaptionItems(ctx)] };
  // 캡션은 나누기·언어(한/영 한 줄 캡션을 나눠 언어를 따로)와 떼기만 - 떼기는 묶음을 바꾸니 배정이 있으면 서버가 묻는다
  if (ctx.target.kind === "caption") {
    const detachReason = ctx.readOnly ? why("readOnly") : ctx.target.noise_kind ? why("tocLine") : ctx.isFixedCaption?.(ctx.target) ? why("captionInFigure") : ctx.hasDraft(ctx.target) ? why("unsaved") : null;
    // 같은 묶음의 다른 캡션이 가진 언어로는 바꿀 수 없다(서버 caption_exists), 캡션은 참조 줄이 되지 않는다
    const taken = ctx.captionBundle ? (ctx.listCaptionLangs?.(ctx.captionBundle) ?? []) : [];
    const langReasons: AssignMenuItem["langReasons"] = { ref: why("captionNoRef") };
    for (const lang of ["ko", "en"] as const) if (lang !== ctx.target.lang && taken.includes(lang)) langReasons[lang] = why("captionExists");
    // 나눈 두 조각도 캡션이다 - 한/영 한 줄 캡션을 한글·영어로 나누는 것만 된다(같은 언어 둘·다른 캡션과 겹침은 서버 caption_exists, split)
    const others = [...taken];
    const ownIndex = others.indexOf(ctx.target.lang);
    // 목록에 이 캡션의 언어가 없으면 splice(-1)이 다른 캡션의 언어를 지운다
    if (ownIndex >= 0) others.splice(ownIndex, 1);
    const isPairSplit = hasBothScripts(ctx.target.text) && !others.some((lang) => lang === "ko" || lang === "en");
    const captionSplit = isPairSplit ? splitItem : build("split", retireReason ?? why("captionSplitOneLang"));
    return { assign, edit: [captionSplit, { ...langItem, langReasons }, build("caption_detach", detachReason)] };
  }
  return {
    assign,
    edit: [
      splitItem,
      buildJoin(ctx, ctx.prev, "prev"),
      buildJoin(ctx, ctx.next, "next"),
      // 떨어져 있는 문장과 짝 맺기 - 짝이 없는 한글·영어 문장에서만. 누르면 다른 문장을 하나 고른다
      ...(ctx.target.pair_id === null && (ctx.target.lang === "ko" || ctx.target.lang === "en") ? [build("pair_pick", editReason ?? (ctx.target.noise_kind ? why("tocLine") : null))] : []),
      // 짝 풀기는 짝인 문장에서만 보인다
      ...(ctx.target.pair_id !== null ? [build("unpair", editReason)] : []),
      // 참조 줄은 언어가 없다 - 언어를 주려면 먼저 "참조 아님"으로 돌린다
      langItem,
      ...buildPieceItems(ctx, retireReason),
      buildRefItem(ctx, editReason),
      ...buildHeadingItems(ctx, retireReason),
      ...buildTableItems(ctx),
      ...buildTextCaptionItems(ctx),
      ...buildBodyStartItems(ctx),
    ],
  };
}

/** 여기부터 본문(쪼개기 먼저 설계 §7 R3) - Old 본문의 표 밖 글 줄(띠 표 제목 포함)에만. 이 줄 앞을 본문 앞부분으로 삭제하고 뒤의 앞부분 표시를 비운다.
 *  이 줄 자신의 판단은 그대로라 배정이 있어도 막지 않는다 - 정한 줄이 앞에 끼어 있으면 서버가 거절한다 */
function buildBodyStartItems(ctx: AssignMenuContext): AssignMenuItem[] {
  const { target } = ctx;
  const isFlow = target.group_unit_id === null && (target.table_id === null || isBandHeading(target));
  if (!ctx.canStartBody || target.noise_kind || !isFlow || (target.kind !== "sentence" && target.kind !== "heading")) return [];
  return [build("start_body", ctx.readOnly ? why("readOnly") : null)];
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

/** 떨어진 문장 짝 고르기에 그 문장을 넣을 수 없는 까닭의 문구 키 - 넣을 수 있으면 null. 언어 조합은 다 고른 뒤에 본다(getPairSetBlocker) */
export function getPairPickBlocker(unit: ViewUnit, state: Pick<AssignMenuContext, "isDecided" | "hasDraft">): string | null {
  if (!EDITABLE_KINDS.has(unit.kind) || unit.kind === "caption") return why("notText");
  if (unit.noise_kind) return why("tocLine");
  if (unit.lang !== "ko" && unit.lang !== "en") return "split.menu.why.noLanguage";
  if (unit.pair_id !== null) return "split.menu.why.alreadyPaired";
  if (state.isDecided(unit)) return why("neighborAssigned");
  return state.hasDraft(unit) ? why("neighborUnsaved") : null;
}

/** 고른 문장들(처음 문장 포함)을 한 짝으로 맺을 수 없는 까닭의 문구 키 - 한글과 영어가 모두 있어야 한다 */
export function getPairSetBlocker(units: ViewUnit[]): string | null {
  const plan = planJoin(units, false);
  if (plan.kind === "pair") return null;
  // 같은 언어뿐이면 합치기 규칙의 까닭("이웃한 문장만") 대신 짝에 맞는 까닭을 말한다
  return new Set(units.map((unit) => unit.lang)).size === 1 ? "assign.pairPickSameLang" : (plan.reasonKey ?? why("cannotMerge"));
}

// 다듬기 줄에 단추로 두는 일 - 언어는 세 칸이, 참조 줄 표시는 아래 카드가, 확정·지우기는 3번이 맡는다
const SHAPE_LINE_ACTIONS: ReadonlySet<AssignMenuAction> = new Set([
  "split", "merge_prev", "pair_prev", "merge_next", "pair_next", "pair_pick", "unpair", "table_layout",
  "caption_detach", "to_sentence",
]);

// 다듬기 줄에서 꺼 둔 채 보이지도 않는 까닭 - 그 자리에서는 풀 길이 없는 모양 탓이다(옆에 문장이 없다·이미 짝·글이 아니다).
// 저장 전·배정처럼 먼저 할 일이 있는 까닭은 꺼 둔 채 보여 툴팁으로 알린다. 우클릭 메뉴는 그대로 다 보인다
const SHAPE_HIDDEN_REASONS: ReadonlySet<string> = new Set([
  why("captionInFigure"), why("nothingToSplit"), why("noNeighbor"), why("neighborNotText"), why("notText"), why("tocLine"),
  "split.menu.why.alreadyPaired", "split.menu.why.noLanguage", "split.menu.why.notText",
  ...Object.values(MERGE_BLOCKER_KEYS),
]);

/**
 * 다듬기 한 줄에 보일 단추 - 그 문장의 고치기 항목 중 단추로 두는 일만, 풀 길이 없는 까닭으로 꺼진 것은 뺀다.
 * 참조 줄은 나누거나 묶을 일이 없어 단추가 없다(언어 세 칸만). 한/영 짝 줄(isPairRow)의 짝 풀기는 줄마다 두지 않고 모양 전환 옆에 한 번 둔다.
 * 캡션 붙이기는 다듬기 줄 단추가 아니다 - 표·그림은 그 아래 캡션 자리의 후보(F12), 글은 우클릭 "캡션으로 쓰기"가 맡는다(B10).
 */
export function listShapeLineItems(unit: ViewUnit, items: readonly AssignMenuItem[], isPairRow: boolean): AssignMenuItem[] {
  if (unit.lang === "ref") return [];
  return items.filter((item) =>
    SHAPE_LINE_ACTIONS.has(item.action)
    && !(item.reasonKey !== undefined && SHAPE_HIDDEN_REASONS.has(item.reasonKey))
    && !(isPairRow && item.action === "unpair"));
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
