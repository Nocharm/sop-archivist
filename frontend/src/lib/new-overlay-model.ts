// 이미 쓴 New 문서의 용지(components/assign/new-paper) 위에 얹을 것 - 박스는 Unit이고 New 문장은 new_unit_id로 잇는다.
// Unit마다 한 덩이(NewBox)를 여기서 다 정하고 용지는 그리기만 한다. 덩이의 key는 그리는 값 전부를 이은 글이라, 화면에서 먼 덩어리는 제 Unit의 key가 바뀔 때만 다시 그린다(PaperChunk).
import type { BundleCell, ChangeType, UnitLang, ViewUnit, WrittenSentence } from "@/lib/api-sop";
import { getNewRowKey } from "@/lib/composed-model";
import { readNewAiSectionKey, type NewAiBand, type NewAiFilter, type NewAiMark } from "@/lib/new-ai-filter-model";
import { readWrittenRefMark } from "@/lib/ref-model";

/** 박스의 모양 - 출처 없는 New에서 고른 것, 이은 곳(간 곳), 이을 후보, 출처 없음 */
export type NewBoxState = "focus" | "picked" | "candidate" | "unsourced";

/** 원문 조각이 없는 칸 문장(칸 번역) - 같은 행 · 열의 칸 조각 아래에 읽기 전용으로 보인다 */
export interface NewCellNote {
  targetId: number;
  lang: UnitLang;
  text: string;
  isOpen: boolean;
  isAi: boolean;
  sourceIds: readonly number[];
}

export interface NewBox {
  unitId: number;
  targetId: number;
  kind: "sentence" | "cell" | "bundle";
  lang: UnitLang;
  /** 이은 Old 단위(출처 순서) */
  sourceIds: readonly number[];
  isAi: boolean;
  isMarkedNew: boolean;
  /** 확정하지 않았다 - 표 칸은 점선 테두리 */
  isOpen: boolean;
  /** 이 칸 아래에 딸린 칸 문장 */
  notes: readonly NewCellNote[];
  /** 참조 줄 표시가 있는 문장 - 칩 줄의 RefMark가 그린다 */
  refRow: WrittenSentence | null;
  state: NewBoxState | undefined;
  /** AI 거르기의 표시 - 거르지 않으면 없다 */
  ai: NewAiMark | undefined;
  /** AI 거르기로 접혔다 */
  isAiFolded: boolean;
  /** 접힌 자리의 띠 - 칸마다(탭이 다르면 탭마다) 첫 접힌 박스 하나에만, count는 거기 접힌 박스 수 */
  band: NewAiBand | null;
  /** Old 줄을 이을 수 있나 - 문장과 표 칸만(표 · 그림은 아니다) */
  isLinkable: boolean;
  /** 표 칸의 자리(0부터) - 고른 칸의 꼬리표 "r행 c열". 문장 · 묶음은 null */
  cellAt: { row: number; col: number } | null;
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
  aiFilter: NewAiFilter | null;
  /** AI 거르기에서 띠를 눌러 펼친 칸(readNewAiSectionKey) */
  openAiSections: ReadonlySet<string>;
  /** Unit이 놓인 탭(PaperTabs.tabOf) - 없으면 모두 한 탭으로 친다 */
  tabOf?: ReadonlyMap<number, string>;
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
  isOpen: boolean;
  changeType: ChangeType | null;
  /** 표 칸의 자리 - 문장 · 묶음은 없다 */
  place: string | null;
  cellAt: { row: number; col: number } | null;
}

function formatPlace(row: WrittenSentence, cell: BundleCell): string {
  return `${row.target_id}:${cell.row}:${cell.col}`;
}

function listRawBoxes(rows: readonly WrittenSentence[]): RawBox[] {
  return rows.flatMap((row) => {
    const own: RawBox[] =
      row.new_unit_id == null
        ? []
        : [{ row, unitId: row.new_unit_id, targetId: row.target_id, kind: row.kind === "sentence" ? "sentence" : "bundle", lang: row.lang, sourceIds: row.source_unit_ids, isAi: row.status === "ai_suggested", isOpen: row.status !== "confirmed", changeType: row.change_type, place: null, cellAt: null }];
    const cells = (row.table?.cells ?? []).flatMap((cell): RawBox[] =>
      cell.new_unit_id == null
        ? []
        : [{ row, unitId: cell.new_unit_id, targetId: cell.target_id, kind: "cell", lang: cell.lang, sourceIds: cell.source_unit_ids, isAi: cell.status === "ai_suggested", isOpen: cell.status !== "confirmed", changeType: cell.change_type ?? null, place: formatPlace(row, cell), cellAt: { row: cell.row, col: cell.col } }],
    );
    return [...own, ...cells];
  });
}

/** 같은 Unit의 새 문장 둘 중 보일 것 - 지금 보는 것(출처 없는 New의 고른 문장), 이을 곳으로 고른 것, 출처가 있는 것, 그다음 먼저 만든(작은 id) 것 */
function isPreferred(next: RawBox, held: RawBox, input: NewOverlayInput): boolean {
  const getRank = (box: RawBox) => (box.targetId === input.focusId ? 3 : input.pickedIds.has(box.targetId) ? 2 : box.sourceIds.length > 0 ? 1 : 0);
  const gap = getRank(next) - getRank(held);
  return gap !== 0 ? gap > 0 : next.targetId < held.targetId;
}

/** 원문 조각이 없는 칸 문장 → 그것을 보일 Unit(같은 자리의 마지막 칸 조각, 없으면 그 표) */
function listCellNotes(rows: readonly WrittenSentence[], held: ReadonlyMap<number, RawBox>): Array<{ unitId: number; note: NewCellNote }> {
  const unitAt = new Map<string, number>();
  for (const box of held.values()) if (box.place !== null) unitAt.set(box.place, box.unitId);
  return rows.flatMap((row) =>
    (row.table?.cells ?? []).flatMap((cell) => {
      const unitId = cell.new_unit_id == null ? (unitAt.get(formatPlace(row, cell)) ?? row.new_unit_id ?? null) : null;
      if (unitId === null) return [];
      return [{ unitId, note: { targetId: cell.target_id, lang: cell.lang, text: cell.text, isOpen: cell.status !== "confirmed", isAi: cell.status === "ai_suggested", sourceIds: cell.source_unit_ids } }];
    }),
  );
}

function readState(box: RawBox, input: NewOverlayInput): NewBoxState | undefined {
  if (box.targetId === input.focusId) return "focus";
  if (input.pickedIds.has(box.targetId)) return "picked";
  if (input.candidateIds.has(box.targetId)) return "candidate";
  if (box.kind !== "bundle" && box.sourceIds.length === 0 && box.changeType !== "new") return "unsourced";
  return undefined;
}

/** AI 거르기의 표시 - 칸은 표째 거른다(표시는 표 박스 하나에) */
function readAiMark(box: RawBox, input: NewOverlayInput): NewAiMark | undefined {
  return box.kind === "cell" ? undefined : input.aiFilter?.marks.get(getNewRowKey(box.row));
}

/** 이 문서 보기에 없는 Unit의 새 문장이 있나 - 보기보다 새 목록이다(남의 나누기 · 합치기) */
export function hasStrayUnit(rows: readonly WrittenSentence[], unitIds: ReadonlySet<number>): boolean {
  const isStray = (unitId: number | null | undefined) => unitId != null && !unitIds.has(unitId);
  return rows.some((row) => isStray(row.new_unit_id) || (row.table?.cells ?? []).some((cell) => isStray(cell.new_unit_id)));
}

export function buildNewOverlay(input: NewOverlayInput): NewOverlay {
  const held = new Map<number, RawBox>();
  const unitOfTarget = new Map<number, number>();
  for (const box of listRawBoxes(input.rows)) {
    unitOfTarget.set(box.targetId, box.unitId);
    const before = held.get(box.unitId);
    if (!before || isPreferred(box, before, input)) held.set(box.unitId, box);
  }
  const notesOf = new Map<number, NewCellNote[]>();
  for (const { unitId, note } of listCellNotes(input.rows, held)) {
    notesOf.set(unitId, [...(notesOf.get(unitId) ?? []), note]);
    unitOfTarget.set(note.targetId, unitId);
  }
  // 접힌 박스는 칸 · 탭마다 띠 하나 - 띠가 다른 탭에 있으면 이 탭에서 펼칠 길이 없다
  const foldOf = new Map<number, { section: string; group: string }>();
  const foldCounts = new Map<string, number>();
  for (const box of held.values()) {
    const section = readNewAiSectionKey(box.row.section_path);
    if (readAiMark(box, input) !== "other_ai" || input.openAiSections.has(section)) continue;
    const group = `${input.tabOf?.get(box.unitId) ?? ""}:${section}`;
    foldOf.set(box.unitId, { section, group });
    foldCounts.set(group, (foldCounts.get(group) ?? 0) + 1);
  }
  const boxes = new Map<number, NewBox>();
  for (const box of held.values()) {
    const ai = readAiMark(box, input);
    const fold = foldOf.get(box.unitId);
    const isAiFolded = fold !== undefined;
    const count = fold === undefined ? undefined : foldCounts.get(fold.group);
    const band = fold !== undefined && count !== undefined ? { sectionKey: fold.section, count } : null;
    if (fold !== undefined) foldCounts.delete(fold.group);
    const notes = notesOf.get(box.unitId) ?? [];
    const refRow = box.kind === "sentence" && readWrittenRefMark(box.row) !== null ? box.row : null;
    const state = readState(box, input);
    const isMarkedNew = box.changeType === "new";
    boxes.set(box.unitId, {
      unitId: box.unitId, targetId: box.targetId, kind: box.kind, lang: box.lang, sourceIds: box.sourceIds, isAi: box.isAi, isMarkedNew, isOpen: box.isOpen, notes, refRow, state, ai, isAiFolded, band,
      isLinkable: box.kind !== "bundle",
      cellAt: box.cellAt,
      key: [box.targetId, box.kind, box.cellAt ? `${box.cellAt.row}:${box.cellAt.col}` : "", box.lang, box.sourceIds.join(","), box.isAi, isMarkedNew, box.isOpen, refRow ? readWrittenRefMark(refRow) : "", state ?? "", ai ?? "", isAiFolded, band?.count ?? "", notes.length > 0 ? JSON.stringify(notes) : ""].join("|"),
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

/** 표마다 칸 문장 수와 그중 Old에 이은 수 - 표 머리 "칸 문장 n 가운데 m 이음"(쪼개기 먼저 §8 4-3). 칸 박스의 표는 Unit의 group_unit_id로 찾는다 */
export function readTableLinks(model: { units: ReadonlyMap<number, ViewUnit> }, boxes: ReadonlyMap<number, NewBox>): ReadonlyMap<number, { linked: number; total: number }> {
  const links = new Map<number, { linked: number; total: number }>();
  for (const box of boxes.values()) {
    const tableId = box.kind === "cell" ? model.units.get(box.unitId)?.group_unit_id : null;
    if (tableId == null) continue;
    const count = links.get(tableId) ?? { linked: 0, total: 0 };
    links.set(tableId, { linked: count.linked + (box.sourceIds.length > 0 ? 1 : 0), total: count.total + 1 });
  }
  return links;
}
