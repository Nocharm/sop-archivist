import { describe, expect, it } from "vitest";
import type { OutputCItem } from "./api-sop";
import { classifyDropZone, findDragBlock, findLiveBlock, listDropRows, planDrop } from "./c-drop-model";
import { previewEdit } from "./c-edit-model";

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

it("classifyDropZone: home inside the section band (10px above, 28px below), other elsewhere on the sheet, outside off the sheet", () => {
  const zone = (x: number, y: number) => classifyDropZone({ x, y }, { left: 100, right: 860, top: 0, bottom: 2000 }, { top: 300, bottom: 500 });
  expect([zone(200, 290), zone(200, 289), zone(200, 528), zone(200, 529), zone(99, 400), zone(200, 2001)]).toEqual(["home", "other", "home", "other", "outside", "outside"]);
});

describe("planDrop", () => {
  const items = [1, 2, 3, 4, 5].map((id) => line(id));
  const base = { locationKey: "s5", items, depths: [0, 0, 0, 0, 0], block: { start: 0, end: 0, baseDepth: 0, isDepthLocked: false }, rows: box([2, 3, 4, 5]), dx: 0, homeTop: 0 };
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
    expect(previewEdit({ target_doc_id: 7, code: "C", title: "T", doc_type: "sop", parent_code: null, entrance: "assign", sections: [{ location_key: "s5", label: "s5", number: "5", na_reason: null, heading_note: "", items }] }, plan.edit!)).not.toBeNull();
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
    const plan = planDrop({ locationKey: "s", items, depths: [0, 0, 0, 0, 0], block, rows, pointerY: 500, dx: 0, homeTop: 0 });
    expect(plan.beforeId).toBe(5);
  });
});
