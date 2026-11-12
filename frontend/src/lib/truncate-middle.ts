// 가운데 말줄임 - 코드처럼 앞(무슨 문서인지)과 뒤(몇 번인지)가 모두 뜻을 가진 글을 줄일 때 쓴다.

/** head + tail + 1자를 넘으면 앞 head자 + "…" + 뒤 tail자. 글자는 코드포인트로 센다 */
export function truncateMiddle(text: string, head: number, tail: number): string {
  const chars = Array.from(text);
  if (chars.length <= head + tail + 1) return text;
  return `${chars.slice(0, head).join("")}…${chars.slice(chars.length - tail).join("")}`;
}
