// 이 탭이 쓰기 응답으로 알게 된 문서 revision - 편집 뒤 원문 보기를 다시 받기 전에 한 다음 편집이 낡은 revision을 들고 가
// 409 revision_conflict("다른 사람이 먼저 바꿨습니다")가 나지 않게 한다. 혼자 연달아 고칠 때 나던 토스트와 다시 받기가 이것이었다.
// 낡은 보기로 보내도 되는 까닭: 편집·짝은 Unit id로 대상을 가리키고 고친 Unit은 은퇴해 새 id가 되므로, 없어진 Unit을 가리키면 서버가 따로 거절한다.
// 다른 사람(또는 AI 작업)의 쓰기는 여기 없으니 그대로 409로 잡힌다.

const known = new Map<number, number>();

/** 쓰기 응답의 문서 revision을 적는다 - revision은 늘기만 해서 더 큰 값만 남긴다 */
export function noteDocRevision(docId: number, revision: number): void {
  if (revision > (known.get(docId) ?? 0)) known.set(docId, revision);
}

/** 보낼 revision - 화면이 든 값과 이 탭이 쓴 뒤 받은 값 중 큰 것 */
export function pickDocRevision(docId: number, revision: number): number {
  return Math.max(revision, known.get(docId) ?? 0);
}

/** 쓰기 하나를 보낸다 - 보낼 revision을 고르고, 응답의 새 revision을 적는다 */
export async function sendDocWrite<T extends { document_revision: number }>(docId: number, revision: number, send: (revision: number) => Promise<T>): Promise<T> {
  const result = await send(pickDocRevision(docId, revision));
  noteDocRevision(docId, result.document_revision);
  return result;
}
