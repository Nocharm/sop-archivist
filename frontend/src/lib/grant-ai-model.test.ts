import { describe, expect, it } from "vitest";

import type { Grant, GrantAiLine } from "./api";
import { buildGrantAiBatch, buildGrantAiRows, countGrantAiStatus, getPickKey, hasChange, isRowToCheck } from "./grant-ai-model";

function grant(id: number, type: "user" | "dept", subject: string, roleId: number | null, permission: string | null = null): Grant {
  return {
    id, subject_type: type, subject_id: subject, subject_name: subject, subject_missing: false,
    role_id: roleId, role_name: roleId === null ? null : `role ${roleId}`, permission, created_by: "t", created_at: "2026-11-26T00:00:00+09:00",
  };
}

function line(action: "add" | "remove", subjects: GrantAiLine["subjects"], roles: GrantAiLine["roles"], permissions: GrantAiLine["permissions"] = []): GrantAiLine {
  return { line: 1, action, subjects, roles, permissions };
}

const USER = (id: string) => ({ subject_type: "user" as const, subject_id: id });
const GRANTS = [grant(1, "user", "qa.member", 7), grant(2, "dept", "TEAM-IT1", null, "system.view")];

describe("buildGrantAiRows", () => {
  it("splits an add line into new and already held grants", () => {
    const [row] = buildGrantAiRows([line("add", [{ written: "qa.member", matches: [USER("qa.member")] }, { written: "kim", matches: [USER("kim.a")] }], [{ written: "Ops", role_id: 7 }])], GRANTS, new Map());

    expect(row.items.map((item) => [item.subjectId, item.status])).toEqual([["qa.member", "exists"], ["kim.a", "new"]]);
    expect(countGrantAiStatus(row)).toEqual({ new: 1, exists: 1, remove: 0, notHeld: 0 });
    expect(hasChange(row)).toBe(true);
    expect(isRowToCheck(row)).toBe(false);
  });

  it("finds the grant id to revoke and marks what was never held", () => {
    const dept = { subject_type: "dept" as const, subject_id: "TEAM-IT1" };
    const [row] = buildGrantAiRows([line("remove", [{ written: "TEAM-IT1", matches: [dept] }], [{ written: "Ops", role_id: 7 }], [{ written: "system.view", permission: "system.view" }])], GRANTS, new Map());

    expect(row.items.map((item) => [item.status, item.grantId])).toEqual([["notHeld", null], ["remove", 2]]);
  });

  it("waits for a pick when one name fits two people and uses the pick", () => {
    const lines = [line("add", [{ written: "김민서", matches: [USER("kim.a"), USER("kim.b")] }], [{ written: "Ops", role_id: 7 }])];

    const [before] = buildGrantAiRows(lines, GRANTS, new Map());
    const [after] = buildGrantAiRows(lines, GRANTS, new Map([[getPickKey("0", "김민서"), "user:kim.b"]]));

    expect(before.needsPick).toEqual(["김민서"]);
    expect(before.items).toEqual([]);
    expect(isRowToCheck(before)).toBe(true);
    expect(after.needsPick).toEqual([]);
    expect(after.items.map((item) => item.subjectId)).toEqual(["kim.b"]);
  });

  it("lists unknown subjects, roles and permissions for the row to check", () => {
    const [row] = buildGrantAiRows([line("add", [{ written: "nobody", matches: [] }], [{ written: "Ghost", role_id: null }], [{ written: "x.y", permission: null }])], GRANTS, new Map());

    expect(row.unknownSubjects).toEqual(["nobody"]);
    expect(row.unknownWhat).toEqual(["Ghost", "x.y"]);
    expect(hasChange(row)).toBe(false);
    expect(isRowToCheck(row)).toBe(true);
  });

  it("treats a line without a role or a permission as one to check", () => {
    const [row] = buildGrantAiRows([line("add", [{ written: "qa.member", matches: [USER("qa.member")] }], [])], GRANTS, new Map());

    expect(isRowToCheck(row)).toBe(true);
  });
});

describe("buildGrantAiBatch", () => {
  it("sends only the checked rows and each change once", () => {
    const lines = [
      line("add", [{ written: "kim", matches: [USER("kim.a")] }], [{ written: "Ops", role_id: 7 }]),
      line("add", [{ written: "kim.a", matches: [USER("kim.a")] }], [{ written: "Ops", role_id: 7 }], [{ written: "ai.admin", permission: "ai.admin" }]),
      line("remove", [{ written: "qa.member", matches: [USER("qa.member")] }], [{ written: "Ops", role_id: 7 }]),
      line("add", [{ written: "qa.member", matches: [USER("qa.member")] }], [{ written: "Ops", role_id: 7 }]),
    ];
    const rows = buildGrantAiRows(lines, GRANTS, new Map());

    const body = buildGrantAiBatch(rows, new Set(["0", "1", "2"]));

    expect(body.add).toEqual([
      { subject_type: "user", subject_id: "kim.a", role_id: 7 },
      { subject_type: "user", subject_id: "kim.a", permission: "ai.admin" },
    ]);
    expect(body.remove).toEqual([1]);
  });

  it("is empty when nothing is checked", () => {
    const rows = buildGrantAiRows([line("add", [{ written: "kim", matches: [USER("kim.a")] }], [{ written: "Ops", role_id: 7 }])], GRANTS, new Map());

    expect(buildGrantAiBatch(rows, new Set())).toEqual({ add: [], remove: [] });
  });
});
