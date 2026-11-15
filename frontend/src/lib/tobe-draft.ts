// New 문서 목록을 화면에 그리는 모양 - 서버 목록을 줄 키("id-<줄 id>")로 묶고(상위 SOP·N/A·단계가 번호가 아니라 줄에 묶인다) SOP 아래 WI 순서로 놓는다.
// 전에는 통째로 저장하기 전의 초안이었다. 지금은 칸마다 바로 저장해 초안이 없고, 그리는 모양만 남았다.

import type { TargetDoc, TargetDocType, ToBe } from "./api-sop";

export interface DraftDoc {
  /** 화면 키 - 서버 id가 없는 새 줄도 구분한다. 코드는 키 입력마다 바뀌므로 하위 항목은 코드가 아니라 이 키에 묶는다 */
  key: string;
  code: string;
  title: string;
  doc_type: TargetDocType;
  /** 부모 SOP 줄의 화면 키 */
  parent_key: string | null;
  is_equipment_sop: boolean;
  entrance: TargetDoc["entrance"];
}

export interface DraftNaSlot {
  doc_key: string;
  slot_key: string;
  reason: string;
}

export interface DraftStep {
  doc_key: string;
  step_no: number;
  title: string;
}

export interface ToBeDraft {
  docs: DraftDoc[];
  na_slots: DraftNaSlot[];
  wi_steps: DraftStep[];
}

export function createDraft(tobe: ToBe): ToBeDraft {
  // 서버 목록에서는 코드가 겹치지 않는다
  const keyByCode = new Map(tobe.docs.map((doc) => [doc.code, `id-${doc.id}`]));
  const keyOf = (code: string | null) => (code === null ? null : (keyByCode.get(code) ?? null));
  return {
    docs: tobe.docs.map((doc) => ({
      key: `id-${doc.id}`,
      code: doc.code,
      title: doc.title,
      doc_type: doc.doc_type,
      parent_key: keyOf(doc.parent_code),
      is_equipment_sop: doc.is_equipment_sop,
      entrance: doc.entrance,
    })),
    na_slots: tobe.na_slots.flatMap((slot) => {
      const docKey = keyOf(slot.code);
      return docKey === null ? [] : [{ doc_key: docKey, slot_key: slot.slot_key, reason: slot.reason }];
    }),
    wi_steps: tobe.wi_steps.flatMap((step) => {
      const docKey = keyOf(step.code);
      return docKey === null ? [] : [{ doc_key: docKey, step_no: step.step_no, title: step.title }];
    }),
  };
}

/** 보이는 순서: SOP마다 그 아래 WI, 부모를 못 찾은 WI는 끝에 */
export function orderDocs(docs: DraftDoc[]): Array<{ doc: DraftDoc; depth: 0 | 1 }> {
  const sops = docs.filter((doc) => doc.doc_type === "sop");
  const sopKeys = new Set(sops.map((doc) => doc.key));
  const rows: Array<{ doc: DraftDoc; depth: 0 | 1 }> = [];
  for (const sop of sops) {
    rows.push({ doc: sop, depth: 0 });
    for (const wi of docs) if (wi.doc_type === "wi" && wi.parent_key === sop.key) rows.push({ doc: wi, depth: 1 });
  }
  for (const doc of docs) if (doc.doc_type === "wi" && (doc.parent_key === null || !sopKeys.has(doc.parent_key))) rows.push({ doc, depth: 0 });
  return rows;
}
