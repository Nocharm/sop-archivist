// 권한 헬퍼 단위 테스트 - 카탈로그 순서(백엔드와 동일), sysadmin 우회, 관리 메뉴 노출 조건.
import { describe, expect, it } from "vitest";

import { canSeeAdmin, hasPermission, PERMISSIONS } from "./access";
import type { Me } from "./api";

const BASE_ME: Me = {
  login_id: "qa.lead",
  name: "QA Lead",
  korean_name: "품질리드",
  department: "Quality Division",
  dept_path: "Example Pharma > Quality Division",
  is_sysadmin: false,
  permissions: [],
  auth_mode: "dev",
  ai_enabled: false,
};

describe("access", () => {
  it("sysadmin has every permission", () => {
    const me = { ...BASE_ME, is_sysadmin: true, permissions: [] };
    expect(hasPermission(me, "ai.admin")).toBe(true);
  });

  it("non-sysadmin only has granted permissions", () => {
    const me = { ...BASE_ME, permissions: ["system.view"] };
    expect(hasPermission(me, "system.view")).toBe(true);
    expect(hasPermission(me, "ai.admin")).toBe(false);
  });

  it("admin visible with any permission", () => {
    expect(canSeeAdmin({ ...BASE_ME, permissions: ["system.view"] })).toBe(true);
  });

  it("admin hidden without permissions", () => {
    expect(canSeeAdmin({ ...BASE_ME, permissions: [] })).toBe(false);
  });

  it("admin visible for sysadmin even with an empty permission list", () => {
    expect(canSeeAdmin({ ...BASE_ME, is_sysadmin: true, permissions: [] })).toBe(true);
  });

  it("PERMISSIONS matches backend order", () => {
    expect([...PERMISSIONS]).toEqual(["permission.manage", "directory.sync", "ai.admin", "system.view"]);
  });
});
