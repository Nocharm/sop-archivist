/** 참조 지도의 글쇠 이동 - 줄기·마디 사이를 글쇠로 다니는 순수 모델(설계 2026-11-17 참조 지도) */
import type { LaidLane, MapLayout } from "./map-layout";

/** 마디 id, 또는 줄기 머리 `lane:<key>` */
export type MapFocus = string;
export type MapKeyAction = { kind: "focus"; id: MapFocus } | { kind: "select" } | { kind: "toggle"; laneKey: string } | { kind: "clear" } | { kind: "zoom"; dir: 1 | -1 } | { kind: "fit" };

const LANE_PREFIX = "lane:";

/** 줄기 머리(접기 단추)의 포커스 자리 */
export function getLaneFocus(laneKey: string): MapFocus {
  return `${LANE_PREFIX}${laneKey}`;
}

/** 줄기 머리 자리면 그 줄기 열쇠, 마디면 null */
export function readLaneFocus(focus: MapFocus): string | null {
  return focus.startsWith(LANE_PREFIX) ? focus.slice(LANE_PREFIX.length) : null;
}

function getHeadFocus(lane: LaidLane): MapFocus {
  return getLaneFocus(lane.key);
}

function makeFocus(id: string | undefined): MapKeyAction | null {
  return id === undefined ? null : { kind: "focus", id };
}

/** 포커스가 선 자리 - 줄기 순번과 줄기 안 순번(머리면 -1). 지도에 없는 자리면 null */
function locateFocus(focus: MapFocus, layout: MapLayout): { lane: number; row: number } | null {
  const node = layout.nodes.get(focus);
  if (node) {
    const lane = layout.lanes.findIndex((item) => item.key === node.laneKey);
    const row = lane < 0 ? -1 : layout.lanes[lane].nodeIds.indexOf(focus);
    return row < 0 ? null : { lane, row };
  }
  if (!focus.startsWith(LANE_PREFIX)) return null;
  const lane = layout.lanes.findIndex((item) => getHeadFocus(item) === focus);
  return lane < 0 ? null : { lane, row: -1 };
}

/** 옆 줄기로 - 머리면 옆 머리, 마디면 y가 가장 가까운 마디(같으면 위쪽), 그 줄기가 접혔거나 비면 머리 */
function moveAcross(layout: MapLayout, from: { lane: number; row: number }, step: 1 | -1): MapKeyAction | null {
  const next = layout.lanes[from.lane + step];
  if (!next) return null;
  if (from.row < 0 || next.nodeIds.length === 0) return makeFocus(getHeadFocus(next));
  const y = layout.nodes.get(layout.lanes[from.lane].nodeIds[from.row])!.y;
  let best = next.nodeIds[0];
  let bestGap = Number.POSITIVE_INFINITY;
  for (const id of next.nodeIds) {
    const gap = Math.abs(layout.nodes.get(id)!.y - y);
    // 위에서부터 보므로 더 가까울 때만 바꾸면 같은 거리에서는 위쪽이 남는다
    if (gap < bestGap) {
      best = id;
      bestGap = gap;
    }
  }
  return makeFocus(best);
}

export function getMapKeyAction(key: string, focus: MapFocus, layout: MapLayout): MapKeyAction | null {
  switch (key) {
    case "Escape":
      return { kind: "clear" };
    case "+":
    case "=":
      return { kind: "zoom", dir: 1 };
    case "-":
      return { kind: "zoom", dir: -1 };
    case "0":
      return { kind: "fit" };
  }
  const spot = locateFocus(focus, layout);
  if (!spot) return null;
  const lane = layout.lanes[spot.lane];
  const ids = lane.nodeIds;
  switch (key) {
    case "Enter":
    case " ":
      return spot.row < 0 ? { kind: "toggle", laneKey: lane.key } : { kind: "select" };
    case "ArrowDown":
      return makeFocus(ids[spot.row + 1]);
    case "ArrowUp":
      if (spot.row < 0) return null;
      return makeFocus(spot.row === 0 ? getHeadFocus(lane) : ids[spot.row - 1]);
    case "ArrowRight":
      return moveAcross(layout, spot, 1);
    case "ArrowLeft":
      return moveAcross(layout, spot, -1);
    case "Home":
      return makeFocus(ids[0]);
    case "End":
      return makeFocus(ids[ids.length - 1]);
    default:
      return null;
  }
}

/** 지도에 들어설 때의 포커스 자리 - 고른 마디, 없으면 이 Bundle 줄기의 첫 마디, 그것도 없으면 첫 줄기의 머리 */
export function getEntryFocus(layout: MapLayout, selectedId: string | null): MapFocus | null {
  if (selectedId !== null && layout.nodes.has(selectedId)) return selectedId;
  // 이 Bundle 줄기는 늘 첫 줄기다(layoutMap의 줄기 순서)
  const first = layout.lanes[0];
  if (!first) return null;
  return first.nodeIds[0] ?? getHeadFocus(first);
}

/** 지도 안의 Tab 자리 하나(움직이는 tabindex) - 마지막으로 포커스한 마디·머리가 아직 그려져 있으면 그것, 아니면 들어설 자리 */
export function getTabStop(layout: MapLayout, lastFocus: MapFocus | null, selectedId: string | null): MapFocus | null {
  if (lastFocus !== null && locateFocus(lastFocus, layout) !== null) return lastFocus;
  return getEntryFocus(layout, selectedId);
}

const MOVE_KEYS: ReadonlySet<string> = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"]);

/** 지도 안에서 포커스를 옮기는 글쇠 - 옮길 곳이 없어도(끝) 칸을 스크롤하지 않게 늘 막는다 */
export function isMapMoveKey(key: string): boolean {
  return MOVE_KEYS.has(key);
}
