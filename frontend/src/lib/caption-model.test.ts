// 캡션 규칙 - 캡션이 필요한 묶음을 처리와 입구 2에 따라 가른다.
import { describe, expect, it } from "vitest";

import { isCaptionNeeded } from "./caption-model";

describe("isCaptionNeeded", () => {
  it("needs a caption for an undecided, held or assigned bundle without one", () => {
    expect(isCaptionNeeded({ hasCaption: false, disposition: "unassigned", isLinkedToWritten: false })).toBe(true);
    expect(isCaptionNeeded({ hasCaption: false, disposition: "assigned", isLinkedToWritten: false })).toBe(true);
    expect(isCaptionNeeded({ hasCaption: false, disposition: undefined, isLinkedToWritten: false })).toBe(true);
  });

  it("does not need one when the bundle has a caption, is deleted or moved, or is linked to a written New document", () => {
    expect(isCaptionNeeded({ hasCaption: true, disposition: "assigned", isLinkedToWritten: false })).toBe(false);
    expect(isCaptionNeeded({ hasCaption: false, disposition: "delete", isLinkedToWritten: false })).toBe(false);
    expect(isCaptionNeeded({ hasCaption: false, disposition: "move_external", isLinkedToWritten: false })).toBe(false);
    expect(isCaptionNeeded({ hasCaption: false, disposition: "assigned", isLinkedToWritten: true })).toBe(false);
  });
});
