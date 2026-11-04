// auth-return 단위 테스트 — window/sessionStorage를 스텁해 딥링크 복원·자동 로그인 억제·재시도 예산을 확인한다.
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearAuthRetry,
  clearAutoLoginSkip,
  consumeAutoLoginSkip,
  consumeReturnTo,
  consumeSsoLogoutHint,
  isSafeReturnPath,
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

describe("isSafeReturnPath", () => {
  it("allows internal paths (with query)", () => {
    expect(isSafeReturnPath("/admin")).toBe(true);
    expect(isSafeReturnPath("/admin?tab=ai")).toBe(true);
  });
  it("rejects external, protocol, login and root paths", () => {
    expect(isSafeReturnPath("//evil.com")).toBe(false);
    expect(isSafeReturnPath("https://evil.com")).toBe(false);
    expect(isSafeReturnPath("/login")).toBe(false);
    expect(isSafeReturnPath("/login?next=1")).toBe(false);
    expect(isSafeReturnPath("/")).toBe(false);
  });
});

describe("returnTo save/peek/consume", () => {
  it("consume returns the saved path once and removes it", () => {
    saveReturnTo("/admin?tab=ai");
    expect(peekReturnTo()).toBe("/admin?tab=ai"); // peek does not remove
    expect(consumeReturnTo()).toBe("/admin?tab=ai");
    expect(consumeReturnTo()).toBeNull();
  });
  it("does not store an unsafe path", () => {
    saveReturnTo("//evil.com");
    expect(consumeReturnTo()).toBeNull();
  });
  it("never returns an unsafe value even if storage was tampered with", () => {
    storage.setItem("sopa.returnTo", "https://evil.com");
    expect(consumeReturnTo()).toBeNull();
    expect(storage.getItem("sopa.returnTo")).toBeNull(); // the tampered value is removed too
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
