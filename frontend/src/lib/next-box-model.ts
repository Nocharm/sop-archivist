// 판단을 누른 순간 고를 다음 박스 - 저장한 뒤의 규칙 그대로(같은 문서 · 같은 탭 · 거르기 목록 안, 되감기 없이, findNextAfterSave)인데,
// 아직 응답이 오지 않은 판단도 이미 된 것으로 센다(명세 2026-11-23-assign-feedback-2 A1-R2).

import { findNextAfterSave, type ClassifyRow } from "./classify-model";
import { readTocNavKey, readUnitNavKey, toUnitNavKey } from "./toc-block-model";

/** 보냈거나 보낼 판단이 그 줄을 어떻게 만드나 */
export type PendingOutcome = "deleted" | "confirmed" | "held";

export interface NextBoxInput {
  /** 줄 이동 차례(buildNavKeys) */
  order: readonly string[];
  rowMap: ReadonlyMap<string, Pick<ClassifyRow, "key" | "documentId" | "unitIds" | "status">>;
  rowOfUnit: ReadonlyMap<number, string>;
  /** 거르기 목록의 줄 */
  listed: ReadonlySet<string>;
  /** 차례가 줄 하나씩인가(Pair view) - 아니면 박스 하나씩 */
  isByRow: boolean;
  readTab: (unitId: number) => string;
  /** 이미 삭제로 확정된(접힌) 줄 */
  isDeleted: (rowKey: string) => boolean;
  /** 판단한 줄과 그 줄에서 고른 박스(없으면 첫 박스) */
  from: string;
  fromUnitId?: number | null;
  /** below - 삭제: 바로 아래 박스(없으면 바로 위), open - 다른 확정: 아래로 첫 미확정 */
  mode: "below" | "open";
  pending: ReadonlyMap<string, PendingOutcome>;
}

export function pickNextBox(input: NextBoxInput): { key: string; unitId: number } | null {
  const { order, rowMap, rowOfUnit, listed, readTab, pending, mode } = input;
  const saved = rowMap.get(input.from);
  if (saved === undefined) return null;
  const fromUnitId = input.fromUnitId != null && saved.unitIds.includes(input.fromUnitId) ? input.fromUnitId : saved.unitIds[0];
  const readRowKey = (navKey: string): string | null => {
    if (readTocNavKey(navKey) !== null) return null;
    const unitId = readUnitNavKey(navKey);
    return unitId === null ? navKey : (rowOfUnit.get(unitId) ?? null);
  };
  const readBoxId = (navKey: string, key: string) => readUnitNavKey(navKey) ?? rowMap.get(key)?.unitIds[0] ?? null;
  const isCandidate = (navKey: string): boolean => {
    const key = readRowKey(navKey);
    const row = key === null ? undefined : rowMap.get(key);
    if (key === null || row === undefined || key === saved.key || !listed.has(key) || row.documentId !== saved.documentId) return false;
    const boxId = readBoxId(navKey, key);
    if (boxId === null || readTab(boxId) !== readTab(fromUnitId)) return false;
    // 삭제할 것까지 접힌 줄로 센다 - 다만 다시 판단하는 줄(보류 · 확정)은 접히지 않는다
    const outcome = pending.get(key);
    return mode === "open" || !(outcome === undefined ? input.isDeleted(key) : outcome === "deleted");
  };
  const isOpen = (navKey: string): boolean => {
    const key = readRowKey(navKey) ?? "";
    const outcome = pending.get(key);
    return outcome === undefined ? rowMap.get(key)?.status !== "confirmed" : outcome === "held";
  };
  const next = findNextAfterSave(order, input.isByRow ? saved.key : toUnitNavKey(fromUnitId), mode, isCandidate, isOpen);
  const key = next === null ? null : readRowKey(next);
  const unitId = next === null || key === null ? null : readBoxId(next, key);
  return key === null || unitId === null ? null : { key, unitId };
}
