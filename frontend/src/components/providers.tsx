// 인증 게이트 - 부팅 시 백엔드가 알려준 모드(dev|keycloak)로 DevGate/AuthGate를 고르고, 로그인한 화면에만 세션·앱 셸을 씌운다. layout이 LangProvider 안에서 한 번 쓴다.
"use client";

import { AuthProvider, useAuth, type ErrorContext } from "react-oidc-context";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import { AppShell } from "@/components/app-shell";
import { AuthLoadingScreen } from "@/components/auth-loading";
import { setAuthToken } from "@/lib/api";
import { getCachedAuthMode, type AuthModeInfo } from "@/lib/auth-mode";
import {
  clearAuthRetry,
  clearAutoLoginSkip,
  consumeReturnTo,
  saveReturnTo,
  saveSsoLogoutHint,
  setAutoLoginSkip,
  tryConsumeAuthRetry,
} from "@/lib/auth-return";
import { getStoredDevUser, storeDevUser } from "@/lib/dev-auth";
import { buildOidcSettings } from "@/lib/keycloak-login";
import { SessionProvider } from "@/lib/session";

const LOGIN_PATH = "/login";

const subscribe = () => () => {};
function useMounted(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false);
}

// 콜백 처리 뒤 주소창의 code/state를 지운다. 모듈 상수로 둬야 Providers가 다시 그려져도 AuthProvider가 콜백을 재처리하지 않는다.
function handleSigninCallback(): void {
  window.history.replaceState({}, document.title, window.location.pathname);
}

// prompt=none 실패(SSO 세션 없음) 신호 - 에러 화면이 아니라 "로그인 카드로" 신호로 해석.
// react-oidc-context가 원본(oidc-client-ts ErrorResponse)을 ErrorContext로 감싸 innerError에 두므로 거기서 error 코드를 읽는다.
function isLoginRequiredError(err: ErrorContext): boolean {
  const inner = err.innerError;
  if (!inner || typeof inner !== "object" || !("error" in inner)) {
    return false;
  }
  return inner.error === "login_required" || inner.error === "interaction_required";
}

function AuthGate({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const isLoginPage = pathname === LOGIN_PATH;
  // 사용자가 직접 로그아웃한 경우엔 지금 경로를 "로그인 후 복귀 경로"로 저장하지 않는다
  const signingOutRef = useRef(false);

  // 토큰은 렌더 단계에서 동기 반영 - 자식 페이지의 fetch effect가 이 게이트의 effect보다 먼저 실행되는
  // 레이스(첫 GET /me가 토큰 없이 나가 401)를 막는다. React effect는 자식->부모 순서라 effect로 세팅하면 늦다.
  setAuthToken(auth.user?.access_token ?? null);

  useEffect(() => {
    if (auth.isLoading || auth.isAuthenticated || auth.activeNavigator || auth.error) return;
    if (isLoginPage) return;
    if (!signingOutRef.current) {
      saveReturnTo(pathname + window.location.search); // 딥링크 보존 - 로그인 후 복귀
    }
    router.replace(LOGIN_PATH);
  }, [auth.isLoading, auth.isAuthenticated, auth.activeNavigator, auth.error, isLoginPage, pathname, router]);

  // 인증 에러는 막다른 빨간 화면 대신 로그인 카드로 복귀한다. 콜백이 /login으로 돌아오므로 prompt=none 실패도 여기서 받는다.
  //  - login_required/interaction_required(세션 없음, 정상) -> 카드로, silent 재시도 억제(무의미한 루프 방지).
  //  - 그 외(state 불일치·토큰 교환 실패 등) -> 세션이 살아 있을 수 있으니 silent 재시도 1회, 소진되면 카드로.
  // 로그인 페이지가 시도 직전에 억제 플래그를 세워 두므로, 재시도할 때만 플래그를 푼다(로그인 페이지의 소비는 이 effect 뒤에 돈다).
  useEffect(() => {
    if (!auth.error || auth.isAuthenticated) return;
    if (isLoginRequiredError(auth.error)) {
      setAutoLoginSkip();
      clearAuthRetry();
    } else {
      console.error("auth error, retrying via login", auth.error);
      if (tryConsumeAuthRetry()) {
        clearAutoLoginSkip();
      } else {
        setAutoLoginSkip();
      }
    }
    if (isLoginPage) {
      // 새로고침하면 소진된 state로 콜백을 다시 처리해 같은 에러가 반복되므로 주소창을 비운다
      window.history.replaceState({}, document.title, LOGIN_PATH);
    } else {
      router.replace(LOGIN_PATH);
    }
  }, [auth.error, auth.isAuthenticated, isLoginPage, router]);

  // 로그인 성공: 억제 플래그·재시도 예산 해제, 로그인 화면에 있으면 저장된 딥링크(없으면 홈)로 보낸다
  useEffect(() => {
    if (!auth.isAuthenticated) return;
    clearAutoLoginSkip();
    clearAuthRetry();
    if (isLoginPage) {
      router.replace(consumeReturnTo() ?? "/");
    }
  }, [auth.isAuthenticated, isLoginPage, router]);

  const signOut = async () => {
    signingOutRef.current = true;
    // removeUser는 로컬 토큰만 지우고 Keycloak SSO 세션은 살아 있다 - 로그인 페이지가 바로 되살리지 않게 억제한다
    setAutoLoginSkip();
    // 로그인 페이지의 "모든 세션 종료" 패널이 쓸 id_token - removeUser 뒤에는 사라지므로 먼저 보관한다
    if (auth.user?.id_token) {
      saveSsoLogoutHint(auth.user.id_token);
    }
    await auth.removeUser();
    router.replace(LOGIN_PATH);
  };

  if (isLoginPage) {
    // 콜백 처리 중이거나 이미 로그인된 상태(복귀 이동 대기)에서 로그인 카드·자동 시도가 끼어들면 콜백이 깨진다
    if (auth.isLoading || auth.isAuthenticated || auth.activeNavigator) {
      return <AuthLoadingScreen />;
    }
    return <>{children}</>;
  }
  // 에러 상태(위 effect가 로그인으로 복귀 처리 중)도 not-authenticated로 여기 걸린다
  if (auth.isLoading || !auth.isAuthenticated) {
    return <AuthLoadingScreen />;
  }
  return (
    <SessionProvider mode="keycloak" signOut={() => void signOut()}>
      <AppShell>{children}</AppShell>
    </SessionProvider>
  );
}

function DevGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  // dev 사용자는 apiFetch가 요청마다 localStorage에서 읽으므로 토큰 같은 렌더 단계 주입이 필요 없다
  const stored = getStoredDevUser();
  const isLoginPage = pathname === LOGIN_PATH;

  useEffect(() => {
    if (!stored && !isLoginPage) {
      saveReturnTo(pathname + window.location.search); // 딥링크 보존 - dev 로그인 후 복귀
      router.replace(LOGIN_PATH);
    }
  }, [stored, isLoginPage, pathname, router]);

  const signOut = () => {
    storeDevUser(null);
    router.replace(LOGIN_PATH);
  };

  if (isLoginPage) {
    return <>{children}</>;
  }
  if (!stored) {
    return null; // 위 effect가 로그인으로 보내는 중
  }
  return (
    <SessionProvider mode="dev" signOut={signOut}>
      <AppShell>{children}</AppShell>
    </SessionProvider>
  );
}

export function Providers({ children }: { children: ReactNode }) {
  const mounted = useMounted();
  const [modeInfo, setModeInfo] = useState<AuthModeInfo | null>(null);

  useEffect(() => {
    let alive = true;
    void getCachedAuthMode().then((info) => {
      if (alive) setModeInfo(info);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!mounted || modeInfo === null) {
    // 모드가 정해지기 전에 자식을 그리면 인증 없이 API를 때리는 창이 생긴다.
    return <AuthLoadingScreen />;
  }
  if (modeInfo.mode === "dev") {
    return <DevGate>{children}</DevGate>;
  }
  return (
    <AuthProvider {...buildOidcSettings(modeInfo)} onSigninCallback={handleSigninCallback}>
      <AuthGate>{children}</AuthGate>
    </AuthProvider>
  );
}
