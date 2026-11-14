// EQUIS 표시 규칙 - 줄에 보일 글과 모양(설계 §4.1의 표), 펼친 정보의 사유 문구, 다시 읽기 판단. 값은 모두 합성이다.
import { describe, expect, it } from "vitest";

import type { EquisInfo } from "./api-sop";
import { formatEquisLabel, hasRefreshingEquis, listEquisHintKeys, normalizeDocNumber } from "./equis-model";
import { MESSAGES } from "./i18n-messages";

function t(key: string, vars: Record<string, string | number> = {}): string {
  const text = MESSAGES.en[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? ""));
}

const EFFECTIVE = { version: "14.0", status: "Effective", effective_date: "2025-09-17", retired_date: "" };

function make(overrides: Partial<EquisInfo>): EquisInfo {
  return {
    state: "found", refreshing: false, verdict: "ok", reasons: [], notes: [], current: EFFECTIVE, in_progress: [], retired: null,
    number: "SOP-ABC-00001", trail: ["SOP-ABC-00001"], ambiguous: [], name: "Synthetic Name", subtype: "", owning_department: "",
    plant: "", area: "", legacy_numbers: [], equipment_tag: "", doc_url: "https://equis.test/ui/#doc_info/900001", title_locked: true,
    fetched_at: "2026-11-13T15:40:00+09:00", ...overrides,
  };
}

describe("formatEquisLabel", () => {
  it("is quiet when the uploaded version is the one in force", () => {
    expect(formatEquisLabel(make({}), t)).toEqual({ tone: "quiet", icon: "check", text: "Current · Effective 14.0" });
  });

  it("appends a version under review without raising the tone", () => {
    const equis = make({ notes: [{ version: "14.2", status: "In Review", effective_date: "", retired_date: "" }] });
    expect(formatEquisLabel(equis, t)).toEqual({ tone: "quiet", icon: "check", text: "Current · Effective 14.0 · 14.2 In Review" });
  });

  it("names the version in force when an older one was uploaded", () => {
    const equis = make({ verdict: "attention", reasons: ["version_mismatch", "newer_authorized"] });
    expect(formatEquisLabel(equis, t)).toEqual({ tone: "attention", icon: "alert", text: "Check · Not current, 14.0 Effective" });
  });

  it("names the authorized next version", () => {
    const equis = make({ verdict: "attention", reasons: ["newer_authorized"], in_progress: [{ version: "15.0", status: "Authorized", effective_date: "", retired_date: "" }] });
    expect(formatEquisLabel(equis, t).text).toBe("Check · 15.0 Authorized");
  });

  it("shows the retirement status and date", () => {
    const equis = make({ verdict: "attention", reasons: ["retired"], current: null, retired: { version: "3.0", status: "Obsolete", effective_date: "", retired_date: "2018-11-21" } });
    expect(formatEquisLabel(equis, t).text).toBe("Check · Obsolete 2018-11-21");
  });

  it("points an old number at the current one", () => {
    const equis = make({ verdict: "attention", reasons: ["old_number"], trail: ["SOP-ABC-1016", "SOP-ABC-00001"] });
    expect(formatEquisLabel(equis, t).text).toBe("Check · Old number, now SOP-ABC-00001");
  });

  it("says a document has no version in force yet", () => {
    const equis = make({ verdict: "attention", reasons: ["no_current"], current: null });
    expect(formatEquisLabel(equis, t).text).toBe("Check · No current version");
  });

  it("reports a new document that already exists in EQUIS as a fact", () => {
    expect(formatEquisLabel(make({ verdict: "in_equis" }), t)).toEqual({ tone: "quiet", icon: "check", text: "In EQUIS · Effective 14.0" });
    const draftOnly = make({ verdict: "in_equis", current: null, in_progress: [], title_locked: false, name: "" });
    expect(formatEquisLabel(draftOnly, t).text).toBe("In EQUIS");
  });

  it("is muted for a number EQUIS does not know and while looking up", () => {
    expect(formatEquisLabel(make({ state: "not_found", verdict: null, current: null }), t)).toEqual({ tone: "muted", icon: "dashed", text: "Not in EQUIS" });
    expect(formatEquisLabel(make({ state: "pending", refreshing: true, verdict: null, current: null }), t)).toEqual({ tone: "muted", icon: "loading", text: "Looking up" });
  });

  it("shows a failed lookup only when there is no earlier answer to keep", () => {
    expect(formatEquisLabel(make({ state: "unavailable", verdict: null, current: null }), t)).toEqual({ tone: "neutral", icon: "failed", text: "Lookup failed" });
    expect(formatEquisLabel(make({ state: "unavailable" }), t).text).toBe("Current · Effective 14.0");
  });
});

describe("listEquisHintKeys", () => {
  it("maps known reasons to sentences that exist in both languages", () => {
    const keys = listEquisHintKeys(make({ reasons: ["old_number", "version_mismatch", "made_up"] }));
    expect(keys).toEqual(["equis.hint.old_number", "equis.hint.version_mismatch"]);
    for (const reason of ["old_number", "retired", "version_mismatch", "newer_authorized", "no_current"]) {
      expect(MESSAGES.en[`equis.hint.${reason}`]).toBeTruthy();
      expect(MESSAGES.ko[`equis.hint.${reason}`]).toBeTruthy();
    }
  });
});

describe("helpers", () => {
  it("normalizes a draft code the way the server does", () => {
    expect(normalizeDocNumber("  sop-abc-00001 ")).toBe("SOP-ABC-00001");
  });

  it("knows when any row is still being looked up", () => {
    expect(hasRefreshingEquis(null)).toBe(false);
    expect(hasRefreshingEquis([{ equis: null }, { equis: make({}) }])).toBe(false);
    expect(hasRefreshingEquis([{ equis: make({ refreshing: true }) }])).toBe(true);
  });
});
