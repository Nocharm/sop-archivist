// 결과물 C - AI가 제안한 표의 칸은 아직 확정 글이 없어 AI 글을 보인다(문장과 같은 규칙). 비어 보이면 검토자가 표를 못 본다.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import type { OutputC, OutputCItem } from "@/lib/api-sop";
import { LangProvider } from "@/lib/i18n";

import { OutputCView } from "./output-c";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeItem(extra: Partial<OutputCItem>): OutputCItem {
  return { target_id: 1, kind: "sentence", lang: "ko", text: "", ai_text: "", change_type: null, status: "ai_suggested", source_note: "", cell_row: null, cell_col: null, children: [], ...extra };
}

describe("OutputCView", () => {
  it("shows the AI text in the cells of an AI-suggested table", () => {
    const table = makeItem({ target_id: 10, kind: "table", lang: "neutral", children: [makeItem({ target_id: 11, ai_text: "AI 칸 글", cell_row: 0, cell_col: 0 })] });
    const data: OutputC = {
      docs: [{ target_doc_id: 1, code: "SOP-1", title: "T", doc_type: "sop", parent_code: null, entrance: "assign", sections: [{ location_key: "scope", label: "Scope", na_reason: null, items: [table] }] }],
      deleted: [],
      moved: [],
    };
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => root.render(createElement(LangProvider, null, createElement(OutputCView, { data, lang: "ko" }))));
    expect(host.querySelector("td")?.textContent).toBe("AI 칸 글");
    act(() => root.unmount());
  });
});
