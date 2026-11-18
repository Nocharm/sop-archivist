import { describe, expect, it } from "vitest";
import type { OutputCItem } from "./api-sop";
import { findDragBlock, findEnterRefusal, findDropSection, findDropSectionByKey, findLeaveRefusal, findLiveBlock, listDropRows, planCrossDrop, planDrop } from "./c-drop-model";
import { previewEdit } from "./c-edit-model";
import { makeSectionOutline } from "./outline-fixture";

function line(id: number, extra: Partial<OutputCItem> = {}): OutputCItem {
  return { target_id: id, kind: "sentence", lang: "ko", text: `t${id}`, ai_text: "", change_type: null, status: "confirmed", source_note: "", origin: "units", meaning_key: null, number: null, indent_level: 0, number_style: "numbered", cell_row: null, cell_col: null, children: [], ...extra };
}

/** 줄마다 20px - 화면 순서대로 */
function box(ids: number[]) {
  return ids.map((targetId, i) => ({ targetId, top: 20 * i, bottom: 20 * i + 20 }));
}

describe("findDragBlock", () => {
  const items = [line(1, { meaning_key: "m1" }), line(2, { meaning_key: "m1" }), line(3, { meaning_key: "m2" }), line(4, { meaning_key: "m3" }), line(5, { meaning_key: null }), line(6, { meaning_key: "m1" })];
  const depths = [0, 0, 1, 0, 0, 0];
  it("takes same-meaning neighbours and the deeper lines under them", () => {
    expect(findDragBlock(items, depths, 1, "assign")).toEqual({ start: 0, end: 2, baseDepth: 0, isDepthLocked: false });
    expect(findDragBlock(items, depths, 2, "assign")).toEqual({ start: 2, end: 2, baseDepth: 1, isDepthLocked: false });
  });
  it("leaves a same-meaning line that sits apart, and a line without a meaning key moves alone", () => {
    expect(findDragBlock(items, depths, 5, "assign")).toMatchObject({ start: 5, end: 5 });
    expect(findDragBlock(items, depths, 4, "assign")).toMatchObject({ start: 4, end: 4 });
  });
  it("locks depth when any line is an AI translation or the document is already written", () => {
    const pair = [line(1, { meaning_key: "m" }), line(2, { meaning_key: "m", origin: "translation" })];
    expect(findDragBlock(pair, [0, 0], 0, "assign").isDepthLocked).toBe(true);
    expect(findDragBlock(items, depths, 3, "match").isDepthLocked).toBe(true);
  });
});

describe("planDrop", () => {
  const items = [1, 2, 3, 4, 5].map((id) => line(id));
  const base = { locationKey: "s5", countsLines: true, items, depths: [0, 0, 0, 0, 0], block: { start: 0, end: 0, baseDepth: 0, isDepthLocked: false }, rows: box([2, 3, 4, 5]), dx: 0, homeTop: 0 };
  it("inserts by row midlines, with no edit when the block lands where it was or is alone in its section", () => {
    expect(planDrop({ ...base, pointerY: 45 })).toMatchObject({ beforeId: 4, lineY: 39, edit: { targetIds: [1], beforeId: 4, depths: null } });
    expect(planDrop({ ...base, pointerY: 200 })).toMatchObject({ beforeId: null, lineY: 81 });
    expect(planDrop({ ...base, pointerY: 5 }).edit).toBeNull();
    expect(planDrop({ ...base, items: [line(1)], depths: [0], rows: [], pointerY: 50, homeTop: 77 })).toMatchObject({ lineY: 77, edit: null });
  });
  it("changes depth one level per 24px, up to the previous numbered line plus one", () => {
    expect(planDrop({ ...base, pointerY: 45, dx: 11 }).depth).toBe(0);
    expect(planDrop({ ...base, pointerY: 45, dx: 12 })).toMatchObject({ depth: 1, edit: { depths: [1] } });
    expect(planDrop({ ...base, pointerY: 45, dx: 100 }).depth).toBe(1);
    expect(planDrop({ ...base, pointerY: 45, dx: -30 }).depth).toBe(0);
    expect(planDrop({ ...base, pointerY: 5, dx: 100 }).depth).toBe(0); // 앞에 번호 줄이 없다
  });
  it("skips unnumbered lines when finding the depth limit and never passes MAX_INDENT_LEVEL", () => {
    const noted = items.map((item) => (item.target_id === 3 ? { ...item, number_style: "note" as const } : item));
    expect(planDrop({ ...base, items: noted, depths: [0, 2, 9, 0, 0], pointerY: 45, dx: 240 }).depth).toBe(3);
    expect(planDrop({ ...base, depths: [0, 0, 9, 0, 0], pointerY: 45, dx: 480 }).depth).toBe(9);
  });
  it("keeps depth 0 in a section that does not count lines - its lines take no number, so none sets a limit", () => {
    expect(planDrop({ ...base, pointerY: 45, dx: 100 }).depth).toBe(1);
    expect(planDrop({ ...base, countsLines: false, pointerY: 45, dx: 100 }).depth).toBe(0);
  });
  it("caps the block's first line so its deepest line stays within MAX_INDENT_LEVEL and keeps the offsets inside the block", () => {
    // 덩어리 = 줄 1(8)·줄 2(9), 줄 3(9) 뒤로 한 단 들이려 한다 - 첫 줄은 9 - 1 = 8까지, 아래 줄은 한 단 깊이를 지킨다
    const plan = planDrop({ ...base, depths: [8, 9, 9, 0, 0], block: { start: 0, end: 1, baseDepth: 8, isDepthLocked: false }, rows: box([3, 4, 5]), pointerY: 25, dx: 24 });
    expect(plan).toMatchObject({ depth: 8, edit: { targetIds: [1, 2], beforeId: 4, depths: null } });
    const deep = planDrop({ ...base, depths: [7, 8, 9, 0, 0], block: { start: 0, end: 1, baseDepth: 7, isDepthLocked: false }, rows: box([3, 4, 5]), pointerY: 25, dx: 48 });
    expect(deep).toMatchObject({ depth: 8, edit: { depths: [8, 9] } });
  });
  it("outdents a block whose base depth is above 0", () => {
    const plan = planDrop({ ...base, depths: [0, 1, 2, 0, 0], block: { start: 2, end: 2, baseDepth: 2, isDepthLocked: false }, rows: box([1, 2, 4, 5]), pointerY: 35, dx: -24 });
    expect(plan).toMatchObject({ beforeId: 4, depth: 1, edit: { targetIds: [3], beforeId: 4, depths: [1] } });
  });
  it("drops before a row when the pointer is exactly on its midline", () => {
    // 줄 3의 칸은 20..40, 중간선 30 - 그 위에 정확히 있으면 줄 3 앞
    expect(planDrop({ ...base, pointerY: 30 })).toMatchObject({ beforeId: 3, lineY: 19 });
  });
  it("does not count the block's own lines as the line above when limiting depth", () => {
    // 줄 1(깊이 3)을 줄 2 앞(제자리)에 놓는다 - 앞 번호 줄이 자기 자신뿐이라 한계는 0
    expect(planDrop({ ...base, depths: [3, 0, 0, 0, 0], block: { start: 0, end: 0, baseDepth: 3, isDepthLocked: false }, pointerY: 5, dx: 0 }).depth).toBe(0);
  });
  it("keeps the depth of a locked block", () => {
    expect(planDrop({ ...base, block: { ...base.block, isDepthLocked: true }, pointerY: 45, dx: 100 })).toMatchObject({ depth: 0, edit: { depths: null } });
  });
  it("changes only the depth when the block stays in place", () => {
    const plan = planDrop({ ...base, items: items.map((item) => item), depths: [0, 0, 0, 0, 0], block: { start: 1, end: 1, baseDepth: 0, isDepthLocked: false }, rows: box([1, 3, 4, 5]), pointerY: 15, dx: 24 });
    expect(plan.edit).toMatchObject({ targetIds: [2], beforeId: 3, depths: [1] });
    expect(previewEdit({ target_doc_id: 7, code: "C", title: "T", doc_type: "sop", parent_code: null, entrance: "assign", sections: [{ ...makeSectionOutline(), location_key: "s5", label: "s5", number: "5", na_reason: null, heading_note: "", items }] }, plan.edit!)).not.toBeNull();
    // 깊이도 그대로면 제자리
    expect(planDrop({ ...base, block: { start: 1, end: 1, baseDepth: 0, isDepthLocked: false }, rows: box([1, 3, 4, 5]), pointerY: 15, dx: 0 }).edit).toBeNull();
  });
  it("shifts every line of the block by the same amount", () => {
    const plan = planDrop({ ...base, depths: [0, 1, 0, 0, 0], block: { start: 0, end: 1, baseDepth: 0, isDepthLocked: false }, rows: box([3, 4, 5]), pointerY: 25, dx: 24 });
    expect(plan.edit).toMatchObject({ targetIds: [1, 2], beforeId: 4, depths: [1, 2] });
  });
  it("snaps to the edge of another meaning group instead of splitting it", () => {
    const grouped = items.map((item) => (item.target_id === 2 || item.target_id === 3 ? { ...item, meaning_key: "a" } : item));
    expect(planDrop({ ...base, items: grouped, pointerY: 25 }).beforeId).toBe(4); // 묶음 중간(20) 아래 → 묶음 뒤
    expect(planDrop({ ...base, items: grouped, pointerY: 15 }).beforeId).toBe(2); // 위 → 묶음 앞(제자리)
  });
  it("lets the block stay between a same-meaning pair it already splits", () => {
    const split = [line(1, { meaning_key: "m1" }), line(2, { meaning_key: "m2" }), line(3, { meaning_key: "m1" })];
    const args = { ...base, items: split, depths: [0, 0, 0], block: { start: 1, end: 1, baseDepth: 0, isDepthLocked: false }, rows: box([1, 3]), pointerY: 20 };
    expect(planDrop({ ...args, dx: 0 })).toMatchObject({ beforeId: 3, edit: null });
    expect(planDrop({ ...args, dx: 24 })).toMatchObject({ beforeId: 3, edit: { targetIds: [2], beforeId: 3, depths: [1] } });
  });
  it("still snaps out of a same-meaning pair that sits together", () => {
    const pair = [line(1, { meaning_key: "m1" }), line(2, { meaning_key: "m1" }), line(3, { meaning_key: "m2" })];
    const args = { ...base, items: pair, depths: [0, 0, 0], block: { start: 2, end: 2, baseDepth: 0, isDepthLocked: false }, rows: box([1, 2]) };
    expect(planDrop({ ...args, pointerY: 15 }).beforeId).toBe(1);
    expect(planDrop({ ...args, pointerY: 25 }).beforeId).toBeNull(); // 묶음 뒤 = 칸 끝(덩어리는 건너뛴다)
  });
  it("drops below the last rendered row before the first unrendered one", () => {
    const long = [1, 2, 3, 4, 5, 6, 7].map((id) => line(id));
    const plan = planDrop({ ...base, items: long, depths: [0, 0, 0, 0, 0, 0, 0], rows: box([2, 3]), pointerY: 500 });
    expect(plan.beforeId).toBe(4);
  });
});

describe("findLiveBlock", () => {
  const items = [line(1), line(2, { meaning_key: "m" }), line(3, { meaning_key: "m" }), line(4), line(5)];
  const depths = [0, 0, 0, 1, 0];
  it("finds the same block again in the current lines, wherever they now sit", () => {
    expect(findLiveBlock(items, depths, 3, [2, 3, 4], "assign")).toEqual({ start: 1, end: 3, baseDepth: 0, isDepthLocked: false });
    const shifted = [line(9), ...items];
    expect(findLiveBlock(shifted, [0, ...depths], 3, [2, 3, 4], "assign")).toMatchObject({ start: 2, end: 4 });
  });
  it("refuses when the pressed line or any block line is gone", () => {
    expect(findLiveBlock(items.filter((item) => item.target_id !== 3), [0, 0, 1, 0], 3, [2, 3, 4], "assign")).toBeNull();
    expect(findLiveBlock(items.filter((item) => item.target_id !== 4), [0, 0, 0, 0], 3, [2, 3, 4], "assign")).toBeNull();
  });
  it("refuses when the block grew or a line came between its lines", () => {
    const grown = [...items.slice(0, 4), line(6), items[4]];
    expect(findLiveBlock(grown, [0, 0, 0, 1, 1, 0], 3, [2, 3, 4], "assign")).toBeNull();
    const split = [items[0], items[1], line(7, { meaning_key: "x" }), ...items.slice(2)];
    expect(findLiveBlock(split, [0, 0, 0, 0, 1, 0], 2, [2, 3, 4], "assign")).toBeNull();
  });
});

describe("listDropRows", () => {
  const items = [1, 2, 3, 4, 5].map((id) => line(id));
  const block = { start: 1, end: 2, baseDepth: 0, isDepthLocked: false };
  it("drops the block's rows by id, even ones rendered after the drag started", () => {
    expect(listDropRows(items, block, box([1, 2, 3, 4, 5])).map((row) => row.targetId)).toEqual([1, 4, 5]);
  });
  it("drops a measured row whose line is no longer in the section", () => {
    expect(listDropRows(items, block, box([1, 8, 4, 5])).map((row) => row.targetId)).toEqual([1, 4, 5]);
  });
  it("gives planDrop rows that keep a drop below the last row at the right place", () => {
    const rows = listDropRows(items, block, box([1, 2, 3, 4, 8]));
    const plan = planDrop({ locationKey: "s", countsLines: true, items, depths: [0, 0, 0, 0, 0], block, rows, pointerY: 500, dx: 0, homeTop: 0 });
    expect(plan.beforeId).toBe(5);
  });
});

describe("listDropRows for a destination", () => {
  it("keeps every known row when there is no block, and still drops rows that are not in the section", () => {
    const items = [1, 2, 3].map((id) => line(id));
    expect(listDropRows(items, null, box([1, 8, 2, 3])).map((row) => row.targetId)).toEqual([1, 2, 3]);
  });
});

describe("findDropSectionByKey", () => {
  const sheet = { left: 0, right: 800, top: 0, bottom: 2000 };
  const sections = [
    { key: "purpose", band: { top: 100, bottom: 200 } },
    { key: "scope", band: { top: 260, bottom: 300 } },
    { key: "responsibilities", band: { top: 320, bottom: 500 } },
  ];
  it("decides home by the section key, whatever element drew it", () => {
    // 끄는 도중 다시 그려진 출발 칸도 키가 같으면 출발 칸 - 다른 칸(planCrossDrop)으로 넘기지 않는다
    expect(findDropSectionByKey({ x: 50, y: 150 }, sheet, sections, "purpose")).toEqual({ index: 0, isHome: true });
    expect(findDropSectionByKey({ x: 50, y: 400 }, sheet, sections, "purpose")).toEqual({ index: 2, isHome: false });
  });
  it("keeps the home band first by key where two bands overlap", () => {
    // y 312는 scope 아래 여유와 responsibilities 위 여유가 겹친다 - 출발 칸 키가 이긴다
    expect(findDropSectionByKey({ x: 50, y: 312 }, sheet, sections, "scope")).toEqual({ index: 1, isHome: true });
    expect(findDropSectionByKey({ x: 50, y: 312 }, sheet, sections, "purpose")).toEqual({ index: 2, isHome: false });
  });
  it("never reports home when the home section is not drawn", () => {
    expect(findDropSectionByKey({ x: 50, y: 150 }, sheet, sections, "definitions")).toEqual({ index: 0, isHome: false });
    expect(findDropSectionByKey({ x: 50, y: 240 }, sheet, sections, "definitions")).toBeNull();
  });
});

describe("findDropSection", () => {
  const sheet = { left: 0, right: 800, top: 0, bottom: 2000 };
  const bands = [{ top: 100, bottom: 200 }, { top: 260, bottom: 300 }, { top: 320, bottom: 500 }];
  it("keeps the home band first and gives an overlap of two other bands to the lower one", () => {
    expect(findDropSection({ x: 50, y: 220 }, sheet, bands, 0)).toBe(0);
    expect(findDropSection({ x: 50, y: 305 }, sheet, bands, 0)).toBe(1);
    expect(findDropSection({ x: 50, y: 315 }, sheet, bands, 0)).toBe(2);
    expect(findDropSection({ x: 50, y: 325 }, sheet, bands, 1)).toBe(1);
  });
  it("is outside off the sheet, above the first band and below the last one", () => {
    expect(findDropSection({ x: 900, y: 150 }, sheet, bands, 0)).toBeNull();
    expect(findDropSection({ x: 50, y: 80 }, sheet, bands, 0)).toBeNull();
    expect(findDropSection({ x: 50, y: 530 }, sheet, bands, 0)).toBeNull();
  });
  it("is outside in a gap that belongs to no band", () => {
    // 칸 0은 ~228, 칸 1은 250부터 - 그 사이 240은 어느 칸도 아니다
    expect(findDropSection({ x: 50, y: 240 }, sheet, bands, 2)).toBeNull();
    expect(findDropSection({ x: 50, y: 240 }, sheet, bands, 0)).toBeNull();
  });
  it("lets the home section's own margins win over a neighbour's band", () => {
    // y 310은 칸 1 여유(~328)와 칸 2 여유(310~)가 겹치지만 출발 칸이 1이면 1, 2이면 2
    expect(findDropSection({ x: 50, y: 312 }, sheet, bands, 1)).toBe(1);
    expect(findDropSection({ x: 50, y: 312 }, sheet, bands, 2)).toBe(2);
    // 칸 0 아래 여유(228) 안에서 칸 0이 출발이면 칸 0, 위 10px 여유는 칸 1이 출발일 때 칸 1
    expect(findDropSection({ x: 50, y: 225 }, sheet, bands, 0)).toBe(0);
    expect(findDropSection({ x: 50, y: 252 }, sheet, bands, 1)).toBe(1);
  });
});

describe("cross-section refusals", () => {
  const home = { start: 0, end: 0, baseDepth: 0, isDepthLocked: false };
  it("refuses an N/A section, another document, another WI part and an unmappable section, and lets the same part of another step in", () => {
    const to = (location_key: string, na_reason: string | null = null) => ({ location_key, na_reason, kind: location_key.includes(":") ? null : ("general" as const) });
    expect(findEnterRefusal("purpose", to("attachments", "x"), true)).toBe("na");
    expect(findEnterRefusal("purpose", to("scope"), false)).toBe("otherDoc");
    expect(findEnterRefusal("step:1:instruction", to("step:2:why"), true)).toBe("otherPart");
    expect(findEnterRefusal("purpose", to("path:1/2"), true)).toBe("otherPart");
    expect(findEnterRefusal("purpose", to("step:1:why"), true)).toBe("otherPart");
    expect(findEnterRefusal("step:1:instruction", to("unstepped:instruction"), true)).toBeNull();
    expect(findEnterRefusal("purpose", to("scope"), true)).toBeNull();
  });
  it("checks N/A before another document", () => {
    expect(findEnterRefusal("purpose", { location_key: "scope", na_reason: "x", kind: "general" }, false)).toBe("na");
  });
  it("refuses a group and the auto list, which take no sentences, and lets the other kinds in", () => {
    const to = (location_key: string, kind: "general" | "category_table" | "named_children" | "group" | "auto_list", na_reason: string | null = null) => ({ location_key, na_reason, kind });
    expect(findEnterRefusal("purpose", to("document_relationships", "group"), true)).toBe("notAssignable");
    expect(findEnterRefusal("purpose", to("document_relationships.work_instructions", "auto_list"), true)).toBe("notAssignable");
    expect(findEnterRefusal("purpose", to("general_requirements", "category_table"), true)).toBeNull();
    expect(findEnterRefusal("purpose", to("procedures", "named_children"), true)).toBeNull();
    // N/A와 다른 문서가 먼저다
    expect(findEnterRefusal("purpose", to("document_relationships", "group", "x"), true)).toBe("na");
    expect(findEnterRefusal("purpose", to("document_relationships", "group"), false)).toBe("otherDoc");
  });
  it("refuses a written document's block", () => {
    expect(findLeaveRefusal("match", [line(1)], { ...home, isDepthLocked: true })).toBe("written");
  });
  it("refuses a block that leaves an AI translation of its meaning behind", () => {
    const items = [line(1, { meaning_key: "old:a" }), line(2, { meaning_key: "old:a", origin: "translation" })];
    expect(findLeaveRefusal("assign", items, home)).toBe("translation");
    expect(findLeaveRefusal("assign", items, { start: 1, end: 1, baseDepth: 0, isDepthLocked: true })).toBe("translation");
    const apart = [...items, line(3), line(4, { meaning_key: "old:a" })];
    expect(findLeaveRefusal("assign", apart, { start: 0, end: 1, baseDepth: 0, isDepthLocked: true })).toBe("translation");
    expect(findLeaveRefusal("assign", [line(5, { origin: "translation" })], { ...home, isDepthLocked: true })).toBe("translation");
  });
  it("lets a block leave when it holds the whole group with its translation", () => {
    const items = [line(1, { meaning_key: "old:a" }), line(2, { meaning_key: "old:a", origin: "translation" })];
    expect(findLeaveRefusal("assign", items, { start: 0, end: 1, baseDepth: 0, isDepthLocked: true })).toBeNull();
    // 번역 없는 의미 묶음은 덩어리가 일부만 가져가도 걸리지 않는다
    expect(findLeaveRefusal("assign", [line(1), line(2)], home)).toBeNull();
  });
  it("refuses a group whose only lines are translations - the server cannot find the source among the moved lines", () => {
    const items = [line(1, { meaning_key: "old:a", origin: "translation" })];
    expect(findLeaveRefusal("assign", items, { ...home, isDepthLocked: true })).toBe("translation");
  });
  it("checks that the block may leave before anything about the destination", () => {
    expect(findLeaveRefusal("match", [line(1, { meaning_key: "old:a", origin: "translation" })], { ...home, isDepthLocked: true })).toBe("written");
  });
});

describe("planCrossDrop", () => {
  const unlocked = { start: 0, end: 0, baseDepth: 0, isDepthLocked: false };
  const empty = { fromKey: "s5", toKey: "s6", source: { countsLines: true, items: [line(1)], depths: [0], block: unlocked }, dest: { countsLines: true, items: [] as OutputCItem[], depths: [] as number[] }, rows: [] as ReturnType<typeof box>, pointerY: 50, dx: 0, emptyTop: 40 };
  const dest3 = [line(10), line(11), line(12)];
  const into = (extra: Partial<Parameters<typeof planCrossDrop>[0]> = {}) => planCrossDrop({ ...empty, dest: { countsLines: true, items: dest3, depths: [0, 1, 0] }, rows: box([10, 11, 12]), ...extra });
  it("makes the block the first lines of an empty section at depth 0 whatever the sideways move", () => {
    const plan = planCrossDrop({ ...empty, dx: 96 });
    expect(plan).toMatchObject({ beforeId: null, depth: 0, lineY: 40 });
    expect(plan.edit).toEqual({ kind: "place", locationKey: "s5", toLocationKey: "s6", targetIds: [1], beforeId: null, depths: [0] });
  });
  it("drops at the top, in the middle and at the end of a rendered destination", () => {
    expect(into({ pointerY: 5 })).toMatchObject({ beforeId: 10, lineY: -1, depth: 0 });
    expect(into({ pointerY: 45 })).toMatchObject({ beforeId: 12, lineY: 39 });
    expect(into({ pointerY: 200 })).toMatchObject({ beforeId: null, lineY: 61 });
  });
  it("drops below the last rendered row before the first unrendered line, not at the section's end", () => {
    const long = [10, 11, 12, 13, 14].map((id) => line(id));
    const plan = into({ dest: { countsLines: true, items: long, depths: [0, 0, 0, 0, 0] }, rows: box([10, 11, 12]), pointerY: 500 });
    expect(plan.beforeId).toBe(13);
    expect(plan.edit).toMatchObject({ beforeId: 13, toLocationKey: "s6" });
  });
  it("gives depth 0 at the destination's top and limits it to the numbered line above plus one", () => {
    const block = { start: 0, end: 1, baseDepth: 1, isDepthLocked: false };
    const source = { countsLines: true, items: [line(1), line(2)], depths: [1, 2], block };
    // 앞줄 없음(맨 위): dx +48이어도 0, 아래 줄은 단 차이를 지켜 [0, 1]
    const top = into({ source, pointerY: 5, dx: 48 });
    expect(top).toMatchObject({ depth: 0, edit: { depths: [0, 1] } });
    // 줄 11(깊이 1) 아래: 한계 2, dx +48 → 시작 1 + 2 = 3 → 2, 아래 줄 [2, 3]
    const below = into({ source, pointerY: 45, dx: 48 });
    expect(below).toMatchObject({ beforeId: 12, depth: 2, edit: { depths: [2, 3] } });
    // 줄 10(깊이 0) 아래: 한계 1
    expect(into({ source, pointerY: 15, dx: 48 })).toMatchObject({ depth: 1, edit: { depths: [1, 2] } });
  });
  it("skips unnumbered lines above and keeps the block's deepest line within MAX_INDENT_LEVEL", () => {
    const noted = [line(10), line(11, { number_style: "note" })];
    expect(into({ dest: { countsLines: true, items: noted, depths: [3, 9] }, rows: box([10, 11]), pointerY: 500, dx: 240 }).depth).toBe(4);
    const block = { start: 0, end: 1, baseDepth: 0, isDepthLocked: false };
    const deep = into({ source: { countsLines: true, items: [line(1), line(2)], depths: [0, 2], block }, dest: { countsLines: true, items: [line(10)], depths: [9] }, rows: box([10]), pointerY: 500, dx: 480 });
    expect(deep).toMatchObject({ depth: 7, edit: { depths: [7, 9] } });
  });
  it("drops at depth 0 into a section that does not count lines, keeping the offsets inside the block", () => {
    const block = { start: 0, end: 1, baseDepth: 1, isDepthLocked: false };
    const source = { countsLines: true, items: [line(1), line(2)], depths: [1, 2], block };
    // 줄 11(깊이 1) 아래라도 그 칸의 줄은 번호를 세지 않아 한계가 없다 - 같은 자리가 번호 칸이면 2다
    expect(into({ source, pointerY: 45, dx: 48 }).depth).toBe(2);
    expect(into({ source, toKey: "procedures", dest: { countsLines: false, items: dest3, depths: [0, 1, 0] }, pointerY: 45, dx: 48 })).toMatchObject({ beforeId: 12, depth: 0, edit: { toLocationKey: "procedures", depths: [0, 1] } });
  });
  it("clamps a locked pair to the destination's rule without applying dx, keeping the offsets inside the block", () => {
    // 원문(2) + 번역(2) + 아래 줄(3): 깊이가 잠겨 dx는 안 먹지만 도착 칸 한계는 받는다
    const block = { start: 0, end: 2, baseDepth: 2, isDepthLocked: true };
    const source = { countsLines: true, items: [line(1, { meaning_key: "old:a" }), line(2, { meaning_key: "old:a", origin: "translation" }), line(3)], depths: [2, 2, 3], block };
    const emptyDest = planCrossDrop({ ...empty, source, dx: 96 });
    expect(emptyDest).toMatchObject({ depth: 0, edit: { targetIds: [1, 2, 3], depths: [0, 0, 1] } });
    const underZero = planCrossDrop({ ...empty, source, dest: { countsLines: true, items: [line(10)], depths: [0] }, rows: box([10]), pointerY: 500, dx: 96 });
    expect(underZero).toMatchObject({ depth: 1, edit: { depths: [1, 1, 2] } });
    const underThree = planCrossDrop({ ...empty, source, dest: { countsLines: true, items: [line(10)], depths: [3] }, rows: box([10]), pointerY: 500, dx: 96 });
    expect(underThree).toMatchObject({ depth: 2, edit: { depths: [2, 2, 3] } });
    expect(planCrossDrop({ ...empty, source, dest: { countsLines: true, items: [line(10), line(11)], depths: [0, 1] }, rows: box([10, 11]), pointerY: 5, dx: -96 })).toMatchObject({ depth: 0, edit: { depths: [0, 0, 1] } });
  });
  it("snaps to the edge of a meaning group in the destination", () => {
    const grouped = [line(10), line(11, { meaning_key: "old:k" }), line(12, { meaning_key: "old:k" }), line(13)];
    const dest = { countsLines: true, items: grouped, depths: [0, 0, 0, 0] };
    const rows = box([10, 11, 12, 13]);
    // 묶음은 20..60, 중간선 40: 위쪽은 묶음 앞(11), 아래쪽은 묶음 뒤(13), 묶음 안 줄 사이 경계(40)가 아니라
    expect(into({ dest, rows, pointerY: 45 }).beforeId).toBe(13);
    expect(into({ dest, rows, pointerY: 35 }).beforeId).toBe(11);
  });
  it("agrees with previewEdit on the number the first line gets", () => {
    const sec = (key: string, number: string, items: OutputCItem[], countsLines = true) => ({ ...makeSectionOutline({ counts_lines: countsLines }), location_key: key, label: key, number, na_reason: null, heading_note: "", items });
    const a = line(1);
    const b = line(2);
    const c = line(3);
    const doc = { target_doc_id: 7, code: "C", title: "T", doc_type: "sop", parent_code: null, entrance: "assign", sections: [sec("procedures", "6", [a, b], false), sec("procedures.procedure", "6.1", [c])] };
    const plan = planCrossDrop({ fromKey: "procedures", toKey: "procedures.procedure", source: { countsLines: false, items: [a, b], depths: [0, 0], block: { start: 1, end: 1, baseDepth: 0, isDepthLocked: false } }, dest: { countsLines: true, items: [c], depths: [0] }, rows: box([3]), pointerY: 5, dx: 0, emptyTop: 0 });
    expect(plan.beforeId).toBe(3);
    const shown = previewEdit(doc as never, plan.edit!)!;
    expect(shown.sections[1].items.map((item) => [item.target_id, item.number])).toEqual([[2, "6.1.1"], [3, "6.1.2"]]);
  });
});

describe("planCrossDrop guards", () => {
  const unlocked = { start: 1, end: 1, baseDepth: 0, isDepthLocked: false };
  const home = [1, 2, 3, 4].map((id) => line(id));
  const homeArgs = { source: { countsLines: true, items: home, depths: [0, 0, 0, 0], block: unlocked }, rows: box([1, 3, 4]), dx: 0, emptyTop: 7 };
  it("delegates to planDrop when the destination is the home section", () => {
    for (const pointerY of [45, 5, 500]) {
      const cross = planCrossDrop({ ...homeArgs, fromKey: "s5", toKey: "s5", dest: { countsLines: true, items: home, depths: [0, 0, 0, 0] }, pointerY });
      const same = planDrop({ locationKey: "s5", countsLines: true, items: home, depths: [0, 0, 0, 0], block: unlocked, rows: homeArgs.rows, pointerY, dx: 0, homeTop: 7 });
      expect(cross).toEqual(same);
      expect(cross.edit && "toLocationKey" in cross.edit).toBeFalsy();
    }
    // 실제로 옮기는 경우와 제자리가 둘 다 들어 있다
    expect(planDrop({ locationKey: "s5", countsLines: true, items: home, depths: [0, 0, 0, 0], block: unlocked, rows: homeArgs.rows, pointerY: 500, dx: 0, homeTop: 7 }).edit).not.toBeNull();
    expect(planDrop({ locationKey: "s5", countsLines: true, items: home, depths: [0, 0, 0, 0], block: unlocked, rows: homeArgs.rows, pointerY: 15, dx: 0, homeTop: 7 }).edit).toBeNull();
  });
  it("saves nothing when a row is not in the destination's items", () => {
    const plan = planCrossDrop({ ...homeArgs, fromKey: "s5", toKey: "s6", dest: { countsLines: true, items: [line(10), line(11)], depths: [0, 0] }, rows: box([10, 99]), pointerY: 30 });
    expect(plan.edit).toBeNull();
    expect(plan.beforeId).toBeNull();
  });
  it("lands after the whole meaning group when the rendered window cuts it", () => {
    const dest = [line(10), line(11, { meaning_key: "old:k" }), line(12, { meaning_key: "old:k" }), line(13, { meaning_key: "old:k" }), line(14)];
    const args = { ...homeArgs, fromKey: "s5", toKey: "s6", dest: { countsLines: true, items: dest, depths: [0, 0, 0, 0, 0] } };
    // 그려진 줄은 10·11·12, 13부터 안 그려졌다 - 12 아래로 놓아도 묶음(11~13) 뒤인 14 앞
    expect(planCrossDrop({ ...args, rows: box([10, 11, 12]), pointerY: 500 }).beforeId).toBe(14);
    // 묶음이 칸 끝까지 가면 칸 끝
    expect(planCrossDrop({ ...args, dest: { countsLines: true, items: dest.slice(0, 4), depths: [0, 0, 0, 0] }, rows: box([10, 11, 12]), pointerY: 500 }).beforeId).toBeNull();
    // 이어지지 않으면 안 그려진 첫 줄 앞 그대로
    expect(planCrossDrop({ ...args, dest: { countsLines: true, items: [line(10), line(11, { meaning_key: "old:k" }), line(12)], depths: [0, 0, 0] }, rows: box([10, 11]), pointerY: 500 }).beforeId).toBe(12);
  });
});
