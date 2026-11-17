import { describe, expect, it } from "vitest";

import type { MapLine, MapLines } from "./api-sop";
import { attachLines, pickCurrentLines } from "./map-lines-model";
import type { NodeLink } from "./map-model";

const LINKS: NodeLink[] = [
  { nodeId: "old:140", number: "SOP-ABC-1016", label: "confirmed", lines: 2 },
  { nodeId: "old:140", number: "SOP-ABC-1016", label: "proposed", lines: 1 },
  { nodeId: "target:77", number: "SOP-LOG", label: "moved", lines: 2 },
];

function makeLine(unitId: number, over: Partial<MapLine> = {}): MapLine {
  return {
    bundle_id: 12,
    document_id: 101,
    unit_id: unitId,
    display_id: `OLD-1-${String(unitId).padStart(3, "0")}`,
    kind: "ref",
    state: "confirmed",
    number: "SOP-ABC-1016",
    source: "old:101",
    target: "old:140",
    text: `Synthetic line ${unitId}`,
    text_truncated: false,
    ...over,
  };
}

const LINES: MapLines = {
  node: "old:101",
  out: [makeLine(11), makeLine(12), makeLine(13, { state: "proposed" })],
  in: [],
  withheld_out: [{ source: "old:101", target: "target:77", kind: "moved", state: "confirmed", lines: 2 }],
  withheld_in: [],
  more_out: 0,
  more_in: 0,
};

describe("attachLines", () => {
  it("attaches each sentence under its counterpart and state, in the response order", () => {
    const side = attachLines(LINKS, LINES, "out");
    expect(side.rows.map((row) => row.lines.map((line) => line.unit_id))).toEqual([[11, 12], [13], []]);
    expect(side.rows.map((row) => row.withheld)).toEqual([0, 0, 2]);
    expect(side.more).toBe(0);
  });

  it("uses the source as the counterpart for incoming lines", () => {
    const incoming: MapLines = {
      ...LINES,
      node: "old:140",
      out: [],
      in: [makeLine(21, { source: "old:300", target: "old:140" }), makeLine(22, { source: "old:301", target: "old:140", state: "proposed" })],
      withheld_out: [],
      withheld_in: [{ source: "old:302", target: "old:140", kind: "ref", state: "confirmed", lines: 3 }],
      more_in: 4,
    };
    const links: NodeLink[] = [
      { nodeId: "old:300", number: "OLD-1", label: "confirmed", lines: 1 },
      { nodeId: "old:301", number: "OLD-2", label: "proposed", lines: 1 },
      { nodeId: "old:302", number: "OLD-3", label: "confirmed", lines: 3 },
    ];
    const side = attachLines(links, incoming, "in");
    expect(side.rows.map((row) => [row.lines.map((line) => line.unit_id), row.withheld])).toEqual([
      [[21], 0],
      [[22], 0],
      [[], 3],
    ]);
    expect(side.more).toBe(4);
  });

  it("shows counts only until the lines arrive", () => {
    const side = attachLines(LINKS, null, "out");
    expect(side.rows.every((row) => row.lines.length === 0 && row.withheld === 0)).toBe(true);
    expect(side.more).toBe(0);
  });

  it("ignores a line or a withheld count that matches no row", () => {
    const stray: MapLines = {
      ...LINES,
      out: [makeLine(31, { target: "old:999" })],
      withheld_out: [{ source: "old:101", target: "old:999", kind: "ref", state: "confirmed", lines: 5 }],
    };
    const side = attachLines(LINKS, stray, "out");
    expect(side.rows.every((row) => row.lines.length === 0 && row.withheld === 0)).toBe(true);
  });

  it("keeps a moved line apart from a confirmed reference to the same document", () => {
    const links: NodeLink[] = [
      { nodeId: "old:140", number: "SOP-ABC-1016", label: "confirmed", lines: 1 },
      { nodeId: "old:140", number: "SOP-ABC-1016", label: "moved", lines: 1 },
    ];
    const lines: MapLines = { ...LINES, out: [makeLine(41, { kind: "moved" }), makeLine(42)], withheld_out: [] };
    expect(attachLines(links, lines, "out").rows.map((row) => row.lines.map((line) => line.unit_id))).toEqual([[42], [41]]);
  });
});

describe("pickCurrentLines", () => {
  it("uses lines only for the document that is picked now", () => {
    const lines = { ...LINES, node: "old:101" };
    expect(pickCurrentLines(lines, "old:101", false)).toBe(lines);
    expect(pickCurrentLines(lines, "old:102", false)).toBeNull();
    expect(pickCurrentLines(lines, "old:101", true)).toBeNull();
    expect(pickCurrentLines(lines, null, false)).toBeNull();
    expect(pickCurrentLines(null, "old:101", false)).toBeNull();
  });
});
