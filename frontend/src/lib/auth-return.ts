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

// 브라우저는 http URL에서 `\`를 `/`로, 탭·개행을 무시로 처리해 `/\evil.com`·`/\t/evil.com`을 `//evil.com`으로 읽는다.
// 접두 문자열 비교는 이 파서 차이를 못 막으므로 해당 문자는 아예 거부하고, 나머지는 URL 파서로 직접 확인한다.
const UNSAFE_RETURN_CHARS = /[\\\x00-\x1f\x7f]/;
// 상대 경로를 풀기 위한 가짜 기준 origin - 결과 origin이 이 값이어야 같은 사이트 경로다.
const RETURN_BASE = "http://internal.invalid";

// open redirect 방지 — 같은 origin 경로만 통과시키고 `경로+쿼리+해시`로 정규화해 돌려준다(루트·로그인 페이지 제외).
export function normalizeReturnPath(path: string): string | null {
  if (!path.startsWith("/") || UNSAFE_RETURN_CHARS.test(path)) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(path, RETURN_BASE);
  } catch {
    return null;
  }
  if (url.origin !== RETURN_BASE) {
    return null;
  }
  // 정규화된 pathname 기준이라 `/admin/../login`도 걸린다. `/loginfoo`는 다른 경로라 통과.
  if (url.pathname === "/" || url.pathname === "/login" || url.pathname.startsWith("/login/")) {
    return null;
  }
  // `/.//evil.com`처럼 점 구간이 접히면 pathname이 `//`로 시작한다. 이 문자열을 다시 풀면 프로토콜 상대 URL이
  // 되어 사이트 밖으로 나가므로(검증을 한 번 더 돌리면 통과하던 비멱등) 정규화 결과가 `//`로 시작하면 거부한다.
  if (url.pathname.startsWith("//")) {
    return null;
  }
  return url.pathname + url.search + url.hash;
}

export function isSafeReturnPath(path: string): boolean {
  return normalizeReturnPath(path) !== null;
}

export function saveReturnTo(path: string): void {
  const normalized = normalizeReturnPath(path);
  if (normalized === null) {
    return;
  }
  getStorage()?.setItem(RETURN_TO_KEY, normalized);
}

// 저장소는 변조될 수 있어(같은 탭의 다른 스크립트·확장) 읽을 때도 같은 검증을 다시 한다.
export function peekReturnTo(): string | null {
  const value = getStorage()?.getItem(RETURN_TO_KEY) ?? null;
  return value === null ? null : normalizeReturnPath(value);
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
