// Assign 연결선 경로 - Old 배지(조각 오른쪽 아래)에서 New 출처 칩 왼쪽까지. 위아래 이동은 두 칸 사이 빈 띠에서만 하고 New 칸 안으로는 가로로만 들어가 본문 글을 가로지르지 않는다.
// 맨 왼쪽 칩은 옆에서 바로, 그 밖의 칩은 Old 배지가 위면 문단 위 틈, 아래면 칩 줄과 문장 사이로 들어와 칩 사이에서 꺾은 뒤 칩 왼쪽으로 들어간다.

export interface RoutePoint {
  x: number;
  y: number;
}

export interface RouteTarget {
  /** 칩 왼쪽 끝 x와 세로 가운데 y - 선의 도착점 */
  end: RoutePoint;
  /** 칩 위·아래 끝 */
  chipTop: number;
  chipBottom: number;
  /** New 줄(탭 포함)의 왼쪽 끝과 위 끝 */
  rowLeft: number;
  rowTop: number;
  /** 칩 줄의 첫 칩이면 옆에서 바로 들어온다 */
  isFirst: boolean;
}

// 띠에서 New 줄 왼쪽 끝까지 남기는 거리, 꺾는 모서리 반지름, 칩 왼쪽 앞 꺾는 자리(칩 사이 10px의 가운데) (px)
const GUTTER_INSET = 4;
const CORNER = 3;
const LANE_INSET = 5;
// 위 틈(4px)의 가운데, 칩 줄 아래 틈(6px)의 가운데 (px)
const GAP_ABOVE = 2;
const GAP_BELOW = 3;

/** 시작점에서 띠 끝(gx, ty)까지 옆으로 누운 S자 */
function buildCurve(start: RoutePoint, gx: number, ty: number): string {
  const dx = Math.max(10, (gx - start.x) / 2);
  return `M${start.x} ${start.y}C${start.x + dx} ${start.y} ${gx - dx} ${ty} ${gx} ${ty}`;
}

export function buildLinkPath(start: RoutePoint, target: RouteTarget): string {
  const gx = target.rowLeft - GUTTER_INSET;
  const { end } = target;
  if (target.isFirst) return `${buildCurve(start, gx, end.y)}L${end.x} ${end.y}`;
  const fromAbove = start.y < end.y;
  const ty = fromAbove ? target.rowTop - GAP_ABOVE : target.chipBottom + GAP_BELOW;
  const lane = end.x - LANE_INSET;
  const s = fromAbove ? 1 : -1;
  const r = Math.min(CORNER, Math.abs(end.y - ty) / 2);
  return (
    `${buildCurve(start, gx, ty)}L${lane - r} ${ty}Q${lane} ${ty} ${lane} ${ty + s * r}` +
    `L${lane} ${end.y - s * r}Q${lane} ${end.y} ${lane + r} ${end.y}L${end.x} ${end.y}`
  );
}
