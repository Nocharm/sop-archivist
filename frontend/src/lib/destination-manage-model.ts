// 배정 화면에서 보낼 곳(새 문서·WI 단계)을 더하고 지울 때의 규칙 - 단추를 미리 잠그는 근거다. 서버는 저장할 때 같은 규칙을 다시 검사한다.

import type { TargetDoc, TargetDocType, ToBe } from "./api-sop";

/** 지울 수 없는 이유 - 올린 파일의 문서, 문장이 든 자리, 아래 WI가 남은 SOP */
export type RemoveBlock = "written" | "hasSentences" | "hasChildren";

export function getDocRemoveBlock(tobe: ToBe, doc: TargetDoc): RemoveBlock | null {
  if (doc.entrance !== "assign") return "written";
  if ((tobe.sentence_counts ?? []).some((row) => row.target_doc_id === doc.id)) return "hasSentences";
  if (tobe.docs.some((other) => other.parent_code === doc.code)) return "hasChildren";
  return null;
}

export function getStepRemoveBlock(tobe: ToBe, doc: TargetDoc, stepNo: number): RemoveBlock | null {
  return (tobe.sentence_counts ?? []).some((row) => row.target_doc_id === doc.id && row.wi_step === stepNo) ? "hasSentences" : null;
}

/** WI의 부모로 고를 수 있는 SOP 번호 - 목록 순서 */
export function listParentCodes(tobe: ToBe): string[] {
  return [...tobe.docs]
    .sort((a, b) => a.order_index - b.order_index || a.id - b.id)
    .filter((doc) => doc.doc_type === "sop")
    .map((doc) => doc.code);
}

export interface NewDocDraft {
  code: string;
  docType: TargetDocType;
  parentCode: string | null;
}

export type NewDocProblem = "codeRequired" | "codeTaken" | "parentRequired";

/** 새 문서 입력의 문제 - 없으면 null. 번호는 목록에서 하나뿐이고(앞뒤 공백은 뺀다) WI는 부모 SOP가 있어야 한다 */
export function checkNewDoc(tobe: ToBe, draft: NewDocDraft): NewDocProblem | null {
  const code = draft.code.trim();
  if (code === "") return "codeRequired";
  if (tobe.docs.some((doc) => doc.code === code)) return "codeTaken";
  if (draft.docType === "wi" && !listParentCodes(tobe).includes(draft.parentCode ?? "")) return "parentRequired";
  return null;
}

/** 방금 더한 단계의 번호 - 서버는 가장 큰 번호 다음을 준다. 응답에 그 문서의 단계가 없으면 null */
export function findLastStep(tobe: ToBe, docCode: string): number | null {
  const steps = tobe.wi_steps.filter((step) => step.code === docCode).map((step) => step.step_no);
  return steps.length > 0 ? Math.max(...steps) : null;
}
