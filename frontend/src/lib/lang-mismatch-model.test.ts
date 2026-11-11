import { describe, expect, it } from "vitest";

import type { UnitLang } from "./api-sop";
import { findLangMismatch } from "./lang-mismatch-model";

const units = (...langs: UnitLang[]) => langs.map((lang, i) => ({ id: i + 1, lang }));

describe("findLangMismatch", () => {
  it("flags another language in a single-language layout", () => {
    const list = units("ko", "en");
    expect(findLangMismatch("ko_only", list[1], list)).toEqual({ reason: "singleLangOther" });
    expect(findLangMismatch("en_only", list[0], list)).toEqual({ reason: "singleLangOther" });
  });
  it("accepts the layout's own language and neutral lines", () => {
    const list = units("ko", "neutral");
    expect(findLangMismatch("ko_only", list[0], list)).toBeNull();
    expect(findLangMismatch("ko_only", list[1], list)).toBeNull();
  });
  it("flags three same-language lines in a row when interleaved", () => {
    const list = units("ko", "ko", "ko", "en");
    expect(findLangMismatch("ko_en_interleaved", list[1], list)).toEqual({ reason: "interleavedRun" });
  });
  it("does not count neutral lines nor flag alternating or two-line runs", () => {
    expect(findLangMismatch("ko_en_interleaved", units("ko", "en", "ko", "en")[0], units("ko", "en", "ko", "en"))).toBeNull();
    const two = units("ko", "ko", "en");
    expect(findLangMismatch("ko_en_interleaved", two[0], two)).toBeNull();
    const skip = units("ko", "neutral", "ko", "neutral", "ko");
    expect(findLangMismatch("ko_en_interleaved", skip[2], skip)).toEqual({ reason: "interleavedRun" });
  });
  it("never flags the separate layout", () => {
    const list = units("ko", "ko", "ko", "en");
    expect(findLangMismatch("ko_en_separate", list[0], list)).toBeNull();
  });
});
