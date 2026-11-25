// 숨긴 기능 스위치 - 기본은 꺼짐, 운영 빌드에는 켜는 길이 없다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DRAFTING_KEY, isDraftingOn } from "./drafting";

describe("isDraftingOn", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("is off by default and on only with sopa.drafting = 1 outside production", () => {
    expect(isDraftingOn()).toBe(false);
    window.localStorage.setItem(DRAFTING_KEY, "1");
    expect(isDraftingOn()).toBe(true);
    window.localStorage.setItem(DRAFTING_KEY, "true");
    expect(isDraftingOn()).toBe(false);
  });

  it("a production build never turns it on", () => {
    vi.stubEnv("NODE_ENV", "production");
    window.localStorage.setItem(DRAFTING_KEY, "1");
    expect(isDraftingOn()).toBe(false);
  });

  it("stays off when the browser store is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(isDraftingOn()).toBe(false);
  });
});
