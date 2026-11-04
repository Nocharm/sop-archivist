// 로그인 리다이렉트 보조 — 딥링크 복원(returnTo) + 자동 silent 로그인 억제 플래그. sessionStorage(탭 단위).
const RETURN_TO_KEY = "sopa.returnTo";
const AUTO_LOGIN_SKIP_KEY = "sopa.autoLoginSkip";

function getStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.sessionStorage;
  } catch {
    return null; // 프라이버시 모드 등 접근 불가 — 딥링크 복원 없이 기존 흐름으로
  }
}

// open redirect 방지 — 내부 경로만("/" 시작, "//"·"/login"·루트 제외)
export function isSafeReturnPath(path: string): boolean {
  return path.startsWith("/") && !path.startsWith("//") && path !== "/" && !path.startsWith("/login");
}

export function saveReturnTo(path: string): void {
  if (!isSafeReturnPath(path)) {
    return;
  }
  getStorage()?.setItem(RETURN_TO_KEY, path);
}

export function peekReturnTo(): string | null {
  const value = getStorage()?.getItem(RETURN_TO_KEY) ?? null;
  return value !== null && isSafeReturnPath(value) ? value : null;
}

export function consumeReturnTo(): string | null {
  const value = peekReturnTo();
  getStorage()?.removeItem(RETURN_TO_KEY);
  return value;
}

export function setAutoLoginSkip(): void {
  getStorage()?.setItem(AUTO_LOGIN_SKIP_KEY, "1");
}

export function clearAutoLoginSkip(): void {
  getStorage()?.removeItem(AUTO_LOGIN_SKIP_KEY);
}

// 소비형 — 억제는 "다음 로그인 페이지 1회"만. 이후 정상 재방문은 세션 있으면 다시 자동 로그인.
export function consumeAutoLoginSkip(): boolean {
  const storage = getStorage();
  const skipped = storage?.getItem(AUTO_LOGIN_SKIP_KEY) === "1";
  storage?.removeItem(AUTO_LOGIN_SKIP_KEY);
  return skipped;
}

const AUTH_RETRY_KEY = "sopa.authRetry";
// 비-login_required 에러(state 불일치·네트워크 등) 시 silent 자동 재시도 상한.
// 세션이 살아있으면 재시도로 클릭 없이 로그인되고, 지속성 에러(시계 오차 등)는 상한에서 카드로 폴백해 루프를 막는다.
const MAX_AUTH_RETRY = 1;

// 재시도 여력이 남았으면 카운트를 올리고 true(=silent 재시도), 소진이면 리셋 후 false(=로그인 카드로).
export function tryConsumeAuthRetry(): boolean {
  const storage = getStorage();
  const count = Number(storage?.getItem(AUTH_RETRY_KEY) ?? "0") || 0;
  if (count >= MAX_AUTH_RETRY) {
    storage?.removeItem(AUTH_RETRY_KEY);
    return false;
  }
  storage?.setItem(AUTH_RETRY_KEY, String(count + 1));
  return true;
}

// 로그인 성공·세션 없음 확정 등 "깨끗한" 상태 도달 시 재시도 예산을 초기화.
export function clearAuthRetry(): void {
  getStorage()?.removeItem(AUTH_RETRY_KEY);
}

const SSO_LOGOUT_HINT_KEY = "sopa.ssoLogoutHint";

// 로그아웃 직전에 확보한 id_token — /login의 "모든 세션 종료" 패널이 id_token_hint로 1회 사용.
// (removeUser 후에는 로컬 토큰이 없어 Keycloak end_session이 확인 화면을 요구하게 됨)
export function saveSsoLogoutHint(idToken: string): void {
  getStorage()?.setItem(SSO_LOGOUT_HINT_KEY, idToken);
}

export function consumeSsoLogoutHint(): string | null {
  const storage = getStorage();
  const value = storage?.getItem(SSO_LOGOUT_HINT_KEY) ?? null;
  storage?.removeItem(SSO_LOGOUT_HINT_KEY);
  return value;
}
