// To-Be 목록 초안 - 화면에서 고친 목록을 통째로 저장(PUT)하기 전의 순수 모델. 부모·N/A·단계는 줄의 화면 키에 묶이고 저장할 때 그 줄의 지금 코드로 바뀐다. 저장 순서가 order_index가 된다.

import type { NaSlot, TargetDoc, TargetDocType, ToBe, ToBeInput, WiStep } from "./api-sop";

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

/** 번호만 바꾼다 - 부모·N/A·단계는 줄 키에 묶여 있어 저장할 때 새 번호를 따라간다 */
export function renameDoc(draft: ToBeDraft, key: string, nextCode: string): ToBeDraft {
  return { ...draft, docs: draft.docs.map((item) => (item.key === key ? { ...item, code: nextCode } : item)) };
}

/** 줄을 지우면 그 문서의 N/A·단계도 지우고, 그 SOP를 부모로 둔 WI는 부모가 빈다 */
export function removeDoc(draft: ToBeDraft, key: string): ToBeDraft {
  return {
    docs: draft.docs.filter((item) => item.key !== key).map((item) => (item.parent_key === key ? { ...item, parent_key: null } : item)),
    na_slots: draft.na_slots.filter((slot) => slot.doc_key !== key),
    wi_steps: draft.wi_steps.filter((step) => step.doc_key !== key),
  };
}

/** 종류를 바꾸면 그 종류에 없는 것을 비운다(SOP는 부모·단계 없음, WI는 장비·N/A·하위 WI 없음) */
export function changeDocType(draft: ToBeDraft, key: string, nextType: TargetDocType): ToBeDraft {
  const doc = draft.docs.find((item) => item.key === key);
  if (!doc || doc.doc_type === nextType) return draft;
  return {
    docs: draft.docs.map((item) => {
      if (item.key === key) {
        return { ...item, doc_type: nextType, parent_key: nextType === "sop" ? null : item.parent_key, is_equipment_sop: nextType === "sop" && item.is_equipment_sop };
      }
      return nextType === "wi" && item.parent_key === key ? { ...item, parent_key: null } : item;
    }),
    na_slots: nextType === "wi" ? draft.na_slots.filter((slot) => slot.doc_key !== key) : draft.na_slots,
    wi_steps: nextType === "sop" ? draft.wi_steps.filter((step) => step.doc_key !== key) : draft.wi_steps,
  };
}

/** SOP 칸 N/A 켜기·끄기 - 켤 때 사유는 비어 있다 */
export function setNaSlot(draft: ToBeDraft, key: string, slotKey: string, checked: boolean): ToBeDraft {
  const rest = draft.na_slots.filter((slot) => !(slot.doc_key === key && slot.slot_key === slotKey));
  return { ...draft, na_slots: checked ? [...rest, { doc_key: key, slot_key: slotKey, reason: "" }] : rest };
}

/** 새 단계는 그 WI에서 가장 큰 번호 다음을 받는다 - 지운 번호를 다시 쓰지 않는다 */
export function addStep(draft: ToBeDraft, key: string): ToBeDraft {
  const last = Math.max(0, ...draft.wi_steps.filter((step) => step.doc_key === key).map((step) => step.step_no));
  return { ...draft, wi_steps: [...draft.wi_steps, { doc_key: key, step_no: last + 1, title: "" }] };
}

/** 단계를 지워도 남은 단계의 번호는 그대로다(빈 번호 허용) */
export function removeStep(draft: ToBeDraft, key: string, stepNo: number): ToBeDraft {
  return { ...draft, wi_steps: draft.wi_steps.filter((step) => !(step.doc_key === key && step.step_no === stepNo)) };
}

/**
 * 저장 요청 - 보이는 순서가 order_index다. 단계 번호는 그대로 보낸다:
 * 서버는 (code, step_no)로 단계를 알아보고 분류한 문장은 wi_step 번호를 가리키므로, 다시 매기면 문장이 다른 단계 밑으로 옮겨간다.
 */
export function buildToBeInput(draft: ToBeDraft, revision: number): ToBeInput {
  const rows = orderDocs(draft.docs);
  const codeByKey = new Map(draft.docs.map((doc) => [doc.key, doc.code.trim()]));
  const steps: WiStep[] = [];
  const slots: NaSlot[] = [];
  for (const { doc } of rows) {
    const code = doc.code.trim();
    draft.wi_steps
      .filter((step) => step.doc_key === doc.key)
      .sort((a, b) => a.step_no - b.step_no)
      .forEach((step) => steps.push({ code, step_no: step.step_no, title: step.title.trim() }));
    draft.na_slots.filter((slot) => slot.doc_key === doc.key).forEach((slot) => slots.push({ code, slot_key: slot.slot_key, reason: slot.reason.trim() }));
  }
  return {
    revision,
    docs: rows.map(({ doc }, index) => ({
      code: doc.code.trim(),
      title: doc.title.trim(),
      doc_type: doc.doc_type,
      parent_code: doc.doc_type === "wi" && doc.parent_key !== null ? (codeByKey.get(doc.parent_key) ?? null) : null,
      is_equipment_sop: doc.doc_type === "sop" && doc.is_equipment_sop,
      order_index: index,
    })),
    na_slots: slots,
    wi_steps: steps,
  };
}

export function isDraftDirty(draft: ToBeDraft, base: ToBe): boolean {
  return JSON.stringify(buildToBeInput(draft, base.revision)) !== JSON.stringify(buildToBeInput(createDraft(base), base.revision));
}
