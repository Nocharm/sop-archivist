// 결과물 A 한 줄 - Old unit 칸은 옛 문서·위치(Excel Location과 같은 글)·Unit ID, 펼치면 검사 경고를 화면 문구로 보인다.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import type { OutputARow } from "@/lib/api-sop";
import { LangProvider } from "@/lib/i18n";

import { OutputARowView } from "./output-a-row";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom에는 ResizeObserver가 없다 - 잘림 재기는 이 시험의 대상이 아니다
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

function makeRow(extra: Partial<OutputARow>): OutputARow {
  return {
    row_no: 1, is_group_start: true, row_kind: "unit", old_doc_code: "OLD-1", old_doc_version: "1.0",
    location: { section: "5", place: "Paragraph", page: 3, page_basis: "rendered" }, unit_id: 1, display_id: "OLD-1-001", source_text: "원문",
    dest_kind: "sop", dest_doc_code: "SOP-1", dest_doc_title: "", dest_location: "Purpose", dest_number: "1.1", dest_is_note: false,
    confirmed_text: "새 문장", ai_text: "", change_type: "as_is", remark: "", status: "confirmed", confirmed_by: null, confirmed_at: null,
    group_id: null, warnings: [], ...extra,
  };
}

function render(row: OutputARow) {
  const host = document.createElement("div");
  const root = createRoot(host);
  const line = { row, showShared: row.is_group_start, showDest: true };
  const view = createElement(OutputARowView, { line, index: 0, destKindLabel: "New SOP", changeLabel: "As is", status: "confirmed" });
  act(() => root.render(createElement(LangProvider, null, createElement("table", null, createElement("tbody", null, view)))));
  return { host, unmount: () => act(() => root.unmount()) };
}

describe("OutputARowView", () => {
  it("shows the old document, the Excel location and the Unit ID in the Old unit cell", () => {
    const { host, unmount } = render(makeRow({}));
    expect(host.querySelector('[data-testid="output-a-location-0"]')?.textContent).toBe("§5 · Paragraph · p. 3");
    expect(host.querySelectorAll("td")[1].textContent).toContain("OLD-1");
    expect(host.querySelectorAll("td")[1].textContent).toContain("OLD-1-001");
    unmount();
  });

  it("names a check warning with its screen label when the row is opened", () => {
    const { host, unmount } = render(makeRow({ warnings: [{ kind: "number_mismatch", source: "3", target: "4" }] }));
    act(() => host.querySelector<HTMLButtonElement>('[data-testid="output-a-0-expand"]')?.click());
    const details = host.querySelector('[data-testid="output-a-details-0"]')?.textContent ?? "";
    expect(details).toContain("Numbers differ");
    expect(details).toContain("3 → 4");
    expect(details).not.toContain("number_mismatch");
    unmount();
  });
});
