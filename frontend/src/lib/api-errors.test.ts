// humanizeApiError 단위 테스트 - 상태 코드별 error.* 키 매핑과 폴백, 영어/한국어 실제 문구 존재를 확인한다.
import { describe, expect, it } from "vitest";

import { ApiError } from "./api";
import { humanizeApiError } from "./api-errors";
import { MESSAGES } from "./i18n-messages";

// 키와 치환 값을 그대로 돌려줘 어떤 키가 골라졌는지 본다
const t = (key: string, vars?: Record<string, string | number>) =>
  vars?.detail != null ? `${key}:${vars.detail}` : key;

describe("humanizeApiError", () => {
  it.each([
    [401, "missing bearer token", "error.unauthorized"],
    [403, "missing permission: ai.admin", "error.forbidden"],
    [409, "role is still granted", "error.conflict"],
    [502, "AI endpoint error: HTTPStatusError: 502", "error.upstream"],
    [503, "AI is disabled", "error.unavailable"],
    [0, "Failed to fetch", "error.network"],
  ])("maps status %i to %s", (status, detail, key) => {
    expect(humanizeApiError(new ApiError(status, detail), t)).toBe(key);
  });

  it("shows the validation detail for 422", () => {
    expect(humanizeApiError(new ApiError(422, "a; b"), t)).toBe("error.invalid:a; b");
  });

  it("falls back to error.unknown for other statuses and non-API errors", () => {
    expect(humanizeApiError(new ApiError(500, "boom"), t)).toBe("error.unknown");
    expect(humanizeApiError(new Error("boom"), t)).toBe("error.unknown");
    expect(humanizeApiError("weird", t)).toBe("error.unknown");
  });

  it("never leaks the raw detail outside 422", () => {
    const text = humanizeApiError(new ApiError(502, "HR source error: https://secret.example/hook"), t);
    expect(text).not.toContain("secret");
  });

  it("has an English and Korean sentence for every key it can return", () => {
    const keys = ["unauthorized", "forbidden", "conflict", "invalid", "upstream", "unavailable", "network", "unknown"];
    for (const key of keys) {
      expect(MESSAGES.en[`error.${key}`], `en error.${key}`).toBeTruthy();
      expect(MESSAGES.ko[`error.${key}`], `ko error.${key}`).toBeTruthy();
    }
  });
});
