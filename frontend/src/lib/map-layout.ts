/** 참조 지도의 줄기 배치·확대 셈 - DOM을 재지 않는 정해진 셈(설계 2026-11-17 참조 지도) */
import type { MapBundle, MapEdge, MapNode } from "./api-sop";
import { compareNumbers, type EdgeLabel, getEdgeKey, getEdgeLabel, getLaneKey, type MapView } from "./map-model";

// 단위 px(확대 1 기준). 시안 값 - 극단 자료로 재고 바꾸면 이 상수만 바꾼다
export const LANE_W = 200,
  NODE_W = 176,
  NODE_H = 44,
  GAP_X = 48,
  GAP_Y = 10,
  LANE_HEAD = 50,
  LANE_MIN_H = 120,
  LANE_PAD = 2,
  MORE_H = 28,
  LOOP_BULGE = 34,
  PORT_STEP = 6,
  MIN_CTRL = 24;

export interface LaidLane {
  key: string;
  bundleId: number | null;
  x: number;
  height: number;
  collapsed: boolean;
  nodeIds: string[];
  more: { y: number; count: number } | null;
}
export interface LaidNode {
  id: string;
  laneKey: string;
  x: number;
  y: number;
}
export interface LaidEdge {
  key: string;
  source: string;
  target: string;
  d: string;
  dot: { x: number; y: number };
}
export interface MapLayout {
  lanes: LaidLane[];
  nodes: ReadonlyMap<string, LaidNode>;
  edges: LaidEdge[];
  width: number;
  height: number;
}

const EDGE_ORDER: Record<EdgeLabel, number> = { confirmed: 0, proposed: 1, moved: 2 };
const NO_RANK = Number.POSITIVE_INFINITY;

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** id를 수로 읽되 끝까지 같으면 글자로 - 늘 하나로 정해지는 순서 */
function compareIds(a: string, b: string): number {
  return compareNumbers(a, b) || compareText(a, b);
}

function compareRanks(a: number, b: number): number {
  return a === b ? 0 : a < b ? -1 : 1;
}

function compareByNumber(a: MapNode, b: MapNode): number {
  return compareNumbers(a.number, b.number) || compareIds(a.id, b.id);
}

/** 줄기 순서 - 이 Bundle → 선의 줄 수가 많은 Bundle(같으면 id) → 나머지(id) → 어느 Bundle에도 없음 */
function orderLanes(view: MapView, nodeById: ReadonlyMap<string, MapNode>, hasNone: boolean): { key: string; bundle: MapBundle | null }[] {
  const linkedLines = new Map<number, number>();
  for (const edge of view.edges) {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target) continue;
    const other = source.bundle_id === view.selfId ? target : target.bundle_id === view.selfId ? source : null;
    if (other === null || other.bundle_id === null || other.bundle_id === view.selfId) continue;
    linkedLines.set(other.bundle_id, (linkedLines.get(other.bundle_id) ?? 0) + edge.lines);
  }
  const self = view.bundles.find((bundle) => bundle.id === view.selfId);
  const others = view.bundles
    .filter((bundle) => bundle.id !== view.selfId)
    .sort((a, b) => (linkedLines.get(b.id) ?? 0) - (linkedLines.get(a.id) ?? 0) || a.id - b.id);
  const lanes: { key: string; bundle: MapBundle | null }[] = [...(self ? [self] : []), ...others].map((bundle) => ({ key: getLaneKey(bundle.id), bundle }));
  if (hasNone) lanes.push({ key: getLaneKey(null), bundle: null });
  return lanes;
}

/** 줄기 안 순서. 이 Bundle은 Old → New(번호순), 남은 이웃 순번이 있는 Old → New → 이웃 없는 Old */
function orderLaneNodes(nodes: MapNode[], isSelf: boolean, rankOf: (id: string) => number): MapNode[] {
  if (isSelf) return [...nodes].sort((a, b) => Number(a.kind !== "old") - Number(b.kind !== "old") || compareByNumber(a, b));
  const groupOf = (node: MapNode) => (node.kind === "target" ? 1 : node.kind === "old" && rankOf(node.id) === NO_RANK ? 2 : 0);
  return [...nodes].sort((a, b) => groupOf(a) - groupOf(b) || compareRanks(rankOf(a.id), rankOf(b.id)) || compareByNumber(a, b));
}

function buildEdgePath(edge: MapEdge, a: LaidNode, b: LaidNode, off: number): LaidEdge {
  const y1 = a.y + NODE_H / 2 + off;
  const y2 = b.y + NODE_H / 2 + off;
  const key = getEdgeKey(edge);
  if (a.laneKey === b.laneKey) {
    const x = a.x + NODE_W;
    return { key, source: edge.source, target: edge.target, d: `M${x} ${y1} C${x + LOOP_BULGE} ${y1} ${x + LOOP_BULGE} ${y2} ${x} ${y2}`, dot: { x, y: y2 } };
  }
  const rightward = b.x > a.x;
  const x1 = rightward ? a.x + NODE_W : a.x;
  const x2 = rightward ? b.x : b.x + NODE_W;
  const c = Math.max(MIN_CTRL, Math.abs(x2 - x1) / 2) * (rightward ? 1 : -1);
  return { key, source: edge.source, target: edge.target, d: `M${x1} ${y1} C${x1 + c} ${y1} ${x2 - c} ${y2} ${x2} ${y2}`, dot: { x: x2, y: y2 } };
}

/** 같은 두 마디 사이(방향 무관)의 선을 (확인 · REF? · Moved to → source id) 순으로 세워 가운데 기준으로 벌린다 */
function layoutEdges(edges: MapEdge[], laid: ReadonlyMap<string, LaidNode>): LaidEdge[] {
  const groups = new Map<string, MapEdge[]>();
  for (const edge of edges) {
    if (!laid.has(edge.source) || !laid.has(edge.target)) continue;
    const pair = edge.source < edge.target ? `${edge.source}\n${edge.target}` : `${edge.target}\n${edge.source}`;
    const group = groups.get(pair);
    if (group) group.push(edge);
    else groups.set(pair, [edge]);
  }
  const result: LaidEdge[] = [];
  for (const group of groups.values()) {
    group.sort((a, b) => EDGE_ORDER[getEdgeLabel(a)] - EDGE_ORDER[getEdgeLabel(b)] || compareIds(a.source, b.source) || compareText(getEdgeKey(a), getEdgeKey(b)));
    group.forEach((edge, k) => {
      const off = (k - (group.length - 1) / 2) * PORT_STEP;
      result.push(buildEdgePath(edge, laid.get(edge.source)!, laid.get(edge.target)!, off));
    });
  }
  return result.sort((a, b) => compareText(a.key, b.key));
}

/** 줄기·마디·선의 자리. 같은 view와 접힘이면 입력 순서와 무관하게 늘 같은 결과다 */
export function layoutMap(view: MapView, collapsed: ReadonlySet<string>): MapLayout {
  const nodeById = new Map(view.nodes.map((node) => [node.id, node]));
  const byLane = new Map<string, MapNode[]>();
  for (const node of view.nodes) {
    const key = getLaneKey(node.bundle_id);
    const list = byLane.get(key);
    if (list) list.push(node);
    else byLane.set(key, [node]);
  }
  // 이 Bundle 마디의 순번(접힘과 무관) - 남의 줄기를 세우는 기준
  const selfOrder = orderLaneNodes(byLane.get(getLaneKey(view.selfId)) ?? [], true, () => NO_RANK);
  const selfRank = new Map(selfOrder.map((node, index) => [node.id, index]));
  const neighborRank = new Map<string, number>();
  for (const edge of view.edges) {
    const pairs: [string, string][] = [
      [edge.source, edge.target],
      [edge.target, edge.source],
    ];
    for (const [own, far] of pairs) {
      const rank = selfRank.get(far);
      if (rank === undefined || selfRank.has(own)) continue;
      neighborRank.set(own, Math.min(neighborRank.get(own) ?? NO_RANK, rank));
    }
  }
  const rankOf = (id: string) => neighborRank.get(id) ?? NO_RANK;

  const lanes: LaidLane[] = [];
  const nodes = new Map<string, LaidNode>();
  orderLanes(view, nodeById, byLane.has(getLaneKey(null))).forEach(({ key, bundle }, index) => {
    const x = index * (LANE_W + GAP_X);
    const isCollapsed = collapsed.has(key);
    const isSelf = bundle !== null && bundle.id === view.selfId;
    if (isCollapsed) {
      lanes.push({ key, bundleId: bundle?.id ?? null, x, height: LANE_HEAD, collapsed: true, nodeIds: [], more: null });
      return;
    }
    const ordered = isSelf ? selfOrder : orderLaneNodes(byLane.get(key) ?? [], false, rankOf);
    ordered.forEach((node, j) => {
      nodes.set(node.id, { id: node.id, laneKey: key, x: x + (LANE_W - NODE_W) / 2, y: LANE_HEAD + j * (NODE_H + GAP_Y) });
    });
    const n = ordered.length;
    const hidden = bundle !== null && !isSelf && view.scope === "linked" ? bundle.document_count - ordered.filter((node) => node.kind === "old").length : 0;
    const more = hidden > 0 ? { y: LANE_HEAD + n * (NODE_H + GAP_Y), count: hidden } : null;
    const bottom = LANE_HEAD + n * (NODE_H + GAP_Y) + (more ? MORE_H + GAP_Y : 0);
    lanes.push({ key, bundleId: bundle?.id ?? null, x, height: Math.max(LANE_MIN_H, bottom + LANE_PAD), collapsed: false, nodeIds: ordered.map((node) => node.id), more });
  });

  return {
    lanes,
    nodes,
    edges: layoutEdges(view.edges, nodes),
    width: lanes.length > 0 ? lanes.length * LANE_W + (lanes.length - 1) * GAP_X : 0,
    height: lanes.reduce((tallest, lane) => Math.max(tallest, lane.height), 0),
  };
}

// 확대 배율 범위·한 걸음, ZOOM_FAR 아래면 마디의 둘째 줄을 감춘다. FIT_MARGIN은 Fit all의 칸 여백(px)
export const ZOOM_MIN = 0.5,
  ZOOM_MAX = 1.5,
  ZOOM_STEP = 0.1,
  ZOOM_FAR = 0.75,
  FIT_MARGIN = 32;

/** 한 걸음 확대·축소 - 소수 첫째 자리로 맞춰 범위에 가둔다 */
export function stepZoom(zoom: number, dir: 1 | -1): number {
  const next = Math.round((zoom + dir * ZOOM_STEP) * 10) / 10;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
}

/** 세계 전체가 칸에 들어오는 배율 - 0.1 아래로 내리고 1을 넘지 않는다 */
export function fitZoom(frame: { width: number; height: number }, world: { width: number; height: number }): number {
  if (world.width <= 0 || world.height <= 0) return 1;
  const fit = Math.min((frame.width - FIT_MARGIN) / world.width, (frame.height - FIT_MARGIN) / world.height, 1);
  return Math.max(ZOOM_MIN, Math.floor(fit * 10) / 10);
}

/** 확대를 바꿔도 포인터 밑의 자리가 그대로이게 하는 새 스크롤 위치(한 축) */
export function keepPoint(scroll: number, pointer: number, from: number, to: number): number {
  return ((scroll + pointer) * to) / from - pointer;
}
