// 결과물 C 한 벌 - 칸마다 두 언어가 한 목록이고, 의미가 바뀌는 줄에 굵은 선, 칸 머리 옆에 칸 제목 출처, 줄마다 바꿀 수 있는 단추만 보인다.
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import type { OutputC, OutputCItem } from "@/lib/api-sop";
import { addEdit, startDraft } from "@/lib/c-edit-model";
import { LangProvider } from "@/lib/i18n";
import { makeSectionOutline } from "@/lib/outline-fixture";
import type { MoveDir } from "@/lib/target-order";

import { OutputCView } from "./output-c";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Section = OutputC["docs"][number]["sections"][number];

function makeItem(extra: Partial<OutputCItem>): OutputCItem {
  return { target_id: 1, kind: "sentence", lang: "ko", text: "", ai_text: "", change_type: null, status: "ai_suggested", source_note: "", source_count: 1, origin: "units", meaning_key: null, number: null, indent_level: 0, number_style: "numbered", cell_row: null, cell_col: null, children: [], ...extra };
}

function makeOutput(items: OutputCItem[], extra: Partial<Section> = {}): OutputC {
  return {
    docs: [{ target_doc_id: 1, code: "SOP-1", title: "T", doc_type: "sop", parent_code: null, entrance: "assign", sections: [{ ...makeSectionOutline(), location_key: "scope", label: "Scope", number: "2", na_reason: null, heading_note: "", items, ...extra }] }],
    deleted: [],
    moved: [],
  };
}

function render(props: Parameters<typeof OutputCView>[0]) {
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => root.render(createElement(LangProvider, null, createElement(OutputCView, props))));
  return { host, unmount: () => act(() => root.unmount()) };
}

describe("OutputCView", () => {
  it("shows the AI text in the cells of an AI-suggested table", () => {
    const table = makeItem({ target_id: 10, kind: "table", lang: "neutral", children: [makeItem({ target_id: 11, ai_text: "AI 칸 글", cell_row: 0, cell_col: 0 })] });
    const { host, unmount } = render({ data: makeOutput([table]) });
    expect(host.querySelector("td")?.textContent).toBe("AI 칸 글");
    unmount();
  });

  it("puts the table caption line before the table and keeps a translated cell in its own column", () => {
    const table = makeItem({
      target_id: 10,
      kind: "table",
      lang: "neutral",
      status: "confirmed",
      caption: "표 3. 운전 조건",
      children: [
        makeItem({ target_id: 12, text: "표 3. 운전 조건", status: "confirmed" }),
        makeItem({ target_id: 13, text: "항목", status: "confirmed", cell_row: 0, cell_col: 0 }),
        makeItem({ target_id: 15, lang: "en", ai_text: "Item", cell_row: 0, cell_col: 0 }),
        makeItem({ target_id: 14, text: "값", status: "confirmed", cell_row: 0, cell_col: 1 }),
      ],
    });
    const { host, unmount } = render({ data: makeOutput([table]) });
    const caption = host.querySelector('[data-testid="output-c-caption-12"]');
    expect(caption?.textContent).toBe("표 3. 운전 조건");
    expect(caption?.compareDocumentPosition(host.querySelector("table")!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    // 칸 번역은 같은 칸 안에 줄로 - 둘째 열이 밀리지 않는다
    expect([...host.querySelectorAll("td")].map((td) => [...td.children].map((line) => line.textContent))).toEqual([["항목", "Item"], ["값"]]);
    unmount();
  });

  it("shows a figure's caption lines with their own status instead of [Figure], and the marker only without one", () => {
    const captions = [
      makeItem({ target_id: 22, text: "그림 2. 로터 장착 위치", status: "confirmed" }),
      makeItem({ target_id: 23, lang: "en", ai_text: "Figure 2. Rotor mounting" }),
    ];
    const items = [makeItem({ target_id: 20, kind: "figure", lang: "neutral", status: "confirmed", children: captions }), makeItem({ target_id: 21, kind: "figure", lang: "neutral" })];
    const { host, unmount } = render({ data: makeOutput(items) });
    const lines = [...host.querySelectorAll('[data-testid="output-c-item-20"] [data-testid^="output-c-caption-"]')];
    expect(lines.map((line) => [line.textContent, line.classList.contains("border-dashed")])).toEqual([
      ["그림 2. 로터 장착 위치", false],
      ["Figure 2. Rotor mounting", true],
    ]);
    expect(host.querySelector('[data-testid="output-c-item-21"]')?.textContent).toBe("[Figure]");
    unmount();
  });

  it("numbers lines and sections, and Tab on a picked row indents one level at most", () => {
    const items = [makeItem({ target_id: 1, lang: "en", text: "A", status: "confirmed", number: "2.1" }), makeItem({ target_id: 2, text: "나", status: "confirmed", number: "2.2" })];
    const onIndent = vi.fn();
    const { host, unmount } = render({ data: makeOutput(items), onMove: () => {}, onIndent });
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
    unmount();
  });

  it("draws a bullet in the number place of a bullet line and offers Bullet next to Numbered", () => {
    const items = [
      makeItem({ target_id: 1, text: "가", status: "confirmed", number: "2.1" }),
      makeItem({ target_id: 2, text: "항목", status: "confirmed", number: null, number_style: "bullet" }),
      makeItem({ target_id: 3, text: "생략", status: "confirmed", number: null, number_style: "omitted" }),
    ];
    const onMark = vi.fn();
    const { host, unmount } = render({ data: makeOutput(items), onMove: () => {}, onIndent: () => {}, onMark });
    expect(host.querySelector('[data-testid="output-c-number-2"]')).toBeNull();
    expect(host.querySelector('[data-testid="output-c-bullet-2"]')?.textContent).toBe("•");
    // 번호 생략 줄에는 기호도 없다
    expect(host.querySelector('[data-testid="output-c-bullet-3"]')).toBeNull();
    expect(host.querySelector('[data-testid="output-c-mark-bullet-2"]')?.getAttribute("aria-pressed")).toBe("true");
    const group = [...host.querySelectorAll('[data-testid="output-c-mark-1"] button')].map((button) => button.getAttribute("data-testid"));
    expect(group).toEqual(["output-c-mark-numbered-1", "output-c-mark-bullet-1", "output-c-mark-omitted-1", "output-c-mark-note-1"]);
    act(() => host.querySelector<HTMLButtonElement>('[data-testid="output-c-mark-bullet-1"]')?.click());
    expect(onMark).toHaveBeenCalledWith(1, 1, "bullet");
    unmount();
  });

  it("draws the level symbol of a bullet line in the number place and indents it per level, in the editable and the read-only view", () => {
    const items = [
      makeItem({ target_id: 1, text: "가", status: "confirmed", number: null, number_style: "bullet" }),
      makeItem({ target_id: 2, text: "나", status: "confirmed", number: null, number_style: "bullet", indent_level: 1 }),
      makeItem({ target_id: 3, text: "다", status: "confirmed", number: null, number_style: "bullet", indent_level: 2 }),
      makeItem({ target_id: 4, text: "라", status: "confirmed", number: null, number_style: "bullet", indent_level: 9 }),
    ];
    for (const props of [{ data: makeOutput(items), onMove: () => {}, onIndent: () => {}, onMark: () => {} }, { data: makeOutput(items) }]) {
      const { host, unmount } = render(props);
      expect([1, 2, 3, 4].map((id) => host.querySelector('[data-testid="output-c-bullet-' + id + '"]')?.textContent)).toEqual(["•", "○", "▪", "▪"]);
      expect([1, 2, 3, 4].map((id) => host.querySelector<HTMLElement>('[data-testid="output-c-row-' + id + '"] .c-line')?.style.paddingLeft)).toEqual([
        "calc(0 * var(--c-indent))", "calc(1 * var(--c-indent))", "calc(2 * var(--c-indent))", "calc(2 * var(--c-indent))",
      ]);
      unmount();
    }
  });

  it("offers Indent on a bullet line only below the previous bullet line's depth + 1, up to depth 2", () => {
    const items = [
      makeItem({ target_id: 1, text: "가", status: "confirmed", number: null, number_style: "bullet" }),
      makeItem({ target_id: 2, text: "나", status: "confirmed", number: null, number_style: "bullet" }),
      makeItem({ target_id: 3, text: "다", status: "confirmed", number: null, number_style: "bullet", indent_level: 1 }),
      makeItem({ target_id: 4, text: "라", status: "confirmed", number: null, number_style: "bullet", indent_level: 2 }),
      makeItem({ target_id: 5, text: "마", status: "confirmed", number: null, number_style: "bullet" }),
    ];
    const onIndent = vi.fn();
    const { host, unmount } = render({ data: makeOutput(items, { counts_lines: false }), onMove: () => {}, onIndent, onMark: () => {} });
    const disabled = (id: number) => host.querySelector<HTMLButtonElement>('[data-testid="output-c-indent-' + id + '"]')?.disabled;
    // 첫 줄(0)과 앞 줄 + 1에 닿은 줄(셋째 1, 넷째 2)은 못 들이고, 앞 줄이 2여도 둘째·다섯째 줄은 자기 앞 글머리 기호 줄 + 1까지 들인다
    expect([1, 2, 3, 4, 5].map(disabled)).toEqual([true, false, true, true, false]);
    // 둘째 줄에서 Tab - 깊이 0 → 1로 한 단 들인다
    const row = host.querySelector<HTMLElement>('[data-testid="output-c-row-2"]');
    const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    act(() => row?.dispatchEvent(tab));
    expect(onIndent).toHaveBeenCalledWith(1, 2, 1);
    unmount();
  });

  it("shows the source note as a tag only on a line that came from two or more Old lines", () => {
    const items = [
      makeItem({ target_id: 1, text: "합침", status: "confirmed", source_note: "← OLD-1 §5.1, OLD-2 §5.1 (merged)", source_count: 2 }),
      makeItem({ target_id: 2, text: "하나", status: "confirmed", source_note: "← OLD-1 §5.1", source_count: 1 }),
      makeItem({ target_id: 3, text: "신규", status: "confirmed", source_note: "", source_count: 0 }),
    ];
    for (const props of [{ data: makeOutput(items), onMove: () => {}, onIndent: () => {}, onMark: () => {} }, { data: makeOutput(items) }]) {
      const { host, unmount } = render(props);
      // 글은 서버의 source_note 그대로, 늘 보이는 칩이 아니라 줄 안(CSS가 올리거나 고를 때만 보인다)에 있다
      const tag = host.querySelector('[data-testid="output-c-source-1"]');
      expect(tag?.textContent).toBe("← OLD-1 §5.1, OLD-2 §5.1 (merged)");
      expect(tag?.closest('[data-testid="output-c-row-1"]')).not.toBeNull();
      expect(host.querySelector('[data-testid="output-c-source-2"]')).toBeNull();
      expect(host.querySelector('[data-testid="output-c-source-3"]')).toBeNull();
      unmount();
    }
  });

  it("shows a note in italics without a number, indents it, and sends a mark change for that line only", () => {
    const items = [
      makeItem({ target_id: 1, text: "가", status: "confirmed", number: "2.1" }),
      makeItem({ target_id: 2, text: "주석", status: "confirmed", number: null, number_style: "note", indent_level: 1 }),
      makeItem({ target_id: 3, text: "나", status: "confirmed", number: "2.2" }),
    ];
    const onMark = vi.fn();
    const { host, unmount } = render({ data: makeOutput(items), onMove: () => {}, onIndent: () => {}, onMark });
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
    // 줄 끝 단추 묶음은 글 밖에 떠서(.c-acts) 오른쪽 예약 여백이 없고(글 폭이 줄지 않는다), 그 틈을 눌러도 끌기가 시작되지 않는다
    for (const id of [2, 3]) {
      expect(host.querySelector(`[data-testid="output-c-row-${id}"]`)?.className).not.toMatch(/\bpr-\[/);
      const acts = host.querySelector(`[data-testid="output-c-row-${id}"] [data-testid="output-c-acts-${id}"]`);
      expect(acts?.className).toBe("c-acts");
      expect(acts?.hasAttribute("data-no-drag")).toBe(true);
    }
    expect(host.querySelector('[data-testid="output-c"]')?.classList.contains("c-order")).toBe(true);
    unmount();
  });

  it("opens the same actions from the more button as labelled menu items, disabled where the buttons are", () => {
    const items = [
      makeItem({ target_id: 1, text: "가", status: "confirmed", number: "2.1" }),
      makeItem({ target_id: 2, text: "나", status: "confirmed", number: "2.2" }),
    ];
    const onMove = vi.fn();
    const onIndent = vi.fn();
    const onMark = vi.fn();
    const { host, unmount } = render({ data: makeOutput(items), onMove, onIndent, onMark });
    document.body.append(host);
    const more = host.querySelector<HTMLButtonElement>('[data-testid="output-c-menu-1"]');
    // ⋯는 아이콘만 있어 이름을 aria-label로 갖고, 그 틈을 눌러도 끌기가 시작되지 않는다
    expect(more?.getAttribute("aria-label")).toBe("Line actions");
    expect(more?.closest(".c-more")?.hasAttribute("data-no-drag")).toBe(true);
    act(() => more?.click());
    const menu = document.querySelector('[data-testid="output-c-menu-list-1"]');
    expect([...(menu?.querySelectorAll('[role^="menuitem"]') ?? [])].map((el) => el.textContent)).toEqual(["Numbered", "Bullet", "No number", "Note", "Outdent", "Indent", "Move up", "Move down"]);
    expect(menu?.querySelector('[data-testid="output-c-menu-numbered-1"]')?.getAttribute("aria-checked")).toBe("true");
    // 첫 줄 - 내어쓰기·들여쓰기·위로는 단추처럼 막히고 아래로만 된다
    for (const key of ["outdent", "indent", "up"]) expect(menu?.querySelector<HTMLButtonElement>(`[data-testid="output-c-menu-${key}-1"]`)?.disabled).toBe(true);
    act(() => menu?.querySelector<HTMLButtonElement>('[data-testid="output-c-menu-down-1"]')?.click());
    expect(onMove).toHaveBeenCalledWith(1, "scope", 1, 1);
    // 고르면 메뉴가 닫힌다 - 다시 열어 번호 표시를 바꾸고, 이미 고른 표시는 보내지 않는다
    expect(document.querySelector('[data-testid="output-c-menu-list-1"]')).toBeNull();
    act(() => more?.click());
    act(() => document.querySelector<HTMLButtonElement>('[data-testid="output-c-menu-numbered-1"]')?.click());
    expect(onMark).not.toHaveBeenCalled();
    act(() => more?.click());
    act(() => document.querySelector<HTMLButtonElement>('[data-testid="output-c-menu-note-1"]')?.click());
    expect(onMark).toHaveBeenCalledWith(1, 1, "note");
    // 둘째 줄은 들일 수 있다
    act(() => host.querySelector<HTMLButtonElement>('[data-testid="output-c-menu-2"]')?.click());
    act(() => document.querySelector<HTMLButtonElement>('[data-testid="output-c-menu-indent-2"]')?.click());
    expect(onIndent).toHaveBeenCalledWith(1, 2, 1);
    unmount();
    host.remove();
  });

  it("offers no Numbered choice on a line placed directly in a section that does not count lines, and shows it as No number", () => {
    const items = [
      makeItem({ target_id: 1, text: "가", status: "confirmed", indent_level: 0 }),
      makeItem({ target_id: 2, text: "나", status: "confirmed", indent_level: 1 }),
      makeItem({ target_id: 3, text: "주석", status: "confirmed", number_style: "note" }),
    ];
    const onMark = vi.fn();
    // 어느 칸이 그런지는 서버가 절에 싣는다(counts_lines) - 화면은 칸 키로 풀지 않는다
    const data = makeOutput(items, { location_key: "general_requirements", label: "General Requirements", number: "5", kind: "named_children", counts_lines: false });
    const { host, unmount } = render({ data, onMove: () => {}, onIndent: () => {}, onMark });
    document.body.append(host);
    expect(host.querySelector('[data-testid="output-c-number-1"]')).toBeNull();
    // 쓸 수 없는 번호 단추는 숨기고, 번호로 저장된 줄은 번호 생략이 눌린 것으로 보인다 - 주석은 주석 그대로
    const pressed = (id: number) => [...host.querySelectorAll(`[data-testid="output-c-mark-${id}"] button`)].map((el) => [el.getAttribute("aria-label"), el.getAttribute("aria-pressed")]);
    expect(pressed(1)).toEqual([["Bullet", "false"], ["No number", "true"], ["Note", "false"]]);
    expect(pressed(3)).toEqual([["Bullet", "false"], ["No number", "false"], ["Note", "true"]]);
    // 번호를 세는 줄이 없어 저장된 깊이와 상관없이 맨 바깥에 그리고 들이거나 내어 쓸 수 없다
    expect(host.querySelector<HTMLElement>('[data-testid="output-c-row-2"] .c-line')?.style.paddingLeft).toBe("calc(0 * var(--c-indent))");
    for (const key of ["indent", "outdent"]) expect(host.querySelector<HTMLButtonElement>(`[data-testid="output-c-${key}-2"]`)?.disabled).toBe(true);
    // ⋯ 메뉴도 같은 세 가지만
    act(() => host.querySelector<HTMLButtonElement>('[data-testid="output-c-menu-1"]')?.click());
    const menu = document.querySelector('[data-testid="output-c-menu-list-1"]');
    expect([...(menu?.querySelectorAll('[role="menuitemradio"]') ?? [])].map((el) => [el.textContent, el.getAttribute("aria-checked")])).toEqual([["Bullet", "false"], ["No number", "true"], ["Note", "false"]]);
    // 눌린 것으로 보여도 저장값은 번호라, 번호 생략을 고르면 그 값을 저장한다
    act(() => menu?.querySelector<HTMLButtonElement>('[data-testid="output-c-menu-omitted-1"]')?.click());
    expect(onMark).toHaveBeenCalledWith(1, 1, "omitted");
    act(() => host.querySelector<HTMLButtonElement>('[data-testid="output-c-mark-note-2"]')?.click());
    expect(onMark).toHaveBeenLastCalledWith(1, 2, "note");
    unmount();
    host.remove();
  });

  it("locks the depth of an AI translation but lets its number style and a person's other-language sentence change", () => {
    const items = [
      makeItem({ target_id: 1, lang: "en", text: "Check", status: "confirmed", number: "2.1", meaning_key: "old:3" }),
      makeItem({ target_id: 2, text: "확인", status: "confirmed", number_style: "omitted", change_type: "translated", origin: "translation", meaning_key: "old:3" }),
      makeItem({ target_id: 3, lang: "en", text: "Written", status: "confirmed", number: "2.2", change_type: "translated", origin: "units", meaning_key: "old:4" }),
    ];
    const { host, unmount } = render({ data: makeOutput(items), onMove: () => {}, onIndent: () => {}, onMark: () => {} });
    // AI 번역: 깊이 단추는 없고(출처를 따른다) 번호 표시는 고른다
    expect(host.querySelector('[data-testid="output-c-indent-2"]')).toBeNull();
    expect(host.querySelector('[data-testid="output-c-mark-2"]')).not.toBeNull();
    // 사람이 쓴 다른 언어 문장은 일반 새 문장이다
    expect(host.querySelector('[data-testid="output-c-indent-3"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="output-c-mark-3"]')).not.toBeNull();
    unmount();
  });

  it("draws one list per section with a meaning border and each line in its own language", () => {
    const items = [
      makeItem({ target_id: 1, lang: "en", text: "Check", status: "confirmed", meaning_key: "old:3" }),
      makeItem({ target_id: 2, text: "확인", status: "confirmed", meaning_key: "old:3" }),
      makeItem({ target_id: 3, lang: "en", text: "Next", status: "confirmed", meaning_key: "old:4" }),
      makeItem({ target_id: 4, text: "번역", status: "confirmed", meaning_key: null }),
    ];
    // 검토 화면처럼 조작 없이 그려도 같은 선이다
    const { host, unmount } = render({ data: makeOutput(items, { heading_note: "← OLD-1 §5, OLD-2 §5" }) });
    const starts = [1, 2, 3, 4].map((id) => host.querySelector(`[data-testid="output-c-row-${id}"]`)?.hasAttribute("data-meaning-start"));
    // 칸의 첫 줄은 칸 머리가 위에 있어 선을 긋지 않는다
    expect(starts).toEqual([false, false, true, true]);
    expect(host.querySelector('[data-testid="output-c-item-1"]')?.getAttribute("lang")).toBe("en");
    expect(host.querySelector('[data-testid="output-c-item-2"]')?.getAttribute("lang")).toBe("ko");
    expect(host.querySelector('[data-testid="output-c-heading-note-1-scope"]')?.textContent).toBe("← OLD-1 §5, OLD-2 §5");
    unmount();
  });

  it("draws a long C in parts and shows the deleted list only after the last line", () => {
    // jsdom에는 IntersectionObserver가 없다 - 끝 표지가 보이는 일은 일어나지 않는 것으로 둔다
    vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} });
    const items = Array.from({ length: 100 }, (_, index) => makeItem({ target_id: index + 1, text: `줄 ${index + 1}`, status: "confirmed" }));
    const data: OutputC = { ...makeOutput(items), deleted: [{ display_id: "OLD-1-1", doc_code: "OLD-1", section: "5", source_text: "가", reason: "중복" }] };
    const { host, unmount } = render({ data, onMove: () => {} });
    // 80줄 = 문서 머리 + 칸 머리 + 문장 78줄
    expect(host.querySelectorAll('[data-testid^="output-c-row-"]')).toHaveLength(78);
    expect(host.querySelector('[data-testid="output-c-more"]')).not.toBeNull();
    expect(host.querySelector('[data-testid^="output-c-deleted-"]')).toBeNull();
    expect(host.querySelector('[data-testid="output-c-row-5"]')?.getAttribute("data-flip-key")).toBe("5");
    unmount();
    vi.unstubAllGlobals();
  });

  it("keeps focus on the pressed move button after the line moves, or the other one at the section edge", () => {
    const items = [makeItem({ target_id: 1, text: "가", status: "confirmed" }), makeItem({ target_id: 2, text: "나", status: "confirmed" }), makeItem({ target_id: 3, text: "다", status: "confirmed" })];
    function Harness() {
      // 결과물 화면처럼 누르면 그 자리에서 문서를 바꾼다
      const [data, setData] = useState(makeOutput(items));
      const onMove = (_docId: number, locationKey: string, targetId: number, dir: MoveDir) => {
        const draft = addEdit(startDraft(data.docs[0]), { kind: "move", locationKey, targetId, dir });
        if (draft) setData({ ...data, docs: [draft.shown] });
      };
      return createElement(OutputCView, { data, onMove });
    }
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(createElement(LangProvider, null, createElement(Harness))));
    const press = (testId: string) => {
      const button = host.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
      button?.focus();
      act(() => button?.click());
    };
    const order = () => [...host.querySelectorAll('[data-testid^="output-c-row-"]')].map((row) => row.getAttribute("data-flip-key"));

    press("output-c-move-down-1");
    expect(order()).toEqual(["2", "1", "3"]);
    expect(document.activeElement?.getAttribute("data-testid")).toBe("output-c-move-down-1");
    press("output-c-move-down-1");
    expect(order()).toEqual(["2", "3", "1"]);
    // 칸 끝에 닿아 아래 단추가 꺼졌다 - 포커스는 위 단추로
    expect(document.activeElement?.getAttribute("data-testid")).toBe("output-c-move-up-1");
    act(() => root.unmount());
    host.remove();
  });

  it("lists a deleted pair once with both sentences", () => {
    const data: OutputC = { ...makeOutput([]), deleted: [{ display_id: "OLD-1-1\nOLD-1-2", doc_code: "OLD-1", section: "5", source_text: "가\nA", reason: "중복" }] };
    const { host, unmount } = render({ data });
    const rows = host.querySelectorAll('[data-testid^="output-c-deleted-"]');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("가\nA");
    unmount();
  });
  it("puts the renumber chip only on a caption line that has text, like the New pane", () => {
    const renumber = { from_label: "표 4", to_label: "표 1" };
    const empty = makeItem({ target_id: 31, kind: "table", lang: "neutral", renumber, children: [makeItem({ target_id: 32 }), makeItem({ target_id: 33, cell_row: 0, cell_col: 0, text: "가" })] });
    const filled = makeItem({ target_id: 41, kind: "table", lang: "neutral", renumber, children: [makeItem({ target_id: 42 }), makeItem({ target_id: 43, lang: "en", text: "Table 1. Limits" }), makeItem({ target_id: 44, cell_row: 0, cell_col: 0, text: "나" })] });
    const { host, unmount } = render({ data: makeOutput([empty, filled]) });
    expect(host.querySelector('[data-testid="output-c-renumber-31"]')).toBeNull();
    const chip = host.querySelector('[data-testid="output-c-renumber-41"]');
    expect(chip?.closest('[data-testid^="output-c-caption-"]')?.getAttribute("data-testid")).toBe("output-c-caption-43");
    unmount();
  });
});

describe("OutputCView sections that take no sentences", () => {
  const base = makeOutput([]).docs[0];
  function makeSection(location_key: string, number: string | null, label: string, extra: Partial<Section> = {}): Section {
    return { ...makeSectionOutline({ default_style: "bullet" }), location_key, label, number, na_reason: null, heading_note: "", items: [], ...extra };
  }
  const WI_LIST = "document_relationships.work_instructions";
  const sections: Section[] = [
    makeSection("general_requirements.safety", null, "General Requirements › Safety", { level: 1, items: [makeItem({ target_id: 1, text: "보호구", status: "confirmed", number_style: "bullet" })] }),
    makeSection("document_relationships", "7", "Document Relationships", { kind: "group", counts_lines: false }),
    makeSection(WI_LIST, "7.2", "Document Relationships › Work Instructions", {
      kind: "auto_list",
      level: 1,
      counts_lines: false,
      auto_items: [{ code: "WI-CF-01", title: "Rotor change" }, { code: "WI-CF-02", title: "" }],
    }),
    makeSection("document_relationships.references", "7.3", "Document Relationships › References", { level: 1 }),
  ];
  const data: OutputC = { docs: [{ ...base, sections }], deleted: [], moved: [] };
  const edit = { onMove: () => {}, onIndent: () => {}, onMark: () => {}, onPlace: () => {} };
  const find = (host: HTMLElement, testId: string) => host.querySelector(`[data-testid="${testId}"]`);

  it("lists the SOP's work instructions as read-only lines under the auto-list heading", () => {
    const { host, unmount } = render({ data, ...edit });
    const list = find(host, `output-c-auto-1-${WI_LIST}`);
    expect([...(list?.querySelectorAll("li") ?? [])].map((item) => item.textContent)).toEqual(["WI-CF-01 — Rotor change", "WI-CF-02"]);
    // 끌 상자도 줄 끝 단추도 없고, 빈 칸 표시("–")로 그리지도 않는다
    expect(list?.querySelector("[data-drag-box], button")).toBeNull();
    expect(find(host, `output-c-empty-1-${WI_LIST}`)).toBeNull();
    expect(find(host, `output-c-section-1-${WI_LIST}`)?.textContent).toBe("7.2Document Relationships › Work Instructions");
    unmount();
  });

  it("says so when the SOP has no work instructions yet", () => {
    const empty: OutputC = { ...data, docs: [{ ...base, sections: [makeSection(WI_LIST, "7.2", "Work Instructions", { kind: "auto_list", counts_lines: false })] }] };
    const { host, unmount } = render({ data: empty });
    expect(find(host, `output-c-auto-1-${WI_LIST}`)?.textContent).toBe("No work instructions yet");
    unmount();
  });

  it("draws a group as its heading only, and an empty section that takes sentences with the empty mark", () => {
    const { host, unmount } = render({ data, ...edit });
    const group = host.querySelector('section[data-location-key="document_relationships"]');
    expect(group?.children).toHaveLength(1);
    expect(find(host, "output-c-section-1-document_relationships")?.textContent).toBe("7Document Relationships");
    expect(find(host, "output-c-empty-1-document_relationships")).toBeNull();
    expect(find(host, "output-c-empty-1-document_relationships.references")).not.toBeNull();
    unmount();
  });

  it("shows an N/A group with its reason like any other section", () => {
    const na: OutputC = { ...data, docs: [{ ...base, sections: [makeSection("document_relationships", "7", "Document Relationships", { kind: "group", counts_lines: false, na_reason: "No related documents" })] }] };
    const { host, unmount } = render({ data: na });
    expect(host.querySelector("[data-na-reason]")?.textContent).toBe("N/A · No related documents");
    unmount();
  });

  it("titles a category section without a number and draws its lines as bullets", () => {
    const { host, unmount } = render({ data });
    expect(find(host, "output-c-section-1-general_requirements.safety")?.textContent).toBe("General Requirements › Safety");
    expect(find(host, "output-c-bullet-1")).not.toBeNull();
    expect(find(host, "output-c-number-1")).toBeNull();
    unmount();
  });

  it("heads an appendix with its label alone while its lines keep the appendix number", () => {
    // 부록의 이름에 번호가 들어 있다 - 머리에 번호를 또 적으면 "1Appendix 1. …"이 된다
    const appendix = makeSection("appendices.a1", "1", "Appendix 1. Alarm list", { shows_number: false, default_style: "numbered", items: [makeItem({ target_id: 5, text: "경보", status: "confirmed", number: "1.1" })] });
    const numbered = makeSection("purpose", "1", "Purpose");
    const { host, unmount } = render({ data: { ...data, docs: [{ ...base, sections: [numbered, appendix] }] } });
    expect(find(host, "output-c-section-1-appendices.a1")?.textContent).toBe("Appendix 1. Alarm list");
    expect(find(host, "output-c-section-1-purpose")?.textContent).toBe("1Purpose");
    expect(find(host, "output-c-number-5")?.textContent).toBe("1.1");
    unmount();
  });
});
