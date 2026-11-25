// 글쇠로 번호 칸을 다룬다 - ⇧N은 그 줄의 번호 칸 창을 열고, Tab · ⇧Tab은 창의 ◀ ▶와 같은 값을 저장한다(명세 2026-11-23-assign-feedback-2 B2-R5).
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DocumentView, ViewBlock, ViewUnit } from "@/lib/api-sop";
import { LangProvider } from "@/lib/i18n";
import { buildPaperModel } from "@/lib/paper-model";

import { Paper, type PaperNumberHandle } from "./paper";

// 5 → 5.1 → • → • → 번호 없음(1 ~ 5), 6은 번호 칸이 없다
const VALUES: Record<number, string | null> = { 1: "5", 2: "5.1", 3: "•", 4: "•", 5: null };
const IDS = [1, 2, 3, 4, 5, 6];

function makeModel() {
  const blocks = IDS.map((id): ViewBlock => ({
    id, seq: id, text: `Line ${id}`, part: "body", kind: "paragraph", page: 1, page_basis: "estimated", section_label: "", heading_level: null,
    table_id: null, row_index: null, col_index: null, grid_span: 1, row_span: 1, flags: [], has_image: false, part_group: "body",
  }));
  const numberOf = (id: number) => (id in VALUES ? ({ value: VALUES[id], read: VALUES[id], source: "auto", is_set: false, content_start: 0, from_text: false, note: null } as never) : null);
  const units = IDS.map((id): ViewUnit => ({
    id, display_id: `D-${id}`, kind: "sentence", spans: [[id, 0, 6]], text: `Line ${id}`, lang: "en", number: numberOf(id), table_id: null, row_index: null, group_unit_id: null,
    status: "unassigned", pair_id: null, pos_seq: id, block_id: id, is_edited: false, can_unmerge: false, split_suggestion_id: null, ref: null, caption_refs: [],
  }));
  const view: DocumentView = {
    document: {} as DocumentView["document"], extraction: null, has_number_ranges: true, tables: [], blocks, units, pairs: [], part_groups: [], edits: { can_undo: false, can_redo: false },
  };
  return buildPaperModel(view);
}

let host: HTMLDivElement;
let root: Root;
let handle: PaperNumberHandle | null = null;
const onSave = vi.fn();
const onIndent = vi.fn();

async function render() {
  await act(async () =>
    root.render(
      createElement(LangProvider, null, createElement(Paper, {
        model: makeModel(), selectedId: 2, onUnitClick: () => undefined, testId: "p", strips: { statusOf: () => undefined },
        numberCell: {
          busy: false, onSave, onIndent,
          handleRef: (value: PaperNumberHandle | null) => {
            handle = value;
          },
        },
      })),
    ),
  );
}
const press = (testId: string) => act(async () => host.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)!.click());

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await render();
});

afterEach(async () => {
  await act(async () => root.unmount());
  expect(handle).toBeNull();
  host.remove();
  onSave.mockReset();
  onIndent.mockReset();
  vi.unstubAllGlobals();
});

describe("number keys on the paper", () => {
  it("steps a continuous number and renumbers what follows, like the arrows then OK", async () => {
    expect(handle!.requestIndent(2, -1)).toBe("done");
    expect(onSave).toHaveBeenLastCalledWith(2, "6", true);
    await press("p-num-2");
    await press("p-num-outdent");
    await press("p-number-cell-ok");
    expect(onSave.mock.lastCall?.slice(0, 3)).toEqual([2, "6", true]);
  });
  it("saves the indent of other lines with the run that follows, like the arrows", async () => {
    expect(handle!.requestIndent(3, 1)).toBe("end");
    expect(handle!.requestIndent(3, -1)).toBe("done");
    const byKey = onIndent.mock.lastCall;
    await press("p-num-3");
    await press("p-num-outdent");
    expect(onIndent).toHaveBeenCalledTimes(2);
    expect(onIndent.mock.lastCall).toEqual(byKey);
    expect(byKey?.[0].batch.map((change: { unitId: number }) => change.unitId)).toContain(4);
    expect(byKey?.slice(1)).toEqual([-1, "D-3"]);
  });
  it("says the end without saving", () => {
    expect(handle!.requestIndent(1, -1)).toBe("end");
    expect(onSave).not.toHaveBeenCalled();
    expect(onIndent).not.toHaveBeenCalled();
  });
  it("opens the number cell of a line, and leaves lines without one alone", async () => {
    await act(async () => void handle!.openNumber(2));
    expect(host.querySelector('[data-testid="p-num-edit-2"]')).not.toBeNull();
    expect(host.querySelector<HTMLInputElement>('[data-testid="p-num-input"]')?.value).toBe("5.1");
    expect(handle!.openNumber(6)).toBe(false);
    expect(handle!.requestIndent(6, 1)).toBeNull();
    expect(handle!.requestIndent(99, 1)).toBeNull();
  });
});
