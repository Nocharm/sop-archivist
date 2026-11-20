// 같은 문서의 쓰기를 한 줄로 - 앞 쓰기의 응답 뒤에 다음을 보낸다(설계 2026-11-20 D4). 같은 revision으로 두 쓰기가 나가 둘째가 409가 되지 않게 -
// 보낼 revision은 doc-revision이 앞 응답의 것으로 이어 준다. 앞 쓰기가 실패해도 다음은 간다(그 실패는 앞 일이 알린다 - 앞 일이 은퇴시킨 Unit을
// 가리키면 서버가 거절하고 그 일이 알린다). 문서마다의 줄은 화면과 무관한 모듈 상태다(c-save-queue의 묶음 줄과 같은 짜임).

const tails = new Map<number, Promise<void>>();

/** 그 문서의 줄 끝에 쓰기 하나를 세운다 - docId가 null이면(문서 revision을 쓰지 않는 일) 바로 보낸다 */
export function enqueueDocWrite<T>(docId: number | null, write: () => Promise<T>): Promise<T> {
  if (docId === null) return write();
  const before = tails.get(docId) ?? Promise.resolve();
  const result = before.then(write);
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  tails.set(docId, tail);
  void tail.then(() => {
    if (tails.get(docId) === tail) tails.delete(docId);
  });
  return result;
}

/** 그 문서에 아직 끝나지 않은 쓰기가 있나 */
export function isDocWriteQueued(docId: number): boolean {
  return tails.has(docId);
}
