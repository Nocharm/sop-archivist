// 표·그림 캡션 규칙 - 화면이 "캡션이 있어야 하는데 없다"를 같은 기준으로 판단한다(Old 머리 줄의 Caption needed, 위쪽 줄 남은 수, Confirm 막기)와 저장할 캡션 출처.

import type { Disposition, Group, GroupTarget, UnitLang, UnitRow, ViewUnit } from "./api-sop";
import { isSharedCaptioned } from "./caption-slot-model";
import type { ClassifyRow, Destination, RowDraft } from "./classify-model";

export interface CaptionNeedInput {
  hasCaption: boolean;
  /** 저장된 판단의 처리 - 삭제·이동한 묶음은 새 문서에 가지 않아 캡션이 필요 없다(명세 §3.4) */
  disposition: Disposition | undefined;
  /** 이미 쓴 New 문서의 묶음이거나 그 문서에 이은 묶음(입구 2) - 캡션은 그 문서가 정한다 */
  isLinkedToWritten: boolean;
}

/** 캡션이 없고 있어야 하는 묶음 - 미배정·보류·배정은 true, 삭제·이동·입구 2는 false */
export function isCaptionNeeded({ hasCaption, disposition, isLinkedToWritten }: CaptionNeedInput): boolean {
  if (hasCaption || isLinkedToWritten) return false;
  return disposition !== "delete" && disposition !== "move_external";
}

/** 이미 쓴 New 문서 쪽 묶음인가 - 혼자 연 그 문서의 단위이거나 그 문서에 이은 묶음(입구 2). 머리 줄과 위쪽 줄 수가 같은 판단을 쓴다 */
export function makeIsLinkedToWritten(writtenDocUnitIds: ReadonlySet<number>, linked: { has(unitId: number): boolean }): (unitId: number) => boolean {
  return (unitId) => writtenDocUnitIds.has(unitId) || linked.has(unitId);
}

/** 묶음 하나의 Caption needed - 묶인 캡션 단위나 캡션 새 문장(써 넣은 것 포함, has_caption_target)이 있으면 캡션이 있다. 머리 줄과 위쪽 줄 수가 같은 입력으로 */
export function isBundleCaptionNeeded(unit: Pick<UnitRow, "has_caption_target" | "decision"> | undefined, hasBoundCaption: boolean, isLinkedToWritten: boolean): boolean {
  return isCaptionNeeded({ hasCaption: hasBoundCaption || unit?.has_caption_target === true, disposition: unit?.decision.disposition, isLinkedToWritten });
}

/** 캡션을 받는 묶음 단위 - 표·그림 */
const BUNDLE_KINDS: readonly string[] = ["table", "figure"];

export function isBundleKind(kind: string): boolean {
  return BUNDLE_KINDS.includes(kind);
}

/** 묶음에 딸린 캡션 단위 - 저장 요청의 출처(SaveContext.captions) */
export interface CaptionUnit {
  id: number;
  lang: UnitLang;
  text: string;
}

/** 묶음 캡션 하나 - 캡션 단위가 출처이거나, 출처 없이 써 넣은 글(unitId null) */
export interface CaptionSource {
  /** 고친 글 초안(captionTexts)의 키 - getCaptionTextKey */
  key: string;
  unitId: number | null;
  lang: UnitLang;
  text: string;
}

/** 저장할 캡션 - 출처에 더해 지금 캡션 새 문장(있으면 id·revision을 되보낸다)과 견줄 원문 */
export interface CaptionPlan extends CaptionSource {
  target: GroupTarget | null;
  /** 캡션 단위의 원문 - 써 넣은 캡션은 null(변경 종류를 서버가 new로 정한다) */
  sourceText: string | null;
  /** 사람이 이번에 글을 고쳤다 - 손대지 않은 AI 제안 캡션은 글·종류 없이 보내 제안 그대로 받는다 */
  isEdited: boolean;
}

type CaptionDraft = Pick<RowDraft, "captionTexts"> | undefined;

/**
 * 캡션 글 초안(RowDraft.captionTexts)의 키 - 캡션 단위가 있으면 그 단위(같은 언어 캡션이 둘이거나 줄에 묶음이 여럿이어도 겹치지 않게),
 * 써 넣은 캡션은 묶음과 언어(묶음마다 언어당 하나).
 */
export function getCaptionTextKey(bundleId: number, unitId: number | null, lang: string): string {
  return unitId !== null ? `u${unitId}` : `w${bundleId}:${lang}`;
}

/** 이 묶음에 써 넣는 캡션 초안의 언어들 */
function listWrittenDraftLangs(bundleId: number, captionTexts: Readonly<Record<string, string>>): UnitLang[] {
  const prefix = `w${bundleId}:`;
  return Object.keys(captionTexts).filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length) as UnitLang);
}

/** 묶음 단위의 표·그림 새 문장(줄로 만든 것) 아래 캡션 새 문장 - 칸 좌표가 없는 자식 문장(서버 captions.is_caption_target) */
export function listCaptionChildren(group: Group | null, bundleId: number): GroupTarget[] {
  const targets = group?.targets ?? [];
  const parent = targets.find((target) => target.parent_target_id === null && target.origin === "units" && (target.kind === "table" || target.kind === "figure") && target.source_unit_ids.includes(bundleId));
  if (!parent) return [];
  return targets.filter((target) => target.parent_target_id === parent.id && target.origin === "units" && target.kind === "sentence" && target.cell_row === null && target.cell_col === null);
}

/**
 * 저장할 캡션들. 캡션 단위가 있으면 단위마다 하나(글은 사람이 고친 글, 비웠거나 안 고쳤으면 지금 캡션 새 문장의 글, 없으면 원문).
 * 캡션 단위가 없으면 써 넣은 캡션 - 저장된 것과 이번에 쓴 언어마다 하나, 글이 빈 것은 뺀다.
 */
export function planCaptions(bundleId: number, units: readonly CaptionUnit[], children: readonly GroupTarget[], captionTexts: Readonly<Record<string, string>> = {}): CaptionPlan[] {
  if (units.length > 0) {
    return units.map((unit) => {
      const key = getCaptionTextKey(bundleId, unit.id, unit.lang);
      const target = children.find((child) => child.source_unit_ids.includes(unit.id)) ?? null;
      const current = target ? target.confirmed_text || target.ai_text || unit.text : unit.text;
      const edited = (captionTexts[key] ?? "").trim();
      return { key, unitId: unit.id, lang: unit.lang, text: edited || current.trim(), target, sourceText: unit.text, isEdited: edited !== "" };
    });
  }
  const written = children.filter((child) => child.source_unit_ids.length === 0);
  const langs = [...new Set([...written.map((child) => child.lang), ...listWrittenDraftLangs(bundleId, captionTexts)])];
  return langs
    .map((lang) => {
      const key = getCaptionTextKey(bundleId, null, lang);
      const target = written.find((child) => child.lang === lang) ?? null;
      return { key, unitId: null, lang, text: (captionTexts[key] ?? target?.confirmed_text ?? "").trim(), target, sourceText: null, isEdited: captionTexts[key] !== undefined };
    })
    .filter((plan) => plan.text !== "");
}

function listBoundCaptions(bundleId: number, units: Iterable<ViewUnit>): ViewUnit[] {
  return [...units].filter((unit) => unit.kind === "caption" && unit.group_unit_id === bundleId);
}

/** 묶음의 캡션 출처 - 묶인 캡션 단위(고친 글), 단위가 없으면 써 넣은 글(unitId null) */
export function listCaptionSources(bundle: ViewUnit, units: readonly ViewUnit[], draft: CaptionDraft, group: Group | null = null): CaptionSource[] {
  return planCaptions(bundle.id, listBoundCaptions(bundle.id, units), listCaptionChildren(group, bundle.id), draft?.captionTexts).map(({ key, unitId, lang, text }) => ({ key, unitId, lang, text }));
}

/** 캡션을 써 넣을 언어 - 묶음 바로 앞 한국어·영어 글 단위의 언어, 없으면 한국어 */
export function pickCaptionLang(bundle: ViewUnit, units: readonly ViewUnit[]): "ko" | "en" {
  const before = units.filter((unit) => unit.pos_seq < bundle.pos_seq && unit.group_unit_id === null && (unit.lang === "ko" || unit.lang === "en")).sort((a, b) => a.pos_seq - b.pos_seq);
  return before.at(-1)?.lang === "en" ? "en" : "ko";
}

/**
 * Edit and confirm의 캡션 칸 - 캡션 언어마다 하나(비워도 칸은 남는다). 캡션 단위가 없으면 써 넣은 캡션의 언어마다,
 * 그것도 없으면 Write a caption 칸 하나(pickCaptionLang).
 */
export function listCaptionFields(bundle: ViewUnit, units: readonly ViewUnit[], draft: CaptionDraft, group: Group | null = null): CaptionSource[] {
  const texts = draft?.captionTexts ?? {};
  const bound = listBoundCaptions(bundle.id, units);
  const children = listCaptionChildren(group, bundle.id);
  if (bound.length > 0) return planCaptions(bundle.id, bound, children).map(({ key, unitId, lang, text }) => ({ key, unitId, lang, text: texts[key] ?? text }));
  const written = children.filter((child) => child.source_unit_ids.length === 0);
  const langs = [...new Set([...(written.length > 0 ? written.map((child) => child.lang) : [pickCaptionLang(bundle, units)]), ...listWrittenDraftLangs(bundle.id, texts)])];
  return langs.map((lang) => {
    const key = getCaptionTextKey(bundle.id, null, lang);
    return { key, unitId: null, lang, text: texts[key] ?? written.find((child) => child.lang === lang)?.confirmed_text ?? "" };
  });
}

/**
 * Confirm을 막는가 - 새 문서 자리로 보내는 줄의 표·그림에 캡션이 하나도 없다. 삭제·이동·보류·입구 2 잇기는 막지 않는다.
 * 캡션 있는 첫 그림의 캡션을 같이 쓰는 그림(F7 ⑥)은 캡션이 있다(서버 decisions._check_captions와 같다)
 */
export function isCaptionGate(row: ClassifyRow, destination: Destination | null, units: ReadonlyMap<number, ViewUnit>, draft: CaptionDraft, group: Group | null = null): boolean {
  if (destination?.kind !== "slot" && destination?.kind !== "step") return false;
  return row.unitIds.some((id) => {
    const unit = units.get(id);
    if (!unit || !isBundleKind(unit.kind) || isSharedCaptioned(unit, units)) return false;
    return planCaptions(id, listBoundCaptions(id, units.values()), listCaptionChildren(group, id), draft?.captionTexts).length === 0;
  });
}

/**
 * 캡션이 필요한 묶음의 줄(문서 순서) - 머리 줄의 Caption needed와 같은 규칙(isCaptionNeeded).
 * 캡션은 묶인 캡션 단위 또는 캡션 새 문장(써 넣은 것 포함, has_caption_target).
 */
export function listCaptionPendingRowKeys(rows: readonly ClassifyRow[], units: ReadonlyMap<number, UnitRow>, isLinkedToWritten: (unitId: number) => boolean): string[] {
  const captioned = new Set<number>();
  for (const unit of units.values()) if (unit.kind === "caption" && unit.group_unit_id !== null) captioned.add(unit.group_unit_id);
  return rows
    .filter((row) =>
      row.unitIds.some((id) => {
        const unit = units.get(id);
        if (!unit || !isBundleKind(unit.kind)) return false;
        // 첫 그림의 캡션을 같이 쓰는 그림(F7 ⑥)은 그 첫 그림의 캡션이 제 캡션이다
        return isBundleCaptionNeeded(unit, captioned.has(unit.caption_figure_id ?? id), isLinkedToWritten(id));
      }),
    )
    .map((row) => row.key);
}
