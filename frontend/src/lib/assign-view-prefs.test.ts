// Assign 보기 설정 - 문서별 확대와 폭을 사람마다 브라우저에 기억한다. 저장소가 없거나 값이 이상하면 기본값.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readAssignView, writeAssignView } from "./assign-view-prefs";

describe("assign view prefs", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("reads defaults when nothing is stored", () => {
    expect(readAssignView()).toEqual({ zoomOld: 1, zoomNew: 1, split: 0.5, lines: true, single: false, newAiOnly: false });
  });

  it("round-trips stored values", () => {
    writeAssignView({ zoomNew: 1.2, split: 0.6, lines: true });
    expect(readAssignView()).toEqual({ zoomOld: 1, zoomNew: 1.2, split: 0.6, lines: true, single: false, newAiOnly: false });
  });

  it("remembers turning the link lines off", () => {
    writeAssignView({ lines: false });
    expect(readAssignView().lines).toBe(false);
    writeAssignView({ lines: true });
    expect(readAssignView().lines).toBe(true);
  });

  it("remembers the one-document view", () => {
    writeAssignView({ single: true });
    expect(readAssignView().single).toBe(true);
    writeAssignView({ single: false, newAiOnly: false });
    expect(readAssignView().single).toBe(false);
  });

  it("remembers the New-side AI filter, off until it is turned on", () => {
    expect(readAssignView().newAiOnly).toBe(false);
    writeAssignView({ newAiOnly: true });
    expect(window.localStorage.getItem("sopa.assign.newAiOnly")).toBe("1");
    expect(readAssignView().newAiOnly).toBe(true);
  });

  it("clamps out-of-range and junk values", () => {
    window.localStorage.setItem("sopa.assign.zoomOld", "3");
    window.localStorage.setItem("sopa.assign.split", "abc");
    expect(readAssignView()).toEqual({ zoomOld: 1.6, zoomNew: 1, split: 0.5, lines: true, single: false, newAiOnly: false });
  });

  it("falls back to defaults when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readAssignView()).toEqual({ zoomOld: 1, zoomNew: 1, split: 0.5, lines: true, single: false, newAiOnly: false });
  });
});
