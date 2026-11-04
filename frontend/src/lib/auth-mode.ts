// 인증 모드는 백엔드가 런타임에 알려준다 — NEXT_PUBLIC_* 빌드 상수를 쓰면 모드를 바꿀 때마다
// 프런트 이미지를 다시 구워야 한다.

export type AuthMode = "keycloak" | "dev";

export interface AuthModeInfo {
  mode: AuthMode;
  keycloakIssuer: string;
  keycloakClientId: string;
}

const MODES: AuthMode[] = ["keycloak", "dev"];

// 모드를 못 읽었을 때 인증이 열리면 안 되므로 가장 엄격한 모드로 떨어진다.
const FALLBACK: AuthModeInfo = { mode: "keycloak", keycloakIssuer: "", keycloakClientId: "" };

function isAuthMode(value: unknown): value is AuthMode {
  return typeof value === "string" && MODES.includes(value as AuthMode);
}

let cachedModePromise: Promise<AuthModeInfo> | null = null;

// Providers·로그인 페이지·상단 바가 모두 부팅 시 같은 값을 묻는다 — 매 마운트마다 재요청하지 않도록
// 인플라이트/완료된 promise를 모듈 캐시로 공유한다. fetchAuthMode 자체는 테스트가 직접 쓰므로 그대로 둔다.
// 폴백(fail-closed) 결과는 캐시하지 않는다 — 부팅 시 일시적 오류를 세션 내내 고정하면 실제 모드가
// 복구돼도 새로고침 전까지 keycloak으로 갇힌다. 성공 응답만 태워 단일 비행(single-flight) 성질을 유지.
export function getCachedAuthMode(): Promise<AuthModeInfo> {
  if (!cachedModePromise) {
    const promise = fetchAuthMode().then((info) => {
      if (info === FALLBACK) {
        cachedModePromise = null;
      }
      return info;
    });
    cachedModePromise = promise;
  }
  return cachedModePromise;
}

export async function fetchAuthMode(): Promise<AuthModeInfo> {
  try {
    const res = await fetch("/api/auth/mode", { cache: "no-store" });
    if (!res.ok) {
      return FALLBACK;
    }
    const body: unknown = await res.json();
    if (typeof body !== "object" || body === null || !("mode" in body)) {
      return FALLBACK;
    }
    const raw = body as Record<string, unknown>;
    if (!isAuthMode(raw.mode)) {
      return FALLBACK;
    }
    return {
      mode: raw.mode,
      keycloakIssuer: typeof raw.keycloakIssuer === "string" ? raw.keycloakIssuer : "",
      keycloakClientId: typeof raw.keycloakClientId === "string" ? raw.keycloakClientId : "",
    };
  } catch {
    return FALLBACK;
  }
}
