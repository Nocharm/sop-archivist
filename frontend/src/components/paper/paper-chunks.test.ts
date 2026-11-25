// 용지 덩어리 그리기 - 필터로 접힌 목록도 덩어리이고, 화면에서 먼 덩어리는 그 안이 그대로면 다시 그리지 않는다.
import { act, createElement, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DocumentView, ViewBlock, ViewUnit } from "@/lib/api-sop";
import { LangProvider } from "@/lib/i18n";
import { EMPTY_FOLD_OPEN, type FoldOpen } from "@/lib/paper-fold-model";
import { buildPaperModel } from "@/lib/paper-model";

import { Paper } from "./paper";

const COUNT = 200;
const IDS = Array.from({ length: COUNT }, (_, at) => at + 1);

function makeModel() {
  const blocks = IDS.map((id): ViewBlock => ({
    id, seq: id, text: `Line ${id}`, part: "body", kind: "paragraph", page: 1, page_basis: "estimated", section_label: "", heading_level: null,
    table_id: null, row_index: null, col_index: null, grid_span: 1, row_span: 1, flags: [], has_image: false, part_group: "body",
  }));
  const units = IDS.map((id): ViewUnit => ({
    id, display_id: `D-${id}`, kind: "sentence", spans: [[id, 0, `Line ${id}`.length]], text: `Line ${id}`, lang: "en", number: null, table_id: null, row_index: null, group_unit_id: null,
    status: "unassigned", pair_id: null, pos_seq: id, block_id: id, is_edited: false, can_unmerge: false, split_suggestion_id: null, ref: null, caption_refs: [],
  }));
  const view: DocumentView = {
    document: {} as DocumentView["document"], extraction: null, has_number_ranges: false, tables: [], blocks, units, pairs: [], part_groups: [], edits: { can_undo: false, can_redo: false },
  };
  return buildPaperModel(view);
}

const model = makeModel();
const onUnitClick = () => undefined;
const onOpenChange = () => undefined;
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
}

let host: HTMLDivElement;
let root: Root;
let current: Shown | null = null;
let notify = () => undefined as void;
const subscribe = (listener: () => void) => {
  notify = listener;
  return () => undefined;
};

/** 바뀌는 값은 LangProvider 안에서 받는다 - 바깥을 다시 그리면 문구 함수(t)가 새것이라 모든 덩어리가 다시 그려진다 */
function Screen() {
  const shown = useSyncExternalStore(subscribe, () => current);
  return shown && createElement(Paper, { model, selectedId: shown.selectedId, onUnitClick, testId: "p", strips: { statusOf, ...shown.strips } });
}

async function render(strips: Strips, selectedId: number | null = null) {
  drawn.length = 0;
  await act(async () => {
    current = { strips, selectedId };
    notify();
  });
  // 화면 가까운 덩어리 재기(requestAnimationFrame)까지
  await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
}

const fold = (matchIds: ReadonlySet<number>, open: FoldOpen = EMPTY_FOLD_OPEN) => ({ matchIds, open, onOpenChange });
const listChunkUnits = () =>
  [...host.querySelectorAll(".strip-chunk")].map((chunk) => [...chunk.querySelectorAll('[data-testid^="p-piece-"]')].map((el) => Number(el.getAttribute("data-strip-unit"))));
const listFar = () => [...new Set(drawn)].filter((id) => id > 80).sort((a, b) => a - b);

beforeEach(() => {
  current = null;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
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

  it("draws a far chunk again when its own rows change", async () => {
    const some = new Set(IDS.filter((id) => id !== 150));
    await render({ fold: fold(some) }, 1);
    await render({ fold: fold(some, { runs: new Set(), peeks: new Set(["u150-150-0"]) }) }, 1);
    expect(host.querySelector('[data-testid="p-piece-150"]')).not.toBeNull();
  });
});
