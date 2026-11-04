// 백엔드 REST 호출 공용 래퍼 — 인증 헤더 선택·FastAPI detail 추출·ApiError. 화면별 API 함수는 이 파일에 얹는다.
// 경로는 `/api` 뒤만 적는다(`apiFetch("/me")` → `/api/me`). 개발 서버는 next.config rewrites, 운영은 nginx가 backend로 넘긴다.

import { getStoredDevUser } from "./dev-auth";

// 인증 토큰 — Providers가 Keycloak 로그인 후 주입한다. dev 모드면 null로 두고 X-Dev-User를 쓴다.
let authToken: string | null = null;

export function setAuthToken(token: string | null): void {
  authToken = token;
}

/** HTTP 오류 응답. status 0은 서버에 닿지 못한 네트워크 오류, detail은 사람이 읽을 수 있게 정리한 서버 사유. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
    message: string = `API request failed: ${status}${detail ? ` - ${detail}` : ""}`,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// FastAPI는 문자열 detail(업무 오류) 또는 {msg} 배열(422 검증 실패)을 준다. JSON이 아니면(프록시 오류 등) 원문 그대로.
function extractDetail(bodyText: string): string {
  try {
    const parsed: unknown = JSON.parse(bodyText);
    if (isRecord(parsed)) {
      const { detail } = parsed;
      if (typeof detail === "string") return detail;
      if (Array.isArray(detail)) {
        const msgs = detail.flatMap((item: unknown) =>
          isRecord(item) && typeof item.msg === "string" ? [item.msg] : [],
        );
        if (msgs.length > 0) return msgs.join("; ");
      }
    }
  } catch {
    // JSON 아님 - 원문 폴백
  }
  return bodyText;
}

/**
 * `/api` 아래 엔드포인트 호출. 토큰이 있으면 Bearer, 없고 dev 사용자가 저장돼 있으면 X-Dev-User.
 * init.headers는 일반 객체로 넘긴다(Headers 인스턴스는 펼쳐지지 않는다).
 */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const method = init?.method ?? "GET";
  const headers: Record<string, string> = {};
  // multipart 같은 비문자열 body에는 브라우저가 Content-Type을 직접 정해야 하므로 문자열 body에만 JSON을 선언한다.
  if (typeof init?.body === "string") {
    headers["Content-Type"] = "application/json";
  }
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  } else {
    // 요청마다 읽는다 - 모듈 변수에 캐시하면 사용자 전환 직후 첫 요청이 이전 사용자로 나간다.
    const devUser = getStoredDevUser();
    if (devUser) headers["X-Dev-User"] = devUser;
  }

  let response: Response;
  try {
    response = await fetch(`/api${path}`, { ...init, headers: { ...headers, ...init?.headers } });
  } catch (e) {
    // 호출자가 일부러 취소한 요청은 오류가 아니다.
    // (이름으로 판별 - jsdom처럼 DOMException이 Error 하위 타입이 아닌 환경에서도 같게 동작한다)
    if (isRecord(e) && e.name === "AbortError") throw e;
    throw new ApiError(0, e instanceof Error ? e.message : String(e), `API ${method} ${path} failed: network error`);
  }

  if (!response.ok) {
    const detail = extractDetail(await response.text().catch(() => ""));
    throw new ApiError(
      response.status,
      detail,
      `API ${method} ${path} failed: ${response.status}${detail ? ` - ${detail}` : ""}`,
    );
  }
  if (response.status === 204) {
    // 본문 없음 - 호출자는 T를 void로 둔다
    return undefined as T;
  }
  return (await response.json()) as T;
}
