// 결과물 C - AI가 제안한 표의 칸은 아직 확정 글이 없어 AI 글을 보인다(문장과 같은 규칙). 비어 보이면 검토자가 표를 못 본다.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import type { OutputC, OutputCItem } from "@/lib/api-sop";
import { LangProvider } from "@/lib/i18n";

import { OutputCView } from "./output-c";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeItem(extra: Partial<OutputCItem>): OutputCItem {
  return { target_id: 1, kind: "sentence", lang: "ko", text: "", ai_text: "", change_type: null, status: "ai_suggested", source_note: "", number: null, indent_level: 0, number_style: "numbered", cell_row: null, cell_col: null, children: [], ...extra };
}

describe("OutputCView", () => {
  it("shows the AI text in the cells of an AI-suggested table", () => {
    const table = makeItem({ target_id: 10, kind: "table", lang: "neutral", children: [makeItem({ target_id: 11, ai_text: "AI 칸 글", cell_row: 0, cell_col: 0 })] });
    const data: OutputC = {
      docs: [{ target_doc_id: 1, code: "SOP-1", title: "T", doc_type: "sop", parent_code: null, entrance: "assign", sections: [{ location_key: "scope", label: "Scope", number: "2", na_reason: null, items: [table] }] }],
      deleted: [],
      moved: [],
    };
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => root.render(createElement(LangProvider, null, createElement(OutputCView, { data, lang: "ko" }))));
    expect(host.querySelector("td")?.textContent).toBe("AI 칸 글");
    act(() => root.unmount());
  });

  it("numbers lines and sections, and Tab on a picked row indents one level at most", () => {
    const items = [makeItem({ target_id: 1, text: "가", status: "confirmed", number: "2.1" }), makeItem({ target_id: 2, text: "나", status: "confirmed", number: "2.2" })];
    const data: OutputC = {
      docs: [{ target_doc_id: 1, code: "SOP-1", title: "T", doc_type: "sop", parent_code: null, entrance: "assign", sections: [{ location_key: "scope", label: "Scope", number: "2", na_reason: null, items }] }],
      deleted: [],
      moved: [],
    };
    const onIndent = vi.fn();
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => root.render(createElement(LangProvider, null, createElement(OutputCView, { data, lang: "ko", onMove: () => {}, onIndent }))));
    expect(host.querySelector('[data-testid="output-c-number-2"]')?.textContent).toBe("2.2");
    expect(host.querySelector('[data-testid="output-c-section-1-scope"]')?.textContent).toBe("2Scope");
    // 첫 줄은 들일 수 없다(앞줄이 없다) - 단추도 막고 Tab도 무시한다
    expect(host.querySelector<HTMLButtonElement>('[data-testid="output-c-indent-1"]')?.disabled).toBe(true);
    const first = host.querySelector<HTMLElement>('[data-testid="output-c-row-1"]');
    const second = host.querySelector<HTMLElement>('[data-testid="output-c-row-2"]');
    // 들일 수 없는 Tab은 막지 않는다 - 포커스가 다음 요소로 가야 키보드가 줄에 갇히지 않는다
    const blocked = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    act(() => first?.dispatchEvent(blocked));
    expect(onIndent).not.toHaveBeenCalled();
    expect(blocked.defaultPrevented).toBe(false);
    const taken = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    act(() => second?.dispatchEvent(taken));
    expect(onIndent).toHaveBeenCalledWith(1, 2, 1);
    expect(taken.defaultPrevented).toBe(true);
    // Shift+Tab은 깊이 0이라 내어 쓸 수 없다 - 그대로 지나간다
    const back = new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true });
    act(() => second?.dispatchEvent(back));
    expect(back.defaultPrevented).toBe(false);
    act(() => root.unmount());
  });

  it("shows a note in italics without a number, indents it, and sends a mark change for that line only", () => {
    const items = [
      makeItem({ target_id: 1, text: "가", status: "confirmed", number: "2.1" }),
      makeItem({ target_id: 2, text: "주석", status: "confirmed", number: null, number_style: "note", indent_level: 1 }),
      makeItem({ target_id: 3, text: "나", status: "confirmed", number: "2.2" }),
      makeItem({ target_id: 4, text: "번역", status: "confirmed", number: "2.3", change_type: "translated" }),
    ];
    const data: OutputC = {
      docs: [{ target_doc_id: 1, code: "SOP-1", title: "T", doc_type: "sop", parent_code: null, entrance: "assign", sections: [{ location_key: "scope", label: "Scope", number: "2", na_reason: null, items }] }],
      deleted: [],
      moved: [],
    };
    const onMark = vi.fn();
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => root.render(createElement(LangProvider, null, createElement(OutputCView, { data, lang: "ko", onMove: () => {}, onIndent: () => {}, onMark }))));
    expect(host.querySelector('[data-testid="output-c-number-2"]')).toBeNull();
    expect(host.querySelector('[data-testid="output-c-item-2"]')?.className).toContain("italic");
    expect(host.querySelector('[data-testid="output-c-item-1"]')?.className).not.toContain("italic");
    // 주석 줄도 사람이 정한 깊이만큼 들여 그린다
    expect(host.querySelector<HTMLElement>('[data-testid="output-c-row-2"] .c-line')?.style.paddingLeft).toBe("calc(1 * var(--c-indent))");
    // 셋째 줄의 상한은 앞 번호 줄(2.1, 깊이 0) + 1 - 주석 줄의 깊이 1에 기대지 않는다
    expect(host.querySelector<HTMLButtonElement>('[data-testid="output-c-indent-3"]')?.disabled).toBe(false);
    expect(host.querySelector('[data-testid="output-c-mark-note-2"]')?.getAttribute("aria-pressed")).toBe("true");
    act(() => host.querySelector<HTMLButtonElement>('[data-testid="output-c-mark-omitted-3"]')?.click());
    expect(onMark).toHaveBeenCalledWith(1, 3, "omitted");
    // 이미 고른 표시를 다시 눌러도 보내지 않는다
    act(() => host.querySelector<HTMLButtonElement>('[data-testid="output-c-mark-note-2"]')?.click());
    expect(onMark).toHaveBeenCalledTimes(1);
    // 번역 줄은 출처의 표시를 따라가므로 고르는 단추가 없다
    expect(host.querySelector('[data-testid="output-c-mark-4"]')).toBeNull();
    // 줄 끝 단추는 줄 아래에 겹쳐 그리므로 오른쪽 예약 여백이 없다(글 폭이 줄지 않는다)
    for (const id of [3, 4]) {
      expect(host.querySelector(`[data-testid="output-c-row-${id}"]`)?.className).not.toMatch(/\bpr-\[/);
      expect(host.querySelector(`[data-testid="output-c-row-${id}"] .row-actions`)?.className).toContain("top-full");
    }
    act(() => root.unmount());
  });
});
