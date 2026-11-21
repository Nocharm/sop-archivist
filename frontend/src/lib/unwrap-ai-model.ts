// 벗긴 표의 AI 순서 제안(B11) - 지금 덩이 줄 차례와 제안 차례를 견줘 미리 보기 칩("4 → 1")을 만드는 순수 모델.
// 서버가 덩이 줄의 순열인지 확인하고 저장하지만, 그 사이 줄이 바뀌었을 수 있어 화면이 한 번 더 같은 집합인지 본다

/** 제안 순번 - 1부터. moved면 지금 자리(from)와 제안 자리(to)가 다르다 */
export interface UnwrapLineMove {
  from: number;
  to: number;
  moved: boolean;
}

/** 지금 덩이 줄과 제안이 같은 줄 집합이면 참 - 아니면(줄이 늘거나 줄었다) 낡은 제안이라 미리 보기를 두지 않는다 */
export function isUnwrapSuggestionApplicable(current: readonly number[], suggested: readonly number[]): boolean {
  if (current.length < 2 || current.length !== suggested.length) return false;
  const ids = new Set(current);
  return ids.size === current.length && new Set(suggested).size === suggested.length && suggested.every((id) => ids.has(id));
}

/** 줄마다 지금 자리 → 제안 자리(1부터). 적용할 수 없는 제안이면 빈 표 */
export function readUnwrapMoves(current: readonly number[], suggested: readonly number[]): Map<number, UnwrapLineMove> {
  const moves = new Map<number, UnwrapLineMove>();
  if (!isUnwrapSuggestionApplicable(current, suggested)) return moves;
  const target = new Map(suggested.map((id, index) => [id, index + 1]));
  current.forEach((id, index) => {
    const to = target.get(id) ?? index + 1;
    moves.set(id, { from: index + 1, to, moved: to !== index + 1 });
  });
  return moves;
}

/** 제안이 지금 차례와 같다 - 놓을 것이 없어 "이미 같다"만 보이고 닫는 단추만 둔다 */
export function isUnwrapSuggestionUnchanged(current: readonly number[], suggested: readonly number[]): boolean {
  return isUnwrapSuggestionApplicable(current, suggested) && current.every((id, index) => id === suggested[index]);
}

/** 순서 제안을 요청한 표 하나 - baseline은 이 요청이 끝났다고 셀 수 있는 지금까지 끝난 순서 작업의 수(요청 때 끝난 수 + 앞서 기다리는 수 + 1) */
export interface UnwrapAiAsk {
  tableId: number;
  doneAt: number;
}

/** 요청 때 새 요청의 끝 기준을 정한다 - 아직 안 끝난 앞 요청 뒤에 줄 선다 */
export function addUnwrapAiAsk(asks: readonly UnwrapAiAsk[], tableId: number, finished: number): UnwrapAiAsk[] {
  const waiting = asks.filter((ask) => ask.tableId !== tableId && finished < ask.doneAt);
  return [...waiting, { tableId, doneAt: finished + waiting.length + 1 }];
}

/** 작업 중 칩을 보일 표 - 이 종류의 끝난 작업(done·failed·stale·cancelled) 수가 기준에 닿으면 성공 · 실패 가리지 않고 걷힌다 */
export function listUnwrapAiBusy(asks: readonly UnwrapAiAsk[], finished: number): Set<number> {
  return new Set(asks.filter((ask) => finished < ask.doneAt).map((ask) => ask.tableId));
}
