// humanizeApiError 단위 테스트 - 백엔드 detail별 문장 매핑, 상태 코드 폴백, 원문 비노출, 영어/한국어 문구 존재를 확인한다.
import { describe, expect, it } from "vitest";

import { ApiError } from "./api";
import { humanizeApiError } from "./api-errors";
import { MESSAGES, type Lang } from "./i18n-messages";

// 키와 치환 값을 그대로 돌려줘 어떤 키가 골라졌는지 본다
const t = (key: string, vars?: Record<string, string | number>) =>
  vars?.detail != null ? `${key}:${vars.detail}` : key;

// 실제 사전의 문장으로 풀어 사용자가 읽는 글자를 확인한다
function makeTranslator(lang: Lang) {
  return (key: string, vars?: Record<string, string | number>) => {
    let text = MESSAGES[lang][key] ?? key;
    for (const [name, value] of Object.entries(vars ?? {})) text = text.replaceAll(`{${name}}`, String(value));
    return text;
  };
}

// access.py·admin.py가 실제로 내는 (상태, detail) 전부 - 문서(Task 10 브리프)의 목록과 같다
const KNOWN_DETAILS: Array<[number, string]> = [
  [409, "role name already exists"],
  [409, "role is still granted"],
  [409, "grant already exists"],
  [409, "sync ran too recently"],
  [422, "unknown permission: made.up"],
  [422, "unknown subject"],
  [422, "unknown role"],
  [422, "exactly one of role_id or permission is required"],
  [404, "role not found"],
  [404, "grant not found"],
  [403, "missing permission: permission.manage"],
  [503, "HR sync is not configured"],
  [503, "AI is disabled"],
  [502, "HR source error: ConnectError"],
  [502, "AI endpoint error: ConnectTimeout"],
];

describe("humanizeApiError status fallbacks", () => {
  it.each([
    [401, "missing bearer token", "error.unauthorized"],
    [403, "something else", "error.forbidden"],
    [404, "something else", "error.notFound"],
    [409, "something else", "error.conflict"],
    [413, "something else", "error.tooLarge"],
    [502, "something else", "error.upstream"],
    [503, "something else", "error.unavailable"],
    [0, "Failed to fetch", "error.network"],
  ])("maps status %i with an unknown detail to %s", (status, detail, key) => {
    expect(humanizeApiError(new ApiError(status, detail), t)).toBe(key);
  });

  it("shows the validation detail for an unknown 422", () => {
    expect(humanizeApiError(new ApiError(422, "a; b"), t)).toBe("error.invalid:a; b");
  });

  it("falls back to error.unknown for other statuses and non-API errors", () => {
    expect(humanizeApiError(new ApiError(500, "boom"), t)).toBe("error.unknown");
    expect(humanizeApiError(new ApiError(418, "other"), t)).toBe("error.unknown");
    expect(humanizeApiError(new Error("boom"), t)).toBe("error.unknown");
    expect(humanizeApiError("weird", t)).toBe("error.unknown");
  });
});

describe("humanizeApiError known details", () => {
  it.each([
    [409, "role name already exists", "error.roleNameTaken"],
    [409, "role is still granted", "error.roleStillGranted"],
    [409, "grant already exists", "error.grantExists"],
    [409, "sync ran too recently", "error.syncTooSoon"],
    [422, "unknown permission: made.up", "error.unknownPermission"],
    [422, "unknown subject", "error.subjectGone"],
    [422, "unknown role", "error.roleGone"],
    [422, "exactly one of role_id or permission is required", "error.grantNeedsOne"],
    [404, "role not found", "error.roleGone"],
    [404, "grant not found", "error.grantGone"],
    [503, "HR sync is not configured", "error.hrNotConfigured"],
    [503, "AI is disabled", "error.aiDisabled"],
  ])("maps %i %s to %s", (status, detail, key) => {
    expect(humanizeApiError(new ApiError(status, detail), t)).toBe(key);
  });

  it("explains a still-granted role in plain English", () => {
    const text = humanizeApiError(new ApiError(409, "role is still granted"), makeTranslator("en"));
    expect(text).toBe("This role is still granted. Remove its grants first.");
  });

  it("says the AI is turned off instead of showing the status", () => {
    const text = humanizeApiError(new ApiError(503, "AI is disabled"), makeTranslator("en"));
    expect(text).toBe("AI is turned off.");
    expect(text).not.toContain("503");
  });

  it("names the missing permission by its label", () => {
    const en = humanizeApiError(new ApiError(403, "missing permission: ai.admin"), makeTranslator("en"));
    const ko = humanizeApiError(new ApiError(403, "missing permission: ai.admin"), makeTranslator("ko"));
    expect(en).toContain("Manage AI");
    expect(ko).toContain("AI 관리");
  });

  it("uses the general refusal for a missing permission outside the catalog", () => {
    expect(humanizeApiError(new ApiError(403, "missing permission: made.up"), t)).toBe("error.forbidden");
  });
});

describe("humanizeApiError 502 hints", () => {
  it("adds a status-code hint after the HR sentence", () => {
    const text = humanizeApiError(new ApiError(502, "HR source error: 401"), makeTranslator("en"));
    expect(text).toBe("Could not reach the HR source. Try again later. Details: HTTP 401");
  });

  it("adds an exception-class hint after the AI sentence", () => {
    const text = humanizeApiError(new ApiError(502, "AI endpoint error: ConnectTimeout"), makeTranslator("en"));
    expect(text).toBe("Could not reach the AI service. Try again later. Details: ConnectTimeout");
  });

  it("drops a hint that does not look like a status code or class name", () => {
    const text = humanizeApiError(new ApiError(502, "HR source error: https://secret.example/hook"), makeTranslator("en"));
    expect(text).toBe("Could not reach the HR source. Try again later.");
    expect(text).not.toContain("secret");
  });

  it("drops a multi-word hint", () => {
    const text = humanizeApiError(new ApiError(502, "AI endpoint error: HTTPStatusError: 502"), makeTranslator("en"));
    expect(text).toBe("Could not reach the AI service. Try again later.");
  });
});

describe("humanizeApiError copy", () => {
  it("never shows the response status or the bare backend string for a known detail", () => {
    for (const lang of ["en", "ko"] as const) {
      for (const [status, detail] of KNOWN_DETAILS) {
        const text = humanizeApiError(new ApiError(status, detail), makeTranslator(lang));
        expect(text, `${lang} ${status} ${detail}`).not.toContain(String(status));
        expect(text, `${lang} ${status} ${detail}`).not.toBe(detail);
      }
    }
  });

  it("has an English and Korean sentence for every key it can return", () => {
    const used = new Set<string>();
    const recorder = (key: string) => {
      used.add(key);
      return key;
    };
    for (const [status, detail] of KNOWN_DETAILS) humanizeApiError(new ApiError(status, detail), recorder);
    for (const status of [0, 401, 403, 409, 422, 502, 503, 500]) humanizeApiError(new ApiError(status, "x"), recorder);
    humanizeApiError(new Error("boom"), recorder);
    expect(used.size).toBeGreaterThan(15);
    for (const key of used) {
      expect(MESSAGES.en[key], `en ${key}`).toBeTruthy();
      expect(MESSAGES.ko[key], `ko ${key}`).toBeTruthy();
    }
  });
});

describe("humanizeApiError rule rejections", () => {
  function makeRuleError(status: number, rule: { code: string; [key: string]: unknown }): ApiError {
    const err = new ApiError(status, rule.code);
    err.rule = rule;
    return err;
  }

  it("reads a known rule code with its context", () => {
    const text = humanizeApiError(makeRuleError(409, { code: "confirm_required", unit_ids: [1, 2, 3] }), makeTranslator("en"));
    expect(text).toContain("3");
  });

  it("never shows the raw JSON of an unknown rule, even on 422", () => {
    expect(humanizeApiError(makeRuleError(422, { code: "made_up_rule" }), t)).toBe("error.unknown");
    expect(humanizeApiError(makeRuleError(409, { code: "made_up_rule" }), t)).toBe("error.conflict");
  });
});
