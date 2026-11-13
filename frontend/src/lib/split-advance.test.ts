// 경계 확인 뒤 넘어가기 - 바뀜을 다 본 뒤 넘어가고, 움직임 줄이기·Enter 건너뛰기·늦은 응답이면 바로 넘어간다.
import { describe, expect, it } from "vitest";

import { getAdvanceDelay, getAdvanceWait, parseDurationMs } from "./split-advance";

describe("parseDurationMs", () => {
  it("reads ms and s values", () => {
    expect(parseDurationMs("240ms")).toBe(240);
    expect(parseDurationMs(" 0.24s ")).toBe(240);
  });

  it("treats unreadable or zero values as no wait", () => {
    expect(parseDurationMs("")).toBe(0);
    expect(parseDurationMs("0ms")).toBe(0);
    expect(parseDurationMs("fast")).toBe(0);
  });
});

describe("getAdvanceDelay", () => {
  it("covers the action bar turning off and back on", () => {
    expect(getAdvanceDelay(240, false)).toBe(552);
  });

  it("does not wait with reduced motion", () => {
    expect(getAdvanceDelay(240, true)).toBe(0);
    expect(getAdvanceDelay(0, false)).toBe(0);
  });
});

describe("getAdvanceWait", () => {
  it("waits for the rest of the flip after a quick save", () => {
    expect(getAdvanceWait(552, 120, false)).toBe(432);
  });

  it("moves at once after a slow save or a second Enter", () => {
    expect(getAdvanceWait(552, 900, false)).toBe(0);
    expect(getAdvanceWait(552, 120, true)).toBe(0);
  });
});
