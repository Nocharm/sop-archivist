// 안전한 고유 id 생성 — crypto.randomUUID는 secure context(HTTPS/localhost) 전용이라
// 평문 HTTP(원격 IP) 같은 insecure context에선 undefined. getRandomValues로 폴백(이건 어디서나 동작).
export function genId(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === "function") {
    return c.randomUUID();
  }
  const bytes = c.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
