import { beforeEach, describe, expect, it } from "vitest";

import { parseManualMarks, readManualMarks, setManualMark } from "./manual-read";

describe("parseManualMarks", () => {
  it("reads id to hash pairs", () => {
    expect(parseManualMarks('{"assign":"0a1b2c3d","split":"ffffffff"}')).toEqual({ assign: "0a1b2c3d", split: "ffffffff" });
  });

  it("drops values that are not text and stored text of another shape", () => {
    expect(parseManualMarks('{"assign":"0a1b2c3d","split":1,"tobe":null}')).toEqual({ assign: "0a1b2c3d" });
    for (const raw of [null, "", "not json", "[]", '"text"', "null", "3"]) {
      expect(parseManualMarks(raw)).toEqual({});
    }
  });
});

describe("setManualMark", () => {
  beforeEach(() => {
    for (const id of Object.keys(readManualMarks())) setManualMark(id, null);
  });

  it("adds a mark, replaces it and removes it", () => {
    setManualMark("assign", "11111111");
    setManualMark("split", "22222222");
    setManualMark("assign", "33333333");

    expect(readManualMarks()).toEqual({ assign: "33333333", split: "22222222" });
    expect(JSON.parse(window.localStorage.getItem("sopa.manual.read") ?? "{}")).toEqual({ assign: "33333333", split: "22222222" });

    setManualMark("assign", null);

    expect(readManualMarks()).toEqual({ split: "22222222" });
  });

  it("returns the same object until something changes", () => {
    setManualMark("assign", "11111111");

    expect(readManualMarks()).toBe(readManualMarks());
  });
});
