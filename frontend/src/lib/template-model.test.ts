// 템플릿 보기 모델 - 결과물 C 꼴 문서를 템플릿 모양으로: 절반 순서, C와 같은 번호·같은 줄, 짝 미러링, 번역 없음 자리, 장 표, WI 장 대응
import { describe, expect, it } from "vitest";

import type { ComposedDoc, ComposedItem, ComposedSection, NumberStyle } from "@/lib/api-sop";
import { buildComposedRows, isComposedRow } from "@/lib/composed-model";
import { makeSectionOutline, makeTemplateOutline } from "@/lib/outline-fixture";
import { buildTemplateLayout, buildTemplateTitles, isLineSelected, listHalfLines, type TemplateBlock, type TemplateHalf, type TemplateTitles } from "@/lib/template-model";

const NO_TITLES: TemplateTitles = { ko: new Map(), steps: new Map() };

function makeItem(targetId: number, lang: ComposedItem["lang"], style: NumberStyle, number: string | null, fields: Partial<ComposedItem> = {}): ComposedItem {
  return {
    target_id: targetId, kind: "sentence", lang, text: `${lang}-${targetId}`, status: "confirmed", change_type: "as_is", number, number_style: style, indent_level: 0,
    meaning_key: null, source_unit_ids: [targetId * 10], ...fields,
  };
}

/** 짝 한 줄(영어 번호 · 한글 생략) - 함께 놓인 짝의 서버 기본값(target_placement._arrange_meaning) */
function makePair(enId: number, koId: number, number: string | null, style: NumberStyle = "numbered"): ComposedItem[] {
  const key = `old:${enId}`;
  return [makeItem(enId, "en", style, number, { meaning_key: key }), makeItem(koId, "ko", "omitted", null, { meaning_key: key })];
}

function makeSection(key: string, label: string, number: string | null, items: ComposedItem[], patch: Partial<ComposedSection> = {}): ComposedSection {
  const level = key.split(".").length - 1;
  return { ...makeSectionOutline({ level }), location_key: key, label, number, na_reason: null, heading_note: "", items, ...patch };
}

/** 템플릿 골격 SOP - 1·3·5(범주 둘)·6.1·7.x·8·9 */
function makeSop(): ComposedDoc {
  return {
    target_doc_id: 1, code: "SOP-TPL", title: "Synthetic Filter Care", doc_type: "sop", entrance: "assign",
    sections: [
      makeSection("purpose", "Purpose", "1", makePair(1, 2, null, "bullet"), { counts_lines: true, default_style: "bullet" }),
      makeSection("scope", "Scope", "2", [makeItem(3, "en", "bullet", null)]),
      makeSection("definitions", "Definitions", "3", [], { is_empty_required: true }),
      makeSection("responsibilities", "Responsibilities", "4", [], { na_reason: "Synthetic N/A" }),
      makeSection("general_requirements", "General Requirements", "5", [], { kind: "category_table", counts_lines: false }),
      makeSection("general_requirements.safety", "General Requirements › Safety", null, [
        makeItem(5, "en", "bullet", null, { meaning_key: "old:5" }), makeItem(6, "ko", "omitted", null, { meaning_key: "old:5" }),
        makeItem(7, "en", "bullet", null, { indent_level: 1 }),
      ]),
      makeSection("general_requirements.work", "General Requirements › Work", null, [], { deviation_reason: "Synthetic reason" }),
      makeSection("procedures", "Procedures", "6", [], { kind: "named_children", counts_lines: false }),
      makeSection("procedures.p1", "Procedures › Pre-cleaning", "6.1", [
        ...makePair(11, 12, "6.1.1"),
        makeItem(13, "en", "numbered", "6.1.2", { meaning_key: "old:13" }),
        makeItem(14, "en", "note", null),
        makeItem(15, "ko", "numbered", "6.1.3", { meaning_key: "old:15" }),
        makeItem(16, "neutral", "numbered", "6.1.4", { kind: "table", text: "" }),
      ]),
      makeSection("document_relationships", "Document Relationships", "7", [], { kind: "group" }),
      makeSection("document_relationships.associated_documents", "Document Relationships › Associated Documents", "7.1", [], { kind: "group" }),
      makeSection("document_relationships.associated_documents.form", "Document Relationships › Associated Documents › Form", "7.1.1", [makeItem(21, "en", "bullet", null)]),
      makeSection("document_relationships.work_instructions", "Document Relationships › Work Instructions", "7.2", [], { kind: "auto_list", auto_items: [{ code: "WI-TPL-01", title: "Filter change" }] }),
      makeSection("document_relationships.references", "Document Relationships › References", "7.3", []),
      makeSection("attachments", "Attachments", "8", []),
      makeSection("appendices", "Appendices", "9", [], { kind: "named_children", counts_lines: false }),
      makeSection("appendices.a1", "Appendix 1. Alarm list", "1", [makeItem(31, "en", "numbered", "1.1")], { shows_number: false }),
    ],
  };
}

const KO_TITLES: TemplateTitles = { ko: new Map([["procedures.p1", "세척 전 준비"], ["general_requirements.safety", "안전"], ["purpose", "목적"]]), steps: new Map() };

function findBlocks<K extends TemplateBlock<ComposedItem>["kind"]>(half: TemplateHalf<ComposedItem>, kind: K): Array<Extract<TemplateBlock<ComposedItem>, { kind: K }>> {
  return half.blocks.filter((block): block is Extract<TemplateBlock<ComposedItem>, { kind: K }> => block.kind === kind);
}

function readLines(half: TemplateHalf<ComposedItem>, sectionKey: string) {
  const block = half.blocks.find((item) => item.kind === "lines" && item.sectionKey === sectionKey);
  return block?.kind === "lines" ? block.lines : [];
}

describe("buildTemplateLayout - SOP", () => {
  const layout = buildTemplateLayout(makeSop(), KO_TITLES);
  const [en, ko] = layout.halves;

  it("draws the English half before the Korean half", () => {
    expect(layout.docType).toBe("sop");
    expect(layout.halves.map((half) => half.lang)).toEqual(["en", "ko"]);
  });

  it("keeps chapter titles, 7.x and appendices English in the Korean half and uses title_ko only for 6.x and 5.x", () => {
    const heads = (half: TemplateHalf<ComposedItem>) => findBlocks(half, "heading").map((block) => block.text);
    expect(heads(en)).toContain("6.1. Pre-cleaning");
    expect(heads(ko)).toContain("6.1. 세척 전 준비");
    expect(heads(ko)).toContain("1. Purpose");
    expect(heads(ko)).toContain("7.1.1. Form");
    expect(heads(ko)).toContain("Appendix 1. Alarm list");
    expect(findBlocks(ko, "categories")[0].rows.map((row) => row.title)).toEqual(["안전", "Work"]);
    expect(findBlocks(en, "categories")[0].rows.map((row) => row.title)).toEqual(["Safety", "Work"]);
  });

  it("mirrors a pair: the omitted Korean line shows the English number and both halves light up together", () => {
    const enLine = readLines(en, "procedures.p1")[0];
    const koLine = readLines(ko, "procedures.p1")[0];
    expect(enLine.item?.target_id).toBe(11);
    expect(koLine.item?.target_id).toBe(12);
    expect(enLine.marker).toEqual({ kind: "number", text: "6.1.1" });
    expect(koLine.marker).toEqual({ kind: "number", text: "6.1.1" });
    expect(isLineSelected(koLine, new Set([11]))).toBe(true);
    expect(isLineSelected(enLine, new Set([12]))).toBe(true);
    expect(isLineSelected(enLine, new Set([13]))).toBe(false);
  });

  it("puts a No translation slot on the other half for a line with no partner, with the same number", () => {
    const koLines = readLines(ko, "procedures.p1");
    const missEn = koLines.find((line) => line.key === "miss:13");
    expect(missEn).toMatchObject({ item: null, marker: { kind: "number", text: "6.1.2" } });
    expect(missEn?.source?.target_id).toBe(13);
    // 한글만 있는 줄은 영어 절반에 빈 자리 - 자기 C 번호 그대로
    const missKo = readLines(en, "procedures.p1").find((line) => line.key === "miss:15");
    expect(missKo).toMatchObject({ item: null, marker: { kind: "number", text: "6.1.3" } });
  });

  it("draws tables and language-less lines in both halves, notes as Note.", () => {
    const ids = (half: TemplateHalf<ComposedItem>) => readLines(half, "procedures.p1").map((line) => line.key);
    expect(ids(en)).toEqual(["t:11", "t:13", "t:14", "miss:15", "t:16"]);
    expect(ids(ko)).toEqual(["t:12", "miss:13", "miss:14", "t:15", "t:16"]);
    expect(readLines(en, "procedures.p1")[2].marker).toEqual({ kind: "note" });
  });

  it("draws bullets by depth and borrows the bullet for the omitted Korean partner", () => {
    const safety = (half: TemplateHalf<ComposedItem>) => findBlocks(half, "categories")[0].rows[0].lines;
    expect(safety(en).map((line) => line.marker)).toEqual([{ kind: "bullet", symbol: "•" }, { kind: "bullet", symbol: "○" }]);
    expect(safety(en).map((line) => line.depth)).toEqual([0, 1]);
    expect(safety(ko).map((line) => [line.key, line.marker])).toEqual([["t:6", { kind: "bullet", symbol: "•" }], ["miss:7", { kind: "bullet", symbol: "○" }]]);
  });

  it("shapes the chapters like the template", () => {
    const keys = en.blocks.map((block) => `${block.kind}:${block.sectionKey}`);
    // 2장 - 빈 Site 표, In Scope 아래 줄
    expect(keys.slice(keys.indexOf("heading:scope"), keys.indexOf("heading:scope") + 4)).toEqual(["heading:scope", "grid:scope", "label:scope", "lines:scope"]);
    expect(findBlocks(en, "grid").map((block) => [block.sectionKey, block.heads, block.blankRow])).toEqual([
      ["scope", ["Site", "Building", "Functional Unit", "Product"], true],
      ["definitions", ["Term", "Definition"], false],
      ["responsibilities", ["Role", "Responsibility"], false],
    ]);
    expect(findBlocks(en, "lines").find((block) => block.sectionKey === "scope")?.nested).toBe(true);
    // 비어 있음 · N/A · 묶음 제목은 머리만 · 7.2 자동 목록 · 8장 시스템 항목
    expect(findBlocks(en, "empty").map((block) => [block.sectionKey, block.na])).toEqual([
      ["definitions", false], ["responsibilities", true], ["document_relationships.references", false],
    ]);
    expect(findBlocks(en, "auto")[0].items).toEqual([{ code: "WI-TPL-01", title: "Filter change" }]);
    expect(findBlocks(en, "system")).toMatchObject([{ sectionKey: "attachments", text: "Attachment 1. Document Change History" }]);
    expect(keys).not.toContain("empty:document_relationships");
    expect(keys).not.toContain("empty:procedures");
    // 표준과 다름 · 비어 있음 알림
    expect(findBlocks(en, "heading").find((block) => block.sectionKey === "definitions")?.isEmptyRequired).toBe(true);
    expect(findBlocks(en, "categories")[0].rows[1]).toMatchObject({ sectionKey: "general_requirements.work", deviationReason: "Synthetic reason" });
  });

  it("builds the contents from chapters and the sections of 6 and 9", () => {
    expect(layout.toc.map((entry) => entry.text)).toEqual([
      "1. Purpose", "2. Scope", "3. Definitions", "4. Responsibilities", "5. General Requirements", "6. Procedures", "6.1. Pre-cleaning",
      "7. Document Relationships", "8. Attachments", "9. Appendices", "Appendix 1. Alarm list",
    ]);
  });

  it("holds exactly the lines of Output C - each sentence once, its own number untouched", () => {
    const doc = makeSop();
    const cRows = buildComposedRows(doc).filter(isComposedRow);
    const drawn = layout.halves.flatMap(listHalfLines).flatMap((line) => (line.item ? [line.item] : []));
    expect(new Set(drawn.map((item) => item.target_id))).toEqual(new Set(cRows.map((row) => row.target_id)));
    for (const row of cRows) {
      const copies = drawn.filter((item) => item.target_id === row.target_id);
      // 언어 줄은 한 절반에 한 번, 표·언어 없는 줄은 두 절반에 한 번씩
      expect(copies).toHaveLength(row.kind === "sentence" && (row.lang === "en" || row.lang === "ko") ? 1 : 2);
      expect(copies.every((item) => item.text === row.text)).toBe(true);
    }
    // C가 번호를 준 줄은 그 번호 그대로
    for (const line of layout.halves.flatMap(listHalfLines)) {
      if (line.item?.number) expect(line.marker).toEqual({ kind: "number", text: line.item.number });
    }
  });
});

describe("buildTemplateLayout - pair shapes (open question: 1:2 numbering)", () => {
  function layoutOf(items: ComposedItem[]) {
    const doc: ComposedDoc = { target_doc_id: 2, code: "SOP-P", title: "", doc_type: "sop", entrance: "assign", sections: [makeSection("procedures.p1", "Procedures › P1", "6.1", items, { level: 1 })] };
    const [en, ko] = buildTemplateLayout(doc, NO_TITLES).halves;
    return { en: readLines(en, "procedures.p1"), ko: readLines(ko, "procedures.p1") };
  }

  it("1:2 - the first Korean line takes the English number, the second keeps its own C mark (none), no No translation slot", () => {
    const key = "old:41";
    const { en, ko } = layoutOf([
      makeItem(41, "en", "numbered", "6.1.1", { meaning_key: key }),
      makeItem(42, "ko", "omitted", null, { meaning_key: key }),
      makeItem(43, "ko", "omitted", null, { meaning_key: key }),
    ]);
    expect(en.map((line) => line.key)).toEqual(["t:41"]);
    expect(ko.map((line) => [line.key, line.marker])).toEqual([["t:42", { kind: "number", text: "6.1.1" }], ["t:43", { kind: "none" }]]);
  });

  it("a pair saved one line at a time keeps both C numbers (6.1.1 | 6.1.2)", () => {
    const key = "old:51";
    const { en, ko } = layoutOf([makeItem(51, "en", "numbered", "6.1.1", { meaning_key: key }), makeItem(52, "ko", "numbered", "6.1.2", { meaning_key: key })]);
    expect(en[0].marker).toEqual({ kind: "number", text: "6.1.1" });
    expect(ko[0].marker).toEqual({ kind: "number", text: "6.1.2" });
    expect(en[0].mirrorIds).toEqual([51, 52]);
  });
});

describe("buildTemplateLayout - WI", () => {
  const doc: ComposedDoc = {
    target_doc_id: 3, code: "WI-TPL-01", title: "Filter change", doc_type: "wi", entrance: "assign",
    sections: [
      makeSection("step:1:instruction", "Step 1 · Instruction", "1", [], { kind: null }),
      makeSection("step:1:why", "Step 1 · Why", "1", [], { kind: null }),
      makeSection("step:2:instruction", "Step 2 · Instruction", "2", [
        ...makePair(61, 62, "2.1"),
        makeItem(63, "neutral", "numbered", "2.2", { kind: "figure", text: "" }),
      ], { kind: null }),
      makeSection("step:2:why", "Step 2 · Why", "2", [makeItem(64, "ko", "numbered", "2.3")], { kind: null }),
      makeSection("unstepped:instruction", "No step · Instruction", null, [makeItem(65, "ko", "numbered", null)], { kind: null }),
    ],
  };
  const titles: TemplateTitles = { ko: new Map(), steps: new Map([[1, "Prepare"], [2, "Change the filter"]]) };
  const layout = buildTemplateLayout(doc, titles);
  const [ko, en] = layout.halves;

  it("draws the Korean half before the English half, one chapter table per step", () => {
    expect(layout.halves.map((half) => half.lang)).toEqual(["ko", "en"]);
    expect(findBlocks(ko, "wi_chapter").map((block) => block.title)).toEqual(["Chapter 1. Prepare", "Chapter 2. Change the filter", "No step"]);
    expect(layout.toc.map((entry) => entry.text)).toEqual(["Chapter 1. Prepare", "Chapter 2. Change the filter", "No step"]);
  });

  it("makes each line a detail row with today's number, Why lines below in the same chapter, figures in the figure cell", () => {
    const step2 = findBlocks(ko, "wi_chapter")[1];
    expect(step2.rows.map((row) => [row.line.key, row.line.marker, row.why])).toEqual([
      ["t:62", { kind: "number", text: "2.1" }, false],
      ["t:64", { kind: "number", text: "2.3" }, true],
    ]);
    expect(step2.figures.map((line) => line.key)).toEqual(["t:63"]);
    const enStep2 = findBlocks(en, "wi_chapter")[1];
    expect(enStep2.rows.map((row) => row.line.key)).toEqual(["t:61", "miss:64"]);
    expect(findBlocks(en, "wi_chapter")[0].rows).toEqual([]);
  });
});

describe("buildTemplateTitles", () => {
  it("keeps this document's Korean names (not empty ones) and its WI step names", () => {
    const outline = makeTemplateOutline("SOP-A", { "procedures.p1": { title_ko: "절차 하나" }, purpose: { title_ko: " " } });
    const other = makeTemplateOutline("SOP-B", { "procedures.p1": { title_ko: "다른 문서" } });
    const titles = buildTemplateTitles(
      { outline_items: [...outline, ...other], wi_steps: [{ code: "SOP-A", step_no: 1, title: "One" }, { code: "WI-X", step_no: 1, title: "Other" }] },
      "SOP-A",
    );
    expect([...titles.ko]).toEqual([["procedures.p1", "절차 하나"]]);
    expect([...titles.steps]).toEqual([[1, "One"]]);
  });
});
