// auth-mode 단위 테스트 — 모드 판독과 fail-closed 폴백(일시 실패는 캐시하지 않음)을 확인한다.
import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchAuthMode } from "./auth-mode";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchAuthMode", () => {
  it("returns the mode reported by the backend", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          mode: "dev",
          keycloakIssuer: "http://kc/realms/x",
          keycloakClientId: "sop-archivist-frontend",
        }),
      }),
    );
    const info = await fetchAuthMode();
    expect(info.mode).toBe("dev");
    expect(info.keycloakClientId).toBe("sop-archivist-frontend");
  });

  it("falls back to keycloak when the endpoint fails", async () => {
    // 모드를 못 읽었다고 인증을 통째로 열면 안 된다 - 가장 엄격한 모드로 떨어진다.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const info = await fetchAuthMode();
    expect(info.mode).toBe("keycloak");
  });

  it("falls back to keycloak on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    const info = await fetchAuthMode();
    expect(info.mode).toBe("keycloak");
  });

  it("rejects an unknown mode string, including the ldap mode this app does not have", async () => {
    for (const bogus of ["bogus", "ldap"]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ mode: bogus }) }));
      const info = await fetchAuthMode();
      expect(info.mode).toBe("keycloak");
    }
  });
});

describe("getCachedAuthMode", () => {
  it("does not memoize a transient fallback - retries once the endpoint recovers", async () => {
    vi.resetModules();
    const { getCachedAuthMode: freshGetCachedAuthMode } = await import("./auth-mode");

    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("boot blip")));
    const first = await freshGetCachedAuthMode();
    expect(first.mode).toBe("keycloak");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          mode: "dev",
          keycloakIssuer: "http://kc/realms/x",
          keycloakClientId: "sop-archivist-frontend",
        }),
      }),
    );
    const second = await freshGetCachedAuthMode();
    expect(second.mode).toBe("dev");
  });

  it("shares one request across concurrent callers once it succeeds", async () => {
    vi.resetModules();
    const { getCachedAuthMode: freshGetCachedAuthMode } = await import("./auth-mode");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ mode: "dev", keycloakIssuer: "", keycloakClientId: "" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await Promise.all([freshGetCachedAuthMode(), freshGetCachedAuthMode()]);
    await freshGetCachedAuthMode();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
