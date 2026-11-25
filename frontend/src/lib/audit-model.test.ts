import { describe, expect, it } from "vitest";

import type { AuditEvent } from "./api";
import { filterAudit, getAuditDay, getAuditKind } from "./audit-model";

const event = (id: number, action: string, occurred_at = "2026-11-21T10:00:00+09:00"): AuditEvent => ({ id, occurred_at, actor: "qa.lead", action, detail: {} });

describe("audit model", () => {
  it("sorts actions into the pills", () => {
    expect([getAuditKind("grant.add"), getAuditKind("grant.remove"), getAuditKind("role.update"), getAuditKind("other")]).toEqual(["add", "remove", "role", null]);
  });

  it("filters by pill and by what the row says", () => {
    const rows = [event(1, "grant.add"), event(2, "grant.remove"), event(3, "role.create"), event(4, "grant.add")];
    expect(filterAudit(rows, "add", "", () => "").map((row) => row.id)).toEqual([1, 4]);
    expect(filterAudit(rows, "all", "QA", (row) => `${row.action} qa.lead`).map((row) => row.id)).toEqual([1, 2, 3, 4]);
    expect(filterAudit(rows, "all", "nothing", () => "x")).toEqual([]);
  });

  it("groups by the Seoul date", () => {
    expect(getAuditDay({ occurred_at: "2026-11-20T15:30:00Z" })).toBe("2026-11-21");
  });
});
