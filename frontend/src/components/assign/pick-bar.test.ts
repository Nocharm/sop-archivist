import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LangProvider } from "@/lib/i18n";
import { buildPickBar, type PickBarState, type PickToolId } from "@/lib/pick-bar-model";

import { PickBar } from "./pick-bar";

const IDS: PickToolId[] = ["split", "merge_prev", "merge_next", "pair"];
const open = { rowKey: "r3", unitId: 3, isConfirmed: false, savedTargetIds: [], blockKey: null };
const sentence = { unitId: 700, targetIds: [70], additive: false, hasSources: false, whyKey: null };
const noop = () => undefined;

/** 결정표(pick-bar-model.test)의 줄 - 2 Old만 · 4 양쪽 · 11 보낼 곳을 고른 뒤 · 14 칸 */
function row(n: 2 | 4 | 11 | 14, reasons: Partial<Record<PickToolId, string>> = {}): PickBarState {
  const tools = IDS.map((id) => ({ id, reasonKey: reasons[id] ?? null }));
  const base: PickBarState = { canEdit: true, mode: "old", isPicking: false, isMultiPick: false, isCell: false, last: "new", act: "pick", old: open, new: sentence, tools };
  if (n === 2) return { ...base, last: "old", new: null };
  if (n === 11) return { ...base, last: "old", act: "destination" };
  if (n === 14) return { ...base, isCell: true };
  return base;
}

function html(state: PickBarState): string {
  const bar = createElement(PickBar, { bar: buildPickBar(state), toolLabel: (id) => id, keyOf: () => null, busy: false, testId: "pick", onLink: noop, onStartLink: noop, onTool: noop, onMore: noop });
  return renderToStaticMarkup(createElement(LangProvider, null, bar));
}

const order = (markup: string) => [...markup.matchAll(/data-part="([^"]+)"/g)].map((match) => match[1]);

describe("PickBar", () => {
  it("shows link, then a divider, then tools", () => expect(order(html(row(4)))).toEqual(["link", "sep", "split", "merge_prev", "merge_next", "pair", "more"]));
  it("puts the partner pick after the tools when one side is picked", () => expect(order(html(row(2)))).toEqual(["split", "merge_prev", "merge_next", "pair", "sep", "start", "more"]));
  it("keeps an unavailable tool with its reason", () => {
    const markup = html(row(2, { split: "split.menu.why.notText" }));
    expect(markup).toMatch(/pick-tool-split"[^>]*aria-disabled="true"/);
    expect(markup).not.toContain(' disabled=""');
  });
  it("labels an unavailable tool with its name and keeps the reason in the tip and aria-label", () => {
    const markup = html(row(2, { split: "assign.ctx.why.nothingToSplit" }));
    const button = markup.match(/<button[^>]*pick-tool-split"[^>]*>.*?<\/button>/)?.[0] ?? "";
    expect(button).toContain('aria-label="This sentence is too short to split."');
    expect(button).toContain('data-tip="This sentence is too short to split."');
    expect(button).toMatch(/class="mbtn-label"[^>]*>split<\/span>/);
  });
  it("gives every folding button its name as a tip - a folded one shows only its icon, hover does not unfold it", () => {
    const markup = html(row(2));
    for (const part of ["split", "pair", "start", "more"]) expect(markup).toMatch(new RegExp(`<button[^>]*data-part="${part}"[^>]*data-tip="[^"]+"`));
  });
  it("puts the partner pick and more inside the folding group after the tools", () => {
    const group = html(row(2)).match(/<span class="pick-tools">(.*)<\/span><\/div>$/)?.[1] ?? "";
    expect(order(group)).toEqual(["split", "merge_prev", "merge_next", "pair", "sep", "start", "more"]);
  });
  it("draws the Enter mark only on the link", () => {
    expect(html(row(4)).match(/<kbd>↵<\/kbd>/g)).toHaveLength(1);
    expect(html(row(11))).not.toContain("<kbd>↵</kbd>");
  });
  it("draws only link and more in a cell", () => expect(order(html(row(14)))).toEqual(["link", "more"]));
  it("draws nothing when the bar is empty", () => expect(html({ ...row(4), canEdit: false })).toBe(""));
});
