// 접은 표를 문서마다 기억한다(11-23 명세 E2-R4) - 저장소가 없거나 값이 이상하면 모두 펼침.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readFoldedTables, writeFoldedTables } from "./table-fold-prefs";

describe("folded table prefs", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("remembers per document", () => {
    writeFoldedTables(3, new Set([2]));
    expect(readFoldedTables(3)).toEqual(new Set([2]));
    expect(readFoldedTables(4)).toEqual(new Set());
    expect(window.localStorage.getItem("sopa.assign.tablesFolded.3")).toBe("[2]");
  });

  it("forgets a document with nothing folded", () => {
    writeFoldedTables(3, new Set([2]));
    writeFoldedTables(3, new Set());
    expect(window.localStorage.getItem("sopa.assign.tablesFolded.3")).toBeNull();
  });

  it("is empty for junk and for a blocked store", () => {
    window.localStorage.setItem("sopa.assign.tablesFolded.3", "{oops");
    expect(readFoldedTables(3)).toEqual(new Set());
    window.localStorage.setItem("sopa.assign.tablesFolded.4", '[1,"x",2.5,3]');
    expect(readFoldedTables(4)).toEqual(new Set([1, 3]));
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readFoldedTables(4)).toEqual(new Set());
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => writeFoldedTables(4, new Set([1]))).not.toThrow();
  });
});
