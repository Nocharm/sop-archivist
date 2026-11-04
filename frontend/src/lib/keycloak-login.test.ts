// buildOidcSettings 단위 테스트 - crypto.subtle이 있으면 PKCE 사용, 없으면(평문 HTTP) 끔, 콜백 주소는 <origin>/login.
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AuthModeInfo } from "./auth-mode";
import { buildOidcSettings } from "./keycloak-login";

const INFO: AuthModeInfo = {
  mode: "keycloak",
  keycloakIssuer: "https://sso.example/realms/test",
  keycloakClientId: "sop-archivist",
};

describe("buildOidcSettings", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps PKCE on when crypto.subtle is available", () => {
    vi.stubGlobal("crypto", { subtle: {} });
    expect(buildOidcSettings(INFO).disablePKCE).toBe(false);
  });

  it("turns PKCE off when crypto.subtle is missing (insecure context)", () => {
    vi.stubGlobal("crypto", {});
    expect(buildOidcSettings(INFO).disablePKCE).toBe(true);
  });

  it("turns PKCE off when crypto itself is missing", () => {
    vi.stubGlobal("crypto", undefined);
    expect(buildOidcSettings(INFO).disablePKCE).toBe(true);
  });

  it("returns to <origin>/login with the issuer and client id from the auth mode", () => {
    const settings = buildOidcSettings(INFO);
    expect(settings.redirect_uri).toBe(`${window.location.origin}/login`);
    expect(settings.authority).toBe(INFO.keycloakIssuer);
    expect(settings.client_id).toBe(INFO.keycloakClientId);
  });
});
