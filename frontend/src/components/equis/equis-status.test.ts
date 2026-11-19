// EQUIS 표시의 이름과 툴팁 - 좁은 줄에서 글자가 숨어(.equis-text) 아이콘만 남아도 단추에 이름이 있고 툴팁이 뜬다. 글자가 보이면 툴팁은 뜨지 않는다.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EquisInfo } from "@/lib/api-sop";
import { LangProvider } from "@/lib/i18n";

import { EquisStatus } from "./equis-status";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const EQUIS: EquisInfo = {
  state: "found", refreshing: false, verdict: "ok", reasons: [], notes: [], current: { version: "14.0", status: "Effective", effective_date: "2025-09-17", retired_date: "" },
  in_progress: [], retired: null, number: "SOP-ABC-00001", trail: ["SOP-ABC-00001"], ambiguous: [], name: "Synthetic Name", subtype: "", owning_department: "",
  plant: "", area: "", legacy_numbers: [], equipment_tag: "", doc_url: null, title_locked: false, fetched_at: null,
};
const LABEL = "Current · Effective 14.0";

function render(compact = false) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(createElement(LangProvider, null, createElement(EquisStatus, { equis: EQUIS, testId: "eq", compact, canEdit: false }))));
  const trigger = host.querySelector<HTMLButtonElement>('[data-testid="eq"]');
  if (!trigger) throw new Error("EquisStatus did not render");
  /** 포커스하고 툴팁 지연(150ms)을 넘긴 뒤 뜬 툴팁 글 */
  const focusTip = () => {
    act(() => trigger.focus());
    act(() => vi.advanceTimersByTime(300));
    return document.querySelector('[role="tooltip"]')?.textContent ?? null;
  };
  return { trigger, focusTip, unmount: () => act(() => root.unmount()) };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("EquisStatus", () => {
  it("names the marker even when its text is visible, and keeps the text", () => {
    const view = render();
    expect(view.trigger.getAttribute("aria-label")).toBe(LABEL);
    expect(view.trigger.querySelector(".equis-text")?.textContent).toBe(LABEL);
    view.unmount();
  });

  it("shows no tooltip while the text is visible", () => {
    const view = render();
    const text = view.trigger.querySelector<HTMLElement>(".equis-text");
    if (!text) throw new Error("no text");
    // jsdom은 배치를 하지 않는다 - 보이는 글은 상자가 있다
    text.getClientRects = () => [new DOMRect(0, 0, 80, 16)] as unknown as DOMRectList;
    expect(view.focusTip()).toBeNull();
    view.unmount();
  });

  it("shows its text as a tooltip once the text is hidden", () => {
    const view = render();
    const text = view.trigger.querySelector<HTMLElement>(".equis-text");
    if (!text) throw new Error("no text");
    // display:none인 글은 상자가 없다
    text.getClientRects = () => [] as unknown as DOMRectList;
    expect(view.focusTip()).toBe(LABEL);
    view.unmount();
  });

  it("keeps the compact marker's name and tooltip", () => {
    const view = render(true);
    expect(view.trigger.getAttribute("aria-label")).toBe(LABEL);
    expect(view.focusTip()).toBe(LABEL);
    view.unmount();
  });
});
