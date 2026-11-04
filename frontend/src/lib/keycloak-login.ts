// Keycloak 로그인·로그아웃 리다이렉트와 OIDC 설정 단일 소스 - 로그인 페이지의 UserManager와 providers.tsx의 AuthProvider가 같은 설정을 써야 토큰 교환이 맞는다.
import { UserManager, type UserManagerSettings } from "oidc-client-ts";

import type { AuthModeInfo } from "@/lib/auth-mode";

export function buildOidcSettings(info: AuthModeInfo): UserManagerSettings {
  return {
    authority: info.keycloakIssuer,
    client_id: info.keycloakClientId,
    // 콜백을 /login이 받는다 - Keycloak 클라이언트의 Valid redirect URIs에 `<origin>/login`이 등록돼 있어야 한다.
    redirect_uri: `${window.location.origin}/login`,
    // PKCE는 crypto.subtle을 요구하는데 평문 HTTP(insecure context)에는 그게 없다. 사내망 HTTP 접속(<server-ip>:7777)만 끄고
    // localhost·HTTPS에서는 켠다(Keycloak 클라이언트는 PKCE를 필수로 걸지 않고 선택으로 둔다). 로그인 페이지 UserManager와
    // AuthProvider가 이 함수를 같이 쓰므로 같은 값이 나간다 - 한쪽만 다르면 토큰 교환이 깨진다.
    disablePKCE: !window.crypto?.subtle,
  };
}

export async function signinRedirectFromLogin(
  info: AuthModeInfo,
  options?: { promptNone?: boolean },
): Promise<void> {
  const mgr = new UserManager(buildOidcSettings(info));
  // prompt=none: SSO 세션 있으면 폼 없이 즉시 복귀, 없으면 error=login_required로 복귀(AuthGate가 처리)
  await mgr.signinRedirect(options?.promptNone ? { prompt: "none" } : undefined);
}

// 완전 로그아웃 - Keycloak end_session으로 SSO 세션 종료(같은 realm의 다른 앱 세션도 함께 종료됨).
// id_token_hint가 있으면 확인 화면 없이 즉시 종료. post-logout URI는 Keycloak 클라이언트 등록 필요.
export async function signoutAllSessions(info: AuthModeInfo, idTokenHint: string | null): Promise<void> {
  const mgr = new UserManager(buildOidcSettings(info));
  await mgr.signoutRedirect({
    id_token_hint: idTokenHint ?? undefined,
    post_logout_redirect_uri: `${window.location.origin}/login`,
  });
}
