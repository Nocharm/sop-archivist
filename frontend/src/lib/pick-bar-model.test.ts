import { describe, expect, it } from "vitest";

import { buildPickBar, isMoreOnlyTools, resolveMoreClick, type PickBar, type PickBarState, type PickTool } from "./pick-bar-model";

const TOOLS: PickTool[] = [{ id: "split", reasonKey: null }, { id: "merge_prev", reasonKey: null }, { id: "merge_next", reasonKey: null }, { id: "pair", reasonKey: null }];
const s = 61;
const t = 70;
type OldIn = NonNullable<PickBarState["old"]>;
type NewIn = NonNullable<PickBarState["new"]>;
const open = (over: Partial<OldIn> = {}): OldIn => ({ rowKey: "r3", unitId: 3, isConfirmed: false, savedTargetIds: [], blockKey: null, ...over });
const linked = (ids: number[], over: Partial<OldIn> = {}): OldIn => open({ isConfirmed: true, savedTargetIds: ids, ...over });
const sentence = (over: Partial<NewIn> = {}): NewIn => ({ unitId: 700, targetIds: [t], additive: false, hasSources: false, whyKey: null, ...over });
function state(old: OldIn | null, next: NewIn | null, over: Partial<PickBarState> = {}): PickBarState {
  return { canEdit: true, mode: "old", isPicking: false, isMultiPick: false, isCell: false, last: next !== null ? "new" : old !== null ? "old" : null, act: "pick", old, new: next, tools: TOOLS, ...over };
}

function summary(bar: PickBar) {
  return {
    at: bar.at?.side ?? null,
    link: bar.link === null ? null : { kind: bar.link.kind, result: bar.link.result, isEnter: bar.link.isEnter, reasonKey: bar.link.reasonKey },
    startLink: bar.startLink,
    tools: bar.tools.length,
    enter: bar.enter.kind === "noop" ? `noop ${bar.enter.noticeKey}` : bar.enter.kind,
  };
}
const want = (at: "old" | "new" | null, link: { kind: string; result: number[]; isEnter: boolean; reasonKey?: string | null } | null, startLink: "old" | "new" | null, tools: number, enter: string) => ({ at, link: link === null ? null : { reasonKey: null, ...link }, startLink, tools, enter });

const CASES: Array<[string, PickBarState, ReturnType<typeof want>]> = [
  ["1 nothing picked", state(null, null), want(null, null, null, 0, "none")],
  ["2 an open Old row", state(open(), null, { last: "old" }), want("old", null, "new", 4, "confirm")],
  ["3 a New sentence", state(null, sentence()), want("new", null, "old", 4, "none")],
  ["4 both, New last", state(open(), sentence()), want("new", { kind: "link", result: [t], isEnter: true }, null, 4, "link")],
  ["5 both, Old last", state(open(), sentence(), { last: "old" }), want("old", { kind: "link", result: [t], isEnter: true }, null, 4, "link")],
  ["6 linked elsewhere", state(linked([s]), sentence()), want("new", { kind: "replace", result: [t], isEnter: true }, null, 4, "link")],
  ["7 linked elsewhere, Ctrl", state(linked([s]), sentence({ additive: true })), want("new", { kind: "add", result: [s, t], isEnter: true }, null, 4, "link")],
  ["8 already linked", state(linked([t]), sentence()), want("new", { kind: "unlink", result: [], isEnter: false }, null, 4, "noop assign.pick.alreadyLinked")],
  ["9 one of two links, Ctrl", state(linked([s, t]), sentence({ additive: true })), want("new", { kind: "unlink", result: [s], isEnter: false }, null, 4, "noop assign.pick.alreadyLinked")],
  ["10 confirmed as deleted", state(open({ isConfirmed: true }), sentence()), want("new", { kind: "replace", result: [t], isEnter: true }, null, 4, "link")],
  ["11 a destination was chosen", state(open(), sentence(), { act: "destination", last: "old" }), want("old", { kind: "link", result: [t], isEnter: false }, null, 4, "confirm")],
  ["12 the row is blocked", state(open({ blockKey: "assign.ref.checkFirst" }), sentence()), want("new", { kind: "link", result: [t], isEnter: false, reasonKey: "assign.ref.checkFirst" }, null, 4, "noop assign.ref.checkFirst")],
  ["13 a heading", state(open(), sentence({ targetIds: [], whyKey: "assign.newPaper.why.heading" })), want("new", { kind: "link", result: [], isEnter: false, reasonKey: "assign.newPaper.why.heading" }, null, 4, "noop assign.newPaper.why.heading")],
  ["14 a cell", state(open(), sentence(), { isCell: true }), want("new", { kind: "link", result: [t], isEnter: true }, null, 0, "link")],
  ["15 picking a pair", state(open(), sentence(), { isPicking: true }), want(null, null, null, 0, "none")],
  ["16 Shift-picking rows", state(open(), sentence(), { isMultiPick: true }), want(null, null, null, 0, "none")],
  ["17 read only", state(open(), sentence(), { canEdit: false }), want(null, null, null, 0, "none")],
  ["18 without a source, Old last", state(open(), sentence(), { mode: "unsourced", last: "old" }), want("old", { kind: "link", result: [t], isEnter: true }, null, 4, "link")],
  ["19 without a source, Old only", state(open(), null, { mode: "unsourced", last: "old" }), want("old", null, "new", 4, "none")],
  // act null - 저장 뒤 다음 박스로 저절로 옮긴 것(따라가기는 act를 그대로 둔다). 누르지 않았으니 잇지 않고, Old가 마지막이 아니면 숨은 확정도 없다
  ["20 both, New moved on by itself, act null", state(open(), sentence(), { act: null }), want("new", { kind: "link", result: [t], isEnter: false }, null, 4, "none")],
  ["21 both, Old moved on by a save, act null", state(open(), sentence(), { act: null, last: "old" }), want("old", { kind: "link", result: [t], isEnter: false }, null, 4, "confirm")],
  ["22 a New sentence only, act null", state(null, sentence(), { act: null }), want("new", null, "old", 4, "none")],
  ["23 already linked, New last, act null", state(linked([t]), sentence(), { act: null }), want("new", { kind: "unlink", result: [], isEnter: false }, null, 4, "none")],
  ["24 without a source, the next New sentence picked after a link", state(linked([s]), sentence(), { mode: "unsourced", act: null }), want("new", { kind: "replace", result: [t], isEnter: false }, null, 4, "none")],
  ["25 without a source, the next New sentence pressed", state(linked([s]), sentence(), { mode: "unsourced" }), want("new", { kind: "replace", result: [t], isEnter: true }, null, 4, "link")],
];

describe("buildPickBar", () => {
  it.each(CASES)("%s", (_, input, expected) => expect(summary(buildPickBar(input))).toEqual(expected));

  it("marks Enter on exactly one of the bar and the primary", () => {
    for (const [, input] of CASES) {
      const bar = buildPickBar(input);
      expect(bar.link?.isEnter ?? false).toBe(bar.enter.kind === "link");
    }
  });
  it("offers the linked rows and unlinking only when there are links", () => {
    expect(buildPickBar(state(linked([s]), null, { last: "old" })).more).toEqual(["show_linked", "unlink", "tools"]);
    expect(buildPickBar(state(open(), null, { last: "old" })).more).toEqual(["tools"]);
    expect(buildPickBar(state(null, sentence({ hasSources: true }))).more).toEqual(["show_linked", "unlink", "tools"]);
    // 양쪽을 고르면 끊기는 단추 줄의 잇기가 맡는다
    expect(buildPickBar(state(linked([s]), sentence(), { last: "old" })).more).toEqual(["show_linked", "tools"]);
  });
  it("keeps the other tools in the more menu of a cell", () => expect(buildPickBar(state(open(), sentence(), { isCell: true })).more).toEqual(["tools"]));
  it("does not stop unlinking for a blocked row", () => expect(buildPickBar(state(linked([t], { blockKey: "assign.ref.checkFirst" }), sentence())).link?.reasonKey).toBeNull());
  it("puts the bar under the box pressed last", () => {
    expect(buildPickBar(state(open(), sentence(), { last: "old" })).at).toEqual({ side: "old", unitId: 3 });
    expect(buildPickBar(state(open(), sentence())).at).toEqual({ side: "new", unitId: 700 });
  });
});

describe("resolveMoreClick", () => {
  it("opens the shaping menu straight away when Other shaping is all ⋯ holds", () => {
    expect(resolveMoreClick(["tools"], [])).toBe("tools");
    expect(isMoreOnlyTools(buildPickBar(state(open(), null, { last: "old" })).more)).toBe(true);
  });
  it("goes through the list when a tool is folded away or there is more than Other shaping", () => {
    expect(resolveMoreClick(["tools"], ["pair"])).toBe("list");
    expect(resolveMoreClick(["show_linked", "tools"], [])).toBe("list");
    expect(isMoreOnlyTools(buildPickBar(state(linked([t]), null, { last: "old" })).more)).toBe(false);
  });
});
