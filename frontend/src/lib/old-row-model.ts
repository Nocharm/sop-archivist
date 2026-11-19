// Old 목록의 줄 규칙(Documents 화면 설계 §5) - 어떤 문서가 줄이 되고, 줄 끝에 어떤 단추가 오고, 어떤 줄이 펼쳐지는가.
import type { SopDocument } from "./api-sop";

/** side "new"이고 New 목록 줄이 없다 - 읽지 못해 줄이 생기지 않은 New 파일이라 지울 수 있게 Old 목록 끝에 남는다 */
export function isStrayNew(document: Pick<SopDocument, "side" | "target_doc_id">): boolean {
  return document.side === "new" && document.target_doc_id === null;
}

/** 위 목록의 줄 - Old 문서 먼저(서버 순서), 그 뒤에 줄 없는 New 파일 */
export function listOldRows(documents: readonly SopDocument[]): SopDocument[] {
  return [...documents.filter((document) => document.side === "old"), ...documents.filter(isStrayNew)];
}

export type OldActionKey = "preview" | "download" | "delete";

/** 줄 끝 단추 - 읽힌 문서는 preview·download, 고칠 수 있으면 끝에 delete */
export function listOldActions(document: Pick<SopDocument, "status">, canEdit: boolean): OldActionKey[] {
  return [...(document.status === "ready" ? (["preview", "download"] as const) : []), ...(canEdit ? (["delete"] as const) : [])];
}

/** 펼칠 수 있는 줄 - 읽힌 문서만(받지 못한 파일은 고칠 값이 없다) */
export function canExpandOld(document: Pick<SopDocument, "status">): boolean {
  return document.status === "ready";
}
