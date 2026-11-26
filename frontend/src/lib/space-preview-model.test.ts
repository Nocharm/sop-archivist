// Space 미리보기의 셈 - 누름 · 뗌 · 짧게 탁 · 끌고 뗌 · 열어 둔 뒤 탁 · Esc, Space를 받는 포커스, 창 밖 줄 수, 확정 전 덮어 그리기 값.
import { describe, expect, it } from "vitest";

import type { PreviewRow } from "@/lib/api-sop";

import {
  buildSheetDraft,
  clampSheetHeight,
  readDragHeight,
  countDataRows,
  findSheetUnit,
  pickSheetAnchor,
  getWindowRest,
  isOwnSpaceTarget,
  isSpaceEnabled,
  isSpaceKept,
  isSpaceOpen,
  isTabFlip,
  NO_NUMBER,
  pickSpaceSheet,
  SPACE_CLOSED,
  stepSpace,
  TAP_MS,
  type SpaceEvent,
  type SpaceState,
} from "./space-preview-model";

function run(events: SpaceEvent[], from: SpaceState = SPACE_CLOSED): SpaceState {
  return events.reduce(stepSpace, from);
}

describe("stepSpace", () => {
  it("shows while Space is held and closes on a long release", () => {
    const held = run([{ type: "down", at: 0 }]);
    expect([held.phase, isSpaceOpen(held), isSpaceKept(held)]).toEqual(["held", true, false]);
    expect(run([{ type: "down", at: 0 }, { type: "up", at: TAP_MS }]).phase).toBe("closed");
  });

  it("keeps the sheet open after a short tap", () => {
    const kept = run([{ type: "down", at: 0 }, { type: "up", at: TAP_MS - 1 }]);
    expect([kept.phase, isSpaceKept(kept)]).toEqual(["kept", true]);
  });

  it("closes on release after a drag, even when the press was short", () => {
    expect(run([{ type: "down", at: 0 }, { type: "drag" }, { type: "up", at: 50 }]).phase).toBe("closed");
  });

  it("closes a kept sheet on another tap, but not after a long press or a drag", () => {
    const kept = run([{ type: "down", at: 0 }, { type: "up", at: 10 }]);
    expect(run([{ type: "down", at: 1000 }, { type: "up", at: 1100 }, { type: "closed" }], kept).phase).toBe("closed");
    expect(run([{ type: "down", at: 1000 }, { type: "up", at: 1000 + TAP_MS }], kept).phase).toBe("kept");
    const dragged = run([{ type: "down", at: 1000 }, { type: "drag" }, { type: "up", at: 1050 }], kept);
    expect([dragged.phase, dragged.dragged]).toEqual(["kept", false]);
  });

  it("closes on Esc from any open phase", () => {
    expect(run([{ type: "down", at: 0 }, { type: "escape" }]).phase).toBe("closed");
    expect(run([{ type: "down", at: 0 }, { type: "up", at: 10 }, { type: "escape" }]).phase).toBe("closed");
  });

  it("ignores a second keydown while held and a keyup or drag while closed", () => {
    const held = run([{ type: "down", at: 0 }]);
    expect(stepSpace(held, { type: "down", at: 400 })).toBe(held);
    expect(run([{ type: "up", at: 10 }, { type: "drag" }])).toEqual(SPACE_CLOSED);
  });

  it("closes through closing after a short tap", () => {
    const closing = run([{ type: "down", at: 0 }, { type: "up", at: 10 }, { type: "down", at: 500 }, { type: "up", at: 510 }]);
    expect([closing.phase, isSpaceOpen(closing), isSpaceKept(closing)]).toEqual(["closing", true, false]);
  });

  it("flips the tab on a second tap while closing", () => {
    const closing = run([{ type: "down", at: 0 }, { type: "up", at: 10 }, { type: "down", at: 500 }, { type: "up", at: 510 }]);
    const flipped = stepSpace(closing, { type: "down", at: 600 });
    expect([flipped.phase, isTabFlip(closing, flipped)]).toEqual(["kept", true]);
    expect(isTabFlip(SPACE_CLOSED, run([{ type: "down", at: 0 }]))).toBe(false);
    // 뒤따르는 keyup은 열어 둔 시트를 닫지 않는다
    expect(stepSpace(flipped, { type: "up", at: 650 }).phase).toBe("kept");
  });

  it("closing ends on animation end", () => {
    const closing = run([{ type: "down", at: 0 }, { type: "up", at: 10 }, { type: "down", at: 500 }, { type: "up", at: 510 }]);
    expect(stepSpace(closing, { type: "closed" })).toEqual(SPACE_CLOSED);
    expect(stepSpace(closing, { type: "drag" })).toBe(closing);
    // 다른 단계에서 온 늦은 animationend는 아무것도 하지 않는다
    const kept = run([{ type: "down", at: 0 }, { type: "up", at: 10 }]);
    expect(stepSpace(kept, { type: "closed" })).toBe(kept);
  });

  it("escape while closing closes", () => {
    const closing = run([{ type: "down", at: 0 }, { type: "up", at: 10 }, { type: "down", at: 500 }, { type: "up", at: 510 }]);
    expect(stepSpace(closing, { type: "escape" })).toEqual(SPACE_CLOSED);
    expect(stepSpace(closing, { type: "blur" })).toEqual(SPACE_CLOSED);
  });

  it("closes a held sheet when the window loses focus but keeps a kept one", () => {
    expect(run([{ type: "down", at: 0 }, { type: "blur" }]).phase).toBe("closed");
    expect(run([{ type: "down", at: 0 }, { type: "up", at: 10 }, { type: "down", at: 500 }, { type: "blur" }]).phase).toBe("kept");
  });
});

describe("isOwnSpaceTarget", () => {
  function make(html: string, selector: string): HTMLElement {
    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.appendChild(host);
    return host.querySelector<HTMLElement>(selector)!;
  }

  it("leaves Space to inputs, editors, buttons, links and options", () => {
    expect(isOwnSpaceTarget(make("<input />", "input"))).toBe(true);
    expect(isOwnSpaceTarget(make("<textarea></textarea>", "textarea"))).toBe(true);
    expect(isOwnSpaceTarget(make("<select></select>", "select"))).toBe(true);
    expect(isOwnSpaceTarget(make("<button><span>x</span></button>", "span"))).toBe(true);
    expect(isOwnSpaceTarget(make('<a href="#">x</a>', "a"))).toBe(true);
    expect(isOwnSpaceTarget(make('<ul role="listbox"><li role="option">x</li></ul>', "li"))).toBe(true);
    const editor = make('<div contenteditable="true">x</div>', "div");
    Object.defineProperty(editor, "isContentEditable", { value: true }); // jsdom은 contenteditable을 셈하지 않는다
    expect(isOwnSpaceTarget(editor)).toBe(true);
  });

  it("takes Space on the page body and plain boxes", () => {
    expect(isOwnSpaceTarget(document.body)).toBe(false);
    expect(isOwnSpaceTarget(make('<div tabindex="0">x</div>', "div"))).toBe(false);
    expect(isOwnSpaceTarget(null)).toBe(false);
  });
});

describe("sheet window", () => {
  const mergedRow = (unitId: number | null, unitIds: number[]): PreviewRow => ({ kind: "group_start", wrap: true, cells: [], unit_id: unitId, group_id: null, toc: false, deleted: false, unit_ids: unitIds });
  const row = (unitId: number | null): PreviewRow => mergedRow(unitId, []);

  it("counts the rows left out above and below a centred window", () => {
    const rows = [row(null), row(null), ...[1, 2, 3, 4].map(row)];
    expect(getWindowRest({ truncated: true, offset: 5, total_rows: 12, rows })).toEqual({ above: 5, below: 1 });
    expect(getWindowRest({ truncated: false, offset: 0, total_rows: 6, rows })).toBeNull();
  });

  it("counts data rows without the status and header rows", () => {
    expect(countDataRows({ total_rows: 24, freeze: "A3" })).toBe(22);
    expect(countDataRows({ total_rows: 2, freeze: "A3" })).toBe(0);
    // 문단 Excel은 열 머리 한 줄만 고정한다
    expect(countDataRows({ total_rows: 24, freeze: "A2" })).toBe(23);
  });

  it("finds the picked line's unit that has a row in the sheet", () => {
    const sheet = { rows: [row(null), row(7), row(9)] };
    expect(findSheetUnit(sheet, [8, 9])).toBe(9);
    expect(findSheetUnit(sheet, [3])).toBe(3);
    expect(findSheetUnit(sheet, [])).toBeNull();
  });

  it("finds the row a merged paragraph line shares - any of its units picks the row's first unit", () => {
    const sheet = { rows: [row(null), mergedRow(7, [7, 8, 9]), row(10)] };
    expect(findSheetUnit(sheet, [9])).toBe(7);
    expect(findSheetUnit(sheet, [4, 8])).toBe(7);
  });

  describe("sheet anchor", () => {
    // 문서 차례 - 머리말 1, 본문 2 · 3(KO) · 4(EN), 꼬리말 5
    const order = [1, 2, 3, 4, 5];
    const isBody = (id: number) => id >= 2 && id <= 4;

    it("puts the pressed box first - the EN box of a KO/EN pair finds the EN row", () => {
      expect(pickSheetAnchor([3, 4], 4, order, isBody)).toBe(4);
      expect(pickSheetAnchor([3, 4], null, order, isBody)).toBe(3);
    });

    it("falls back to the nearest body unit above when the box has no row", () => {
      expect(pickSheetAnchor([5], 5, order, isBody)).toBe(4);
    });

    it("has no anchor above the first body unit or without a pick", () => {
      expect(pickSheetAnchor([1], 1, order, isBody)).toBeNull();
      expect(pickSheetAnchor([], null, order, isBody)).toBeNull();
    });
  });
});

describe("pickSpaceSheet · isSpaceEnabled", () => {
  const base = { hasDoc: true, unitCount: 5, isNewEdit: false, rowCount: 3 };

  it("shows the paragraph sheet in one pane and Excel A in two panes", () => {
    expect(pickSpaceSheet(true)).toBe("paragraphs");
    expect(pickSpaceSheet(false)).toBe("comparison");
  });

  it("turns the paragraph sheet on for any document with units - an Old one or a written New one", () => {
    expect(isSpaceEnabled("paragraphs", base)).toBe(true);
    expect(isSpaceEnabled("paragraphs", { ...base, rowCount: 0 })).toBe(true);
    // 빈 템플릿(엮은 New)은 단위가 없다
    expect(isSpaceEnabled("paragraphs", { ...base, unitCount: 0 })).toBe(false);
    expect(isSpaceEnabled("paragraphs", { ...base, hasDoc: false })).toBe(false);
  });

  it("keeps Excel A off while a New document is edited in place, as before", () => {
    expect(isSpaceEnabled("comparison", base)).toBe(true);
    expect(isSpaceEnabled("comparison", { ...base, isNewEdit: true })).toBe(false);
    expect(isSpaceEnabled("comparison", { ...base, rowCount: 0 })).toBe(false);
  });
});

describe("buildSheetDraft", () => {
  it("writes the not-yet-confirmed place in the Excel A labels", () => {
    const draft = buildSheetDraft({ docType: "sop", docCode: "SOP-PW", docTitle: "Synthetic SOP", place: "Procedure", texts: ["First.", "Second."], changes: ["as_is", "rewritten", "as_is"] });
    expect(draft).toEqual({
      destination: "New SOP",
      new_doc: "SOP-PW",
      new_doc_title: "Synthetic SOP",
      place: "Procedure",
      number: NO_NUMBER,
      new_text: "First.\nSecond.",
      change: "= · Modified",
    });
    expect(buildSheetDraft({ docType: "wi", docCode: "WI-1", docTitle: "", place: "1 Step · Instruction", texts: [], changes: ["heading"] })).toMatchObject({ destination: "WI", change: "Slot heading" });
  });
});

describe("sheet height", () => {
  it("clamps the ratio to 0.3..0.9 and falls back to 0.7 for non-numbers", () => {
    expect(clampSheetHeight(0.5)).toBe(0.5);
    expect(clampSheetHeight(0.1)).toBe(0.3);
    expect(clampSheetHeight(1.4)).toBe(0.9);
    expect(clampSheetHeight(Number.NaN)).toBe(0.7);
  });

  it("reads the ratio from the pointer, measured from the work area bottom", () => {
    expect(readDragHeight(500, 1000, 1000)).toBe(0.5);
    expect(readDragHeight(100, 1000, 1000)).toBe(0.9);
    expect(readDragHeight(990, 1000, 1000)).toBe(0.3);
    expect(readDragHeight(500, 1000, 0)).toBe(0.7);
  });
});
