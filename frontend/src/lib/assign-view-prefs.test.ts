// Assign 보기 설정 - 문서별 확대와 폭을 사람마다 브라우저에 기억한다. 저장소가 없거나 값이 이상하면 기본값.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readAssignView, readSpacePreviewOpens, readSpaceSheetHeight, readSpaceTab, writeAssignView, writeSpacePreviewOpens, writeSpaceSheetHeight, writeSpaceTab } from "./assign-view-prefs";

const SIDE_DEFAULTS = { sideFloat: false, sideX: null, sideY: null, sideFolded: false };

describe("assign view prefs", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("reads defaults when nothing is stored", () => {
    expect(readAssignView()).toEqual({ zoomOld: 1, zoomNew: 1, split: 0.5, lines: true, single: false, newAiOnly: false, newTemplate: false, ...SIDE_DEFAULTS });
  });

  it("round-trips stored values", () => {
    writeAssignView({ zoomNew: 1.2, split: 0.6, lines: true });
    expect(readAssignView()).toEqual({ zoomOld: 1, zoomNew: 1.2, split: 0.6, lines: true, single: false, newAiOnly: false, newTemplate: false, ...SIDE_DEFAULTS });
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
    writeAssignView({ single: false, newAiOnly: false, newTemplate: false });
    expect(readAssignView().single).toBe(false);
  });

  it("remembers the New-side AI filter, off until it is turned on", () => {
    expect(readAssignView().newAiOnly).toBe(false);
    writeAssignView({ newAiOnly: true });
    expect(window.localStorage.getItem("sopa.assign.newAiOnly")).toBe("1");
    expect(readAssignView().newAiOnly).toBe(true);
  });

  it("remembers the New template view, basic until it is turned on", () => {
    expect(readAssignView().newTemplate).toBe(false);
    writeAssignView({ newTemplate: true });
    expect(window.localStorage.getItem("sopa.assign.newTemplate")).toBe("1");
    expect(readAssignView().newTemplate).toBe(true);
  });

  it("remembers the detached side panel, its place and its fold - docked with no place at first", () => {
    expect(readAssignView()).toMatchObject({ sideFloat: false, sideX: null, sideY: null, sideFolded: false });
    writeAssignView({ sideFloat: true, sideX: 12, sideY: 40 });
    expect(readAssignView()).toMatchObject({ sideFloat: true, sideX: 12, sideY: 40 });
    writeAssignView({ sideFloat: false, sideFolded: true });
    expect(readAssignView()).toMatchObject({ sideFloat: false, sideX: 12, sideY: 40, sideFolded: true });
  });

  it("never writes a missing place", () => {
    writeAssignView({ sideX: null, sideY: null });
    expect(window.localStorage.getItem("sopa.assign.sideX")).toBeNull();
    expect(readAssignView()).toMatchObject({ sideX: null, sideY: null });
  });

  it("clamps out-of-range and junk values", () => {
    window.localStorage.setItem("sopa.assign.zoomOld", "3");
    window.localStorage.setItem("sopa.assign.split", "abc");
    expect(readAssignView()).toEqual({ zoomOld: 1.6, zoomNew: 1, split: 0.5, lines: true, single: false, newAiOnly: false, newTemplate: false, ...SIDE_DEFAULTS });
  });

  it("falls back to defaults when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readAssignView()).toEqual({ zoomOld: 1, zoomNew: 1, split: 0.5, lines: true, single: false, newAiOnly: false, newTemplate: false, ...SIDE_DEFAULTS });
  });

  it("counts Space preview opens for the small hint, zero when unknown or blocked", () => {
    expect(readSpacePreviewOpens()).toBe(0);
    writeSpacePreviewOpens(2);
    expect(readSpacePreviewOpens()).toBe(2);
    window.localStorage.setItem("sopa.assign.spacePreviewOpens", "junk");
    expect(readSpacePreviewOpens()).toBe(0);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => writeSpacePreviewOpens(3)).not.toThrow();
  });

  it("readSpaceTab defaults to result", () => {
    expect(readSpaceTab()).toBe("result");
  });

  it("round-trips original", () => {
    writeSpaceTab("original");
    expect(window.localStorage.getItem("sopa.assign.spaceTab")).toBe("original");
    expect(readSpaceTab()).toBe("original");
    writeSpaceTab("result");
    expect(readSpaceTab()).toBe("result");
  });

  it("ignores unknown values", () => {
    window.localStorage.setItem("sopa.assign.spaceTab", "junk");
    expect(readSpaceTab()).toBe("result");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readSpaceTab()).toBe("result");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => writeSpaceTab("original")).not.toThrow();
  });

  it("remembers the Space sheet height, default when unknown, clamped when out of range, safe when blocked", () => {
    expect(readSpaceSheetHeight()).toBe(0.7);
    writeSpaceSheetHeight(0.5);
    expect(readSpaceSheetHeight()).toBe(0.5);
    window.localStorage.setItem("sopa.assign.spaceHeight", "5");
    expect(readSpaceSheetHeight()).toBe(0.9);
    window.localStorage.setItem("sopa.assign.spaceHeight", "junk");
    expect(readSpaceSheetHeight()).toBe(0.7);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => writeSpaceSheetHeight(0.4)).not.toThrow();
  });
});
