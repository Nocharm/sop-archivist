// Assign New 칸의 아직 쓰지 않은 문서 - 서버가 결과물 C 규칙으로 엮은 문서(ComposedDoc)를 New 칸 줄로 펴고,
// 저장 응답으로 서버 다시 읽기 전에 미리 고친다(칸 끝에 넣기·지우기). 순서·번호는 다시 읽은 서버 값이 정한다.
import type { ComposedDoc, ComposedItem, GroupTarget, WrittenSentence } from "@/lib/api-sop";

/** 아무것도 받지 않은 칸 - 옅은 자리 표시. key는 칸 키라 칸이 차고 비어도 같은 줄로 읽힌다 */
export interface EmptySlotRow {
  kind: "empty";
  key: string;
  section_path: string;
  /** N/A 칸 */
  na: boolean;
}

export type NewPaneRow = WrittenSentence | EmptySlotRow;

/** New 칸 줄의 키 - 문장은 target id, 빈 칸은 칸 키 */
export function getNewRowKey(row: NewPaneRow): string {
  return row.kind === "empty" ? `slot:${row.key}` : `t:${row.target_id}`;
}

export function isWrittenRow(row: NewPaneRow): row is WrittenSentence {
  return row.kind !== "empty";
}

/** 칸 머리 글 - 번호가 있으면 "5.1. 이름"(New 칸은 앞 번호를 앞머리에 옮겨 보인다) */
function formatSectionPath(number: string | null, label: string): string {
  return number ? `${number}. ${label}` : label;
}

/** 엮은 문서를 New 칸 줄로 - 칸 순서대로 받은 새 문장, 빈 칸은 자리 표시 한 줄. 쓰지 않은 문서라 Remark·짝 카드는 없다 */
export function buildComposedRows(doc: ComposedDoc): NewPaneRow[] {
  const rows: NewPaneRow[] = [];
  for (const section of doc.sections) {
    const path = formatSectionPath(section.number, section.label);
    if (section.items.length === 0) {
      rows.push({ kind: "empty", key: section.location_key, section_path: path, na: section.na_reason !== null });
      continue;
    }
    section.items.forEach((item, index) => {
      rows.push({
        target_id: item.target_id,
        target_doc_id: doc.target_doc_id,
        doc_code: doc.code,
        section_path: path,
        order_index: index,
        lang: item.lang,
        kind: item.kind,
        text: item.text,
        status: item.status,
        change_type: item.change_type,
        source_unit_ids: item.source_unit_ids,
        partner_target_id: null,
        remark: "",
        revision: 0,
      });
    });
  }
  return rows;
}

/** 저장한 새 문장이 놓일 칸 키 - 서버 _plan_sections의 키와 같은 모양 */
function readSectionKey(target: GroupTarget): string | null {
  if (target.slot_key !== null) return target.slot_key;
  if (target.wi_part === null) return null;
  return target.wi_step === null ? `unstepped:${target.wi_part}` : `step:${target.wi_step}:${target.wi_part}`;
}

/**
 * 저장 응답으로 미리 고친 문서 - 이 저장의 새 문장을 모든 칸에서 뺀 뒤 이 문서에 속한 최상위 문장을 제 칸 끝에 넣는다.
 * 칸이 아직 없으면(단계 없음 칸 등) 넣지 않는다 - 곧 다시 읽는 서버 값이 채운다. textOf는 고친 글이 없을 때 출처 원문
 */
export function applySavedTargets(doc: ComposedDoc, targets: readonly GroupTarget[], textOf: (unitIds: number[]) => string): ComposedDoc {
  const savedIds = new Set(targets.map((target) => target.id));
  const placed = new Map<string, ComposedItem[]>();
  for (const target of targets) {
    if (target.target_doc_id !== doc.target_doc_id || target.parent_target_id !== null) continue;
    // 칸 제목은 칸 항목이 아니다 - 머리 줄 출처는 곧 다시 읽는 서버 값이 채운다
    if (target.kind === "slot_heading") continue;
    const key = readSectionKey(target);
    if (key === null) continue;
    const item: ComposedItem = {
      target_id: target.id,
      kind: target.kind,
      lang: target.lang,
      text: target.confirmed_text || target.ai_text || textOf(target.source_unit_ids),
      status: target.status,
      change_type: target.change_type,
      number: null,
      source_unit_ids: target.source_unit_ids,
    };
    placed.set(key, [...(placed.get(key) ?? []), item]);
  }
  return {
    ...doc,
    sections: doc.sections.map((section) => {
      const kept = section.items.filter((item) => !savedIds.has(item.target_id));
      return { ...section, items: [...kept, ...(placed.get(section.location_key) ?? [])] };
    }),
  };
}

/**
 * 줄 목록이 바뀐 차이 - 새로 들어온 줄 키와, 빠진 줄을 바로 뒤에 남은 줄 키(없으면 "")에 매단 것.
 * 빠진 줄은 그 자리에서 접히며 사라지게 잠깐 더 그리고, 들어온 줄은 펼치며 나타난다(New 칸 실시간 넣기)
 */
export function diffRows<T>(previous: readonly T[], next: readonly T[], keyOf: (row: T) => string): { added: Set<string>; leaving: Map<string, T[]> } {
  const before = new Set(previous.map(keyOf));
  const after = new Set(next.map(keyOf));
  const added = new Set([...after].filter((key) => !before.has(key)));
  const leaving = new Map<string, T[]>();
  let pending: T[] = [];
  for (const row of previous) {
    const key = keyOf(row);
    if (!after.has(key)) {
      pending.push(row);
      continue;
    }
    if (pending.length > 0) leaving.set(key, pending);
    pending = [];
  }
  if (pending.length > 0) leaving.set("", pending);
  return { added, leaving };
}

/** 배정을 지운 Unit의 새 문장을 미리 뺀 문서 - 출처가 모두 지운 Unit인 문장만 */
export function removeClearedUnits(doc: ComposedDoc, unitIds: ReadonlySet<number>): ComposedDoc {
  return {
    ...doc,
    sections: doc.sections.map((section) => ({
      ...section,
      items: section.items.filter((item) => item.source_unit_ids.length === 0 || !item.source_unit_ids.every((id) => unitIds.has(id))),
    })),
  };
}
