// 결과물 C 섹션 번호 - 보이는 깊이는 서버 번호와 맞고, 들이기는 앞줄 깊이 + 1을 넘지 않으며, 바꿀 수 있는 줄만 단추를 받는다.
import { describe, expect, it } from "vitest";

import type { NumberStyle, OutputCItem } from "./api-sop";
import { makeDeepOutline, makeSectionOutline } from "./outline-fixture";
import { BULLET_SYMBOLS, canChangeDepth, canChangeStyle, canIndent, getSectionDepths, isCounted, listBullets, listCounted, MAX_BULLET_LEVEL, numberLines, readBulletSymbol, readIndentKey, readStyleChoices } from "./section-number";

function item(id: number, number: string | null, indent = 0, style: NumberStyle = "numbered"): OutputCItem {
  return { target_id: id, kind: "sentence", lang: "ko", text: "", ai_text: "", change_type: null, status: "confirmed", source_note: "", source_count: 1, origin: "units", meaning_key: null, number, indent_level: indent, number_style: style, cell_row: null, cell_col: null, children: [] };
}

// backend tests/test_sop_numbering.py의 두 표 그대로 - 사본이 서버 outputs.number_lines와 같은 번호를 미리 센다
describe("numberLines", () => {
  it.each<[number[], string[]]>([
    [[], []],
    [[0, 0, 0], ["5.1", "5.2", "5.3"]],
    [[0, 1, 1, 2, 0], ["5.1", "5.1.1", "5.1.2", "5.1.2.1", "5.2"]],
    [[3], ["5.1"]],
    [[0, 4, 4], ["5.1", "5.1.1", "5.1.1.1"]],
    [[0, 1, 2, 3, 1, 0], ["5.1", "5.1.1", "5.1.1.1", "5.1.1.1.1", "5.1.2", "5.2"]],
    [[0, 1, 2, 0, 2], ["5.1", "5.1.1", "5.1.1.1", "5.2", "5.2.1"]],
  ])("numbers depths %j as the server does", (depths, expected) => {
    expect(numberLines("5", depths)).toEqual(expected);
  });

  it.each<[(number | null)[], (string | null)[]]>([
    [[0, null, 0], ["5.1", null, "5.2"]],
    [[null, 0, 0], [null, "5.1", "5.2"]],
    [[null, 3], [null, "5.1"]],
    [[0, 1, null, 1], ["5.1", "5.1.1", null, "5.1.2"]],
    [[0, null, 2], ["5.1", null, "5.1.1"]],
    [[0, 1, null, 0, 1], ["5.1", "5.1.1", null, "5.2", "5.2.1"]],
    [[null, null], [null, null]],
  ])("skips unnumbered lines in %j as the server does", (depths, expected) => {
    expect(numberLines("5", depths)).toEqual(expected);
  });
});

describe("getSectionDepths", () => {
  it("reads the depth from the number under the section number", () => {
    const section = { counts_lines: true, number: "5.1", items: [item(1, "5.1.1"), item(2, "5.1.1.1", 4), item(3, "5.1.2")] };
    expect(getSectionDepths(section)).toEqual([0, 1, 0]);
  });

  it("clamps the stored depth where the section has no number", () => {
    // 서버 number_lines와 같은 눌러 읽기 - 첫 줄 0, 앞줄의 눌러 읽은 깊이 + 1까지
    const depths = (stored: number[]) => getSectionDepths({ counts_lines: true, number: null, items: stored.map((depth, index) => item(index, null, depth)) });
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
    expect(getSectionDepths({ counts_lines: true, number: "5", items })).toEqual(want);
  });

  it("skips unnumbered lines for the limit in a section without a number too", () => {
    const items = [item(1, null, 0), item(2, null, 1, "note"), item(3, null, 2, "omitted"), item(4, null, 2)];
    expect(getSectionDepths({ counts_lines: true, number: null, items })).toEqual([0, 1, 1, 1]);
  });

  it("draws a numbered-style line without a number at its clamped stored depth, and it counts for the next limit", () => {
    // 번호 칸 안에서 번호 표시인데 서버 번호가 빈 줄(예전에는 늘 0) - 사람이 정한 깊이를 앞 번호 줄 + 1까지로 그리고,
    // 번호 표시라 다음 줄의 상한에도 낀다. 저장값을 버리고 0으로 그리면 들여쓰기가 사라진다
    const items = [item(1, "5.1"), item(2, null, 3), item(3, null, 5)];
    expect(getSectionDepths({ counts_lines: true, number: "5", items })).toEqual([0, 1, 2]);
  });

  it("draws the lines of a section that does not count lines at depth 0 - none is counted, so none sets a limit", () => {
    const items = [item(1, null, 0), item(2, null, 1), item(3, null, 2, "note")];
    expect(getSectionDepths({ counts_lines: false, number: "6", items })).toEqual([0, 0, 0]);
    // 같은 줄이 하위 칸에서는 저장된 깊이로 그려진다
    expect(getSectionDepths({ counts_lines: true, number: "6.1", items })).toEqual([0, 1, 2]);
  });

  it("reads the depth under a section number of any length - a level 2 section", () => {
    // 세 수준 골격의 맨 아래 칸(6.1.2) - 줄 번호는 칸 번호 마디 수를 뺀 만큼이 깊이다
    const section = { ...makeSectionOutline({ level: 2 }), number: "6.1.2", items: [item(1, "6.1.2.1"), item(2, "6.1.2.1.1", 1), item(3, "6.1.2.2")] };
    expect(getSectionDepths(section)).toEqual([0, 1, 0]);
  });
});

describe("isCounted", () => {
  it("counts numbered lines only", () => {
    expect(isCounted({ number_style: "numbered" })).toBe(true);
    expect(isCounted({ number_style: "omitted" })).toBe(false);
    expect(isCounted({ number_style: "note" })).toBe(false);
  });
});

describe("listCounted", () => {
  const items = [item(1, null), item(2, null, 1, "note")];

  it("counts by style in a section whose lines are numbered", () => {
    expect(listCounted({ counts_lines: true, items })).toEqual([true, false]);
  });

  it("counts no line placed directly in a section that does not count lines, whatever its style", () => {
    expect(listCounted({ counts_lines: false, items })).toEqual([false, false]);
  });
});

describe("readStyleChoices", () => {
  const counting = makeSectionOutline();
  const notCounting = makeSectionOutline({ kind: "named_children", counts_lines: false });

  it("offers all four styles and presses the stored one where lines are numbered", () => {
    expect(readStyleChoices(counting, "numbered")).toEqual({ choices: ["numbered", "bullet", "omitted", "note"], pressed: "numbered" });
    expect(readStyleChoices(counting, "note")).toEqual({ choices: ["numbered", "bullet", "omitted", "note"], pressed: "note" });
    expect(readStyleChoices(counting, "bullet").pressed).toBe("bullet");
  });

  it("hides Numbered in a section that does not count lines and shows a line stored as numbered as No number", () => {
    expect(readStyleChoices(notCounting, "numbered")).toEqual({ choices: ["bullet", "omitted", "note"], pressed: "omitted" });
    expect(readStyleChoices(notCounting, "omitted")).toEqual({ choices: ["bullet", "omitted", "note"], pressed: "omitted" });
    expect(readStyleChoices(notCounting, "note")).toEqual({ choices: ["bullet", "omitted", "note"], pressed: "note" });
    expect(readStyleChoices(notCounting, "bullet").pressed).toBe("bullet");
  });

  it("reads the section's own value, not its place in the outline - a middle level that declares sub sections, a bottom level that counts", () => {
    // 세 수준 골격: a.b(수준 1)는 하위 칸을 선언해 줄을 세지 않고, a.b.c(수준 2)는 센다
    const outline = makeDeepOutline("SOP-1");
    const [middle, bottom] = ["a.b", "a.b.c"].map((key) => outline.find((entry) => entry.key === key)!);
    expect([middle.level, bottom.level]).toEqual([1, 2]);
    expect(readStyleChoices(middle, "numbered").pressed).toBe("omitted");
    expect(readStyleChoices(bottom, "numbered").choices).toContain("numbered");
    expect(listCounted({ ...middle, items: [item(1, null)] })).toEqual([false]);
    expect(listCounted({ ...bottom, items: [item(1, null)] })).toEqual([true]);
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

describe("bullet lines", () => {
  const bullet = (id: number, indent = 0) => item(id, null, indent, "bullet");
  const bulletSection = (items: OutputCItem[], number: string | null = "5") => ({ counts_lines: false, number, items });
  const toDepths = (items: OutputCItem[]) => getSectionDepths(bulletSection(items));
  const canIn = (items: OutputCItem[], index: number, dir: 1 | -1 = 1) => canIndent(toDepths(items), listCounted(bulletSection(items)), index, dir, listBullets({ items }));

  it("reads the symbol of each level and stops at the third", () => {
    expect([0, 1, 2].map(readBulletSymbol)).toEqual(["•", "○", "▪"]);
    expect(BULLET_SYMBOLS).toHaveLength(MAX_BULLET_LEVEL + 1);
    expect(readBulletSymbol(7)).toBe("▪");
  });

  it("lets a bullet line go at most one deeper than the bullet line before it, and the first one stays at 0", () => {
    const items = [bullet(1), bullet(2), bullet(3)];
    expect([canIn(items, 0), canIn(items, 1), canIn(items, 2)]).toEqual([false, true, true]);
    const nested = [bullet(1), bullet(2, 1), bullet(3, 1)];
    expect(toDepths(nested)).toEqual([0, 1, 1]);
    expect([canIn(nested, 1), canIn(nested, 2)]).toEqual([false, true]);
  });

  it("caps the depth at the third level (depth 2) and clamps stored deeper values", () => {
    const items = [bullet(1), bullet(2, 1), bullet(3, 2), bullet(4, 2)];
    expect(toDepths(items)).toEqual([0, 1, 2, 2]);
    expect([canIn(items, 2), canIn(items, 3)]).toEqual([false, false]);
    // 저장된 9는 눌러 읽는다 - 앞 줄(0) + 1
    expect(toDepths([bullet(1), bullet(2, 9)])).toEqual([0, 1]);
    // 내어쓰기는 0보다 깊을 때만
    expect([canIn(items, 0, -1), canIn(items, 1, -1), canIn(items, 3, -1)]).toEqual([false, true, true]);
  });

  it("counts bullet lines apart from numbered lines in a mixed section", () => {
    // numbered(0) / bullet / numbered(1) / bullet - 글머리 기호 줄은 앞 번호 줄이 아니라 앞 글머리 기호 줄의 깊이만 본다
    const items = [item(1, "6.1.1", 0), bullet(2), item(3, "6.1.1.1", 1), bullet(4, 5)];
    const section = { counts_lines: true, number: "6.1", items };
    const depths = getSectionDepths(section);
    expect(depths).toEqual([0, 0, 1, 1]);
    const canAt = (index: number) => canIndent(depths, listCounted(section), index, 1, listBullets(section));
    // 첫 글머리 기호 줄은 못 들인다(앞 번호 줄이 있어도). 둘째 글머리 기호 줄은 앞 글머리 기호 줄(0) + 1인 1에 이미 닿았다. 번호 줄 규칙은 그대로다
    expect([canAt(0), canAt(1), canAt(2), canAt(3)]).toEqual([false, false, false, false]);
    // 앞 글머리 기호 줄이 있으면 번호 줄이 어떻든 들인다
    const flat = [item(1, "6.1.1", 0), bullet(2), item(3, "6.1.1.1", 1), bullet(4)];
    const flatSection = { counts_lines: true, number: "6.1", items: flat };
    const flatDepths = getSectionDepths(flatSection);
    expect(flatDepths).toEqual([0, 0, 1, 0]);
    expect(canIndent(flatDepths, listCounted(flatSection), 3, 1, listBullets(flatSection))).toBe(true);
  });

  it("skips numbered, omitted and note lines when looking for the previous bullet line", () => {
    const items = [bullet(1), item(2, null, 4, "omitted"), item(3, null, 4, "note"), item(4, null, 0), bullet(5, 0)];
    expect(getSectionDepths({ counts_lines: false, number: "5", items })).toEqual([0, 0, 0, 0, 0]);
    expect(canIn(items, 4)).toBe(true);
    // 생략·주석 줄은 앞 글머리 기호 줄이 없어도 번호 줄 규칙대로다 - 글머리 기호 갈래가 가로채지 않는다
    expect(canIndent([0, 0], [false, false], 1, 1, [false, false])).toBe(false);
  });

  it("keeps the numbered rule when no bullet array is given", () => {
    expect(canIndent([0, 0], [true, true], 1, 1)).toBe(true);
    expect(canIndent([0, 0], [true, true], 1, 1, [false, false])).toBe(true);
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
