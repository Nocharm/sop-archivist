// Assign 연결선 경로 - Old 조각 오른쪽 바깥(배지 높이)에서 New 문단 상자 왼쪽 바깥(출처 칩 높이)까지 옆으로 누운 S자 하나.
// 두 끝 모두 상자 테두리에서 가로로 나고 들어가며 위아래 이동은 두 칸 사이에서만 해 본문 글을 가로지르지 않는다(2026-11-12, 칩 안까지 꺾어 들어가던 길을 걷었다).
// 높이 차가 큰 이음은 평소 선 대신 두 끝의 짧은 꼬리만 - 좁은 틈에서 세로선이 다발로 겹쳐 지저분했다(2026-11-13)

export interface RoutePoint {
  x: number;
  y: number;
}

// 두 끝이 아주 가까워도 끝에서 가로로 나가는 거리(px) - 0이면 꺾인 모서리처럼 보인다
const MIN_HANDLE = 10;

export function buildLinkPath(start: RoutePoint, end: RoutePoint): string {
  const dx = Math.max(MIN_HANDLE, (end.x - start.x) / 2);
  return `M${start.x} ${start.y}C${start.x + dx} ${start.y} ${end.x - dx} ${end.y} ${end.x} ${end.y}`;
}

// 이보다 높이 차가 크면 먼 이음 - 두 칸 사이 좁은 틈(약 30px)에서 세로로 길게 달려 선끼리 겹친다(px).
// 2026-11-13 데모 자료에서 나란한 짝의 높이 차는 0~8px였다
export const FAR_LINK_DY = 24;

// 먼 이음의 꼬리 - 상자에서 가로로 나가는 길이, 진행 방향으로 휘는 높이(px)
const STUB_LENGTH = 14;
const STUB_BEND = 6;

export function isFarLink(start: RoutePoint, end: RoutePoint): boolean {
  return Math.abs(end.y - start.y) > FAR_LINK_DY;
}

/** 꼬리 하나 - 상자 테두리(from)에서 끝(to)으로 갈수록 옅어진다(그리는 쪽이 from→to 그라디언트를 건다) */
export interface LinkStub {
  d: string;
  from: RoutePoint;
  to: RoutePoint;
}

/** 먼 이음은 선 대신 두 끝의 짧은 꼬리 - 상자에서 가로로 나가 맞은편이 있는 위·아래로 살짝 휜다. 틈의 가운데를 넘지 않는다 */
export function buildLinkStubs(start: RoutePoint, end: RoutePoint): [LinkStub, LinkStub] {
  const length = Math.min(STUB_LENGTH, Math.max(0, (end.x - start.x) / 2));
  const bend = Math.sign(end.y - start.y) * STUB_BEND;
  const oldTip = { x: start.x + length, y: start.y + bend };
  const newTip = { x: end.x - length, y: end.y - bend };
  return [
    { d: `M${start.x} ${start.y}Q${oldTip.x} ${start.y} ${oldTip.x} ${oldTip.y}`, from: start, to: oldTip },
    { d: `M${end.x} ${end.y}Q${newTip.x} ${end.y} ${newTip.x} ${newTip.y}`, from: end, to: newTip },
  ];
}
