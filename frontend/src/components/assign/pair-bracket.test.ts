// 떨어진 짝 괄호선(11-23 명세 E1) - 그리는 층은 표시 전용이고, 괄호선이 보이는 동안 용지는 안내 줄을 그리지 않는다
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { DocumentView, ViewBlock, ViewUnit } from "@/lib/api-sop";
import { LangProvider } from "@/lib/i18n";
import { buildPaperModel } from "@/lib/paper-model";

import { Paper } from "../paper/paper";
import { PairBracketSvg } from "./pair-bracket";

type PaperProps = Parameters<typeof Paper>[0];

function block(id: number, text: string): ViewBlock {
  return {
    id, seq: id, text, part: "body", kind: "paragraph", page: 1, page_basis: "estimated", section_label: "", heading_level: null,
    table_id: null, row_index: null, col_index: null, grid_span: 1, row_span: 1, flags: [], has_image: false, part_group: "body",
  };
}
function u(id: number, text: string, extra: Partial<ViewUnit> = {}): ViewUnit {
  return {
    id, display_id: `D-${id}`, kind: "sentence", spans: [[id, 0, text.length]], text, lang: "ko", number: null, table_id: null, row_index: null, group_unit_id: null,
    status: "unassigned", pair_id: null, pos_seq: id, block_id: id, is_edited: false, can_unmerge: false, split_suggestion_id: null, ref: null, caption_refs: [], ...extra,
  };
}
function view(units: ViewUnit[]): DocumentView {
  return {
    document: {} as DocumentView["document"], extraction: null, has_number_ranges: false, pairs: [], part_groups: [], edits: { can_undo: false, can_redo: false }, tables: [],
    blocks: units.map((unit) => block(unit.id, unit.text)), units,
  };
}

// S14 - 4 KO "탱크를 비운다."와 8 EN "Empty the tank."이 짝, 사이에 5 · 6 KO와 7 EN
const farModel = buildPaperModel(view([
  u(3, "앞 줄."), u(4, "탱크를 비운다.", { pair_id: 9 }), u(5, "다음 줄."), u(6, "또 다음 줄."), u(7, "Another line.", { lang: "en" }), u(8, "Empty the tank.", { lang: "en", pair_id: 9 }),
]));
const onGo = () => undefined;

function html(props: Parameters<typeof PairBracketSvg>[0]): string {
  return renderToStaticMarkup(createElement(PairBracketSvg, props));
}

function paperHtml(pairHint: NonNullable<PaperProps["strips"]>["pairHint"]): string {
  const props: PaperProps = { model: farModel, selectedId: 4, onUnitClick: () => undefined, testId: "assign-paper", strips: { pairHint } };
  return renderToStaticMarkup(createElement(LangProvider, null, createElement(Paper, props)));
}

describe("the far pair bracket", () => {
  it("draws a path with the pinned testid and takes no pointer", () => {
    const h = html({ side: "old", bracket: { d: "M0 0", unitIds: [4, 8] } });
    expect(h).toContain('data-testid="assign-pair-bracket"');
    expect(h).toContain("aria-hidden");
    expect(h).toContain('data-units="4,8"');
  });

  it("draws nothing without a bracket", () => expect(html({ side: "old", bracket: null })).not.toContain("<path"));

  it("the paper drops the hint while the bracket shows", () => {
    expect(paperHtml({ onGo, isHidden: true })).not.toContain("pair-hint");
    expect(paperHtml({ onGo, isHidden: false })).toContain("pair-hint");
  });
});
