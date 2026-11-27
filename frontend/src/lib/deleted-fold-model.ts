// 삭제 접기 모델 - 삭제로 확정한 줄을 Assign 용지에서 목차 블록처럼 흐린 한 줄 "DELETED · 종류 · 앞부분 글"로 접는다(설계 2026-11-20 D6).
// 줄(짝이면 구성원 모두)이 확정 · 삭제이거나 방금 삭제를 눌렀을 때만 접고, Confirmed 거르기 · 고른 박스가 든 줄은 평소 박스로 둔다(고른 동안만 펼침, 떠나면 다시 접힘).
// 고름은 접을 단위(buildDeletedFolds)가 아니라 카드를 읽을 때(readDeletedLine) 본다 - 고를 때마다 접을 단위가 바뀌면 용지의 먼 덩어리까지 다시 그린다.

import type { ClassifyRow } from "./classify-model";
import type { UnitRow } from "./api-sop";

export type DeletedKind = "KO/EN" | "KO" | "EN" | "TABLE" | "FIGURE";

/** 접힌 단위 하나 - 같은 줄의 구성원은 rowKey · remark가 같다 */
export interface DeletedFold {
  rowKey: string;
  /** 그 줄의 Remark(삭제 사유) - 비었으면 툴팁이 없다 */
  remark: string;
  kind: "text" | "table" | "figure";
  lang: UnitRow["lang"];
  /** 문단 번호를 뺀 글, 빈칸은 한 칸으로 */
  text: string;
  /** 아직 저장 전이다 - 누른 순간의 접힘(전환을 튼다). 저장되면 빠진다 */
  isPending?: true;
}

/** 용지 카드 한 장의 접힌 줄 */
export interface DeletedLine {
  rowKey: string;
  kind: DeletedKind | null;
  text: string;
  remark: string;
  isPending?: true;
}

export interface DeletedFoldOptions {
  /** 지금 거르기 - Confirmed에서는 삭제 줄을 펼친 채 보인다(설계 확인할 것 1 기본안) */
  filter: string;
  /** 삭제를 눌렀고 아직 저장되지 않은 줄(달리는 · 기다리는 · 멈춘 명령) - 응답을 기다리지 않고 접는다(A2-R6) */
  pendingDeletes: ReadonlySet<string>;
}

/** 앞부분 글의 상한(글자) - 줄은 CSS가 말줄임하고, 이것은 긴 표 글을 DOM에 다 싣지 않으려는 것 */
const TEXT_LIMIT = 160;

type FoldUnit = Pick<UnitRow, "kind" | "lang" | "text" | "content_start" | "status" | "decision">;

/** 삭제로 확정한 단위 - 접힌 줄이 되고, 삭제 뒤 고름(다음 박스)은 이것을 건너뛴다 */
export function isDeletedUnit(unit: Pick<UnitRow, "status" | "decision"> | undefined): boolean {
  return unit !== undefined && unit.status === "confirmed" && unit.decision.disposition === "delete";
}

function readFoldText(unit: FoldUnit): string {
  return unit.text.slice(unit.content_start).replace(/\s+/g, " ").trim().slice(0, TEXT_LIMIT);
}

/** 접을 단위 → 접힌 내용. 줄의 Unit이 모두 확정 · 삭제인 줄과 방금 삭제를 눌러 저장 중인 줄만(고름은 보지 않는다 - readDeletedLine · isDeletedLineOpen) */
export function buildDeletedFolds(rows: ReadonlyArray<Pick<ClassifyRow, "key" | "unitIds">>, unitMap: ReadonlyMap<number, FoldUnit>, options: DeletedFoldOptions): ReadonlyMap<number, DeletedFold> {
  const folds = new Map<number, DeletedFold>();
  if (options.filter === "confirmed") return folds;
  for (const row of rows) {
    if (row.unitIds.length === 0) continue;
    const units = row.unitIds.map((id) => unitMap.get(id));
    if (units.some((unit) => unit === undefined)) continue;
    const isSaved = units.every(isDeletedUnit);
    if (!isSaved && !options.pendingDeletes.has(row.key)) continue;
    // 저장 전이면 판단의 사유는 아직 옛것(보류 사유 등)이다
    const remark = isSaved ? (units.map((unit) => unit?.decision.reason.trim() ?? "").find((reason) => reason !== "") ?? "") : "";
    row.unitIds.forEach((id, index) => {
      const unit = units[index] as FoldUnit;
      folds.set(id, { rowKey: row.key, remark, kind: unit.kind === "table" || unit.kind === "figure" ? unit.kind : "text", lang: unit.lang, text: readFoldText(unit), ...(isSaved ? {} : { isPending: true }) });
    });
  }
  return folds;
}

/** 저장되지 못해 풀린 줄(버린 삭제)의 접힌 내용 - 펼침도 전환하도록 감싼 채 둔다. 다시 접히면 빠진다 */
export function listReleasedFolds(released: ReadonlyMap<number, DeletedFold>, prev: ReadonlyMap<number, DeletedFold>, next: ReadonlyMap<number, DeletedFold>): ReadonlyMap<number, DeletedFold> {
  const dropped = [...prev].filter(([, fold]) => fold.isPending);
  return new Map([...released, ...dropped].filter(([id]) => !next.has(id)));
}

/** 용지 카드 한 장(외톨이 줄 하나 또는 이웃한 짝 카드)의 접힌 줄 - 카드의 단위가 모두 접혔을 때만, 아니면 null.
 *  고름과 상관없이 돌려준다 - 펼칠지는 isDeletedLineOpen(펼침 · 접힘을 전환하려면 둘 다 그려야 한다) */
export function readDeletedLine(folds: ReadonlyMap<number, DeletedFold>, unitIds: readonly number[]): DeletedLine | null {
  const parts = unitIds.map((id) => folds.get(id));
  if (parts.length === 0 || parts.some((part) => part === undefined)) return null;
  const items = parts as DeletedFold[];
  return { rowKey: items[0].rowKey, kind: readDeletedKind(items), text: items.map((item) => item.text).filter((text) => text !== "").join(" / "), remark: items[0].remark, isPending: items[0].isPending };
}

/** 접힌 줄을 펼쳐 보이나 - 고른 박스(focusUnitId)가 그 줄에 들었을 때만. 떨어진 짝이면 짝의 다른 카드도, 다른 박스를 고르면 다시 접힌다 */
export function isDeletedLineOpen(folds: ReadonlyMap<number, DeletedFold>, rowKey: string, focusUnitId: number | null): boolean {
  return focusUnitId !== null && folds.get(focusUnitId)?.rowKey === rowKey;
}

/** 종류 꼬리표 - 표 · 그림, 아니면 글의 언어(한/영 둘이면 KO/EN). 언어가 없는 글(참조 · 중립)은 꼬리표 없이 */
function readDeletedKind(items: readonly DeletedFold[]): DeletedKind | null {
  if (items.some((item) => item.kind === "table")) return "TABLE";
  if (items.some((item) => item.kind === "figure")) return "FIGURE";
  const langs = new Set(items.map((item) => item.lang));
  if (langs.has("ko") && langs.has("en")) return "KO/EN";
  if (langs.has("ko")) return "KO";
  if (langs.has("en")) return "EN";
  return null;
}
