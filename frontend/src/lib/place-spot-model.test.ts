import { describe, expect, it } from "vitest";

import type { ComposedItem, ComposedSection, OutlineKind } from "./api-sop";
import { resolveGapDrop, resolveSlotDrop } from "./assign-drop-model";
import {
  buildGapBlocks,
  buildPlaceSections,
  findPlaceBlock,
  formatGapLabel,
  formatPlacement,
  formatPlacePosition,
  isSpotOpen,
  listGapSpots,
  PLACE_REFUSAL_KEYS,
  readFixedSpot,
  readGapKey,
  readPlacePosition,
  readSubjectParticle,
  resolvePlaceSpot,
  type Placement,
} from "./place-spot-model";

function makeItem(target_id: number, unit: number, number: string | null = null, lang: ComposedItem["lang"] = "en"): ComposedItem {
  return { target_id, kind: "sentence", lang, text: `t${target_id}`, status: "confirmed", change_type: null, number, number_style: number ? "numbered" : "bullet", indent_level: 0, meaning_key: null, source_unit_ids: [unit] };
}

function makeSection(location_key: string, kind: OutlineKind | null, items: ComposedItem[] = [], extra: Partial<ComposedSection> = {}): ComposedSection {
  return {
    location_key,
    label: location_key,
    number: null,
    na_reason: null,
    heading_note: "",
    items,
    kind,
    level: location_key.split(".").length - 1,
    counts_lines: false,
    default_style: "bullet",
    shows_number: true,
    auto_items: [],
    deviation_reason: null,
    is_empty_required: false,
    ...extra,
  };
}

// 합성 SOP - 5장 범주 둘(Safety에 줄 하나), 6.1 번호 줄 둘(한/영 짝 하나), 7 · 7.1 묶음, 7.2 자동 목록, 8장, 9장(부록 선언 없음), N/A 칸
const SOP = [
  makeSection("general_requirements", "category_table", [], { number: "5", label: "General Requirements" }),
  makeSection("general_requirements.safety", "general", [makeItem(10, 100)], { number: "5.1", label: "General Requirements › Safety" }),
  makeSection("general_requirements.record", "general", [], { number: "5.2", label: "General Requirements › Record" }),
  makeSection("procedures", "named_children", [], { number: "6", label: "Procedures" }),
  makeSection("procedures.p1", "general", [makeItem(20, 200, "6.1.1"), makeItem(21, 200, null, "ko"), makeItem(22, 201, "6.1.2")], { number: "6.1", label: "Procedures › Filter change", counts_lines: true }),
  makeSection("document_relationships", "group", [], { number: "7" }),
  makeSection("document_relationships.associated_documents", "group", [], { number: "7.1" }),
  makeSection("document_relationships.work_instructions", "auto_list", [], { number: "7.2" }),
  makeSection("attachments", "general", [], { number: "8", label: "Attachments" }),
  makeSection("appendices", "named_children", [], { number: "9", label: "Appendices", counts_lines: true }),
  makeSection("purpose", "general", [], { number: "1", na_reason: "not used" }),
];
// Old 줄 - Unit 200은 한/영 짝 한 줄(같은 묶음)
const rowKeyOf = (unitId: number) => `r${unitId}`;
const sections = buildPlaceSections(SOP, rowKeyOf);

function expectPlace(placement: Placement): Extract<Placement, { kind: "place" }> {
  if (placement.kind !== "place") throw new Error(`expected a place, got ${JSON.stringify(placement)}`);
  return placement;
}

describe("resolvePlaceSpot - section spots", () => {
  it("puts a category row drop at the end of that category", () => {
    const placement = expectPlace(resolvePlaceSpot(sections, { kind: "section", sectionKey: "general_requirements.safety" }, [999]));
    expect(placement).toMatchObject({ sectionKey: "general_requirements.safety", position: { after: 10 }, edge: null, numbers: null, hint: null });
  });

  it("leaves the position out for an empty section", () => {
    expect(expectPlace(resolvePlaceSpot(sections, { kind: "section", sectionKey: "general_requirements.record" }, [999])).position).toBeNull();
  });

  it("keeps chapter heads with children assignable (decision C) and hints an undeclared appendix chapter", () => {
    expect(expectPlace(resolvePlaceSpot(sections, { kind: "section", sectionKey: "procedures" }, [999])).hint).toBeNull();
    const nine = expectPlace(resolvePlaceSpot(sections, { kind: "section", sectionKey: "appendices" }, [999]));
    expect(nine.hint).toBe("declare_appendix");
    expect(nine.numbers).toBeNull();
  });

  it("drops on a numbered section head after its last line with the next number", () => {
    expect(expectPlace(resolvePlaceSpot(sections, { kind: "section", sectionKey: "procedures.p1" }, [999])).numbers).toEqual({ after: "6.1.2", becomes: "6.1.3" });
  });

  it("refuses group titles, the auto list, N/A sections and the same section", () => {
    expect(resolvePlaceSpot(sections, { kind: "section", sectionKey: "document_relationships" }, [999])).toEqual({ kind: "refused", reason: "group_title" });
    expect(resolvePlaceSpot(sections, { kind: "section", sectionKey: "document_relationships.associated_documents" }, [999])).toEqual({ kind: "refused", reason: "group_title" });
    expect(resolvePlaceSpot(sections, { kind: "section", sectionKey: "document_relationships.work_instructions" }, [999])).toEqual({ kind: "refused", reason: "auto_list" });
    expect(resolvePlaceSpot(sections, { kind: "section", sectionKey: "purpose" }, [999])).toEqual({ kind: "refused", reason: "na_slot" });
    expect(resolvePlaceSpot(sections, { kind: "section", sectionKey: "general_requirements.safety" }, [100])).toEqual({ kind: "refused", reason: "same_slot" });
  });

  it("refuses what the app builds", () => {
    for (const what of ["toc", "cover", "scope_table", "system"] as const) expect(resolvePlaceSpot(sections, { kind: "fixed", what }, [999])).toEqual({ kind: "refused", reason: what });
  });

  it("maps a WI chapter spot to that step's instruction section", () => {
    const wi = buildPlaceSections([makeSection("step:2:instruction", null, [makeItem(30, 300)]), makeSection("step:2:why", null)], rowKeyOf);
    expect(expectPlace(resolvePlaceSpot(wi, { kind: "section", sectionKey: "step:2" }, [999]))).toMatchObject({ sectionKey: "step:2:instruction", position: { after: 30 } });
  });

  it("ignores unknown sections", () => {
    expect(resolvePlaceSpot(sections, { kind: "section", sectionKey: "nope" }, [999])).toEqual({ kind: "none" });
  });
});

describe("resolvePlaceSpot - line spots", () => {
  it("places between numbered lines with the number the line will get", () => {
    const below = expectPlace(resolvePlaceSpot(sections, { kind: "line", targetId: 20, isUpperHalf: false }, [999]));
    // 한/영 짝(20 · 21)이 한 묶음 - 아래 절반은 묶음 끝(21) 뒤
    expect(below).toMatchObject({ sectionKey: "procedures.p1", position: { after: 21 }, edge: { targetId: 21, side: "bottom" }, numbers: { after: "6.1.1", becomes: "6.1.2" } });
    const above = expectPlace(resolvePlaceSpot(sections, { kind: "line", targetId: 21, isUpperHalf: true }, [999]));
    expect(above).toMatchObject({ position: { after: null }, edge: { targetId: 20, side: "top" }, numbers: { after: null, becomes: "6.1.1" } });
  });

  it("refuses the section the dragged line is already in", () => {
    expect(resolvePlaceSpot(sections, { kind: "line", targetId: 22, isUpperHalf: true }, [200])).toEqual({ kind: "refused", reason: "same_slot" });
  });
});

describe("same answers as the basic view", () => {
  const drops = sections;
  it("line spots match resolveGapDrop", () => {
    for (const section of drops)
      for (const item of section.items)
        for (const isUpperHalf of [true, false])
          for (const drag of [[999], [200]]) {
            const basic = resolveGapDrop(section, item.targetId, isUpperHalf, drag);
            const placed = resolvePlaceSpot(drops, { kind: "line", targetId: item.targetId, isUpperHalf }, drag);
            if (basic.kind === "gap") expect(placed).toMatchObject({ kind: "place", sectionKey: basic.sectionKey, position: { after: basic.after }, edge: basic.edge });
            else expect(placed).toEqual(basic);
          }
  });

  it("empty section spots match resolveSlotDrop (finer reasons for not-assignable sections)", () => {
    for (const section of drops.filter((candidate) => candidate.items.length === 0)) {
      const basic = resolveSlotDrop(section);
      const placed = resolvePlaceSpot(drops, { kind: "section", sectionKey: section.key }, [999]);
      if (basic.kind === "slot") expect(placed).toMatchObject({ kind: "place", sectionKey: basic.sectionKey, position: null });
      else if (basic.kind === "refused" && basic.reason === "not_assignable") expect(placed).toMatchObject({ kind: "refused", reason: expect.stringMatching(/^(group_title|auto_list)$/) });
      else expect(placed).toEqual(basic);
    }
  });

  it("a section head drop equals dropping below the section's last block", () => {
    const head = expectPlace(resolvePlaceSpot(drops, { kind: "section", sectionKey: "procedures.p1" }, [999]));
    const gap = expectPlace(resolvePlaceSpot(drops, { kind: "line", targetId: 22, isUpperHalf: false }, [999]));
    expect(head.position).toEqual(gap.position);
  });
});

describe("findPlaceBlock · isSpotOpen", () => {
  it("finds the meaning block of a line", () => {
    expect(findPlaceBlock(sections, 21)).toEqual({ firstId: 20, lastId: 21 });
    expect(findPlaceBlock(sections, 404)).toBeNull();
  });
  it("lights only open section spots", () => {
    expect(isSpotOpen(sections, { kind: "section", sectionKey: "general_requirements.record" }, [999])).toBe(true);
    expect(isSpotOpen(sections, { kind: "section", sectionKey: "document_relationships" }, [999])).toBe(false);
    expect(isSpotOpen(sections, { kind: "line", targetId: 20, isUpperHalf: false }, [999])).toBe(false);
  });
});

describe("formatPlacement · refusal keys", () => {
  const t = (key: string, vars?: Record<string, string | number>) => `${key}${vars ? JSON.stringify(vars) : ""}`;
  it("names the destination and the number it becomes", () => {
    expect(formatPlacement(expectPlace(resolvePlaceSpot(sections, { kind: "section", sectionKey: "general_requirements.safety" }, [999])), t)).toBe("→ 5.1. General Requirements › Safety");
    expect(formatPlacement(expectPlace(resolvePlaceSpot(sections, { kind: "line", targetId: 20, isUpperHalf: false }, [999])), t)).toBe('→ 6.1. Procedures › Filter change · template.drop.after{"n":"6.1.2","p":"가","after":"6.1.1"}');
    expect(formatPlacement(expectPlace(resolvePlaceSpot(sections, { kind: "section", sectionKey: "appendices" }, [999])), t)).toBe("→ 9. Appendices · template.drop.declareAppendix");
  });
  it("picks the Korean particle by the last digit", () => {
    expect(["6.1.1", "6.1.2", "6.1.3", "6.1.4", "6.1.5", "6.1.9", "6.1.10"].map(readSubjectParticle)).toEqual(["이", "가", "이", "가", "가", "가", "이"]);
  });
  it("reads only known fixed spots", () => {
    expect(readFixedSpot("toc")).toBe("toc");
    expect(readFixedSpot("nope")).toBeNull();
    expect(readFixedSpot(undefined)).toBeNull();
  });
  it("has a message key for every refusal", () => {
    expect(Object.keys(PLACE_REFUSAL_KEYS).sort()).toEqual(["auto_list", "cover", "group_title", "na_slot", "not_assignable", "same_slot", "scope_table", "system", "toc", "written_doc"]);
  });
});

describe("click place - gaps between numbered lines (MD 2 S3)", () => {
  const blocks = buildGapBlocks(sections);
  const gaps = listGapSpots(sections, blocks);

  it("lists the gap before the first line and after each meaning block, only in counted sections", () => {
    // 한/영 짝(20 · 21)은 한 묶음이라 그 사이에는 틈이 없다. 5.1 Safety(번호 없음)에도 없다
    expect(gaps.map((gap) => gap.key)).toEqual(["before:20", "after:21", "after:22"]);
    expect(gaps.map((gap) => [gap.anchorId, gap.side])).toEqual([
      [20, "before"],
      [21, "after"],
      [22, "after"],
    ]);
  });

  it("saves each gap at the line before it (null = section start) with the number the line gets", () => {
    const answers = gaps.map((gap) => expectPlace(resolvePlaceSpot(sections, gap.spot, [999])));
    expect(answers.map((answer) => [answer.sectionKey, answer.position, answer.numbers])).toEqual([
      ["procedures.p1", { after: null }, { after: null, becomes: "6.1.1" }],
      ["procedures.p1", { after: 21 }, { after: "6.1.1", becomes: "6.1.2" }],
      ["procedures.p1", { after: 22 }, { after: "6.1.2", becomes: "6.1.3" }],
    ]);
  });

  it("gives the same answer as dragging onto that line half", () => {
    const section = sections.find((candidate) => candidate.key === "procedures.p1");
    if (!section) throw new Error("no section");
    for (const gap of gaps)
      for (const drag of [[999], [200]]) {
        if (gap.spot.kind !== "line") throw new Error("gap is a line spot");
        const basic = resolveGapDrop(section, gap.spot.targetId, gap.spot.isUpperHalf, drag);
        const placed = resolvePlaceSpot(sections, gap.spot, drag);
        if (basic.kind === "gap") expect(placed).toMatchObject({ kind: "place", position: { after: basic.after }, edge: basic.edge });
        else expect(placed).toEqual(basic);
      }
  });

  it("refuses every gap of the section the picked line is already in", () => {
    for (const gap of gaps) expect(resolvePlaceSpot(sections, gap.spot, [201])).toEqual({ kind: "refused", reason: "same_slot" });
  });

  it("reads the same gap key from either template half", () => {
    expect(readGapKey(blocks, null, 20)).toBe("before:20");
    // 영어 절반 20 → 22, 한글 절반 21 → 22 - 같은 묶음 경계
    expect(readGapKey(blocks, 20, 22)).toBe("after:21");
    expect(readGapKey(blocks, 21, 22)).toBe("after:21");
    expect(readGapKey(blocks, 22, null)).toBe("after:22");
    // 묶음 안 · 번호를 세지 않는 칸 · 줄 없음
    expect(readGapKey(blocks, 20, 21)).toBeNull();
    expect(readGapKey(blocks, null, 10)).toBeNull();
    expect(readGapKey(blocks, 10, null)).toBeNull();
    expect(readGapKey(blocks, null, null)).toBeNull();
  });

  it("labels a gap with the line before it and the number it becomes", () => {
    const t = (key: string, vars?: Record<string, string | number>) => `${key}${vars ? JSON.stringify(vars) : ""}`;
    const [first, second] = gaps.map((gap) => expectPlace(resolvePlaceSpot(sections, gap.spot, [999])));
    expect(formatGapLabel(first, t)).toBe('assign.place.gapFirst{"n":"6.1.1","p":"이","after":""}');
    expect(formatGapLabel(second, t)).toBe('assign.place.gapAfter{"n":"6.1.2","p":"가","after":"6.1.1"}');
    expect(formatGapLabel(expectPlace(resolvePlaceSpot(sections, { kind: "section", sectionKey: "general_requirements.safety" }, [999])), t)).toBe("");
  });
});

describe("click place - the position line of the picked-place box", () => {
  const t = (key: string, vars?: Record<string, string | number>) => (vars?.n ? `${key}(${vars.after ?? ""}→${vars.n}${vars.p})` : key);

  it("counts the number from the saved position (none = after the last line, empty = first line)", () => {
    expect(readPlacePosition(sections, "procedures.p1", 21)?.position).toEqual({ kind: "number", numbers: { after: "6.1.1", becomes: "6.1.2" } });
    expect(readPlacePosition(sections, "procedures.p1", null)?.position).toEqual({ kind: "number", numbers: { after: null, becomes: "6.1.1" } });
    expect(readPlacePosition(sections, "procedures.p1", undefined)?.position).toEqual({ kind: "number", numbers: { after: "6.1.2", becomes: "6.1.3" } });
    expect(formatPlacePosition(readPlacePosition(sections, "procedures.p1", 21) ?? expect.fail(), t)).toBe("template.drop.after(6.1.1→6.1.2가)");
    expect(formatPlacePosition(readPlacePosition(sections, "procedures.p1", null) ?? expect.fail(), t)).toBe("template.drop.first(→6.1.1이)");
  });

  it("says bullet line and where for sections that do not count lines", () => {
    expect(formatPlacePosition(readPlacePosition(sections, "general_requirements.safety", 10) ?? expect.fail(), t)).toBe("assign.place.bullet · assign.place.at.end");
    expect(formatPlacePosition(readPlacePosition(sections, "general_requirements.safety", undefined) ?? expect.fail(), t)).toBe("assign.place.bullet · assign.place.at.end");
    expect(formatPlacePosition(readPlacePosition(sections, "general_requirements.safety", null) ?? expect.fail(), t)).toBe("assign.place.bullet · assign.place.at.start");
    expect(formatPlacePosition(readPlacePosition(sections, "general_requirements.record", undefined) ?? expect.fail(), t)).toBe("assign.place.bullet · assign.place.at.end");
    const wi = buildPlaceSections([makeSection("step:2:why", null, [makeItem(30, 300), makeItem(31, 301)])], rowKeyOf);
    expect(formatPlacePosition(readPlacePosition(wi, "step:2:why", 30) ?? expect.fail(), t)).toBe("assign.place.at.between");
  });

  it("adds the appendix hint and skips unknown sections", () => {
    expect(formatPlacePosition(readPlacePosition(sections, "appendices", undefined) ?? expect.fail(), t)).toBe("template.drop.first(→9.1이) · template.drop.declareAppendix");
    expect(readPlacePosition(sections, "nope", undefined)).toBeNull();
  });
});
