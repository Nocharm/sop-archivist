// Space 미리보기의 셈 - 누름 · 뗌 · 짧게 탁 · 끌고 뗌 · 열어 둔 뒤 탁 · Esc, Space를 받는 포커스, 창 밖 줄 수, 확정 전 덮어 그리기 값.
import { describe, expect, it } from "vitest";

import type { PreviewRow } from "@/lib/api-sop";

import {
  buildSheetDraft,
  countDataRows,
  findSheetUnit,
  getWindowRest,
  isOwnSpaceTarget,
  isSpaceEnabled,
  isSpaceKept,
  isSpaceOpen,
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
    expect(run([{ type: "down", at: 1000 }, { type: "up", at: 1100 }], kept).phase).toBe("closed");
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
  const row = (unitId: number | null): PreviewRow => ({ kind: "group_start", wrap: true, cells: [], unit_id: unitId, group_id: null, toc: false });

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
