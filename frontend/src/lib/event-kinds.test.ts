// 사건 종류 - 아이콘과 History 필터 묶음. 모르는 종류는 Bundle 묶음으로 둔다.
import { describe, expect, it } from "vitest";

import { getEventGroup, getEventIcon } from "./event-kinds";

describe("getEventGroup", () => {
  it("groups by the action prefix", () => {
    expect(getEventGroup("ai.request")).toBe("ai");
    expect(getEventGroup("document.upload")).toBe("document");
    expect(getEventGroup("unit.edit")).toBe("document");
    expect(getEventGroup("group.confirm")).toBe("decision");
    expect(getEventGroup("review.return")).toBe("review");
    expect(getEventGroup("bundle.members")).toBe("bundle");
  });

  it("falls back to bundle for unknown actions", () => {
    expect(getEventGroup("something.new")).toBe("bundle");
  });
});

describe("getEventIcon", () => {
  it("returns an icon for every action, known or not", () => {
    expect(getEventIcon("bundle.update")).toBeTruthy();
    expect(getEventIcon("mystery")).toBeTruthy();
  });
});
