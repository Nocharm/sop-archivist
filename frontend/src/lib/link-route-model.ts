// Assign 연결선 경로 - Old 조각 오른쪽 바깥(배지 높이)에서 New 문단 상자 왼쪽 바깥(출처 칩 높이)까지 옆으로 누운 S자 하나.
// 두 끝 모두 상자 테두리에서 가로로 나고 들어가며 위아래 이동은 두 칸 사이에서만 해 본문 글을 가로지르지 않는다(2026-11-12, 칩 안까지 꺾어 들어가던 길을 걷었다).

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
