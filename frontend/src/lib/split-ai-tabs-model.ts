// AI 나누기 제안을 읽는 순수 함수 - 자를 위치와, 그 위치에서 자른 조각들(미리보기). 배정 화면의 제안 카드가 쓴다.

/** 제안의 자를 위치 - 응답 JSON이라 숫자만 골라 쓴다 */
export function readSplitOffsets(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((item): item is number => typeof item === "number") : [];
}

/** 원문을 제안 위치에서 자른 조각들(미리보기) - 글 밖의 위치는 버리고, 빈 조각은 뺀다.  */
export function cutSplitPieces(text: string, offsets: readonly number[]): string[] {
  const points = [...offsets].filter((at) => at > 0 && at < text.length).sort((a, b) => a - b);
  const pieces: string[] = [];
  let start = 0;
  for (const at of points) {
    pieces.push(text.slice(start, at));
    start = at;
  }
  pieces.push(text.slice(start));
  return pieces.map((piece) => piece.trim()).filter(Boolean);
}
