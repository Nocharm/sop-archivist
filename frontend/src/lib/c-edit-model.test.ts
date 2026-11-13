// 결과물 C 문서 하나의 낙관적 편집 - 화면에서 먼저 바꾸고 번호를 미리 세며, 저장 응답이 오면 그 위에 남은 편집을 다시 얹는다.
import { describe, expect, it } from "vitest";

import type { NumberStyle, OutputCDoc, OutputCItem } from "./api-sop";
import { acceptSaved, addEdit, hasUnsentEdits, numberDoc, rebaseDraft, rejectSaved, sendDraft, startDraft } from "./c-edit-model";

type Section = OutputCDoc["sections"][number];

function line(id: number, number: string | null, extra: Partial<OutputCItem> = {}): OutputCItem {
  return { target_id: id, kind: "sentence", lang: "ko", text: `t${id}`, ai_text: "", change_type: null, status: "confirmed", source_note: "", origin: "units", meaning_key: null, number, indent_level: 0, number_style: "numbered", cell_row: null, cell_col: null, children: [], ...extra };
}

function section(number: string | null, items: OutputCItem[], key = `s${number}`): Section {
  return { location_key: key, label: key, number, na_reason: null, heading_note: "", items };
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
