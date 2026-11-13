// 결과물 C 섹션 번호 - 보이는 깊이는 서버 번호와 맞고, 들이기는 앞줄 깊이 + 1을 넘지 않으며, 바꿀 수 있는 줄만 단추를 받는다.
import { describe, expect, it } from "vitest";

import type { NumberStyle, OutputCItem } from "./api-sop";
import { canChangeDepth, canChangeStyle, canIndent, getSectionDepths, isCounted, readIndentKey } from "./section-number";

function item(id: number, number: string | null, indent = 0, style: NumberStyle = "numbered"): OutputCItem {
  return { target_id: id, kind: "sentence", lang: "ko", text: "", ai_text: "", change_type: null, status: "confirmed", source_note: "", origin: "units", meaning_key: null, number, indent_level: indent, number_style: style, cell_row: null, cell_col: null, children: [] };
}

describe("getSectionDepths", () => {
  it("reads the depth from the number under the section number", () => {
    const section = { number: "5.1", items: [item(1, "5.1.1"), item(2, "5.1.1.1", 4), item(3, "5.1.2")] };
    expect(getSectionDepths(section)).toEqual([0, 1, 0]);
  });

  it("clamps the stored depth where the section has no number", () => {
    // 서버 number_lines와 같은 눌러 읽기 - 첫 줄 0, 앞줄의 눌러 읽은 깊이 + 1까지
    const depths = (stored: number[]) => getSectionDepths({ number: null, items: stored.map((depth, index) => item(index, null, depth)) });
    expect(depths([2, 4, 4, 0, 3])).toEqual([0, 1, 2, 0, 1]);
    expect(depths([])).toEqual([]);
  });

  // 생략·주석 줄은 번호가 없어도 사람이 정한 깊이로 들여 그린다 - 상한은 앞 번호 줄 깊이 + 1, 다음 줄의 상한에는 끼지 않는다
  it.each([
    { name: "a note under a numbered line keeps its indent", items: [item(1, "5.1"), item(2, null, 1, "note"), item(3, "5.2")], want: [0, 1, 0] },
    { name: "an omitted line is clamped to the previous numbered line + 1", items: [item(1, "5.1"), item(2, null, 3, "omitted")], want: [0, 1] },
    { name: "an unnumbered first line stays at 0", items: [item(1, null, 2, "note"), item(2, "5.1")], want: [0, 0] },
    { name: "a deep note does not raise the limit for the next line", items: [item(1, "5.1"), item(2, "5.1.1", 1), item(3, null, 2, "note"), item(4, null, 9, "omitted")], want: [0, 1, 2, 2] },
  ])("$name", ({ items, want }) => {
    expect(getSectionDepths({ number: "5", items })).toEqual(want);
  });

  it("skips unnumbered lines for the limit in a section without a number too", () => {
    const items = [item(1, null, 0), item(2, null, 1, "note"), item(3, null, 2, "omitted"), item(4, null, 2)];
    expect(getSectionDepths({ number: null, items })).toEqual([0, 1, 1, 1]);
  });

  it("draws a numbered-style line without a number at its clamped stored depth, and it counts for the next limit", () => {
    // 번호 칸 안에서 번호 표시인데 서버 번호가 빈 줄(예전에는 늘 0) - 사람이 정한 깊이를 앞 번호 줄 + 1까지로 그리고,
    // 번호 표시라 다음 줄의 상한에도 낀다. 저장값을 버리고 0으로 그리면 들여쓰기가 사라진다
    const items = [item(1, "5.1"), item(2, null, 3), item(3, null, 5)];
    expect(getSectionDepths({ number: "5", items })).toEqual([0, 1, 2]);
  });
});

describe("isCounted", () => {
  it("counts numbered lines only", () => {
    expect(isCounted({ number_style: "numbered" })).toBe(true);
    expect(isCounted({ number_style: "omitted" })).toBe(false);
    expect(isCounted({ number_style: "note" })).toBe(false);
  });
});

describe("canIndent", () => {
  const all = (length: number) => Array<boolean>(length).fill(true);

  it("stops at the backend's deepest level (9)", () => {
    expect(canIndent([9, 9], all(2), 1, 1)).toBe(false);
    expect(canIndent([8, 8], all(2), 1, 1)).toBe(true);
  });

  const depths = [0, 1, 1, 0];

  it("lets a line go at most one deeper than the line before", () => {
    expect(canIndent(depths, all(4), 0, 1)).toBe(false);
    expect(canIndent(depths, all(4), 1, 1)).toBe(false);
    expect(canIndent(depths, all(4), 2, 1)).toBe(true);
    expect(canIndent(depths, all(4), 3, 1)).toBe(true);
  });

  it("outdents only above depth 0", () => {
    expect(canIndent(depths, all(4), 0, -1)).toBe(false);
    expect(canIndent(depths, all(4), 1, -1)).toBe(true);
    expect(canIndent(depths, all(4), 9, -1)).toBe(false);
  });

  it("measures against the previous numbered line, skipping omitted and note lines", () => {
    // 5.1 / (주석, 깊이 1) / 줄 - 셋째 줄의 상한은 첫 줄(0) + 1이다
    expect(canIndent([0, 1, 1], [true, false, true], 2, 1)).toBe(false);
    expect(canIndent([0, 1, 0], [true, false, true], 2, 1)).toBe(true);
    // 앞에 번호 줄이 없으면 들일 수 없다
    expect(canIndent([0, 0], [false, true], 1, 1)).toBe(false);
    expect(canIndent([0, 0], [false, false], 1, 1)).toBe(false);
  });
});

describe("readIndentKey", () => {
  const key = (extra: Partial<{ key: string; shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean }> = {}) => ({ key: "Tab", shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, ...extra });
  const both = { canOut: true, canIn: true, busy: false };

  it("takes Tab and Shift+Tab only when that direction is allowed", () => {
    expect(readIndentKey(key(), both)).toBe(1);
    expect(readIndentKey(key({ shiftKey: true }), both)).toBe(-1);
    expect(readIndentKey(key(), { ...both, canIn: false })).toBeNull();
    expect(readIndentKey(key({ shiftKey: true }), { ...both, canOut: false })).toBeNull();
  });

  it("lets Tab move focus while saving, with modifiers, or for other keys", () => {
    expect(readIndentKey(key(), { ...both, busy: true })).toBeNull();
    expect(readIndentKey(key({ ctrlKey: true }), both)).toBeNull();
    expect(readIndentKey(key({ altKey: true }), both)).toBeNull();
    expect(readIndentKey(key({ key: "Enter" }), both)).toBeNull();
  });
});

describe("canChangeDepth", () => {
  it("locks the depth of an AI translation only", () => {
    expect(canChangeDepth("assign", { origin: "units" })).toBe(true);
    expect(canChangeDepth("assign", { origin: "translation" })).toBe(false);
  });

  it("lets a sentence a person wrote in the other language change depth", () => {
    // 사람이 쓴 다른 언어 문장(기원 units, 종류 translated)은 일반 새 문장이다
    expect(canChangeDepth("assign", { origin: "units" })).toBe(true);
  });

  it("leaves written New documents alone", () => {
    expect(canChangeDepth("match", { origin: "units" })).toBe(false);
    expect(canChangeDepth("match", { origin: "new_doc" })).toBe(false);
  });
});

describe("canChangeStyle", () => {
  it("allows a number style on every line except in written New documents", () => {
    expect(canChangeStyle("assign")).toBe(true);
    expect(canChangeStyle("match")).toBe(false);
  });
});
