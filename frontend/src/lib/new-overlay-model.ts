// 이미 쓴 New 문서의 용지(components/assign/new-paper) 위에 얹을 것 - 박스는 Unit이고 New 문장은 new_unit_id로 잇는다.
// Unit마다 한 덩이(NewBox)를 여기서 다 정하고 용지는 그리기만 한다. 덩이의 key는 그리는 값 전부를 이은 글이라, 화면에서 먼 덩어리는 제 Unit의 key가 바뀔 때만 다시 그린다(PaperChunk).
import type { ChangeType, UnitLang, ViewUnit, WrittenSentence } from "@/lib/api-sop";
import { getNewRowKey } from "@/lib/composed-model";
import { readNewAiSectionKey, type NewAiBand, type NewAiFilter, type NewAiMark } from "@/lib/new-ai-filter-model";
import { readWrittenRefMark } from "@/lib/ref-model";

/** 박스의 모양 - 출처 없는 New에서 고른 것, 다듬으려고 고른 것, 이을 곳으로 고른 것, 이을 후보, 출처 없음 */
export type NewBoxState = "focus" | "shape" | "picked" | "candidate" | "unsourced";

export interface NewBox {
  unitId: number;
  targetId: number;
  kind: "sentence" | "cell" | "bundle";
  lang: UnitLang;
  /** 이은 Old 단위(출처 순서) */
  sourceIds: readonly number[];
  isAi: boolean;
  isMarkedNew: boolean;
  /** 참조 줄 표시가 있는 문장 - 칩 줄의 RefMark가 그린다 */
  refRow: WrittenSentence | null;
  state: NewBoxState | undefined;
  /** AI 거르기의 표시 - 거르지 않으면 없다 */
  ai: NewAiMark | undefined;
  /** AI 거르기로 접혔다 */
  isAiFolded: boolean;
  /** 접힌 자리의 띠 - 칸마다 첫 접힌 박스 하나에만 */
  band: NewAiBand | null;
  /** Old 줄을 이을 수 있나 - 문장과 표 칸만(표 · 그림은 아니다) */
  isLinkable: boolean;
  /** 이 박스를 그리는 값 전부를 이은 글 */
  key: string;
}

export interface NewOverlay {
  /** Unit id → 그 박스 위에 얹을 것 */
  boxes: ReadonlyMap<number, NewBox>;
  /** 새 문장 id → 그 박스의 Unit */
  unitOfTarget: ReadonlyMap<number, number>;
}

export interface NewOverlayInput {
  /** 그 New 문서의 최상위 새 문장(written-sentences) */
  rows: readonly WrittenSentence[];
  candidateIds: ReadonlySet<number>;
  pickedIds: ReadonlySet<number>;
  /** 출처 없는 New 모드에서 고른 새 문장 */
  focusId: number | null;
  /** 다듬으려고 고른 Unit */
  shapeUnitId: number | null;
  aiFilter: NewAiFilter | null;
  /** AI 거르기에서 띠를 눌러 펼친 칸(readNewAiSectionKey) */
  openAiSections: ReadonlySet<string>;
}

/** 그리기 전의 박스 - 같은 Unit에 새 문장이 둘이면 하나만 남긴 뒤 모양을 정한다 */
interface RawBox {
  row: WrittenSentence;
  unitId: number;
  targetId: number;
  kind: NewBox["kind"];
  lang: UnitLang;
  sourceIds: readonly number[];
  isAi: boolean;
  changeType: ChangeType | null;
}

function listRawBoxes(rows: readonly WrittenSentence[]): RawBox[] {
  return rows.flatMap((row) => {
    const own: RawBox[] =
      row.new_unit_id == null
        ? []
        : [{ row, unitId: row.new_unit_id, targetId: row.target_id, kind: row.kind === "sentence" ? "sentence" : "bundle", lang: row.lang, sourceIds: row.source_unit_ids, isAi: row.status === "ai_suggested", changeType: row.change_type }];
    const cells = (row.table?.cells ?? []).flatMap((cell): RawBox[] =>
      cell.new_unit_id == null
        ? []
        : [{ row, unitId: cell.new_unit_id, targetId: cell.target_id, kind: "cell", lang: cell.lang, sourceIds: cell.source_unit_ids, isAi: cell.status === "ai_suggested", changeType: cell.change_type ?? null }],
    );
    return [...own, ...cells];
  });
}

/** 같은 Unit의 새 문장 둘 중 보일 것 - 출처가 있는 것, 그다음 먼저 만든(작은 id) 것 */
function isPreferred(next: RawBox, held: RawBox): boolean {
  const hasNext = next.sourceIds.length > 0;
  const hasHeld = held.sourceIds.length > 0;
  return hasNext !== hasHeld ? hasNext : next.targetId < held.targetId;
}

function readState(box: RawBox, input: NewOverlayInput): NewBoxState | undefined {
  if (box.targetId === input.focusId) return "focus";
  if (box.unitId === input.shapeUnitId) return "shape";
  if (input.pickedIds.has(box.targetId)) return "picked";
  if (input.candidateIds.has(box.targetId)) return "candidate";
  if (box.kind !== "bundle" && box.sourceIds.length === 0 && box.changeType !== "new") return "unsourced";
  return undefined;
}

export function buildNewOverlay(input: NewOverlayInput): NewOverlay {
  const held = new Map<number, RawBox>();
  const unitOfTarget = new Map<number, number>();
  for (const box of listRawBoxes(input.rows)) {
    unitOfTarget.set(box.targetId, box.unitId);
    const before = held.get(box.unitId);
    if (!before || isPreferred(box, before)) held.set(box.unitId, box);
  }
  const bandOf = new Map([...(input.aiFilter?.bands.values() ?? [])].map((band) => [band.sectionKey, band]));
  const boxes = new Map<number, NewBox>();
  for (const box of held.values()) {
    // 칸은 표째 거른다 - 표시는 표(묶음) 박스 하나에
    const ai = box.kind === "cell" ? undefined : input.aiFilter?.marks.get(getNewRowKey(box.row));
    const section = readNewAiSectionKey(box.row.section_path);
    const isAiFolded = ai === "other_ai" && !input.openAiSections.has(section);
    const band = isAiFolded ? (bandOf.get(section) ?? null) : null;
    if (band !== null) bandOf.delete(section);
    const refRow = box.kind === "sentence" && readWrittenRefMark(box.row) !== null ? box.row : null;
    const state = readState(box, input);
    const isMarkedNew = box.changeType === "new";
    boxes.set(box.unitId, {
      unitId: box.unitId, targetId: box.targetId, kind: box.kind, lang: box.lang, sourceIds: box.sourceIds, isAi: box.isAi, isMarkedNew, refRow, state, ai, isAiFolded, band,
      isLinkable: box.kind !== "bundle",
      key: [box.targetId, box.kind, box.lang, box.sourceIds.join(","), box.isAi, isMarkedNew, refRow ? readWrittenRefMark(refRow) : "", state ?? "", ai ?? "", isAiFolded, band?.count ?? ""].join("|"),
    });
  }
  return { boxes, unitOfTarget };
}

/** 이 Unit들의 얹기 키 - 얹을 것이 없으면 빈 글 */
export function readOverlayKey(boxes: ReadonlyMap<number, NewBox>, unitIds: ReadonlySet<number>): string {
  return [...unitIds].flatMap((id) => boxes.get(id) ? `${id}:${boxes.get(id)?.key}` : []).join(";");
}

/** 이 박스에 Old 줄을 이을 수 없는 까닭(문구 키) - 이을 수 있으면 null. part는 그 박스가 놓인 탭(본문 · 머리말 · 꼬리말 · 그림) */
export function readUnlinkableKey(unit: ViewUnit, box: NewBox | undefined, part: string): string | null {
  if (box?.isLinkable) return null;
  if (unit.noise_kind) return "assign.newPaper.why.noise";
  if (part === "header" || part === "footer") return "assign.newPaper.why.repeated";
  if (unit.kind === "heading") return "assign.newPaper.why.heading";
  if (unit.kind === "caption") return "assign.newPaper.why.caption";
  if (box !== undefined || unit.kind === "table" || unit.kind === "figure") return "assign.newPaper.why.bundle";
  return "assign.newPaper.why.noTarget";
}
