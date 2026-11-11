// Assign 보기 설정 - 문서별 확대와 폭을 사람마다 브라우저에 기억한다. 저장소가 없거나 값이 이상하면 기본값.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readAssignView, writeAssignView } from "./assign-view-prefs";

describe("assign view prefs", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("reads defaults when nothing is stored", () => {
    expect(readAssignView()).toEqual({ zoomOld: 1, zoomNew: 1, split: 0.5, lines: true });
  });

  it("round-trips stored values", () => {
    writeAssignView({ zoomNew: 1.2, split: 0.6, lines: true });
    expect(readAssignView()).toEqual({ zoomOld: 1, zoomNew: 1.2, split: 0.6, lines: true });
  });

  it("remembers turning the link lines off", () => {
    writeAssignView({ lines: false });
    expect(readAssignView().lines).toBe(false);
    writeAssignView({ lines: true });
    expect(readAssignView().lines).toBe(true);
  });

  it("clamps out-of-range and junk values", () => {
    window.localStorage.setItem("sopa.assign.zoomOld", "3");
    window.localStorage.setItem("sopa.assign.split", "abc");
    expect(readAssignView()).toEqual({ zoomOld: 1.6, zoomNew: 1, split: 0.5, lines: true });
  });

  it("falls back to defaults when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readAssignView()).toEqual({ zoomOld: 1, zoomNew: 1, split: 0.5, lines: true });
  });
});
