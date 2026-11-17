// 결과물 C 문서 하나의 낙관적 편집 - 화면에서 먼저 바꾸고 번호를 미리 세며, 저장 응답이 오면 그 위에 남은 편집을 다시 얹는다.
import { describe, expect, it } from "vitest";

import type { NumberStyle, OutputCDoc, OutputCItem, SectionOutline } from "./api-sop";
import { acceptSaved, addEdit, hasUnsentEdits, numberDoc, readLocationPlace, rebaseDraft, rejectSaved, sendDraft, startDraft } from "./c-edit-model";
import { makeSectionOutline } from "./outline-fixture";

type Section = OutputCDoc["sections"][number];

function line(id: number, number: string | null, extra: Partial<OutputCItem> = {}): OutputCItem {
  return { target_id: id, kind: "sentence", lang: "ko", text: `t${id}`, ai_text: "", change_type: null, status: "confirmed", source_note: "", origin: "units", meaning_key: null, number, indent_level: 0, number_style: "numbered", cell_row: null, cell_col: null, children: [], ...extra };
}

/** outline은 그 절이 골격에서 받은 값 - 기본은 줄을 세는 칸, 하위 칸을 선언하는 칸은 { counts_lines: false } */
function section(number: string | null, items: OutputCItem[], key = `s${number}`, outline: Partial<SectionOutline> = {}): Section {
  return { ...makeSectionOutline(outline), location_key: key, label: key, number, na_reason: null, heading_note: "", items };
}

function doc(sections: Section[]): OutputCDoc {
  return { target_doc_id: 7, code: "SOP-1", title: "T", doc_type: "sop", parent_code: null, entrance: "assign", sections };
}

const numbersOf = (d: OutputCDoc) => d.sections.map((s) => s.items.map((i) => [i.target_id, i.number]));

describe("addEdit", () => {
  it("swaps a line with its neighbour and renumbers the section", () => {
    const draft = addEdit(startDraft(doc([section("5", [line(1, "5.1"), line(2, "5.2")])])), { kind: "move", locationKey: "s5", targetId: 2, dir: -1 });
    expect(draft?.shown.sections[0].items.map((i) => [i.target_id, i.number])).toEqual([[2, "5.1"], [1, "5.2"]]);
  });

  it("returns null when the line is at the edge of its section", () => {
    const start = startDraft(doc([section("5", [line(1, "5.1"), line(2, "5.2")]), section("6", [line(3, "6.1")])]));
    expect(addEdit(start, { kind: "move", locationKey: "s5", targetId: 1, dir: -1 })).toBeNull();
    expect(addEdit(start, { kind: "move", locationKey: "s5", targetId: 2, dir: 1 })).toBeNull();
    expect(addEdit(start, { kind: "move", locationKey: "s9", targetId: 1, dir: 1 })).toBeNull();
    expect(addEdit(start, { kind: "indent", targetId: 99, depth: 1 })).toBeNull();
  });

  it("numbers the Instruction and Why of one WI step as one run", () => {
    // 단계 3의 Instruction [3.1] + Why [x] - Why의 줄은 Instruction에 이어 3.2
    const wi = doc([section("3", [line(1, "3.1")], "step:3:instruction"), section("3", [line(2, null)], "step:3:why"), section(null, [line(3, null)], "unstepped:instruction")]);
    expect(numbersOf(numberDoc(wi))).toEqual([[[1, "3.1"]], [[2, "3.2"]], [[3, null]]]);
  });

  it("indents and marks one line, skipping omitted and note lines and giving table cells the table number", () => {
    const table = line(3, "5.3", { kind: "table", lang: "neutral", children: [line(31, "5.3"), line(32, "5.3")] });
    const start = startDraft(doc([section("5", [line(1, "5.1"), line(2, "5.2"), table])]));
    const indented = addEdit(start, { kind: "indent", targetId: 2, depth: 1 });
    expect(numbersOf(indented!.shown)).toEqual([[[1, "5.1"], [2, "5.1.1"], [3, "5.2"]]]);
    expect(indented!.shown.sections[0].items[2].children.map((c) => c.number)).toEqual(["5.2", "5.2"]);
    const marked = addEdit(indented!, { kind: "style", targetId: 1, style: "note" as NumberStyle });
    // 주석 줄은 번호가 없고 세지 않는다 - 다음 번호 줄의 깊이 상한도 앞 번호 줄만 본다(첫 번호 줄은 0)
    expect(numbersOf(marked!.shown)).toEqual([[[1, null], [2, "5.1"], [3, "5.2"]]]);
    const tableNote = addEdit(marked!, { kind: "style", targetId: 3, style: "omitted" });
    expect(tableNote!.shown.sections[0].items[2].children.map((c) => [c.number_style, c.number])).toEqual([["omitted", null], ["omitted", null]]);
  });
});

describe("numberDoc in a section with sub sections", () => {
  it("gives no number to lines placed directly in it, whatever their style and depth, and leaves the sub section alone", () => {
    const table = line(3, "5.3", { kind: "table", lang: "neutral", children: [line(31, "5.3")] });
    const sop = doc([
      section("4", [line(9, null)], "responsibilities"),
      section("5", [line(1, "5.1"), line(2, "5.2", { indent_level: 1 }), table], "general_requirements", { counts_lines: false }),
      section("5.1", [line(4, null), line(5, null, { indent_level: 1 })], "general_requirements.safety"),
    ]);
    const shown = numberDoc(sop);
    // 하위 칸이 없는 칸(4)은 그대로 세고, 하위 칸의 줄은 5.1.1부터다
    expect(numbersOf(shown)).toEqual([[[9, "4.1"]], [[1, null], [2, null], [3, null]], [[4, "5.1.1"], [5, "5.1.1.1"]]]);
    expect(shown.sections[1].items[2].children.map((c) => c.number)).toEqual([null]);
    // 저장된 표시와 깊이는 건드리지 않는다
    expect(shown.sections[1].items.map((i) => [i.number_style, i.indent_level])).toEqual([["numbered", 0], ["numbered", 1], ["numbered", 0]]);
  });

  it("numbers a direct line again once it moves into a sub section", () => {
    const sop = startDraft(doc([section("6", [line(1, null), line(2, null)], "procedures", { counts_lines: false }), section("6.1", [line(3, "6.1.1")], "procedures.procedure")]));
    const moved = addEdit(sop, { kind: "place", locationKey: "procedures", toLocationKey: "procedures.procedure", targetIds: [2], beforeId: null, depths: [0] });
    expect(numbersOf(moved!.shown)).toEqual([[[1, null]], [[3, "6.1.1"], [2, "6.1.2"]]]);
  });

  it("reads the rule from each section, so a middle level of three counts nothing and the bottom level counts", () => {
    // 세 수준: 6(줄을 세지 않음) › 6.1(하위 칸을 선언해 역시 세지 않음) › 6.1.1(센다) - 칸 키의 점 수로는 가를 수 없다
    const sop = doc([
      section("6", [line(1, "6.1")], "a", { kind: "named_children", counts_lines: false }),
      section("6.1", [line(2, "6.1.1")], "a.b", { kind: "named_children", level: 1, counts_lines: false }),
      section("6.1.1", [line(3, null), line(4, null, { indent_level: 1 })], "a.b.c", { level: 2 }),
    ]);
    expect(numbersOf(numberDoc(sop))).toEqual([[[1, null]], [[2, null]], [[3, "6.1.1.1"], [4, "6.1.1.1.1"]]]);
  });
});

describe("sendDraft", () => {
  it("sends the whole order and only the depth and style that differ from the saved doc", () => {
    const start = startDraft(doc([section("5", [line(1, "5.1"), line(2, "5.2"), line(3, "5.3")]), section("6", [line(4, "6.1", { indent_level: 2 })])]));
    let draft = addEdit(start, { kind: "move", locationKey: "s5", targetId: 3, dir: -1 })!;
    draft = addEdit(draft, { kind: "indent", targetId: 3, depth: 1 })!;
    draft = addEdit(draft, { kind: "style", targetId: 2, style: "omitted" })!;
    // 들였다 되돌린 줄은 저장값과 같아 보내지 않는다 - 출처를 따라 바뀐 번역 깊이를 낡은 값으로 되보내지 않게
    draft = addEdit(draft, { kind: "indent", targetId: 1, depth: 1 })!;
    draft = addEdit(draft, { kind: "indent", targetId: 1, depth: 0 })!;

    const { draft: sent, items } = sendDraft(draft);

    expect(items).toEqual([{ target_id: 1 }, { target_id: 3, indent_level: 1 }, { target_id: 2, number_style: "omitted" }, { target_id: 4 }]);
    expect(sent.sentCount).toBe(5);
    expect(sent.shown).toBe(draft.shown);
  });
});

describe("acceptSaved / rejectSaved", () => {
  const start = startDraft(doc([section("5", [line(1, "5.1"), line(2, "5.2"), line(3, "5.3")])]));

  it("keeps edits made after sending on top of the server doc when the save comes back", () => {
    const first = addEdit(start, { kind: "move", locationKey: "s5", targetId: 1, dir: 1 })!;
    const { draft: sent } = sendDraft(first);
    const later = addEdit(sent, { kind: "move", locationKey: "s5", targetId: 1, dir: 1 })!;
    // 서버는 보낸 순서 [2, 1, 3]을 저장하고 번호를 매겨 돌려준다 - 번역이 쓸려 나가는 등 다른 값도 실을 수 있다
    const server = doc([section("5", [line(2, "5.1"), line(1, "5.2", { text: "server" }), line(3, "5.3")])]);

    const accepted = acceptSaved(later, server);

    expect(accepted.saved).toBe(server);
    expect(accepted.edits).toHaveLength(1);
    expect(accepted.sentCount).toBe(0);
    expect(numbersOf(accepted.shown)).toEqual([[[2, "5.1"], [3, "5.2"], [1, "5.3"]]]);
    expect(accepted.shown.sections[0].items[2].text).toBe("server");
  });

  it("shows the server doc as is when nothing was pressed after sending, and drops edits that no longer apply", () => {
    const { draft: sent } = sendDraft(addEdit(start, { kind: "move", locationKey: "s5", targetId: 1, dir: 1 })!);
    const server = doc([section("5", [line(2, "5.1"), line(1, "5.2"), line(3, "5.3")])]);
    expect(acceptSaved(sent, server).shown).toBe(server);
    // 보낸 뒤 누른 줄이 서버 응답에서 사라졌으면(쓸려 나간 번역) 그 편집은 버린다
    const later = addEdit(sent, { kind: "indent", targetId: 3, depth: 1 })!;
    const swept = doc([section("5", [line(2, "5.1"), line(1, "5.2")])]);
    expect(acceptSaved(later, swept)).toMatchObject({ shown: swept, edits: [] });
  });

  it("drops every unsaved edit when the save fails, keeping the last saved doc", () => {
    // 앞 저장의 응답 문서가 기준으로 남는다 - 다음 누름이 더 낡은 문서에서 시작하지 않게
    const saved = acceptSaved(sendDraft(addEdit(start, { kind: "move", locationKey: "s5", targetId: 1, dir: 1 })!).draft, doc([section("5", [line(2, "5.1"), line(1, "5.2"), line(3, "5.3")])]));
    const failed = rejectSaved(sendDraft(addEdit(saved, { kind: "move", locationKey: "s5", targetId: 1, dir: 1 })!).draft);
    expect(failed.shown).toBe(saved.saved);
  });

  it("drops every unsaved edit when the save fails", () => {
    const { draft: sent } = sendDraft(addEdit(start, { kind: "move", locationKey: "s5", targetId: 1, dir: 1 })!);
    const later = addEdit(sent, { kind: "style", targetId: 3, style: "note" })!;

    const rejected = rejectSaved(later);

    expect(rejected.shown).toBe(start.saved);
    expect(rejected.edits).toEqual([]);
    expect(rejected.sentCount).toBe(0);
  });

  it("knows which edits leaving the page would lose - the ones not in the request in flight", () => {
    const pressed = addEdit(start, { kind: "move", locationKey: "s5", targetId: 1, dir: 1 })!;
    expect(hasUnsentEdits(start)).toBe(false);
    expect(hasUnsentEdits(pressed)).toBe(true);
    const { draft: sent } = sendDraft(pressed);
    expect(hasUnsentEdits(sent)).toBe(false);
    expect(hasUnsentEdits(addEdit(sent, { kind: "indent", targetId: 3, depth: 1 })!)).toBe(true);
  });
});

describe("rebaseDraft", () => {
  const start = startDraft(doc([section("5", [line(1, "5.1"), line(2, "5.2"), line(3, "5.3")])]));
  // 라벨 언어만 다른 같은 문서 - 칸 이름이 바뀌어도 순서·깊이·표시가 같다
  const relabeled = doc([{ ...section("5", [line(1, "5.1"), line(2, "5.2"), line(3, "5.3")]), label: "다른 언어" }]);

  it("keeps a draft whose save is in flight - the response settles that doc", () => {
    const { draft: sent } = sendDraft(addEdit(start, { kind: "move", locationKey: "s5", targetId: 1, dir: 1 })!);
    expect(rebaseDraft(sent, relabeled)).toEqual({ draft: sent, dropped: false });
  });

  it("puts waiting edits back on a fetched doc that only reflects this screen's saves", () => {
    const waiting = addEdit(start, { kind: "move", locationKey: "s5", targetId: 3, dir: -1 })!;
    const { draft, dropped } = rebaseDraft(waiting, relabeled);
    expect(dropped).toBe(false);
    expect(draft?.saved).toBe(relabeled);
    expect(draft?.shown.sections[0].label).toBe("다른 언어");
    expect(draft?.shown.sections[0].items.map((i) => [i.target_id, i.number])).toEqual([[1, "5.1"], [3, "5.2"], [2, "5.3"]]);
  });

  it("drops waiting edits and says so when the doc changed elsewhere", () => {
    const waiting = addEdit(start, { kind: "indent", targetId: 2, depth: 1 })!;
    const reordered = doc([section("5", [line(2, "5.1"), line(1, "5.2"), line(3, "5.3")])]);
    expect(rebaseDraft(waiting, reordered)).toEqual({ draft: null, dropped: true });
    expect(rebaseDraft(waiting, undefined)).toEqual({ draft: null, dropped: true });
  });

  it("lets the fetched doc show as is when nothing is waiting", () => {
    const settled = acceptSaved(sendDraft(addEdit(start, { kind: "move", locationKey: "s5", targetId: 1, dir: 1 })!).draft, relabeled);
    expect(rebaseDraft(settled, doc([section("5", [line(2, "5.1"), line(1, "5.2"), line(3, "5.3")])]))).toEqual({ draft: null, dropped: false });
  });
});

describe("addEdit place", () => {
  const start = startDraft(doc([section("5", [line(1, "5.1"), line(2, "5.2"), line(3, "5.3"), line(4, "5.4")])]));
  const place = (targetIds: number[], beforeId: number | null, depths: number[] | null = null) => ({ kind: "place" as const, locationKey: "s5", targetIds, beforeId, depths });

  it("moves a block before another line and renumbers", () => {
    expect(numbersOf(addEdit(start, place([3, 4], 1))!.shown)).toEqual([[[3, "5.1"], [4, "5.2"], [1, "5.3"], [2, "5.4"]]]);
  });
  it("moves to the end of the section when beforeId is null and sets the given depths", () => {
    expect(numbersOf(addEdit(start, place([1], null, [1]))!.shown)).toEqual([[[2, "5.1"], [3, "5.2"], [4, "5.3"], [1, "5.3.1"]]]);
  });
  it("returns null for a no-op, a missing line, a beforeId inside the block and another section", () => {
    expect(addEdit(start, place([2], 3))).toBeNull();
    expect(addEdit(start, place([9], 1))).toBeNull();
    expect(addEdit(start, place([1, 2], 2))).toBeNull();
    expect(addEdit(start, { ...place([1], null), locationKey: "s9" })).toBeNull();
  });
  it("returns null for duplicate or empty targetIds", () => {
    expect(addEdit(start, place([1, 1], null))).toBeNull();
    expect(addEdit(start, place([], 1))).toBeNull();
  });
  it("returns null when depths does not match targetIds in length", () => {
    expect(addEdit(start, place([1, 2], null, [1]))).toBeNull();
    expect(addEdit(start, place([1], null, [1, 1]))).toBeNull();
  });
  it("returns null when beforeId is not in an existing section", () => {
    expect(addEdit(start, place([1], 99))).toBeNull();
  });
  it("keeps a depth-only change in place as a real edit", () => {
    expect(numbersOf(addEdit(start, place([2], 3, [1]))!.shown)).toEqual([[[1, "5.1"], [2, "5.1.1"], [3, "5.2"], [4, "5.3"]]]);
    const last = addEdit(start, place([4], null, [1]))!.shown;
    expect(numbersOf(last)).toEqual([[[1, "5.1"], [2, "5.2"], [3, "5.3"], [4, "5.3.1"]]]);
    expect(last.sections[0].items[3].indent_level).toBe(1);
  });
  it("returns null for a block already at the end with no depths", () => {
    expect(addEdit(start, place([3, 4], null))).toBeNull();
  });
  it("sends the whole new order and only the depths that changed", () => {
    const { items } = sendDraft(addEdit(start, place([1], null, [1]))!);
    expect(items).toEqual([{ target_id: 2 }, { target_id: 3 }, { target_id: 4 }, { target_id: 1, indent_level: 1 }]);
  });
  it("re-applies a place made after sending and drops it when a block line is gone", () => {
    const { draft: sent } = sendDraft(addEdit(start, { kind: "move", locationKey: "s5", targetId: 1, dir: 1 })!);
    const later = addEdit(sent, place([4], 2))!;
    const server = doc([section("5", [line(2, "5.1"), line(1, "5.2"), line(3, "5.3"), line(4, "5.4")])]);
    expect(numbersOf(acceptSaved(later, server).shown)).toEqual([[[4, "5.1"], [2, "5.2"], [1, "5.3"], [3, "5.4"]]]);
    const gone = doc([section("5", [line(2, "5.1"), line(1, "5.2"), line(3, "5.3")])]);
    expect(acceptSaved(later, gone).edits).toEqual([]);
  });
});

describe("addEdit place across sections", () => {
  // 출발 칸은 줄을 세는 칸(4) - 하위 칸이 있는 칸(6)에 직접 놓인 줄은 번호가 없다(위 numberDoc 시험)
  const sop = startDraft(
    doc([
      section("4", [line(1, "4.1"), line(2, "4.2")], "responsibilities"),
      section("6.1", [line(3, "6.1.1")], "procedures.procedure"),
      section("6.2", [], "procedures.electronic_record_control"),
      { ...section("6.3", [], "procedures.troubleshooting"), na_reason: "N/A" },
    ]),
  );
  const wi = startDraft({
    ...doc([
      section("1", [line(1, "1.1")], "step:1:instruction"),
      section("2", [], "step:2:instruction"),
      section("2", [], "step:2:why"),
      section(null, [line(2, null)], "unstepped:instruction"),
    ]),
    doc_type: "wi",
  });
  // 칸을 넘는 편집은 깊이가 필수라 기본은 모두 0
  const cross = (ids: number[], to: string, beforeId: number | null, depths: number[] | null = ids.map(() => 0)) => ({ kind: "place" as const, locationKey: "responsibilities", toLocationKey: to, targetIds: ids, beforeId, depths });
  const wiPlace = (to: string) => ({ kind: "place" as const, locationKey: "step:1:instruction", toLocationKey: to, targetIds: [1], beforeId: null, depths: [0] });
  const toStep2 = wiPlace("step:2:instruction");
  const toUnstepped = wiPlace("unstepped:instruction");

  it("moves a block into another section before a line and renumbers both", () => {
    expect(numbersOf(addEdit(sop, cross([2], "procedures.procedure", 3))!.shown)).toEqual([[[1, "4.1"]], [[2, "6.1.1"], [3, "6.1.2"]], [], []]);
  });
  it("makes the block the first lines of an empty section", () => {
    expect(numbersOf(addEdit(sop, cross([1, 2], "procedures.electronic_record_control", null))!.shown)).toEqual([[], [[3, "6.1.1"]], [[1, "6.2.1"], [2, "6.2.2"]], []]);
  });
  it("sets the given depths on a block that changes section", () => {
    const shown = addEdit(sop, cross([2], "procedures.procedure", null, [1]))!.shown;
    expect(shown.sections[1].items.map((i) => [i.target_id, i.indent_level, i.number])).toEqual([[3, 0, "6.1.1"], [2, 1, "6.1.1.1"]]);
  });
  it("refuses an N/A section, a missing section, a beforeId outside the destination and a WI part change", () => {
    expect(addEdit(sop, cross([1], "procedures.troubleshooting", null))).toBeNull();
    expect(addEdit(sop, cross([1], "nowhere", null))).toBeNull();
    expect(addEdit(sop, cross([1], "procedures.procedure", 2))).toBeNull();
    expect(addEdit(wi, { kind: "place", locationKey: "step:1:instruction", toLocationKey: "step:2:why", targetIds: [1], beforeId: null, depths: [0] })).toBeNull();
  });
  it("refuses missing depths, a gone block line, a beforeId inside the block, duplicate or empty ids, wrong depths length and a mixed kind", () => {
    expect(addEdit(sop, cross([1], "procedures.procedure", null, null))).toBeNull();
    expect(addEdit(sop, cross([9], "procedures.procedure", null))).toBeNull();
    expect(addEdit(sop, cross([1], "procedures.procedure", 1))).toBeNull();
    expect(addEdit(sop, cross([1, 1], "procedures.procedure", null))).toBeNull();
    expect(addEdit(sop, cross([], "procedures.procedure", null))).toBeNull();
    expect(addEdit(sop, cross([1, 2], "procedures.procedure", null, [0]))).toBeNull();
    // 한 문서에 SOP 칸과 WI 칸이 함께 있는 자료 - 도착 칸이 있어 종류 검사만 null을 만든다
    const mixed = startDraft({ ...doc([section("1", [line(1, "1.1")], "step:1:instruction"), section("6", [line(2, "6.1")], "procedures")]), doc_type: "wi" });
    expect(addEdit(mixed, { ...wiPlace("procedures") })).toBeNull();
    expect(addEdit(mixed, { kind: "place", locationKey: "procedures", toLocationKey: "step:1:instruction", targetIds: [2], beforeId: null, depths: [0] })).toBeNull();
  });
  it("keeps an in-section place the same with or without toLocationKey", () => {
    const start = startDraft(doc([section("5", [line(1, "5.1"), line(2, "5.2"), line(3, "5.3"), line(4, "5.4")])]));
    const plain = { kind: "place" as const, locationKey: "s5", targetIds: [3, 4], beforeId: 1, depths: null };
    const withTo = { ...plain, toLocationKey: "s5" };
    expect(addEdit(start, withTo)!.shown).toEqual(addEdit(start, plain)!.shown);
    expect(sendDraft(addEdit(start, withTo)!).items).toEqual(sendDraft(addEdit(start, plain)!).items);
    expect(sendDraft(addEdit(start, plain)!).items).toEqual([{ target_id: 3 }, { target_id: 4 }, { target_id: 1 }, { target_id: 2 }]);
  });
  it("sends the new place and the depth of every line that changed section, even an unchanged depth", () => {
    expect(sendDraft(addEdit(sop, cross([2], "procedures.procedure", null))!).items).toEqual([
      { target_id: 1 },
      { target_id: 3 },
      { target_id: 2, slot_key: "procedures.procedure", indent_level: 0 },
    ]);
  });
  it("sends wi_step null, not a missing key, for the unstepped section", () => {
    const item = sendDraft(addEdit(wi, toUnstepped)!).items.find((i) => i.target_id === 1)!;
    expect(item).toHaveProperty("wi_step", null);
    expect(item).toEqual({ target_id: 1, wi_step: null, indent_level: 0 });
    expect(sendDraft(addEdit(wi, toStep2)!).items.find((i) => i.target_id === 1)).toEqual({ target_id: 1, wi_step: 2, indent_level: 0 });
  });
  it("re-applies a cross-section place over the server answer and drops it quietly when the destination became N/A", () => {
    const { draft: sent } = sendDraft(addEdit(sop, { kind: "style", targetId: 3, style: "note" })!);
    const later = addEdit(sent, cross([2], "procedures.procedure", null))!;
    const server = doc([
      section("4", [line(1, "4.1"), line(2, "4.2")], "responsibilities"),
      section("6.1", [line(3, null)], "procedures.procedure"),
      section("6.2", [], "procedures.electronic_record_control"),
      { ...section("6.3", [], "procedures.troubleshooting"), na_reason: "N/A" },
    ]);
    const accepted = acceptSaved(later, server);
    expect(accepted.edits).toHaveLength(1);
    expect(accepted.shown.sections[1].items.map((i) => i.target_id)).toEqual([3, 2]);
    const na = { ...server, sections: server.sections.map((s) => (s.location_key === "procedures.procedure" ? { ...s, na_reason: "N/A" } : s)) };
    expect(acceptSaved(later, na)).toMatchObject({ shown: na, edits: [] });
  });
  it("reads the place of a section key", () => {
    expect(readLocationPlace("purpose")).toEqual({ slot_key: "purpose" });
    expect(readLocationPlace("step:3:why")).toEqual({ wi_step: 3, wi_part: "why" });
    expect(readLocationPlace("unstepped:instruction")).toEqual({ wi_step: null, wi_part: "instruction" });
    expect(readLocationPlace("path:1. A")).toBeNull();
  });
});
