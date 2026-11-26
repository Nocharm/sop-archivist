import { describe, expect, it } from "vitest";

import { BLANK_STOPS, resolveBlankClick, type BlankClickState } from "./blank-click-model";

const blank = (over: Partial<BlankClickState>): BlankClickState => ({ isSheetArea: true, isOnBox: false, hasTextSelection: false, isDragging: false, hasCut: false, isPicking: false, ...over });
function el(className: string): Element {
  const parent = document.createElement("div");
  parent.className = className;
  const child = document.createElement("span");
  parent.appendChild(child);
  return child;
}

describe("resolveBlankClick", () => {
  it("clears everything on blank paper", () => expect(resolveBlankClick(blank({}))).toBe("clear_all"));
  it("takes the cut first, then the pick mode", () => {
    expect(resolveBlankClick(blank({ hasCut: true, isPicking: true }))).toBe("clear_cut");
    expect(resolveBlankClick(blank({ isPicking: true }))).toBe("end_mode");
  });
  it.each([{ isOnBox: true }, { hasTextSelection: true }, { isDragging: true }, { isSheetArea: false }])("does nothing for %o", (over) => expect(resolveBlankClick(blank(over))).toBe("none"));
  it("stops on a lead, a fold row and the bar", () => {
    for (const className of ["strip-lead", "fold-run", "pick-bar"]) expect(el(className).closest(BLANK_STOPS)).not.toBeNull();
    expect(el("pg").closest(BLANK_STOPS)).toBeNull();
  });
  // 누르면 그 박스를 고르거나 자리를 고르는 것 - 빈 곳으로 읽으면 방금 한 고름이 같은 누르기에 풀린다(Pair view 조각 · 빈 칸 자리 · 템플릿 자리 · 못 놓는 자리)
  it("stops on a Pair view piece, a place spot and a template spot", () => {
    expect(el("pair-piece").closest(BLANK_STOPS)).not.toBeNull();
    for (const [name, value] of [["data-place", "open"], ["data-place", "refused"], ["data-tpl-spot", "section"], ["role", "button"]]) {
      const parent = document.createElement("p");
      parent.setAttribute(name, value);
      const child = document.createElement("span");
      parent.appendChild(child);
      expect(child.closest(BLANK_STOPS), `${name}=${value}`).not.toBeNull();
    }
  });
});
