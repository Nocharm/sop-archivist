// admin-format 단위 테스트 - 변경 기록 한 줄 요약(action별·깨진 detail), 중단 사유 문장, 유효 권한 조회 안내(sysadmin 모순 방지), 모르는 값의 원문 폴백을 실제 사전으로 확인한다.
import { describe, expect, it } from "vitest";

import { buildAuditSummary, describeRunDetail, getAbortReasonKey, getEffectiveNotices, translateOrRaw } from "./admin-format";
import type { AuditEvent } from "./api";
import { MESSAGES, type Lang } from "./i18n-messages";

function makeTranslator(lang: Lang) {
  return (key: string, vars?: Record<string, string | number>) => {
    let text = MESSAGES[lang][key] ?? key;
    for (const [name, value] of Object.entries(vars ?? {})) text = text.replaceAll(`{${name}}`, String(value));
    return text;
  };
}

const en = makeTranslator("en");
const ko = makeTranslator("ko");

const makeEvent = (action: string, detail: Record<string, unknown>): AuditEvent => ({
  id: 1,
  occurred_at: "2026-11-04T10:00:00+09:00",
  actor: "qa.lead",
  action,
  detail,
});

describe("buildAuditSummary", () => {
  it("summarizes a created role with permission labels", () => {
    const event = makeEvent("role.create", { role_id: 3, name: "Smoke Role", description: "", permissions: ["system.view"] });
    expect(buildAuditSummary(event, en)).toBe('Role "Smoke Role" with View system status');
  });

  it("says no permissions for an empty role", () => {
    const event = makeEvent("role.create", { name: "Empty", permissions: [] });
    expect(buildAuditSummary(event, en)).toBe('Role "Empty" with no permissions');
  });

  it("shows the new name and permissions of an updated role, and the old name when renamed", () => {
    const renamed = makeEvent("role.update", {
      role_id: 3,
      before: { name: "Old Name", description: "", permissions: ["system.view"] },
      after: { name: "New Name", description: "", permissions: ["system.view", "ai.admin"] },
    });
    expect(buildAuditSummary(renamed, en)).toBe('Role "New Name" now has View system status, Manage AI (was "Old Name")');
    const same = makeEvent("role.update", {
      before: { name: "Same", permissions: [] },
      after: { name: "Same", permissions: ["ai.admin"] },
    });
    expect(buildAuditSummary(same, en)).toBe('Role "Same" now has Manage AI');
  });

  it("names a deleted role", () => {
    expect(buildAuditSummary(makeEvent("role.delete", { name: "Gone", permissions: [] }), en)).toBe('Role "Gone"');
  });

  it("describes a role grant to a person", () => {
    const event = makeEvent("grant.add", {
      grant_id: 5,
      subject_type: "user",
      subject_id: "prod.member",
      role_id: 3,
      role_name: "Smoke Role",
      permission: null,
    });
    expect(buildAuditSummary(event, en)).toBe('Granted role "Smoke Role" to person prod.member');
  });

  it("describes a direct permission revoked from a department", () => {
    const event = makeEvent("grant.remove", {
      subject_type: "dept",
      subject_id: "DIV-QA",
      role_id: null,
      role_name: null,
      permission: "ai.admin",
    });
    expect(buildAuditSummary(event, en)).toBe('Revoked permission "Manage AI" from department DIV-QA');
    expect(buildAuditSummary(event, ko)).toBe('부서 DIV-QA의 권한 "AI 관리" 회수');
  });

  it("falls back to the raw permission key when the catalog does not know it", () => {
    const event = makeEvent("grant.add", { subject_type: "user", subject_id: "a", permission: "made.up" });
    expect(buildAuditSummary(event, en)).toBe('Granted permission "made.up" to person a');
  });

  it("does not throw on a detail with missing or oddly shaped fields", () => {
    expect(() => buildAuditSummary(makeEvent("role.update", { before: "x", after: 7 }), en)).not.toThrow();
    expect(() => buildAuditSummary(makeEvent("role.create", { name: 5, permissions: "no" }), en)).not.toThrow();
    expect(() => buildAuditSummary(makeEvent("grant.add", {}), en)).not.toThrow();
  });

  it("returns an empty string for an unknown action", () => {
    expect(buildAuditSummary(makeEvent("something.else", { name: "x" }), en)).toBe("");
  });
});

describe("getAbortReasonKey", () => {
  it.each([
    ["count mismatch: header 10 != rows 8", "hr.abort.countMismatch"],
    ["empty feed: no valid employee rows", "hr.abort.emptyFeed"],
    ["delete cap exceeded: would delete 9/10 managed rows", "hr.abort.deleteCap"],
    ["something unexpected", "hr.abort.other"],
  ])("maps %s", (reason, key) => {
    expect(getAbortReasonKey(reason)).toBe(key);
  });

  it("has an English and Korean sentence for every key it can return", () => {
    for (const key of ["countMismatch", "emptyFeed", "deleteCap", "other"]) {
      expect(MESSAGES.en[`hr.abort.${key}`], key).toBeTruthy();
      expect(MESSAGES.ko[`hr.abort.${key}`], key).toBeTruthy();
    }
  });
});

describe("describeRunDetail", () => {
  it("is empty without a detail", () => {
    expect(describeRunDetail("failure", null, en)).toBe("");
  });

  it("turns a known abort reason of a failed run into a sentence", () => {
    expect(describeRunDetail("failure", "empty feed: no valid employee rows", en)).toBe("The feed had no valid employee rows.");
  });

  it("keeps an exception-class detail of a failed run as recorded", () => {
    expect(describeRunDetail("failure", "HTTPStatusError: 502", en)).toBe("HTTPStatusError: 502");
  });

  it("keeps the summary line of a successful run as recorded", () => {
    expect(describeRunDetail("success", "scanned 5 · upserted 5", en)).toBe("scanned 5 · upserted 5");
  });
});

describe("translateOrRaw", () => {
  it("uses the translation when the key exists", () => {
    expect(translateOrRaw(en, "batch.job.hr_sync", "hr_sync")).toBe("Directory sync");
  });

  it("falls back to the raw value for an unknown key", () => {
    expect(translateOrRaw(en, "batch.job.new_job", "new_job")).toBe("new_job");
  });
});

describe("getEffectiveNotices", () => {
  const noticeTexts = (access: { known: boolean; active: boolean; is_sysadmin: boolean }, lang: Lang) =>
    getEffectiveNotices(access).map((notice) => makeTranslator(lang)(notice.key));

  it("shows nothing for a known, active, ordinary person", () => {
    expect(getEffectiveNotices({ known: true, active: true, is_sysadmin: false })).toEqual([]);
  });

  it("explains an ordinary person without an employee record as holding no permissions", () => {
    const notices = getEffectiveNotices({ known: false, active: false, is_sysadmin: false });
    expect(notices.map((notice) => notice.testId)).toEqual(["effective-unknown"]);
    expect(noticeTexts({ known: false, active: false, is_sysadmin: false }, "en")[0]).toContain("holds no permissions");
  });

  it("explains an inactive ordinary person", () => {
    const notices = getEffectiveNotices({ known: true, active: false, is_sysadmin: false });
    expect(notices.map((notice) => notice.testId)).toEqual(["effective-inactive"]);
  });

  it("shows only the sysadmin line for a known, active sysadmin", () => {
    expect(getEffectiveNotices({ known: true, active: true, is_sysadmin: true }).map((notice) => notice.testId)).toEqual(["effective-sysadmin"]);
  });

  it.each([
    ["no employee record", { known: false, active: false, is_sysadmin: true }, "Not in the employee directory yet."],
    ["a retired employee", { known: true, active: false, is_sysadmin: true }, "Marked as retired in the directory."],
  ])("never says a sysadmin holds no permissions: %s", (_label, access, note) => {
    const notices = getEffectiveNotices(access);
    expect(notices.map((notice) => notice.testId)).toEqual(["effective-sysadmin", "effective-sysadmin-note"]);
    for (const lang of ["en", "ko"] as const) {
      const texts = noticeTexts(access, lang);
      expect(texts.join(" ")).not.toMatch(/holds no permissions|권한이 없습니다/);
      expect(texts[0]).toBe(lang === "en" ? "System administrator. Holds every permission, whatever the grants say." : "시스템 관리자입니다. 부여와 상관없이 모든 권한을 가집니다.");
    }
    expect(noticeTexts(access, "en")[1]).toBe(note);
  });
});
