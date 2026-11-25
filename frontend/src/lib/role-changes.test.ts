import { describe, expect, it } from "vitest";

import { applyRoleChanges, toggleChange, type RoleChanges } from "./role-changes";

const ROLE = { id: 7, permissions: ["system.view"] };
const NONE: RoleChanges = new Map();

describe("role changes", () => {
  it("records only cells that differ from the saved value", () => {
    const on = toggleChange(NONE, ROLE, "ai.admin");
    expect([...(on.get(7) ?? [])]).toEqual([["ai.admin", true]]);
    expect(toggleChange(on, ROLE, "ai.admin").size).toBe(0);
    const off = toggleChange(NONE, ROLE, "system.view");
    expect([...(off.get(7) ?? [])]).toEqual([["system.view", false]]);
  });

  it("keeps changes of other roles apart", () => {
    const both = toggleChange(toggleChange(NONE, ROLE, "ai.admin"), { id: 8, permissions: [] }, "ai.admin");
    expect([...both.keys()]).toEqual([7, 8]);
  });

  it("applies changes on top of the saved permissions", () => {
    const changes = toggleChange(toggleChange(NONE, ROLE, "ai.admin"), ROLE, "system.view");
    expect(applyRoleChanges(ROLE.permissions, changes.get(7))).toEqual(["ai.admin"]);
    expect(applyRoleChanges(ROLE.permissions, undefined)).toEqual(["system.view"]);
  });
});
