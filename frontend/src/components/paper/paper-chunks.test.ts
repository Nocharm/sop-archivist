// 용지 덩어리 그리기 - 필터로 접힌 목록도 덩어리이고, 화면에서 먼 덩어리는 그 안이 그대로면 다시 그리지 않는다.
import { act, createElement, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DocumentView, ViewBlock, ViewUnit } from "@/lib/api-sop";
import { LangProvider } from "@/lib/i18n";
import { CHUNK_CARDS } from "@/lib/paper-chunk-model";
import { EMPTY_FOLD_OPEN, type FoldOpen } from "@/lib/paper-fold-model";
import { buildPaperModel, type PaperModel } from "@/lib/paper-model";

import { Paper, type QueueChip } from "./paper";

// 카드 수백 장을 통째로 그리는 시험이라 바쁜 기계(CI)에서 기본 5초를 넘는다 - 시간은 단언이 아니다
vi.setConfig({ testTimeout: 30_000 });

const COUNT = 200;
const IDS = Array.from({ length: COUNT }, (_, at) => at + 1);
/** 벗긴 표(줄 160 · 161 - 4번째 덩어리의 끝과 5번째의 첫 줄)와 아직 표인 것(150) */
const UNWRAPPED = 7;
const TABLE = 8;

interface ModelOptions {
  texts?: Record<number, string>;
  blocks?: (id: number) => Partial<ViewBlock>;
  units?: (id: number) => Partial<ViewUnit>;
  tables?: DocumentView["tables"];
  hasNumbers?: boolean;
}

function makeModel({ texts = {}, blocks: blockOf, units: unitOf, tables = [], hasNumbers = false }: ModelOptions = {}) {
  const textOf = (id: number) => texts[id] ?? `Line ${id}`;
  const blocks = IDS.map((id): ViewBlock => ({
    id, seq: id, text: textOf(id), part: "body", kind: "paragraph", page: 1, page_basis: "estimated", section_label: "", heading_level: null,
    table_id: null, row_index: null, col_index: null, grid_span: 1, row_span: 1, flags: [], has_image: false, part_group: "body", ...blockOf?.(id),
  }));
  const units = IDS.map((id): ViewUnit => ({
    id, display_id: `D-${id}`, kind: "sentence", spans: [[id, 0, textOf(id).length]], text: textOf(id), lang: "en", number: null, table_id: null, row_index: null, group_unit_id: null,
    status: "unassigned", pair_id: null, pos_seq: id, block_id: id, is_edited: false, can_unmerge: false, split_suggestion_id: null, ref: null, caption_refs: [], ...unitOf?.(id),
  }));
  const view: DocumentView = {
    document: {} as DocumentView["document"], extraction: null, has_number_ranges: hasNumbers, tables, blocks, units, pairs: [], part_groups: [], edits: { can_undo: false, can_redo: false },
  };
  return buildPaperModel(view);
}

const model = makeModel();
/** 제목에서 바꾼 문장 160 · 161 - 묶음 하나가 두 덩어리에 걸친다 */
const shiftModel = makeModel({ units: (id) => (id === 160 || id === 161 ? { from_heading: true } : {}) });
const tableModel = makeModel({
  blocks: (id) => (id === 160 || id === 161 ? { kind: "table_cell", table_id: UNWRAPPED, row_index: id - 160, col_index: 0 } : id === 150 ? { kind: "table_cell", table_id: TABLE, row_index: 0, col_index: 0 } : {}),
  units: (id) => (id === 160 || id === 161 ? { kind: "cell_sentence", table_id: UNWRAPPED, row_index: id - 160 } : id === 150 ? { kind: "table", spans: [], table_id: TABLE } : {}),
  tables: [
    { id: UNWRAPPED, table_index: 0, parent_table_id: null, part: "body", n_rows: 2, n_cols: 1, is_layout: true, is_band: false, anchor: null },
    { id: TABLE, table_index: 1, parent_table_id: null, part: "body", n_rows: 1, n_cols: 1, is_layout: false, is_band: false, anchor: null },
  ],
});
const numberModel = makeModel({ hasNumbers: true, units: (id) => ({ number: { value: String(id), read: String(id), source: "auto", is_set: false, content_start: 0, from_text: false, note: null } as never }) });
/** 저절로 삭제된 블록 둘 - 2 · 3(가까운 덩어리)과 140~149(먼 4번째 덩어리, 표 하나와 용지 줄이 없는 그 표의 안쪽 표 900) */
const NOISE_IDS = IDS.filter((id) => id >= 140 && id < 150);
const INNER = 900;
const makeNoiseModel = (reason = "") => {
  const noise = makeModel({ units: (id) => (id === 2 || id === 3 || NOISE_IDS.includes(id) ? { noise_kind: "front", noise_reason: reason } : {}) });
  const inner: ViewUnit = { ...noise.units.get(145)!, id: INNER, kind: "table", spans: [], text: "", pos_seq: 145 };
  return { ...noise, units: new Map([...noise.units, [INNER, inner]]) };
};
const noiseModel = makeNoiseModel();
const onUnitClick = () => undefined;
const onOpenChange = vi.fn();
/** 그린 단위 - describeTab(앞머리)이 부르는 statusOf로 센다 */
const drawn: number[] = [];
const statusOf = (id: number) => {
  drawn.push(id);
  return undefined;
};

type Strips = NonNullable<Parameters<typeof Paper>[0]["strips"]>;

interface Shown {
  strips: Strips;
  selectedId: number | null;
  model: PaperModel;
  expected: ReadonlyMap<number, string | null> | undefined;
}

let host: HTMLDivElement;
let root: Root;
/** 다음 프레임에 할 일 - 시계에 맡기면 기계가 바쁠 때 재기가 act 밖으로 샌다 */
const frames: FrameRequestCallback[] = [];
let current: Shown | null = null;
let notify = () => undefined as void;
const subscribe = (listener: () => void) => {
  notify = listener;
  return () => undefined;
};

/** 바뀌는 값은 LangProvider 안에서 받는다 - 바깥을 다시 그리면 문구 함수(t)가 새것이라 모든 덩어리가 다시 그려진다 */
function Screen() {
  const shown = useSyncExternalStore(subscribe, () => current);
  return shown && createElement(Paper, {
    model: shown.model, selectedId: shown.selectedId, onUnitClick, testId: "p", strips: { statusOf, ...shown.strips },
    numberCell: { busy: false, expected: shown.expected, onSave: () => undefined, onIndent: () => undefined },
  });
}

async function render(strips: Strips, selectedId: number | null = null, more: Partial<Shown> = {}) {
  drawn.length = 0;
  await act(async () => {
    current = { strips, selectedId, model, expected: undefined, ...more };
    notify();
  });
  // 화면 가까운 덩어리 재기까지 - 다음 프레임을 손으로 돌린다
  await act(async () => {
    for (const run of frames.splice(0)) run(0);
  });
}

const fold = (matchIds: ReadonlySet<number>, open: FoldOpen = EMPTY_FOLD_OPEN) => ({ matchIds, open, onOpenChange });
const listChunkUnits = () =>
  [...host.querySelectorAll(".strip-chunk")].map((chunk) => [...chunk.querySelectorAll('[data-testid^="p-piece-"]')].map((el) => Number(el.getAttribute("data-strip-unit"))));
const pieceOf = (id: number) => host.querySelector(`[data-testid="p-piece-${id}"]`);
const getButton = (testId: string) => host.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
/** 4번째 덩어리(줄 121~160) · 5번째(161~200) */
const FOURTH = IDS.slice(120, 160);
const FIFTH = IDS.slice(160);
const listFar = () => [...new Set(drawn)].filter((id) => id > 80).sort((a, b) => a - b);

beforeEach(() => {
  current = null;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  frames.length = 0;
  vi.stubGlobal("requestAnimationFrame", (run: FrameRequestCallback) => frames.push(run));
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  // 덩어리마다 1,000px씩 - 보이는 칸(창 높이 768)과 그 위아래 한 화면에는 0 · 1번 덩어리만 걸친다
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const at = [...document.querySelectorAll(".strip-chunk")].indexOf(this);
    return { top: at * 1000, bottom: at * 1000 + 999, left: 0, right: 0, width: 0, height: 999, x: 0, y: at * 1000, toJSON: () => null } as DOMRect;
  });
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  act(() => root.render(createElement(LangProvider, null, createElement(Screen))));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("a folded list", () => {
  const all = new Set(IDS);

  it("is drawn in chunks with the gap of each chunk's first card kept", async () => {
    await render({ fold: fold(all) });
    expect(listChunkUnits().map((ids) => ids.length)).toEqual([40, 40, 40, 40, 40]);
    expect(host.querySelectorAll(".strip-chunk[data-fold]")).toHaveLength(5);
    // 칸마다 앞 틈 - 덩어리 첫 카드도 앞 덩어리의 끝 줄과 틈을 둔다
    expect(host.querySelectorAll(".strip-gap")).toHaveLength(COUNT - 1);
    expect(host.querySelectorAll(".strip-chunk")[1].firstElementChild?.className).toBe("strip-gap");
  });

  it("keeps far chunks as they are when the selection moves near by", async () => {
    await render({ fold: fold(all) }, 1);
    await render({ fold: fold(new Set(IDS)) }, 2);
    expect(listFar()).toEqual([]);
    expect(drawn).toContain(2);
  });

  it("draws a far chunk again when only the match list changes its rows", async () => {
    await render({ fold: fold(new Set(IDS)) }, 1);
    await render({ fold: fold(new Set(IDS.filter((id) => id !== 150))) }, 1);
    expect(pieceOf(150)).toBeNull();
    expect(getButton("p-fold-line-u150-150-0")).not.toBeNull();
    // 첫 줄이 한 줄 판이 된 덩어리 - 그 뒤 덩어리의 첫 틈도 사라진다
    await render({ fold: fold(new Set(IDS.filter((id) => id !== 160))) }, 1);
    expect(listFar()).toEqual(expect.arrayContaining([...FOURTH, ...FIFTH]));
    expect(host.querySelectorAll(".strip-chunk")[4].firstElementChild?.className).not.toBe("strip-gap");
  });

  it("draws a far chunk again when the text under it changes", async () => {
    const strips = { fold: fold(new Set(IDS)) };
    await render(strips, 1);
    await render(strips, 1, { model: makeModel({ texts: { 150: "Changed" } }) });
    expect(pieceOf(150)?.textContent).toContain("Changed");
  });

  it("opens a far line on top of what is open now", async () => {
    const some = new Set(IDS.filter((id) => id !== 5 && id !== 190));
    await render({ fold: fold(some) }, 1);
    await render({ fold: fold(some, { runs: new Set(), peeks: new Set(["u5-5-0"]) }) }, 1);
    await act(async () => getButton("p-fold-line-u190-190-0")?.click());
    expect(onOpenChange).toHaveBeenLastCalledWith({ runs: new Set(), peeks: new Set(["u5-5-0", "u190-190-0"]) });
  });

  it("stays in chunks when a box picked inside a run makes the list longer", async () => {
    // 접힌 119칸(한 덩어리) → 고른 줄이 묶음을 갈라 121칸
    const some = new Set(IDS.filter((id) => id <= 117));
    await render({ fold: fold(some) }, 1);
    const first = IDS.slice(0, CHUNK_CARDS);
    const before = first.map(pieceOf);
    await render({ fold: fold(some) }, 150);
    expect(host.querySelectorAll(".strip-chunk").length).toBeGreaterThan(1);
    expect(first.filter((id, at) => pieceOf(id) !== before[at])).toEqual([]);
  });

  it.each([
    // 접힌 62칸(한 덩어리) → 펼쳐 200칸
    ["a long run at the end", (id: number) => id <= 60, "u62-62-0"],
    // 첫 덩어리 안 묶음 - 뒤 덩어리의 경계가 밀리지 않는다
    ["a short run in the first chunk", (id: number) => id < 5 || id > 20, "u6-6-0"],
  ])("keeps every card where it was when %s opens and closes", async (_, isMatch, runKey) => {
    const some = new Set(IDS.filter(isMatch));
    await render({ fold: fold(some) }, 1);
    const before = new Map([...some].map((id) => [id, pieceOf(id)]));
    expect(getButton(`p-fold-run-${runKey}`)).not.toBeNull();
    await render({ fold: fold(some, { runs: new Set([runKey]), peeks: new Set() }) }, 1);
    expect(getButton(`p-fold-head-${runKey}`)).not.toBeNull();
    expect([...some].filter((id) => pieceOf(id) !== before.get(id))).toEqual([]);
    await render({ fold: fold(some) }, 1);
    expect([...some].filter((id) => pieceOf(id) !== before.get(id))).toEqual([]);
  });
});

describe("what changes with every key", () => {
  type Pending = NonNullable<Strips["pending"]>;
  const pending = (part: Partial<Pending>): Pending => ({ shimmerIds: new Set(), lockedIds: new Set(), pills: [], waits: new Map(), ...part });
  const pill = (place: Pending["pills"][number]["place"]) => pending({ pills: [{ id: "a", kind: "merge", label: "Working…", place }] });
  const foldsAt = (id: number, isPending?: true) => new Map([[id, { rowKey: `u${id}`, remark: "", kind: "text" as const, lang: "en" as const, text: `Line ${id}`, ...(isPending ? { isPending } : {}) }]]);
  const lists: Array<[string, Strips]> = [["the whole list", {}], ["a folded list", { fold: fold(new Set(IDS)) }]];
  // 덩어리 그리기에 쓰는 값이 저마다 제 몫으로 걸린다 - 한 번에 하나만 바꾼다
  const changes: Array<[string, (id: number) => [Strips, Partial<Shown>?]]> = [
    ["a shimmer", (id) => [{ pending: pending({ shimmerIds: new Set([id]) }) }]],
    ["a lock", (id) => [{ pending: pending({ lockedIds: new Set([id]) }) }]],
    ["a wait", (id) => [{ pending: pending({ waits: new Map([[id, { kind: "save", text: "Queued · Delete" }]]) }) }]],
    ["a deleted line", (id) => [{ deleted: { folds: foldsAt(id) } }]],
    ["a number being saved", (id) => [{}, { expected: new Map([[id, "9.9"]]) }]],
  ];
  const cases = lists.flatMap(([name, list]) => changes.map(([change, make]) => ({ name, list, change, make })));

  it.each(cases)("$change near by leaves the far chunks of $name alone", async ({ list, make }) => {
    const [strips, more] = make(2);
    await render({ ...list, deleted: { folds: new Map() } }, 1);
    await render({ ...list, deleted: { folds: new Map() }, ...strips }, 1, more);
    expect(listFar()).toEqual([]);
  });

  it.each(cases)("$change far away draws its own chunk of $name", async ({ list, make }) => {
    const [strips, more] = make(150);
    await render({ ...list, deleted: { folds: new Map() } }, 1);
    await render({ ...list, deleted: { folds: new Map() }, ...strips }, 1, more);
    // 접힌 삭제 줄의 박스(150)는 그리지 않는다
    const own = (ids: number[]) => ids.filter((id) => id !== 150);
    expect(own(listFar())).toEqual(own(FOURTH));
  });

  it("draws the dashed preview on the two boxes of an armed merge and takes it back", async () => {
    await render({}, 1);
    expect(host.querySelectorAll("[data-merge-arm]").length).toBe(0);
    await render({ mergeArm: { fromId: 2, toId: 3 } }, 1);
    expect([...host.querySelectorAll("[data-merge-arm]")].map((el) => el.getAttribute("data-strip-unit"))).toEqual(["2", "3"]);
    await render({}, 1);
    expect(host.querySelectorAll("[data-merge-arm]").length).toBe(0);
  });

  it("shows a far number being saved and takes it back", async () => {
    const arg = { model: numberModel };
    const read = () => host.querySelector('[data-testid="p-num-150"]')?.textContent;
    await render({}, 1, arg);
    expect(read()).toContain("150");
    await render({}, 1, { ...arg, expected: new Map([[150, "9.9"]]) });
    expect(read()).toContain("9.9");
    expect(listFar()).toEqual(FOURTH);
    await render({}, 1, arg);
    expect(read()).toContain("150");
  });

  it("unfolds a far delete that was dropped", async () => {
    await render({ deleted: { folds: foldsAt(150, true) } }, 1);
    expect(getButton("p-deleted-u150")).not.toBeNull();
    await render({ deleted: { folds: new Map() } }, 1);
    expect(listFar()).toEqual(FOURTH);
    expect(host.querySelector(".deleted-release")).not.toBeNull();
  });

  it.each(lists)("puts the pill of a gap between two chunks of %s in the lower one", async (_, list) => {
    await render(list, 1);
    await render({ ...list, pending: pill({ at: "gap", firstId: 160, secondId: 161 }) }, 1);
    expect(host.querySelector('[data-testid^="p-gap-u161"] [data-testid="p-pending"]')).not.toBeNull();
    await render(list, 1);
    expect(host.querySelector('[data-testid="p-pending"]')).toBeNull();
  });

  it("puts a table's pill on the table, or on the head of an unwrapped one", async () => {
    const strips: Strips = { unwrap: { canRewrap: true, busy: false, onRewrap: () => undefined } };
    await render(strips, 1, { model: tableModel });
    await render({ ...strips, pending: pill({ at: "table", tableId: TABLE }) }, 1, { model: tableModel });
    expect(pieceOf(150)?.querySelector('[data-testid="p-pending"]')).not.toBeNull();
    await render(strips, 1, { model: tableModel });
    expect(host.querySelector('[data-testid="p-pending"]')).toBeNull();
    await render({ ...strips, pending: pill({ at: "table", tableId: UNWRAPPED }) }, 1, { model: tableModel });
    expect(host.querySelector(`[data-testid="p-unwrap-head-${UNWRAPPED}"] [data-testid="p-pending"]`)).not.toBeNull();
    expect(listFar()).toEqual(FOURTH);
  });

  it("turns off a head's button when a member in another chunk is locked", async () => {
    // 머리는 4번째 덩어리(160 위), 잠긴 줄 161은 5번째
    const locked = pending({ lockedIds: new Set([161]) });
    const shift: Strips = { headingShift: { canRevert: true, busy: false, onRevert: () => undefined } };
    await render(shift, 1, { model: shiftModel });
    expect(getButton("p-shift-revert-160")?.disabled).toBe(false);
    await render({ ...shift, pending: locked }, 1, { model: shiftModel });
    expect(getButton("p-shift-revert-160")?.disabled).toBe(true);

    const unwrap: Strips = { unwrap: { canRewrap: true, busy: false, onRewrap: () => undefined } };
    await render(unwrap, 1, { model: tableModel });
    expect(getButton(`p-rewrap-${UNWRAPPED}`)?.disabled).toBe(false);
    await render({ ...unwrap, pending: locked }, 1, { model: tableModel });
    expect(getButton(`p-rewrap-${UNWRAPPED}`)?.disabled).toBe(true);
  });
});

describe("what a screen lays over the boxes", () => {
  type Overlay = NonNullable<Strips["overlay"]>;
  /** 박스마다 얹은 글 하나 - 키도 그 글 */
  const overlay = (marks: Record<number, string>, folded: number[] = []): Overlay => ({
    isFolded: (id) => folded.includes(id),
    keyOf: (ids) => [...ids].flatMap((id) => (marks[id] || folded.includes(id) ? `${id}:${marks[id]}:${folded.includes(id)}` : [])).join(";"),
    boxProps: (id) => (marks[id] ? { attrs: { "data-state": marks[id] } } : null),
    renderTop: () => null,
    renderFolded: () => null,
  });
  const readState = (id: number) => pieceOf(id)?.getAttribute("data-state") ?? null;

  it("leaves the far chunks alone when a box near by changes", async () => {
    await render({ overlay: overlay({ 2: "a", 150: "x" }) }, 1);
    await render({ overlay: overlay({ 2: "b", 150: "x" }) }, 1);
    expect(listFar()).toEqual([]);
    expect(readState(2)).toBe("b");
  });

  it("draws only the far chunk whose own box changed, and shows the change", async () => {
    await render({ overlay: overlay({ 150: "x" }) }, 1);
    await render({ overlay: overlay({ 150: "y" }) }, 1);
    expect(listFar()).toEqual(FOURTH);
    expect(readState(150)).toBe("y");
    await render({ overlay: overlay({}) }, 1);
    expect(readState(150)).toBeNull();
  });

  it("folds and unfolds a far card", async () => {
    await render({ overlay: overlay({}) }, 1);
    await render({ overlay: overlay({}, [150]) }, 1);
    expect(pieceOf(150)).toBeNull();
    await render({ overlay: overlay({}) }, 1);
    expect(pieceOf(150)).not.toBeNull();
  });
});

describe("automatically deleted blocks in a far chunk", () => {
  type Noise = NonNullable<Strips["noise"]>;
  const noise = (over: Partial<Noise> = {}): Noise => ({ canEdit: true, busy: false, onClear: () => undefined, onReason: () => undefined, open: new Set(), selected: null, onToggle: () => undefined, onPick: () => undefined, ...over });
  const arg = { model: noiseModel };
  const pending = (part: Partial<NonNullable<Strips["pending"]>>) => ({ shimmerIds: new Set<number>(), lockedIds: new Set<number>(), pills: [], waits: new Map<number, QueueChip>(), ...part });
  const isOpen = (key: number) => getButton(`p-noise-head-${key}`)?.getAttribute("aria-expanded") === "true";
  /** 4번째 덩어리의 조각 - 블록 하나가 한 칸이라 앞 블록만큼 한 줄, 이 블록만큼 아홉 줄 뒤로 밀린다 */
  const FAR = IDS.filter((id) => id >= 122 && id <= 170 && !NOISE_IDS.includes(id));
  const listDrawn = () => listFar().filter((id) => id > 81);

  it("opens, picks and folds - only its own chunk is drawn again", async () => {
    await render({ noise: noise() }, 1, arg);
    expect(isOpen(140)).toBe(false);
    await render({ noise: noise({ open: new Set([140]), selected: { key: 140, unitId: 141 } }) }, 1, arg);
    expect(isOpen(140)).toBe(true);
    expect(host.querySelectorAll(".mbtn.reveal")).toHaveLength(1);
    expect(listDrawn()).toEqual(FAR);
    await render({ noise: noise({ open: new Set([140]), selected: { key: 140, unitId: 142 } }) }, 1, arg);
    expect(getButton("p-noise-unit-clear-142")?.className).toContain("reveal");
    await render({ noise: noise() }, 1, arg);
    expect(isOpen(140)).toBe(false);
  });

  it("leaves the far chunks alone when a block near by opens and is picked", async () => {
    await render({ noise: noise() }, 1, arg);
    await render({ noise: noise({ open: new Set([2]), selected: { key: 2, unitId: 3 } }) }, 1, arg);
    expect(isOpen(2)).toBe(true);
    expect(listDrawn()).toEqual([]);
  });

  it.each([["a line", 143], ["an inner table that has no row of its own", INNER]])("turns its buttons off while %s is being written", async (_, id) => {
    await render({ noise: noise() }, 1, arg);
    expect(getButton("p-noise-clear-140")?.disabled).toBe(false);
    await render({ noise: noise(), pending: pending({ lockedIds: new Set([id]), pills: [{ id: "a", kind: "toc", label: "Saving…", place: { at: "box", unitId: id } }] }) }, 1, arg);
    expect(getButton("p-noise-clear-140")?.disabled).toBe(true);
    expect(getButton("p-noise-reason-140")?.disabled).toBe(true);
    expect(host.querySelector('[data-testid="p-noise-140"] [data-testid="p-pending"]')).not.toBeNull();
    expect(listDrawn()).toEqual(FAR);
    await render({ noise: noise() }, 1, arg);
    expect(getButton("p-noise-clear-140")?.disabled).toBe(false);
  });

  it("shows a reason written on it", async () => {
    await render({ noise: noise() }, 1, arg);
    expect(getButton("p-noise-head-140")?.textContent).toContain("Before chapter 1");
    await render({ noise: noise() }, 1, { model: makeNoiseModel("Not moved") });
    expect(getButton("p-noise-head-140")?.textContent).toContain("Reason: Not moved");
  });

  it("is drawn again when every block turns off or a reader takes over", async () => {
    await render({ noise: noise() }, 1, arg);
    await render({ noise: noise({ busy: true }) }, 1, arg);
    expect(getButton("p-noise-clear-140")?.disabled).toBe(true);
    await render({ noise: noise({ canEdit: false }) }, 1, arg);
    expect(getButton("p-noise-clear-140")).toBeNull();
  });

  it("keeps each peeked line of a folded list to itself", async () => {
    const list = new Set(IDS.filter((id) => !NOISE_IDS.includes(id) && id !== 2 && id !== 3));
    await render({ noise: noise(), fold: fold(list) }, 1, arg);
    await render({ noise: noise(), fold: fold(list, { runs: new Set(), peeks: new Set(["u2-2-0", "u3-3-0"]) }) }, 1, arg);
    expect([...host.querySelectorAll('[data-testid^="p-noise-head-"]')].map((el) => el.getAttribute("data-testid"))).toEqual(["p-noise-head-2", "p-noise-head-3"]);
  });
});
