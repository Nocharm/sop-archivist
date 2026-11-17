// 가운데 말줄임 - 코드처럼 앞(무슨 문서인지)과 뒤(몇 번인지)가 모두 뜻을 가진 글을 줄일 때 쓴다.

/** head + tail + 1자를 넘으면 앞 head자 + "…" + 뒤 tail자. 글자는 코드포인트로 센다 */
export function truncateMiddle(text: string, head: number, tail: number): string {
  const chars = Array.from(text);
  if (chars.length <= head + tail + 1) return text;
  return `${chars.slice(0, head).join("")}…${chars.slice(chars.length - tail).join("")}`;
}

/** 파일 이름을 머리와 꼬리(마지막 tail자 - 확장자가 든다)로 가른다. tail보다 짧으면 ["", name]. 화면이 머리만 폭에 맞춰 줄인다 */
export function splitFileName(name: string, tail = 12): [head: string, tail: string] {
  const chars = Array.from(name);
  if (chars.length <= tail) return ["", name];
  return [chars.slice(0, chars.length - tail).join(""), chars.slice(chars.length - tail).join("")];
}
