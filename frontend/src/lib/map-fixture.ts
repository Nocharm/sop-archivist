/** 참조 지도 순수 모델 시험이 함께 쓰는 합성 지도(map-model·map-layout·map-keys) */
import type { MapBundle, MapEdge, MapNode, RefMap } from "./api-sop";

export const BUNDLES: MapBundle[] = [
  { id: 12, code: "BND-0012", title: "SYNTHETIC 원심분리기", status: "in_progress", relation: "self", document_count: 4 },
  { id: 15, code: "BND-0015", title: "SYNTHETIC UV", status: "in_review", relation: "member", document_count: 3 },
  { id: 18, code: "BND-0018", title: "", status: "done", relation: "summary", document_count: 2 },
];

export function makeNode(id: string, kind: MapNode["kind"], bundleId: number | null, number: string, title = "", extra: Partial<MapNode> = {}): MapNode {
  return { id, kind, bundle_id: bundleId, number, title, doc_type: null, becomes: [], ...extra };
}

export const NODES: MapNode[] = [
  makeNode("old:101", "old", 12, "OLD-1", "SYNTHETIC 원심분리기 운전", {
    becomes: [
      { code: "SOP-CF", title: "Centrifuge", doc_type: "sop" },
      { code: "WI-01", title: "Centrifuge WI", doc_type: "wi" },
    ],
  }),
  makeNode("old:102", "old", 12, "OLD-2"),
  makeNode("old:110", "old", 12, "OLD-10"),
  makeNode("old:199", "old", 12, ""),
  makeNode("old:140", "old", 15, "SOP-ABC-1016", "UV spectrophotometer", { becomes: [{ code: "SOP-UV", title: "UV", doc_type: "sop" }] }),
  makeNode("old:160", "old", 18, "SOP-ABC-1020"),
  makeNode("target:77", "target", 18, "SOP-LOG", "", { doc_type: "sop" }),
  makeNode("num:SOP-ZZ-404", "num", null, "SOP-ZZ-404"),
];

export function makeEdge(source: string, target: string, kind: MapEdge["kind"], state: MapEdge["state"], lines: number): MapEdge {
  return { source, target, kind, state, lines };
}

export const EDGES: MapEdge[] = [
  makeEdge("old:101", "old:140", "ref", "proposed", 1),
  makeEdge("old:101", "old:140", "ref", "confirmed", 2),
  makeEdge("old:102", "target:77", "moved", "confirmed", 2),
  makeEdge("old:160", "old:101", "ref", "confirmed", 3),
  makeEdge("old:110", "num:SOP-ZZ-404", "ref", "proposed", 1),
  makeEdge("old:101", "old:102", "ref", "confirmed", 1),
];

export const MAP: RefMap = { scope: "linked", truncated: false, bundles: BUNDLES, nodes: NODES, edges: EDGES };
