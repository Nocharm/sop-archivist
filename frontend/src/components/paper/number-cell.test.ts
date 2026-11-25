// 번호 칸 창의 확인 · 취소 단추(B3) - 입력 종류에서만 보이고, 빈 글이면 확인이 꺼진다.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LangProvider } from "@/lib/i18n";

import { NumberCell, type NumberEdit } from "./number-cell";

const noop = () => undefined;

function render(edit: NumberEdit): string {
  const number = { value: "5.1", read: "5.1", source: "auto", is_set: false, content_start: 0, from_text: false, note: null } as never;
  const cell = createElement(NumberCell, {
    width: 40, tip: "", testId: "t", unitId: 1, number, isUnread: false, canEdit: true, busy: false, edit,
    followed: [], continuous: null, preview: null, onEditChange: noop, onSave: noop,
  });
  return renderToStaticMarkup(createElement(LangProvider, null, cell));
}

describe("NumberCell buttons", () => {
  it("shows Cancel and OK under an input kind", () => {
    const filled = render({ unitId: 1, kind: "continuous", text: "5.2", follow: false });
    expect(filled).toContain("t-number-cell-cancel");
    expect(filled).toContain("t-number-cell-ok");
    expect(filled).not.toMatch(/data-testid="t-number-cell-ok"[^>]*aria-disabled="true"/);
    const empty = render({ unitId: 1, kind: "custom", text: "", follow: false });
    expect(empty).toMatch(/aria-disabled="true"[^>]*data-testid="t-number-cell-ok"|data-testid="t-number-cell-ok"[^>]*aria-disabled="true"/);
    expect(empty).toContain("Type a number");
  });
  it("has no buttons under a kind that saves at once", () => {
    const html = render({ unitId: 1, kind: "bullet", text: "", follow: false });
    expect(html).not.toContain("number-cell-ok");
    expect(html).not.toContain("number-cell-cancel");
  });
});
