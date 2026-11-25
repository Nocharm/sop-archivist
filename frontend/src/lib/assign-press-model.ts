// Assign 글쇠의 반복 · 쌓기 - 누르고 있어 되풀이되는 글쇠는 이동만 받고, 앞의 장벽이 끝날 때까지 쌓아 둘 글쇠를 가른다(A1-R3).

// 대상이나 차례가 걸린 것(나눌 선 · 판단) - 줄 이동은 부르는 쪽이 따로 안다
const QUEUED_KEYS: ReadonlySet<string> = new Set(["s", "arrowleft", "arrowright", "enter", "a", "e", "h", "u", "r", "delete", "backspace"]);
// 누르고 있어도 되는 것 - 줄 이동과 나눌 선 옮기기
const REPEAT_KEYS: ReadonlySet<string> = new Set(["arrowleft", "arrowright"]);

/** 앞에 장벽이 있으면 쌓아 두었다가 되살릴 글쇠인가 */
export function isQueuedKey(key: string, isMove: boolean): boolean {
  return isMove || QUEUED_KEYS.has(key);
}

/** 누르고 있어 되풀이된 것을 버릴 글쇠인가 - 판단이 줄줄이 저장되지 않게 */
export function isRepeatIgnored(key: string, isMove: boolean): boolean {
  return !isMove && !REPEAT_KEYS.has(key);
}
