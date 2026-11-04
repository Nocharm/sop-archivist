// 표시 이름 규칙 단위 테스트 - 한국어 UI는 korean_name 우선, 이름이 비면(HR 동기화 전 첫 로그인) login_id로 떨어진다.
import { describe, expect, it } from "vitest";

import type { Me } from "./api";
import { getDisplayName } from "./display-name";

const BASE_ME: Me = {
  login_id: "qa.lead",
  name: "QA Lead",
  korean_name: "품질리드",
  department: "Quality Division",
  dept_path: "",
  is_sysadmin: false,
  permissions: [],
  sources: {},
  auth_mode: "dev",
  ai_enabled: false,
};

describe("getDisplayName", () => {
  it("uses the English name in English UI", () => {
    expect(getDisplayName(BASE_ME, "en")).toBe("QA Lead");
  });

  it("prefers the Korean name in Korean UI", () => {
    expect(getDisplayName(BASE_ME, "ko")).toBe("품질리드");
  });

  it("falls back to the English name when there is no Korean name", () => {
    expect(getDisplayName({ ...BASE_ME, korean_name: "" }, "ko")).toBe("QA Lead");
  });

  it("falls back to login_id for an unknown employee", () => {
    const unknown = { ...BASE_ME, name: "", korean_name: "", department: "" };
    expect(getDisplayName(unknown, "en")).toBe("qa.lead");
    expect(getDisplayName(unknown, "ko")).toBe("qa.lead");
  });
});
