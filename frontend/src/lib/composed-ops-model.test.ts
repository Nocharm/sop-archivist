import { describe, expect, it } from "vitest";

import type { ComposedItem, Group, GroupTarget, GroupUnit, ViewUnit } from "./api-sop";
import { buildComposedMerge, buildComposedSplit, findComposedCut, planComposedJoin, stepComposedCut } from "./composed-ops-model";

function makeUnit(id: number, disposition: GroupUnit["decision"]["disposition"] = "assigned"): GroupUnit {
  return {
    unit_id: id, display_id: `1-${id}`, document_id: 1, kind: "sentence", lang: "en", text: "", group_id: null, cell_unit_ids: [],
    decision: { disposition, move_target_code: "", reason: "", status: "confirmed", hold_reason: "", confirmed_by: null, confirmed_at: null, revision: 2 },
  };
}

function makeTarget(id: number, sources: number[], remark = ""): GroupTarget {
  return {
    id, target_doc_id: 7, slot_key: "scope", wi_step: null, wi_part: null, section_path: "", order_index: 0, lang: "en", kind: "sentence",
    confirmed_text: "", ai_text: "", change_type: "as_is", origin: "units", new_unit_id: null, translation_source_unit_id: null, parent_target_id: null,
    cell_row: null, cell_col: null, grid: null, status: "confirmed", hold_reason: "", remark, warnings: [], source_unit_ids: sources, group_id: null, revision: 3, indent_level: 0,
  };
}

function makeItem(id: number, lang: ComposedItem["lang"], sources: number[], meaningKey: string | null = null, changeType: ComposedItem["change_type"] = "as_is"): ComposedItem {
  return { target_id: id, kind: "sentence", lang, text: "", status: "confirmed", change_type: changeType, number: null, number_style: "numbered", indent_level: 0, meaning_key: meaningKey, source_unit_ids: sources };
}

describe("cut position", () => {
  it("snaps to a spot that leaves text on both sides", () => {
    expect(findComposedCut("Ab cd", 99)).toBe(4);
    expect(findComposedCut("Ab cd", 0)).toBe(1);
    expect(findComposedCut("A", 0)).toBeNull();
  });
  it("arrow keys move one spot and stop at the ends", () => {
    expect(stepComposedCut("Ab cd", 2, 1)).toBe(3);
    expect(stepComposedCut("Ab cd", 4, 1)).toBe(4);
  });
});

describe("planComposedJoin", () => {
  const units = new Map<number, ViewUnit>([
    [1, { id: 1, kind: "sentence", lang: "ko", pair_id: null } as ViewUnit],
    [2, { id: 2, kind: "sentence", lang: "en", pair_id: null } as ViewUnit],
  ]);
  const find = (id: number) => units.get(id);
  it("joins same-language boxes", () => {
    expect(planComposedJoin(makeItem(10, "en", [5]), makeItem(11, "en", [6]), find).kind).toBe("merge");
  });
  it("pairs a KO box and an EN box whose Old lines are open and unpaired", () => {
    expect(planComposedJoin(makeItem(10, "ko", [1]), makeItem(11, "en", [2]), find).kind).toBe("pair");
  });
  it("refuses a translation, an existing card, a merged box and lines in another Old document", () => {
    expect(planComposedJoin(makeItem(10, "ko", [1], null, "translated"), makeItem(11, "ko", [2]), find).reasonKey).toBe("assign.composedOps.why.notOld");
    expect(planComposedJoin(makeItem(10, "ko", [1], "old:9"), makeItem(11, "en", [2], "old:9"), find).reasonKey).toBe("split.menu.why.alreadyPaired");
    expect(planComposedJoin(makeItem(10, "ko", [1, 3]), makeItem(11, "en", [2]), find).reasonKey).toBe("assign.composedOps.why.pairOneLine");
    expect(planComposedJoin(makeItem(10, "ko", [8]), makeItem(11, "en", [2]), find).reasonKey).toBe("assign.composedOps.why.pairOtherDoc");
  });
});

describe("save shapes", () => {
  it("split keeps the front text and adds the back text after it with the same source", () => {
    const group: Group = { units: [makeUnit(5, "unassigned")], targets: [makeTarget(40, [5])] };
    const body = buildComposedSplit(group, 40, "Front part. Back part.", 12);
    expect(body.action).toBe("confirm");
    expect(body.units).toEqual([{ unit_id: 5, revision: 2, disposition: "assigned", move_target_code: "", reason: "" }]);
    expect(body.targets[0]).toMatchObject({ id: 40, revision: 3, text: "Front part.", source_unit_ids: [5], slot_key: "scope" });
    expect(body.targets[1]).toMatchObject({ key: "split", target_doc_id: 7, slot_key: "scope", text: "Back part.", source_unit_ids: [5], position: { after_target_id: 40 } });
  });
  it("merge joins texts, sources and remarks into the upper box and removes the lower one", () => {
    const group: Group = { units: [makeUnit(5), makeUnit(6)], targets: [makeTarget(40, [5], "a"), makeTarget(41, [6], "b")] };
    const body = buildComposedMerge(group, { id: 40, text: "One." }, { id: 41, text: "Two." });
    expect(body.targets).toHaveLength(1);
    expect(body.targets[0]).toMatchObject({ id: 40, text: "One. Two.", source_unit_ids: [5, 6], remark: "a\nb" });
    expect(body.removed_target_ids).toEqual([41]);
  });
});
