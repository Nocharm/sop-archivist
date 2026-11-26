// 접은 표를 문서마다 브라우저에 기억한다(11-23 명세 E2-R4) - 키 sopa.assign.tablesFolded.<문서 id>, 값은 표 id의 JSON 배열. 저장소가 막혀 있거나 값이 이상하면 모두 펼침.

function readKey(docId: number): string {
  return `sopa.assign.tablesFolded.${docId}`;
}

export function readFoldedTables(docId: number): ReadonlySet<number> {
  try {
    const raw = window.localStorage.getItem(readKey(docId));
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is number => Number.isInteger(id)) : []);
  } catch {
    // 개인 창 · 막힌 사이트 데이터 · 깨진 값 - 기억 없이 모두 펼쳐 그린다
    return new Set();
  }
}

/** 접은 표가 없으면 키를 지운다 - 문서마다 빈 값이 쌓이지 않게 */
export function writeFoldedTables(docId: number, ids: ReadonlySet<number>): void {
  try {
    if (ids.size === 0) window.localStorage.removeItem(readKey(docId));
    else window.localStorage.setItem(readKey(docId), JSON.stringify([...ids].sort((a, b) => a - b)));
  } catch {
    // 기억하지 못해도 지금 화면은 그대로 쓴다
  }
}
