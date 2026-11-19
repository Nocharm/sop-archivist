import { describe, expect, it } from "vitest";
import type { MapBundle, MapEdge, MapNode, RefMap } from "./api-sop";
import { BUNDLES, EDGES, makeEdge, makeNode, MAP, NODES } from "./map-fixture";
import { buildMapView, DEFAULT_FILTERS } from "./map-model";
import { fitZoom, GAP_Y, getZoomScroll, keepPoint, LANE_W, layoutMap, listMapOrder, listNeighbors, type MapLayout, MORE_H, NODE_H, NODE_W, stepZoom } from "./map-layout";

const NONE: ReadonlySet<string> = new Set();

function layoutOf(data: RefMap = MAP, collapsed: ReadonlySet<string> = NONE): MapLayout {
  return layoutMap(buildMapView(data, DEFAULT_FILTERS), collapsed);
}

function laneOf(layout: MapLayout, key: string) {
  const lane = layout.lanes.find((item) => item.key === key);
  if (!lane) throw new Error(`no lane ${key}`);
  return lane;
}

function at(layout: MapLayout, id: string): [number, number] {
  const node = layout.nodes.get(id);
  if (!node) throw new Error(`no node ${id}`);
  return [node.x, node.y];
}

function edgeOf(layout: MapLayout, key: string) {
  const edge = layout.edges.find((item) => item.key === key);
  if (!edge) throw new Error(`no edge ${key}`);
  return edge;
}

/** 시험용 정해진 수열(선형 합동) - 난수를 쓰지 않고 극단 자료를 만든다 */
function makeSequence(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state;
  };
}

/** 극단 시드의 한 사람 몫(마디 약 206 · 선 255)과 비슷한 크기의 합성 지도 */
function makeLargeMap(scope: RefMap["scope"]): RefMap {
  const next = makeSequence(7);
  const bundles: MapBundle[] = [];
  const nodes: MapNode[] = [];
  for (let id = 1; id <= 8; id++) {
    bundles.push({ id, code: `BND-${id}`, title: id <= 5 ? `SYNTHETIC M${id}` : "", status: "in_progress", relation: id === 1 ? "self" : id <= 5 ? "member" : "summary", document_count: 30 });
    for (let k = 0; k < 24; k++) nodes.push(makeNode(`old:${id * 100 + k}`, "old", id, k % 7 === 0 ? "" : `MAP-${id}-${k % 20}`));
    for (let k = 0; k < 2; k++) nodes.push(makeNode(`target:${id * 100 + k}`, "target", id, `SOP-M${id}-${k}`, "", { doc_type: "sop" }));
  }
  for (let k = 0; k < 6; k++) nodes.push(makeNode(`num:SOP-NONE-${k}`, "num", null, `SOP-NONE-${k}`));
  const seen = new Set<string>();
  const edges: MapEdge[] = [];
  while (edges.length < 255) {
    const source = nodes[next() % nodes.length];
    const target = nodes[next() % nodes.length];
    if (source.kind !== "old" || source.id === target.id) continue;
    const kind: MapEdge["kind"] = target.kind === "target" ? "moved" : "ref";
    const state: MapEdge["state"] = kind === "ref" && next() % 3 === 0 ? "proposed" : "confirmed";
    const key = `${source.id}>${target.id}:${kind}:${state}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push(makeEdge(source.id, target.id, kind, state, 1 + (next() % 4)));
  }
  return { scope, truncated: false, bundles, nodes, edges };
}

function findOverlap(layout: MapLayout): string | null {
  const nodes = [...layout.nodes.values()];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      if (a.x < b.x + NODE_W && b.x < a.x + NODE_W && a.y < b.y + NODE_H && b.y < a.y + NODE_H) return `${a.id} / ${b.id}`;
    }
  }
  return null;
}

describe("map-layout", () => {
  it("orders lanes: this bundle, linked bundles by lines, then the no-bundle lane", () => {
    expect(layoutOf().lanes.map((l) => [l.key, l.x])).toEqual([
      ["12", 0],
      ["18", 248],
      ["15", 496],
      ["none", 744],
    ]);
  });

  it("orders this bundle's documents by natural number with the empty number last", () => {
    const layout = layoutOf();
    expect(laneOf(layout, "12").nodeIds).toEqual(["old:101", "old:102", "old:110", "old:199"]);
    expect(laneOf(layout, "12").nodeIds.map((id) => at(layout, id))).toEqual([
      [12, 50],
      [12, 104],
      [12, 158],
      [12, 212],
    ]);
  });

  it("puts linked documents first in another lane, then its New documents", () => {
    const layout = layoutOf();
    expect(laneOf(layout, "18").nodeIds).toEqual(["old:160", "target:77"]);
    expect([at(layout, "old:160"), at(layout, "target:77")]).toEqual([
      [260, 50],
      [260, 104],
    ]);
    expect(at(layout, "old:140")).toEqual([508, 50]);
    expect(at(layout, "num:SOP-ZZ-404")).toEqual([756, 50]);
  });

  it("orders another lane by the nearest linked document of this bundle, the no-bundle lane too", () => {
    const data: RefMap = {
      ...MAP,
      scope: "all",
      nodes: [
        ...NODES,
        makeNode("old:141", "old", 15, "A-1"),
        makeNode("old:142", "old", 15, "A-2"),
        makeNode("old:143", "old", 15, "A-3"),
        makeNode("target:144", "target", 15, "A-0", "", { doc_type: "sop" }),
        makeNode("num:SOP-ZZ-500", "num", null, "SOP-ZZ-500"),
      ],
      edges: [
        ...EDGES,
        makeEdge("old:110", "old:142", "ref", "confirmed", 1),
        makeEdge("old:143", "old:101", "ref", "confirmed", 1),
        makeEdge("old:199", "target:144", "moved", "confirmed", 1),
        makeEdge("old:101", "num:SOP-ZZ-500", "ref", "confirmed", 1),
      ],
    };
    const layout = layoutOf(data);
    // 이웃 순번: 143·140 → 0(OLD-1), 142 → 2(OLD-10), New 144 → 3, 141은 없음
    expect(laneOf(layout, "15").nodeIds).toEqual(["old:143", "old:140", "old:142", "target:144", "old:141"]);
    expect(laneOf(layout, "none").nodeIds).toEqual(["num:SOP-ZZ-500", "num:SOP-ZZ-404"]);
  });

  it("sizes lanes, the more-documents row and the world", () => {
    const layout = layoutOf();
    expect(Object.fromEntries(layout.lanes.map((l) => [l.key, l.more]))).toEqual({ "12": null, "18": { y: 158, count: 1 }, "15": { y: 104, count: 2 }, none: null });
    expect(Object.fromEntries(layout.lanes.map((l) => [l.key, l.height]))).toEqual({ "12": 268, "18": 198, "15": 144, none: 120 });
    expect(layout.width).toBe(944);
    expect(layout.height).toBe(268);
    expect(layoutOf({ ...MAP, scope: "all" }).lanes.map((l) => l.more)).toEqual([null, null, null, null]);
  });

  it("draws a straight-across edge back to this bundle", () => {
    const edge = edgeOf(layoutOf(), "old:160>old:101:ref:confirmed");
    expect(edge.d).toBe("M260 72 C224 72 224 72 188 72");
    expect(edge.dot).toEqual({ x: 188, y: 72 });
  });

  it("spreads two edges between the same two documents by 6px, confirmed first", () => {
    const layout = layoutOf();
    expect(edgeOf(layout, "old:101>old:140:ref:confirmed").d).toBe("M188 69 C348 69 348 69 508 69");
    expect(edgeOf(layout, "old:101>old:140:ref:proposed").d).toBe("M188 75 C348 75 348 75 508 75");
  });

  it("loops to the right inside one lane", () => {
    const edge = edgeOf(layoutOf(), "old:101>old:102:ref:confirmed");
    expect(edge.d).toBe("M188 72 C222 72 222 126 188 126");
    expect(edge.dot).toEqual({ x: 188, y: 126 });
  });

  it("orders edges by their key", () => {
    const keys = layoutOf().edges.map((e) => e.key);
    expect(keys).toEqual([...keys].sort());
    expect(keys).toHaveLength(6);
  });

  it("a collapsed lane keeps its width, drops its nodes and their edges", () => {
    const layout = layoutOf(MAP, new Set(["18"]));
    const lane = laneOf(layout, "18");
    expect([lane.height, lane.nodeIds, lane.more, lane.collapsed]).toEqual([50, [], null, true]);
    expect(layout.nodes.has("old:160")).toBe(false);
    expect(layout.edges.some((e) => e.key.includes("old:160") || e.key.includes("target:77"))).toBe(false);
    expect(laneOf(layout, "15").x).toBe(496);
  });

  it("gives the same layout whatever the input order", () => {
    const reversed: RefMap = { ...MAP, bundles: [...BUNDLES].reverse(), nodes: [...NODES].reverse(), edges: [...EDGES].reverse() };
    const rotated: RefMap = { ...MAP, bundles: [...BUNDLES.slice(1), BUNDLES[0]], nodes: [...NODES.slice(3), ...NODES.slice(0, 3)], edges: [...EDGES.slice(2), ...EDGES.slice(0, 2)] };
    expect(layoutOf(reversed)).toEqual(layoutOf());
    expect(layoutOf(rotated)).toEqual(layoutOf());
    const large = makeLargeMap("all");
    expect(layoutOf({ ...large, bundles: [...large.bundles].reverse(), nodes: [...large.nodes].reverse(), edges: [...large.edges].reverse() })).toEqual(layoutOf(large));
  });

  it("keeps every bundle lane where it was when an unrelated bundle joins at the end", () => {
    const before = layoutOf({ ...MAP, scope: "all" });
    const after = layoutOf({
      ...MAP,
      scope: "all",
      bundles: [...BUNDLES, { id: 30, code: "BND-0030", title: "", status: "done", relation: "summary", document_count: 1 }],
      nodes: [...NODES, makeNode("old:300", "old", 30, "X-1")],
    });
    expect(after.lanes.map((l) => [l.key, l.x])).toEqual([
      ["12", 0],
      ["18", 248],
      ["15", 496],
      ["30", 744],
      ["none", 992],
    ]);
    for (const [id, node] of before.nodes) {
      if (node.laneKey !== "none") expect(after.nodes.get(id)).toEqual(node);
    }
  });

  it("lays out nothing, one document, two same-numbered documents and two thousand", () => {
    const empty = layoutOf({ ...MAP, nodes: [], edges: [] });
    expect([empty.lanes.map((l) => [l.key, l.height]), empty.nodes.size, empty.edges, empty.width, empty.height]).toEqual([[["12", 120]], 0, [], 200, 120]);
    const nothing = layoutOf({ ...MAP, bundles: [], nodes: [], edges: [] });
    expect([nothing.lanes, nothing.nodes.size, nothing.width, nothing.height]).toEqual([[], 0, 0, 0]);

    const one = layoutOf({ ...MAP, nodes: [NODES[0]], edges: [] });
    expect([one.nodes.size, at(one, "old:101")]).toEqual([1, [12, 50]]);

    const twins = layoutOf({ ...MAP, bundles: [BUNDLES[0]], nodes: [makeNode("old:2", "old", 12, "X-1"), makeNode("old:1", "old", 12, "X-1")], edges: [] });
    expect(laneOf(twins, "12").nodeIds).toEqual(["old:1", "old:2"]);
    expect(at(twins, "old:1")).not.toEqual(at(twins, "old:2"));

    const many = Array.from({ length: 2000 }, (_, i) => makeNode(`old:${i + 1}`, "old", 12, `N-${i + 1}`));
    const big = layoutOf({ ...MAP, bundles: [BUNDLES[0]], nodes: many, edges: [] });
    const ids = laneOf(big, "12").nodeIds;
    expect(big.nodes.size).toBe(2000);
    expect(at(big, ids[ids.length - 1])[1]).toBe(50 + 1999 * 54);
  });

  it("lays out a few hundred documents without overlap, inside their lanes, quickly", () => {
    for (const scope of ["all", "linked"] as const) {
      const data = makeLargeMap(scope);
      const view = buildMapView(data, DEFAULT_FILTERS);
      const started = performance.now();
      const layout = layoutMap(view, NONE);
      const elapsed = performance.now() - started;
      expect(elapsed).toBeLessThan(200);
      expect(layout.nodes.size).toBe(view.nodes.length);
      expect(layout.edges).toHaveLength(view.edges.length);
      expect(findOverlap(layout)).toBeNull();
      for (const lane of layout.lanes) {
        const last = lane.nodeIds.length ? layout.nodes.get(lane.nodeIds[lane.nodeIds.length - 1])! : null;
        for (const id of lane.nodeIds) {
          const node = layout.nodes.get(id)!;
          expect(node.x >= lane.x && node.x + NODE_W <= lane.x + LANE_W && node.y + NODE_H <= lane.height).toBe(true);
        }
        if (lane.more) {
          expect(lane.more.y).toBeGreaterThanOrEqual(last ? last.y + NODE_H + GAP_Y : 0);
          expect(lane.more.y + MORE_H).toBeLessThanOrEqual(lane.height);
        }
      }
      expect(layout.edges.every((e) => !e.d.includes("NaN") && !e.d.includes("Infinity"))).toBe(true);
    }
    // 범위 all은 Old 문서 192개를 모두 놓는다
    expect(layoutOf(makeLargeMap("all")).nodes.size).toBeGreaterThanOrEqual(192);
  });

  it("lays out a large map with collapsed lanes without overlap or broken paths", () => {
    const data = makeLargeMap("all");
    const view = buildMapView(data, DEFAULT_FILTERS);
    const open = layoutMap(view, NONE);
    const layout = layoutMap(view, new Set(["3", "7", "none"]));
    expect(findOverlap(layout)).toBeNull();
    expect(layout.edges.every((e) => !e.d.includes("NaN") && !e.d.includes("Infinity") && Number.isFinite(e.dot.x) && Number.isFinite(e.dot.y))).toBe(true);
    const hidden = new Set(view.nodes.filter((node) => node.bundle_id === 3 || node.bundle_id === 7 || node.bundle_id === null).map((node) => node.id));
    for (const key of ["3", "7", "none"]) expect([laneOf(layout, key).nodeIds, laneOf(layout, key).height]).toEqual([[], 50]);
    expect([...layout.nodes.keys()].some((id) => hidden.has(id))).toBe(false);
    expect(layout.edges.some((e) => hidden.has(e.source) || hidden.has(e.target))).toBe(false);
    expect(layout.edges.length).toBeGreaterThan(0);
    expect(layout.lanes.map((l) => l.x)).toEqual(open.lanes.map((l) => l.x));
    expect(layout.width).toBe(open.width);
  });

  it("leaves out a document whose bundle is not listed, and its edges, without a lane for it", () => {
    const stray = makeNode("old:900", "old", 99, "STRAY-1");
    const layout = layoutOf({ ...MAP, nodes: [...NODES, stray], edges: [...EDGES, makeEdge("old:101", "old:900", "ref", "confirmed", 1), makeEdge("old:900", "old:140", "ref", "confirmed", 1)] });
    expect(layout.nodes.has("old:900")).toBe(false);
    expect(layout.lanes.map((l) => l.key)).toEqual(["12", "18", "15", "none"]);
    expect(layout.edges.some((e) => e.source === "old:900" || e.target === "old:900")).toBe(false);
    expect(layout.edges).toHaveLength(EDGES.length);
  });

  it("lists every document in map order, collapsed lanes included", () => {
    const view = buildMapView(MAP, DEFAULT_FILTERS);
    expect(listMapOrder(view)).toEqual(["old:101", "old:102", "old:110", "old:199", "old:160", "target:77", "old:140", "num:SOP-ZZ-404"]);
  });

  it("lists each document's neighbours and touching edges from the drawn edges", () => {
    const neighbors = listNeighbors(layoutOf().edges);
    expect([...neighbors.get("old:101")!.nodes].sort()).toEqual(["old:102", "old:140", "old:160"]);
    expect([...neighbors.get("old:101")!.edges].sort()).toEqual(["old:101>old:102:ref:confirmed", "old:101>old:140:ref:confirmed", "old:101>old:140:ref:proposed", "old:160>old:101:ref:confirmed"]);
    expect([...neighbors.get("target:77")!.nodes]).toEqual(["old:102"]);
    expect(neighbors.has("old:199")).toBe(false);
    const collapsed = listNeighbors(layoutOf(MAP, new Set(["18"])).edges);
    expect([...collapsed.get("old:101")!.nodes].sort()).toEqual(["old:102", "old:140"]);
  });

  it("steps and fits the zoom", () => {
    expect(stepZoom(1, 1)).toBe(1.1);
    expect(stepZoom(1.5, 1)).toBe(1.5);
    expect(stepZoom(0.5, -1)).toBe(0.5);
    expect(stepZoom(0.7, 1)).toBe(0.8);
    expect(fitZoom({ width: 730, height: 600 }, { width: 944, height: 268 })).toBe(0.7);
    expect(fitZoom({ width: 730, height: 600 }, { width: 9000, height: 9000 })).toBe(0.5);
    expect(fitZoom({ width: 730, height: 600 }, { width: 200, height: 120 })).toBe(1);
    expect(fitZoom({ width: 730, height: 600 }, { width: 0, height: 0 })).toBe(1);
    expect(keepPoint(200, 100, 1, 1.1)).toBeCloseTo(230);
  });

  it("keeps the world point under the anchor when the zoom changes inside a padded frame", () => {
    const next = getZoomScroll({ left: 0, top: 0 }, { x: 100, y: 50 }, 16, 1, 1.5);
    expect(next.left).toBeCloseTo(42);
    expect(next.top).toBeCloseTo(17);
    // 포인터 밑 세계 자리: 앞 (0 + 100 - 16) / 1 = 84, 뒤 (42 + 100 - 16) / 1.5 = 84
    expect((next.left + 100 - 16) / 1.5).toBeCloseTo(84);
    expect(getZoomScroll({ left: 300, top: 120 }, { x: 200, y: 100 }, 16, 1.2, 1.2)).toEqual({ left: 300, top: 120 });
    // 줄이다 앞 끝을 넘으면 0에서 멈춘다
    expect(getZoomScroll({ left: 0, top: 0 }, { x: 100, y: 50 }, 16, 1.5, 1)).toEqual({ left: 0, top: 0 });
  });
});
