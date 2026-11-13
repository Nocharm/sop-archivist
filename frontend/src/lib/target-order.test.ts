// 결과물 C 순서 바꾸기 - 칸 안에서 옮길 수 있는지(칸 끝이면 단추를 끈다). 옮긴 뒤의 순서·요청 목록은 c-edit-model이 짓는다.
import { describe, expect, it } from "vitest";

import type { OutputCItem } from "./api-sop";
import { canMoveTarget } from "./target-order";

function item(id: number, lang: string): OutputCItem {
  return { target_id: id, kind: "sentence", lang, text: `t${id}`, ai_text: "", change_type: null, status: "confirmed", source_note: "", origin: "units", meaning_key: null, number: null, indent_level: 0, number_style: "numbered", cell_row: null, cell_col: null, children: [] };
}

describe("canMoveTarget", () => {
  // 한 칸에 두 언어가 C 순서대로 한 목록이다
  const items = [item(11, "en"), item(1, "ko"), item(12, "en")];

  it("tells whether a move is possible inside the section", () => {
    expect(canMoveTarget(items, 11, -1)).toBe(false);
    expect(canMoveTarget(items, 11, 1)).toBe(true);
    expect(canMoveTarget(items, 12, 1)).toBe(false);
    expect(canMoveTarget(items, 99, 1)).toBe(false);
  });
});
