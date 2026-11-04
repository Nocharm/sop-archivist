// auth-return 단위 테스트 — window/sessionStorage를 스텁해 딥링크 복원·자동 로그인 억제·재시도 예산을 확인한다.
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearAuthRetry,
  clearAutoLoginSkip,
  consumeAutoLoginSkip,
  consumeReturnTo,
  consumeSsoLogoutHint,
  isSafeReturnPath,
  normalizeReturnPath,
  peekReturnTo,
  saveReturnTo,
  saveSsoLogoutHint,
  setAutoLoginSkip,
  tryConsumeAuthRetry,
} from "@/lib/auth-return";

function makeFakeStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    get length() {
      return store.size;
    },
  } as Storage;
}

let storage: Storage;

beforeEach(() => {
  storage = makeFakeStorage();
  vi.stubGlobal("window", { sessionStorage: storage });
});

describe("normalizeReturnPath", () => {
  it("accepts same-origin paths and returns them normalized", () => {
    expect(normalizeReturnPath("/admin")).toBe("/admin");
    expect(normalizeReturnPath("/admin?tab=ai#x")).toBe("/admin?tab=ai#x");
    expect(normalizeReturnPath("/loginfoo")).toBe("/loginfoo"); // "/login"의 접두일 뿐 다른 경로
    expect(normalizeReturnPath("/a/../admin")).toBe("/admin"); // 점 구간은 파서가 접는다
  });
  it("rejects backslashes and control characters (browsers fold them into //evil.com)", () => {
    expect(normalizeReturnPath("/\\evil.com")).toBeNull();
    expect(normalizeReturnPath("/\t/evil.com")).toBeNull();
    expect(normalizeReturnPath("/\n/evil.com")).toBeNull();
    expect(normalizeReturnPath("/admin\u007f")).toBeNull();
    expect(normalizeReturnPath("/admin?next=\\evil.com")).toBeNull();
  });
  it("keeps a percent-encoded backslash as a same-origin path", () => {
    // %5C는 파서가 디코드하지 않아 경로의 한 글자로 남는다 - 사이트 밖으로 나갈 수 없으므로 그대로 허용한다.
    expect(normalizeReturnPath("/%5Cevil.com")).toBe("/%5Cevil.com");
  });
  it("rejects other origins, protocol-relative and non-rooted values", () => {
    expect(normalizeReturnPath("//evil.com")).toBeNull();
    expect(normalizeReturnPath("///evil.com")).toBeNull();
    expect(normalizeReturnPath("https://evil.com")).toBeNull();
    expect(normalizeReturnPath("javascript:alert(1)")).toBeNull();
    expect(normalizeReturnPath("admin")).toBeNull();
    expect(normalizeReturnPath("")).toBeNull();
  });
  it("rejects the root and the login page, including dot-segment detours", () => {
    expect(normalizeReturnPath("/")).toBeNull();
    expect(normalizeReturnPath("/login")).toBeNull();
    expect(normalizeReturnPath("/login?next=1")).toBeNull();
    expect(normalizeReturnPath("/login#x")).toBeNull();
    expect(normalizeReturnPath("/login/x")).toBeNull();
    expect(normalizeReturnPath("/admin/../login")).toBeNull();
    expect(normalizeReturnPath("/./login")).toBeNull();
  });
});

describe("isSafeReturnPath", () => {
  it("mirrors normalizeReturnPath as a boolean", () => {
    expect(isSafeReturnPath("/admin?tab=ai")).toBe(true);
    expect(isSafeReturnPath("/loginfoo")).toBe(true);
    expect(isSafeReturnPath("/\\evil.com")).toBe(false);
    expect(isSafeReturnPath("//evil.com")).toBe(false);
    expect(isSafeReturnPath("/login")).toBe(false);
  });
});

describe("returnTo save/peek/consume", () => {
  it("consume returns the saved path once and removes it", () => {
    saveReturnTo("/admin?tab=ai");
    expect(peekReturnTo()).toBe("/admin?tab=ai"); // peek does not remove
    expect(consumeReturnTo()).toBe("/admin?tab=ai");
    expect(consumeReturnTo()).toBeNull();
  });
  it("stores and returns the normalized form only", () => {
    saveReturnTo("/a/../admin?tab=ai#x");
    expect(storage.getItem("sopa.returnTo")).toBe("/admin?tab=ai#x");
    expect(consumeReturnTo()).toBe("/admin?tab=ai#x");
  });
  it("does not store an unsafe path", () => {
    for (const unsafe of ["//evil.com", "/\\evil.com", "/\t/evil.com", "/login", "/login/x"]) {
      saveReturnTo(unsafe);
      expect(storage.getItem("sopa.returnTo"), unsafe).toBeNull();
    }
  });
  it("never returns an unsafe value even if storage was tampered with", () => {
    for (const tampered of ["https://evil.com", "/\\evil.com", "/\t/evil.com", "//evil.com", "/login/x"]) {
      storage.setItem("sopa.returnTo", tampered);
      expect(consumeReturnTo(), tampered).toBeNull();
      expect(storage.getItem("sopa.returnTo"), tampered).toBeNull(); // the tampered value is removed too
    }
  });
  it("normalizes a tampered-but-same-origin stored value on read", () => {
    storage.setItem("sopa.returnTo", "/a/../admin");
    expect(peekReturnTo()).toBe("/admin");
  });
});

describe("autoLoginSkip flag", () => {
  it("is consumed once, so the next visit resumes automatic sign-in", () => {
    expect(consumeAutoLoginSkip()).toBe(false);
    setAutoLoginSkip();
    expect(consumeAutoLoginSkip()).toBe(true);
    expect(consumeAutoLoginSkip()).toBe(false);
  });
  it("clear cancels a pending skip", () => {
    setAutoLoginSkip();
    clearAutoLoginSkip();
    expect(consumeAutoLoginSkip()).toBe(false);
  });
});

describe("authRetry counter", () => {
  it("allows one silent retry, then falls back to the card and resets the budget", () => {
    expect(tryConsumeAuthRetry()).toBe(true);
    expect(tryConsumeAuthRetry()).toBe(false);
    expect(tryConsumeAuthRetry()).toBe(true);
  });
  it("clearAuthRetry resets the budget", () => {
    tryConsumeAuthRetry();
    clearAuthRetry();
    expect(tryConsumeAuthRetry()).toBe(true);
  });
});

describe("ssoLogoutHint", () => {
  it("consume returns the saved token once", () => {
    saveSsoLogoutHint("id-token-abc");
    expect(consumeSsoLogoutHint()).toBe("id-token-abc");
    expect(consumeSsoLogoutHint()).toBeNull();
  });
});

describe("no window (SSR) or inaccessible storage", () => {
  it("is a silent no-op without window", () => {
    vi.stubGlobal("window", undefined);
    expect(() => saveReturnTo("/admin")).not.toThrow();
    expect(consumeReturnTo()).toBeNull();
    expect(consumeAutoLoginSkip()).toBe(false);
    expect(consumeSsoLogoutHint()).toBeNull();
  });
});
