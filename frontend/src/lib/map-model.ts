/** 참조 지도의 거르기·표·옆 칸 - 화면 없는 순수 모델(설계 2026-11-17 참조 지도) */
import type { MapBundle, MapEdge, MapNode, MapRelation, RefMap, MapScope } from "./api-sop";
import { getEditOriginalHref } from "./stages";

export interface MapFilters {
  proposedOnly: boolean;
  showMoved: boolean;
  query: string;
}

export const DEFAULT_FILTERS: MapFilters = { proposedOnly: false, showMoved: true, query: "" };

export interface MapView {
  scope: MapScope;
  selfId: number;
  bundles: MapBundle[];
  nodes: MapNode[];
  edges: MapEdge[];
  hasQuery: boolean;
  matches: ReadonlySet<string>;
}

export type EdgeLabel = "confirmed" | "proposed" | "moved";

const LABEL_ORDER: Record<EdgeLabel, number> = { confirmed: 0, proposed: 1, moved: 2 };
const NUMBER_COLLATOR = new Intl.Collator("en", { numeric: true });

function findSelfId(data: Pick<RefMap, "bundles">): number {
  return data.bundles.find((bundle) => bundle.relation === "self")?.id ?? -1;
}

export function getLaneKey(bundleId: number | null): string {
  return bundleId === null ? "none" : String(bundleId);
}

export function getEdgeLabel(edge: Pick<MapEdge, "kind" | "state">): EdgeLabel {
  return edge.kind === "moved" ? "moved" : edge.state;
}

export function getEdgeKey(edge: MapEdge): string {
  return `${edge.source}>${edge.target}:${edge.kind}:${edge.state}`;
}

/** 글자 그대로의 순서 - 마지막 동점 깨기(서버 순서에 기대지 않는다) */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 두 끝 마디가 모두 있는 선만 - 표·요약·배치가 같은 선을 본다 */
function listWholeEdges(data: Pick<RefMap, "nodes" | "edges">): MapEdge[] {
  const ids = new Set(data.nodes.map((node) => node.id));
  return data.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target));
}

/** 숫자를 수로 읽는 자연 정렬 - 빈 번호는 끝 */
export function compareNumbers(a: string, b: string): number {
  if (a === b) return 0;
  if (a === "") return 1;
  if (b === "") return -1;
  return NUMBER_COLLATOR.compare(a, b);
}

/** 거르기를 건 지도 - 선이 사라지면 그 선에만 기대던 마디·Bundle도 함께 빠진다 */
export function buildMapView(data: RefMap, filters: MapFilters): MapView {
  const selfId = findSelfId(data);
  const edges = listWholeEdges(data).filter((edge) => (!filters.proposedOnly || edge.state === "proposed") && (filters.showMoved || edge.kind !== "moved"));
  const touched = new Set<string>();
  for (const edge of edges) {
    touched.add(edge.source);
    touched.add(edge.target);
  }
  const nodes = data.nodes.filter((node) => touched.has(node.id) || (node.kind === "old" && (node.bundle_id === selfId || data.scope === "all")));
  const owners = new Set(nodes.map((node) => node.bundle_id));
  const bundles = data.bundles.filter((bundle) => bundle.id === selfId || owners.has(bundle.id));
  const query = filters.query.trim().toLowerCase();
  // 정규식이 아니라 글 그대로 찾는다 - 입력 중의 ( [ \ 가 예외를 내지 않는다
  const matches = new Set(query ? nodes.filter((node) => node.number.toLowerCase().includes(query) || node.title.toLowerCase().includes(query)).map((node) => node.id) : []);
  return { scope: data.scope, selfId, bundles, nodes, edges, hasQuery: query !== "", matches };
}

/** 선의 자리 - 이 Bundle에서 나가면 out, 아니고 이 Bundle로 들어오면 in, 남끼리면 peer(지도가 선의 색·굵기를 가른다) */
export type EdgeSide = "out" | "in" | "peer";

/** 보이는 선마다(선 열쇠 → 자리) */
export function getEdgeSides(view: MapView): Map<string, EdgeSide> {
  const bundleOf = new Map(view.nodes.map((node) => [node.id, node.bundle_id]));
  return new Map(
    view.edges.map((edge) => [getEdgeKey(edge), bundleOf.get(edge.source) === view.selfId ? "out" : bundleOf.get(edge.target) === view.selfId ? "in" : "peer"]),
  );
}

/** 보이는 지도에서 마디마다 가리키는 줄 수와 가리켜지는 줄 수 - 마디의 접근 이름에 쓴다 */
export function countNodeLines(view: MapView): Map<string, { cites: number; citedBy: number }> {
  const counts = new Map(view.nodes.map((node) => [node.id, { cites: 0, citedBy: 0 }]));
  for (const edge of view.edges) {
    const source = counts.get(edge.source);
    const target = counts.get(edge.target);
    if (source) source.cites += edge.lines;
    if (target) target.citedBy += edge.lines;
  }
  return counts;
}

export interface MapRow {
  key: string;
  from: MapNode;
  to: MapNode;
  label: EdgeLabel;
  lines: number;
  /** 맞은편 Bundle - 없으면 null(어느 Bundle에도 없음) */
  bundle: MapBundle | null;
  /** 줄을 누르면 고르는 마디 */
  pickId: string;
}

/** 나가는 선 → 들어오는 선 → 남끼리의 선, 그 안에서 번호순 */
export function listMapRows(view: MapView): MapRow[] {
  const nodeById = new Map(view.nodes.map((node) => [node.id, node]));
  const bundleById = new Map(view.bundles.map((bundle) => [bundle.id, bundle]));
  const rows: MapRow[] = [];
  const groupOf = new Map<string, number>();
  for (const edge of view.edges) {
    const from = nodeById.get(edge.source);
    const to = nodeById.get(edge.target);
    if (!from || !to) continue;
    const group = from.bundle_id === view.selfId ? 0 : to.bundle_id === view.selfId ? 1 : 2;
    const other = group === 1 ? from : to;
    rows.push({
      key: getEdgeKey(edge),
      from,
      to,
      label: getEdgeLabel(edge),
      lines: edge.lines,
      bundle: other.bundle_id === null ? null : (bundleById.get(other.bundle_id) ?? null),
      pickId: other.id,
    });
    groupOf.set(getEdgeKey(edge), group);
  }
  rows.sort((a, b) => groupOf.get(a.key)! - groupOf.get(b.key)! || compareNumbers(a.from.number, b.from.number) || compareNumbers(a.to.number, b.to.number) || LABEL_ORDER[a.label] - LABEL_ORDER[b.label] || compareText(a.key, b.key));
  return rows;
}

export interface SelfSummary {
  citesLines: number;
  citesDocs: number;
  citedByLines: number;
  citedByBundles: number;
  toCheck: number;
  noOwner: number;
  hasEdges: boolean;
}

/** 거르지 않은 자료로 이 Bundle의 한 줄 요약을 센다 */
export function summarizeSelf(data: RefMap): SelfSummary {
  const selfId = findSelfId(data);
  const nodeById = new Map(data.nodes.map((node) => [node.id, node]));
  const isSelf = (id: string) => nodeById.get(id)?.bundle_id === selfId;
  const citedDocs = new Set<string>();
  const noOwner = new Set<string>();
  const citedByBundles = new Set<number | null>();
  const edges = listWholeEdges(data);
  const summary: SelfSummary = { citesLines: 0, citesDocs: 0, citedByLines: 0, citedByBundles: 0, toCheck: 0, noOwner: 0, hasEdges: edges.length > 0 };
  for (const edge of edges) {
    if (isSelf(edge.source)) {
      summary.citesLines += edge.lines;
      citedDocs.add(edge.target);
      if (edge.state === "proposed") summary.toCheck += edge.lines;
      if (nodeById.get(edge.target)?.kind === "num") noOwner.add(edge.target);
    } else if (isSelf(edge.target)) {
      summary.citedByLines += edge.lines;
      citedByBundles.add(nodeById.get(edge.source)?.bundle_id ?? null);
    }
  }
  summary.citesDocs = citedDocs.size;
  summary.citedByBundles = citedByBundles.size;
  summary.noOwner = noOwner.size;
  return summary;
}

export interface NodeLink {
  nodeId: string;
  number: string;
  label: EdgeLabel;
  lines: number;
}

export type BecomesState = "list" | "undecided" | "noSuccessor" | "nobody" | "none";

export interface NodeDetail {
  node: MapNode;
  bundle: MapBundle | null;
  relation: MapRelation | null;
  becomesState: BecomesState;
  /** Review complete 전이라 바뀔 수 있다 */
  tentative: boolean;
  cites: NodeLink[];
  citedBy: NodeLink[];
  /** 그 Bundle의 Assign에서 이 문서를 여는 주소 - 갈 수 없으면 null */
  assignHref: string | null;
}

function compareLinks(a: NodeLink, b: NodeLink): number {
  return compareNumbers(a.number, b.number) || LABEL_ORDER[a.label] - LABEL_ORDER[b.label] || compareText(a.nodeId, b.nodeId);
}

export function describeNode(data: RefMap, nodeId: string): NodeDetail | null {
  const node = data.nodes.find((item) => item.id === nodeId);
  if (!node) return null;
  const nodeById = new Map(data.nodes.map((item) => [item.id, item]));
  const bundle = node.bundle_id === null ? null : (data.bundles.find((item) => item.id === node.bundle_id) ?? null);
  const links = (own: "source" | "target", far: "source" | "target"): NodeLink[] =>
    data.edges
      .filter((edge) => edge[own] === nodeId && nodeById.has(edge[far]))
      .map((edge) => ({ nodeId: edge[far], number: nodeById.get(edge[far])!.number, label: getEdgeLabel(edge), lines: edge.lines }))
      .sort(compareLinks);
  let becomesState: BecomesState;
  if (node.kind === "target") becomesState = "none";
  else if (node.kind === "num") becomesState = "nobody";
  else if (node.becomes.length > 0) becomesState = "list";
  else becomesState = bundle?.status === "done" ? "noSuccessor" : "undecided";
  const docId = Number(node.id.slice("old:".length));
  const canOpen = node.kind === "old" && bundle !== null && (bundle.relation === "self" || bundle.relation === "member");
  return {
    node,
    bundle,
    relation: bundle?.relation ?? null,
    becomesState,
    tentative: becomesState === "list" && bundle?.status !== "done",
    cites: links("source", "target"),
    citedBy: links("target", "source"),
    assignHref: canOpen ? getEditOriginalHref(bundle.id, docId) : null,
  };
}

/** 마디 첫 줄의 꼬리표 - 첫 후속 문서의 번호(없으면 제목)와 나머지 수 */
export function formatBecomes(node: Pick<MapNode, "becomes">): { first: string; more: number } | null {
  const [head] = node.becomes;
  if (!head) return null;
  return { first: head.code || head.title, more: node.becomes.length - 1 };
}

/** 범위 all로 들어갈 때 접어 둘 줄기의 열쇠 - 이 Bundle과 선으로 이어지지 않은 Bundle(와 keep은 뺀다) */
export function listCollapsedAtStart(data: RefMap, keep: string | null = null): string[] {
  const selfId = findSelfId(data);
  const bundleOf = new Map(data.nodes.map((node) => [node.id, node.bundle_id]));
  const linked = new Set<number | null>();
  for (const edge of data.edges) {
    const source = bundleOf.get(edge.source) ?? null;
    const target = bundleOf.get(edge.target) ?? null;
    if (source === selfId) linked.add(target);
    if (target === selfId) linked.add(source);
  }
  return data.bundles
    .filter((bundle) => bundle.id !== selfId && !linked.has(bundle.id))
    .map((bundle) => getLaneKey(bundle.id))
    .filter((key) => key !== keep);
}
