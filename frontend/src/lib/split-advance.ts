// 경계 확인 뒤 다음 Unit으로 넘어가는 때 - 확인한 조각에서 Not checked → Checked 바뀜(오른쪽 칸 상태 칩 뒤집힘, 조각 아래 단추 줄의 브라운관 꺼짐·켜짐)을 다 본 뒤에 넘어간다.
// 저장 요청은 누르자마자 보낸다 - 기다리는 것은 고름 이동뿐이고, 그동안 Enter를 한 번 더 누르면 바로 넘어간다.

/** 단추 줄 브라운관 전환 한 번(꺼짐 또는 켜짐)의 길이 배수 - components.css `.strip-acts-bar[data-crt]`의 `--dur-slow * 1.15`와 같아야 한다 */
const CRT_SCALE = 1.15;

/** CSS 시간 값("240ms", "0.24s")을 ms로 - 읽지 못하면 0(기다리지 않는다) */
export function parseDurationMs(value: string): number {
  const match = /^\s*(-?[\d.]+)\s*(ms|s)\s*$/.exec(value);
  if (!match) return 0;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return match[2] === "s" ? amount * 1000 : amount;
}

/** 확인을 누른 때부터 넘어가기까지 - 단추 줄이 꺼졌다(Check boundary) 다시 켜지는(Uncheck boundary) 두 번. 움직임 줄이기면 기다리지 않는다 */
export function getAdvanceDelay(durSlowMs: number, isReducedMotion: boolean): number {
  if (isReducedMotion || durSlowMs <= 0) return 0;
  return Math.round(durSlowMs * CRT_SCALE * 2);
}

/** 서버 응답이 온 뒤 더 기다릴 시간 - 응답이 늦어 이미 지났거나 Enter로 건너뛰었으면 0 */
export function getAdvanceWait(delayMs: number, elapsedMs: number, isSkipped: boolean): number {
  return isSkipped ? 0 : Math.max(0, Math.round(delayMs - elapsedMs));
}
