// 로그인 페이지 - keycloak 모드는 SSO 자동 시도(prompt=none) 뒤 로그인 버튼, dev 모드는 로컬 계정·직원 디렉터리에서 고르기. Keycloak 콜백도 이 주소로 돌아온다(처리는 providers.tsx).
"use client";

import { Lock, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AuthLoadingScreen } from "@/components/auth-loading";
import { BrandMark } from "@/components/brand-mark";
import { DevLoginPicker } from "@/components/dev-login-picker";
import { LangToggle } from "@/components/lang-toggle";
import { getCachedAuthMode, type AuthModeInfo } from "@/lib/auth-mode";
import {
  clearAutoLoginSkip,
  consumeAutoLoginSkip,
  consumeReturnTo,
  consumeSsoLogoutHint,
  setAutoLoginSkip,
} from "@/lib/auth-return";
import { storeDevUser } from "@/lib/dev-auth";
import { useI18n } from "@/lib/i18n";
import { signinRedirectFromLogin, signoutAllSessions } from "@/lib/keycloak-login";

// 자동 로그인 로딩 화면 최소 노출(ms) - 순간 플래시 방지. 리다이렉트 중에도 브라우저가 마지막 화면을 유지하므로
// Keycloak 왕복 내내 로딩 화면이 이어져 보인다. 줄이면 다시 깜빡임처럼 느껴질 수 있다.
const AUTO_LOGIN_MIN_VISIBLE_MS = 600;

// 자동 silent 시도 여부 - 페이지 로드당 1회만 판정(모듈 캐시). consume은 부수효과라 StrictMode 이중 렌더/이펙트에서도 한 번만 돌게 멱등화한다.
let autoAttemptDecision: boolean | null = null;
let autoAttemptStarted = false;

// Keycloak 설정을 못 받으면(백엔드 장애 시 fail-closed 폴백) 주소가 비어 있어 로그인을 시작할 수 없다
function isKeycloakReady(info: AuthModeInfo): boolean {
  return info.mode === "keycloak" && info.keycloakIssuer !== "" && info.keycloakClientId !== "";
}

function shouldAutoAttempt(info: AuthModeInfo): boolean {
  if (!isKeycloakReady(info)) {
    return false;
  }
  if (autoAttemptDecision === null) {
    autoAttemptDecision = !consumeAutoLoginSkip();
  }
  return autoAttemptDecision;
}

// 로그아웃 직후 1회성 "모든 세션 종료" 패널용 id_token - consume 부수효과를 모듈 캐시로 멱등화(StrictMode 안전).
let ssoHintDecision: string | null | undefined;

function getSsoLogoutHint(): string | null {
  if (ssoHintDecision === undefined) {
    ssoHintDecision = consumeSsoLogoutHint();
  }
  return ssoHintDecision;
}

export default function LoginPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [modeInfo, setModeInfo] = useState<AuthModeInfo | null>(null);
  const [autoSigning, setAutoSigning] = useState(false);
  const [signinFailed, setSigninFailed] = useState(false);
  const [ssoHint] = useState(getSsoLogoutHint);

  // 모드 조회 - Providers와 캐시 공유(부팅당 1회만 fetch). keycloak이면 이어서 자동 silent 로그인 여부도 정한다(카드 플래시 방지).
  useEffect(() => {
    let alive = true;
    void getCachedAuthMode().then((info) => {
      if (!alive) return;
      setModeInfo(info);
      if (shouldAutoAttempt(info)) {
        setAutoSigning(true);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  // 자동 silent 로그인 - SSO 세션 있으면 버튼 없이 즉시 복귀. 시도 직전에 억제 플래그를 세워
  // 실패(login_required) 복귀 시 다음 로그인 마운트 1회를 억제한다(성공하면 AuthGate가 해제).
  useEffect(() => {
    if (!autoSigning || autoAttemptStarted || !modeInfo) {
      return;
    }
    autoAttemptStarted = true;
    setAutoLoginSkip();
    void (async () => {
      try {
        await new Promise((resolve) => setTimeout(resolve, AUTO_LOGIN_MIN_VISIBLE_MS));
        await signinRedirectFromLogin(modeInfo, { promptNone: true });
      } catch (e) {
        // Keycloak 미응답 등 - 카드로 폴백. 플래그는 원복해 다음 방문에 자동 시도를 유지한다.
        console.error("silent login attempt failed", e);
        clearAutoLoginSkip();
        autoAttemptDecision = false;
        setAutoSigning(false);
      }
    })();
  }, [autoSigning, modeInfo]);

  const handleKeycloakSignin = async () => {
    if (!modeInfo) return;
    clearAutoLoginSkip();
    setSigninFailed(false);
    try {
      await signinRedirectFromLogin(modeInfo);
    } catch (e) {
      // signinRedirect는 보통 페이지를 떠나므로 실패해야만 여기 도달 - 안 잡으면 버튼이 죽은 것처럼 보인다
      console.error("keycloak signin redirect failed", e);
      setSigninFailed(true);
    }
  };

  // Keycloak 모든 세션 종료 - 종료 후 /login 복귀 시 무의미한 silent 시도 왕복을 막는 억제 플래그를 먼저 세운다
  const handleSsoSignoutAll = async () => {
    if (!modeInfo) return;
    setAutoLoginSkip();
    await signoutAllSessions(modeInfo, ssoHint);
  };

  const handlePickDev = (loginId: string) => {
    storeDevUser(loginId);
    router.replace(consumeReturnTo() ?? "/");
  };

  if (modeInfo === null || autoSigning) {
    // 모드 미확정 또는 silent 시도 중 - 클릭 가능한 카드 플래시 대신 로딩 화면
    return <AuthLoadingScreen />;
  }

  return (
    <div className="flex flex-1 items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-4">
        <div data-testid="login-card" className="relative space-y-4 rounded-lg border border-line bg-surface p-6">
          <div className="absolute right-3 top-3">
            <LangToggle testId="login-lang" />
          </div>
          <div className="pr-20">
            <h1 className="login-brand"><BrandMark size={28} />SOP Archivist</h1>
            <p className="text-sm text-ink-2">{t("login.subtitle")}</p>
          </div>

          {modeInfo.mode === "keycloak" && (
            <div className="space-y-2">
              <button
                type="button"
                data-testid="login-keycloak"
                disabled={!isKeycloakReady(modeInfo)}
                className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-accent text-sm font-semibold text-on-accent hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => void handleKeycloakSignin()}
              >
                <Lock size={16} strokeWidth={1.5} />
                {t("login.keycloak")}
              </button>
              {!isKeycloakReady(modeInfo) && (
                <p data-testid="login-unavailable" className="text-sm text-ink-2">
                  {t("login.unavailable")}
                </p>
              )}
              {signinFailed && (
                <p data-testid="login-error" className="text-sm text-ink-2">
                  {t("login.startFailed")}
                </p>
              )}
            </div>
          )}

          {modeInfo.mode === "dev" && <DevLoginPicker onPick={handlePickDev} />}
        </div>

        {/* 로그아웃 직후 1회 노출 - SSO 세션은 아직 살아 있음을 알리고 전체 종료를 제공한다(keycloak 전용) */}
        {modeInfo.mode === "keycloak" && ssoHint && (
          <div data-testid="login-sso-panel" className="space-y-3 rounded-lg border border-line bg-surface p-4">
            <p className="text-sm text-ink-2">{t("login.ssoActiveBody")}</p>
            <button
              type="button"
              data-testid="login-sso-signout-all"
              className="flex h-9 w-full items-center justify-center gap-2 rounded-md border border-line-2 text-sm font-semibold text-ink-2 hover:bg-sunken"
              onClick={() => void handleSsoSignoutAll()}
            >
              <LogOut size={16} strokeWidth={1.5} />
              {t("login.ssoSignoutAll")}
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
