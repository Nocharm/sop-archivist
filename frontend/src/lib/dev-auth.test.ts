// dev-auth 단위 테스트 - 선택한 dev 사용자의 저장/삭제와 backend 시드와 맞춘 LOCAL_USERS 5명을 확인한다.
import { beforeEach, describe, expect, it } from "vitest";

import { getStoredDevUser, LOCAL_USERS, storeDevUser } from "./dev-auth";

beforeEach(() => {
  window.localStorage.clear();
});

describe("stored dev user", () => {
  it("round-trips under the sopa.devUser key and clears on null", () => {
    expect(getStoredDevUser()).toBeNull();
    storeDevUser("qa.lead");
    expect(window.localStorage.getItem("sopa.devUser")).toBe("qa.lead");
    expect(getStoredDevUser()).toBe("qa.lead");
    storeDevUser(null);
    expect(getStoredDevUser()).toBeNull();
  });
});

describe("LOCAL_USERS", () => {
  it("lists the five backend dev seed users with department names", () => {
    expect(LOCAL_USERS.map((u) => [u.loginId, u.name, u.koreanName, u.department])).toEqual([
      ["dev.admin", "Dev Admin", "개발관리자", "IT Ops Team"],
      ["qa.lead", "QA Lead", "품질리드", "Quality Division"],
      ["qa.member", "QA Member", "품질담당", "QA Team 1"],
      ["prod.member", "Production Member", "생산담당", "Production Team 1"],
      ["ops.member", "Ops Member", "운영담당", "IT Ops Team"],
    ]);
  });
});
