// i18n 사전 단위 테스트 - en/ko 키 일치, 빈 문구 금지, 권한 라벨 7종 존재를 확인한다.
import { describe, expect, it } from "vitest";

import { MESSAGES } from "./i18n-messages";

describe("MESSAGES", () => {
  it("en and ko message keys match", () => {
    expect(Object.keys(MESSAGES.ko).sort()).toEqual(Object.keys(MESSAGES.en).sort());
  });

  it("has no empty sentence in either language", () => {
    for (const lang of ["en", "ko"] as const) {
      for (const [key, text] of Object.entries(MESSAGES[lang])) {
        expect(text.trim(), `${lang} ${key}`).not.toBe("");
      }
    }
  });

  it("labels every permission under permission.<key>", () => {
    // 권한 키 자체가 `permission.manage`라 라벨 키는 `permission.permission.manage`가 된다
    const labels: Record<string, [string, string]> = {
      "permission.permission.manage": ["Manage permissions", "권한 관리"],
      "permission.directory.sync": ["Run directory sync", "직원 동기화 실행"],
      "permission.ai.admin": ["Manage AI", "AI 관리"],
      "permission.system.view": ["View system status", "시스템 상태 보기"],
      "permission.bundle.create": ["Create bundles", "Bundle 만들기"],
      "permission.bundle.admin": ["Manage all bundles", "전체 Bundle 관리"],
      "permission.guideline.manage": ["Manage AI guidelines", "AI 지침 관리"],
    };
    for (const [key, [en, ko]] of Object.entries(labels)) {
      expect(MESSAGES.en[key], key).toBe(en);
      expect(MESSAGES.ko[key], key).toBe(ko);
    }
  });
});
