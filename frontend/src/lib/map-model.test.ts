import { describe, expect, it } from "vitest";
import type { RefMap } from "./api-sop";
import { BUNDLES, EDGES, makeEdge, makeNode, MAP, NODES } from "./map-fixture";
import {
  buildMapView,
  compareNumbers,
  DEFAULT_FILTERS,
  describeNode,
  formatBecomes,
  getEdgeKey,
  getEdgeLabel,
  getLaneKey,
  listCollapsedAtStart,
  listMapRows,
  summarizeSelf,
} from "./map-model";

describe("map-model", () => {
  it("keeps everything with the default filters", () => {
    const view = buildMapView(MAP, DEFAULT_FILTERS);
    expect(view.nodes).toHaveLength(8);
    expect(view.edges).toHaveLength(6);
    expect(view.bundles).toHaveLength(3);
    expect(view.hasQuery).toBe(false);
    expect(view.matches.size).toBe(0);
  });

  it("REF? only keeps proposed edges and drops the nodes and bundles that lose every edge", () => {
    const view = buildMapView(MAP, { ...DEFAULT_FILTERS, proposedOnly: true });
    expect(view.edges.map(getEdgeKey)).toEqual(["old:101>old:140:ref:proposed", "old:110>num:SOP-ZZ-404:ref:proposed"]);
    expect(view.nodes.map((n) => n.id)).toEqual(["old:101", "old:102", "old:110", "old:199", "old:140", "num:SOP-ZZ-404"]);
    expect(view.bundles.map((b) => b.id)).toEqual([12, 15]);
  });

  it("hiding Moved to drops the moved edge and its target node, not the bundle that is still cited from", () => {
    const view = buildMapView(MAP, { ...DEFAULT_FILTERS, showMoved: false });
    expect(view.edges).toHaveLength(5);
    expect(view.nodes.some((n) => n.id === "target:77")).toBe(false);
    expect(view.bundles.map((b) => b.id)).toEqual([12, 15, 18]);
  });

  it("in the All Bundles scope other bundles keep their documents without an edge", () => {
    const view = buildMapView({ ...MAP, scope: "all" }, { ...DEFAULT_FILTERS, proposedOnly: true });
    expect(view.nodes.some((n) => n.id === "old:160")).toBe(true);
  });

  it("finds by number or title, ignoring case, and by Korean title", () => {
    expect([...buildMapView(MAP, { ...DEFAULT_FILTERS, query: "abc-1016" }).matches]).toEqual(["old:140"]);
    expect([...buildMapView(MAP, { ...DEFAULT_FILTERS, query: "원심" }).matches]).toEqual(["old:101"]);
    expect(buildMapView(MAP, { ...DEFAULT_FILTERS, query: "  " }).hasQuery).toBe(false);
    for (const query of ["(", "[a-", "\\"]) {
      const view = buildMapView(MAP, { ...DEFAULT_FILTERS, query });
      expect(view.matches.size).toBe(0);
      expect(view.hasQuery).toBe(true);
    }
  });

  it("compareNumbers reads digits as numbers and puts the empty number last", () => {
    expect(["OLD-10", "", "OLD-2", "OLD-1"].sort(compareNumbers)).toEqual(["OLD-1", "OLD-2", "OLD-10", ""]);
  });

  it("names the edge by kind first, then state", () => {
    expect(getEdgeLabel({ kind: "moved", state: "confirmed" })).toBe("moved");
    expect(getEdgeLabel({ kind: "ref", state: "proposed" })).toBe("proposed");
    expect(getEdgeLabel({ kind: "ref", state: "confirmed" })).toBe("confirmed");
  });

  it("lists rows: out of this bundle, then into it", () => {
    const rows = listMapRows(buildMapView(MAP, DEFAULT_FILTERS));
    expect(rows.map((r) => [r.from.number, r.to.number, r.label, r.lines, r.bundle?.id ?? null, r.pickId])).toEqual([
      ["OLD-1", "OLD-2", "confirmed", 1, 12, "old:102"],
      ["OLD-1", "SOP-ABC-1016", "confirmed", 2, 15, "old:140"],
      ["OLD-1", "SOP-ABC-1016", "proposed", 1, 15, "old:140"],
      ["OLD-2", "SOP-LOG", "moved", 2, 18, "target:77"],
      ["OLD-10", "SOP-ZZ-404", "proposed", 1, null, "num:SOP-ZZ-404"],
      ["SOP-ABC-1020", "OLD-1", "confirmed", 3, 18, "old:160"],
    ]);
  });

  it("lists the rows between other bundles after the ones that touch this bundle", () => {
    const data: RefMap = {
      ...MAP,
      scope: "all",
      edges: [...EDGES, makeEdge("old:160", "old:140", "ref", "confirmed", 1)],
    };
    const rows = listMapRows(buildMapView(data, DEFAULT_FILTERS));
    const last = rows[rows.length - 1];
    expect([last.from.number, last.to.number, last.bundle?.id, last.pickId]).toEqual(["SOP-ABC-1020", "SOP-ABC-1016", 15, "old:140"]);
  });

  it("summarizes this bundle", () => {
    expect(summarizeSelf(MAP)).toEqual({ citesLines: 7, citesDocs: 4, citedByLines: 3, citedByBundles: 1, toCheck: 2, noOwner: 1, hasEdges: true });
    const empty = { citesLines: 0, citesDocs: 0, citedByLines: 0, citedByBundles: 0, toCheck: 0, noOwner: 0, hasEdges: false };
    expect(summarizeSelf({ ...MAP, edges: [] })).toEqual(empty);
    expect(summarizeSelf({ ...MAP, nodes: [], edges: [], bundles: [] })).toEqual(empty);
  });

  it("describes a document of this bundle", () => {
    const detail = describeNode(MAP, "old:101");
    expect(detail?.relation).toBe("self");
    expect(detail?.becomesState).toBe("list");
    expect(detail?.tentative).toBe(true);
    expect(detail?.assignHref).toBe("/bundles/12/assign?edit=101");
    expect(detail?.cites.map((l) => [l.nodeId, l.label, l.lines])).toEqual([
      ["old:102", "confirmed", 1],
      ["old:140", "confirmed", 2],
      ["old:140", "proposed", 1],
    ]);
    expect(detail?.citedBy.map((l) => [l.nodeId, l.label, l.lines])).toEqual([["old:160", "confirmed", 3]]);
  });

  it("gives no way into a bundle the viewer is not a member of", () => {
    const outsider = describeNode(MAP, "old:160");
    expect(outsider?.relation).toBe("summary");
    expect(outsider?.assignHref).toBeNull();
    expect(outsider?.becomesState).toBe("noSuccessor");
    expect(outsider?.tentative).toBe(false);
    const member = describeNode(MAP, "old:140");
    expect(member?.relation).toBe("member");
    expect(member?.assignHref).toBe("/bundles/15/assign?edit=140");
    expect(member?.tentative).toBe(true);
  });

  it("names the three empty successor states", () => {
    expect(describeNode(MAP, "old:102")?.becomesState).toBe("undecided");
    const num = describeNode(MAP, "num:SOP-ZZ-404");
    expect([num?.becomesState, num?.bundle, num?.relation, num?.assignHref]).toEqual(["nobody", null, null, null]);
    const target = describeNode(MAP, "target:77");
    expect([target?.becomesState, target?.assignHref]).toEqual(["none", null]);
    expect(describeNode(MAP, "old:999")).toBeNull();
  });

  it("formats the successor tag", () => {
    expect(formatBecomes(NODES[0])).toEqual({ first: "SOP-CF", more: 1 });
    expect(formatBecomes({ becomes: [{ code: "", title: "Draft", doc_type: "sop" }] })).toEqual({ first: "Draft", more: 0 });
    expect(formatBecomes({ becomes: [] })).toBeNull();
  });

  it("starts the All Bundles scope with unlinked lanes collapsed", () => {
    const data: RefMap = {
      ...MAP,
      scope: "all",
      bundles: [
        ...BUNDLES,
        { id: 21, code: "BND-0021", title: "", status: "done", relation: "summary", document_count: 1 },
        { id: 22, code: "BND-0022", title: "", status: "done", relation: "summary", document_count: 1 },
      ],
      nodes: [...NODES, makeNode("old:210", "old", 21, "X-1"), makeNode("old:220", "old", 22, "X-2")],
    };
    expect(listCollapsedAtStart(data)).toEqual(["21", "22"]);
    expect(listCollapsedAtStart(data, "22")).toEqual(["21"]);
  });

  it("keys the lanes", () => {
    expect(getLaneKey(12)).toBe("12");
    expect(getLaneKey(null)).toBe("none");
  });

  it("drops an edge whose source is not among the nodes, for every consumer", () => {
    const data: RefMap = { ...MAP, edges: [...EDGES, makeEdge("old:999", "old:101", "ref", "proposed", 1)] };
    const view = buildMapView(data, DEFAULT_FILTERS);
    expect(view.edges.map(getEdgeKey)).toEqual(EDGES.map(getEdgeKey));
    expect(listMapRows(view)).toHaveLength(6);
    expect(summarizeSelf(data)).toEqual(summarizeSelf(MAP));
  });

  it("drops an edge whose target is not among the nodes, for every consumer", () => {
    const data: RefMap = { ...MAP, edges: [...EDGES, makeEdge("old:101", "old:998", "ref", "proposed", 1)] };
    const view = buildMapView(data, DEFAULT_FILTERS);
    expect(view.edges.map(getEdgeKey)).toEqual(EDGES.map(getEdgeKey));
    expect(listMapRows(view)).toHaveLength(6);
    expect(summarizeSelf(data)).toEqual(summarizeSelf(MAP));
  });

  it("handles an empty map", () => {
    const data: RefMap = { scope: "linked", truncated: false, bundles: [], nodes: [], edges: [] };
    const view = buildMapView(data, DEFAULT_FILTERS);
    expect([view.selfId, view.bundles, view.nodes, view.edges]).toEqual([-1, [], [], []]);
    expect(listMapRows(view)).toEqual([]);
    expect(describeNode(data, "old:101")).toBeNull();
    expect(listCollapsedAtStart(data)).toEqual([]);
  });

  it("handles a map with only this bundle and no edges", () => {
    const data: RefMap = { ...MAP, bundles: [BUNDLES[0]], nodes: NODES.slice(0, 4), edges: [] };
    const view = buildMapView(data, DEFAULT_FILTERS);
    expect(view.bundles.map((b) => b.id)).toEqual([12]);
    expect(view.nodes).toHaveLength(4);
    expect(listMapRows(view)).toEqual([]);
    const detail = describeNode(data, "old:101");
    expect([detail?.relation, detail?.cites, detail?.citedBy]).toEqual(["self", [], []]);
    expect(listCollapsedAtStart(data)).toEqual([]);
  });

  it("handles a map without this bundle", () => {
    const data: RefMap = {
      ...MAP,
      bundles: [BUNDLES[1], BUNDLES[2]],
      nodes: NODES.slice(4, 7),
      edges: [makeEdge("old:160", "old:140", "ref", "confirmed", 1)],
    };
    const view = buildMapView(data, DEFAULT_FILTERS);
    expect(view.selfId).toBe(-1);
    expect(view.nodes.map((n) => n.id)).toEqual(["old:140", "old:160"]);
    expect(view.bundles.map((b) => b.id)).toEqual([15, 18]);
    expect(listMapRows(view).map((r) => [r.key, r.pickId])).toEqual([["old:160>old:140:ref:confirmed", "old:140"]]);
    expect(describeNode(data, "old:160")?.relation).toBe("summary");
    expect(listCollapsedAtStart(data)).toEqual(["15", "18"]);
  });

  it("keeps only this bundle's documents when a filter removes every edge", () => {
    const view = buildMapView({ ...MAP, edges: EDGES.filter((e) => e.state === "confirmed") }, { ...DEFAULT_FILTERS, proposedOnly: true });
    expect(view.edges).toEqual([]);
    expect(view.nodes.map((n) => n.id)).toEqual(["old:101", "old:102", "old:110", "old:199"]);
    expect(view.bundles.map((b) => b.id)).toEqual([12]);
    expect(listMapRows(view)).toEqual([]);
  });

  it("orders rows and links of two documents with the same number the same whatever the server order", () => {
    const twin = makeNode("old:105", "old", 12, "OLD-1");
    const edges = [makeEdge("old:105", "old:140", "ref", "confirmed", 1), makeEdge("old:101", "old:140", "ref", "confirmed", 1)];
    for (const order of [edges, [...edges].reverse()]) {
      const data: RefMap = { ...MAP, nodes: [...NODES, twin], edges: order };
      expect(listMapRows(buildMapView(data, DEFAULT_FILTERS)).map((r) => r.key)).toEqual(["old:101>old:140:ref:confirmed", "old:105>old:140:ref:confirmed"]);
      expect(describeNode(data, "old:140")?.citedBy.map((l) => l.nodeId)).toEqual(["old:101", "old:105"]);
    }
  });
});
