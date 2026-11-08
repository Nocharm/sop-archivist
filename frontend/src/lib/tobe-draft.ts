// To-Be 목록 초안 - 화면에서 고친 목록을 통째로 저장(PUT)하기 전의 순수 모델. 번호를 바꾸면 N/A·단계가 따라가고, 저장 순서가 order_index가 된다.

import type { NaSlot, TargetDoc, TargetDocType, ToBe, ToBeInput, WiStep } from "./api-sop";

export interface DraftDoc {
  /** 화면 키 - 서버 id가 없는 새 줄도 구분한다 */
  key: string;
  code: string;
  title: string;
  doc_type: TargetDocType;
  parent_code: string | null;
  is_equipment_sop: boolean;
  entrance: TargetDoc["entrance"];
}

export interface ToBeDraft {
  docs: DraftDoc[];
  na_slots: NaSlot[];
  wi_steps: WiStep[];
}

export function createDraft(tobe: ToBe): ToBeDraft {
  return {
    docs: tobe.docs.map((doc) => ({
      key: `id-${doc.id}`,
      code: doc.code,
      title: doc.title,
      doc_type: doc.doc_type,
      parent_code: doc.parent_code,
      is_equipment_sop: doc.is_equipment_sop,
      entrance: doc.entrance,
    })),
    na_slots: tobe.na_slots.map((slot) => ({ ...slot })),
    wi_steps: tobe.wi_steps.map((step) => ({ ...step })),
  };
}

/** 보이는 순서: SOP마다 그 아래 WI, 부모를 못 찾은 WI는 끝에 */
export function orderDocs(docs: DraftDoc[]): Array<{ doc: DraftDoc; depth: 0 | 1 }> {
  const sops = docs.filter((doc) => doc.doc_type === "sop");
  const sopCodes = new Set(sops.map((doc) => doc.code));
  const rows: Array<{ doc: DraftDoc; depth: 0 | 1 }> = [];
  for (const sop of sops) {
    rows.push({ doc: sop, depth: 0 });
    for (const wi of docs) if (wi.doc_type === "wi" && wi.parent_code === sop.code) rows.push({ doc: wi, depth: 1 });
  }
  for (const doc of docs) if (doc.doc_type === "wi" && (doc.parent_code === null || !sopCodes.has(doc.parent_code))) rows.push({ doc, depth: 0 });
  return rows;
}

/** 번호를 바꾸면 그 번호를 가리키던 부모·N/A·단계도 함께 바꾼다 */
export function renameDoc(draft: ToBeDraft, key: string, nextCode: string): ToBeDraft {
  const doc = draft.docs.find((item) => item.key === key);
  if (!doc) return draft;
  const prev = doc.code;
  return {
    docs: draft.docs.map((item) =>
      item.key === key ? { ...item, code: nextCode } : item.parent_code === prev && prev !== "" ? { ...item, parent_code: nextCode } : item,
    ),
    na_slots: draft.na_slots.map((slot) => (slot.code === prev ? { ...slot, code: nextCode } : slot)),
    wi_steps: draft.wi_steps.map((step) => (step.code === prev ? { ...step, code: nextCode } : step)),
  };
}

/** 줄을 지우면 그 문서의 N/A·단계도 지우고, 그 SOP를 부모로 둔 WI는 부모가 빈다 */
export function removeDoc(draft: ToBeDraft, key: string): ToBeDraft {
  const doc = draft.docs.find((item) => item.key === key);
  if (!doc) return draft;
  return {
    docs: draft.docs.filter((item) => item.key !== key).map((item) => (item.parent_code === doc.code ? { ...item, parent_code: null } : item)),
    na_slots: draft.na_slots.filter((slot) => slot.code !== doc.code),
    wi_steps: draft.wi_steps.filter((step) => step.code !== doc.code),
  };
}

/** 종류를 바꾸면 그 종류에 없는 것을 비운다(SOP는 부모·단계 없음, WI는 장비·N/A 없음) */
export function changeDocType(draft: ToBeDraft, key: string, nextType: TargetDocType): ToBeDraft {
  const doc = draft.docs.find((item) => item.key === key);
  if (!doc || doc.doc_type === nextType) return draft;
  return {
    docs: draft.docs.map((item) =>
      item.key === key
        ? { ...item, doc_type: nextType, parent_code: nextType === "sop" ? null : item.parent_code, is_equipment_sop: nextType === "sop" && item.is_equipment_sop }
        : item,
    ),
    na_slots: nextType === "wi" ? draft.na_slots.filter((slot) => slot.code !== doc.code) : draft.na_slots,
    wi_steps: nextType === "sop" ? draft.wi_steps.filter((step) => step.code !== doc.code) : draft.wi_steps,
  };
}

/** 새 단계는 그 WI에서 가장 큰 번호 다음을 받는다 - 지운 번호를 다시 쓰지 않는다 */
export function addStep(draft: ToBeDraft, key: string): ToBeDraft {
  const doc = draft.docs.find((item) => item.key === key);
  if (!doc) return draft;
  const last = Math.max(0, ...draft.wi_steps.filter((step) => step.code === doc.code).map((step) => step.step_no));
  return { ...draft, wi_steps: [...draft.wi_steps, { code: doc.code, step_no: last + 1, title: "" }] };
}

/** 단계를 지워도 남은 단계의 번호는 그대로다(빈 번호 허용) */
export function removeStep(draft: ToBeDraft, key: string, stepNo: number): ToBeDraft {
  const doc = draft.docs.find((item) => item.key === key);
  if (!doc) return draft;
  return { ...draft, wi_steps: draft.wi_steps.filter((step) => !(step.code === doc.code && step.step_no === stepNo)) };
}

/**
 * 저장 요청 - 보이는 순서가 order_index다. 단계 번호는 그대로 보낸다:
 * 서버는 (code, step_no)로 단계를 알아보고 분류한 문장은 wi_step 번호를 가리키므로, 다시 매기면 문장이 다른 단계 밑으로 옮겨간다.
 */
export function buildToBeInput(draft: ToBeDraft, revision: number): ToBeInput {
  const rows = orderDocs(draft.docs);
  const steps: WiStep[] = [];
  for (const { doc } of rows) {
    draft.wi_steps
      .filter((step) => step.code === doc.code)
      .sort((a, b) => a.step_no - b.step_no)
      .forEach((step) => steps.push({ code: doc.code, step_no: step.step_no, title: step.title.trim() }));
  }
  return {
    revision,
    docs: rows.map(({ doc }, index) => ({
      code: doc.code.trim(),
      title: doc.title.trim(),
      doc_type: doc.doc_type,
      parent_code: doc.doc_type === "wi" ? doc.parent_code : null,
      is_equipment_sop: doc.doc_type === "sop" && doc.is_equipment_sop,
      order_index: index,
    })),
    na_slots: draft.na_slots.map((slot) => ({ ...slot, reason: slot.reason.trim() })),
    wi_steps: steps,
  };
}

export function isDraftDirty(draft: ToBeDraft, base: ToBe): boolean {
  return JSON.stringify(buildToBeInput(draft, base.revision)) !== JSON.stringify(buildToBeInput(createDraft(base), base.revision));
}
