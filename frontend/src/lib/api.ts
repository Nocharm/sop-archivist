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
  /** SOP API의 업무 규칙 거절 - detail이 {code, ...문맥} 모양일 때만 있다(backend app/sop/errors.raise_rule) */
  rule: ApiRule | null = null;

  constructor(
    readonly status: number,
    readonly detail: string,
    message: string = `API request failed: ${status}${detail ? ` - ${detail}` : ""}`,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiRule {
  code: string;
  [context: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// FastAPI는 문자열 detail(업무 오류) 또는 {msg} 배열(422 검증 실패)을 준다. JSON이 아니면(프록시 오류 등) 원문 그대로.
function extractRule(bodyText: string): ApiRule | null {
  try {
    const parsed: unknown = JSON.parse(bodyText);
    if (isRecord(parsed) && isRecord(parsed.detail) && typeof parsed.detail.code === "string") {
      return { ...parsed.detail, code: parsed.detail.code };
    }
  } catch {
    // JSON 아님 - 규칙 거절이 아니다
  }
  return null;
}

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
  const response = await sendRequest(path, init);
  if (response.status === 204) {
    // 본문 없음 - 호출자는 T를 void로 둔다
    return undefined as T;
  }
  return (await response.json()) as T;
}

/** 파일 내려받기(Excel 등) - 인증 헤더가 필요해 <a href>로는 받지 못한다. 오류는 apiFetch와 같은 ApiError */
export async function apiFetchBlob(path: string, init?: RequestInit): Promise<Blob> {
  const response = await sendRequest(path, init);
  return response.blob();
}

async function sendRequest(path: string, init?: RequestInit): Promise<Response> {
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
    const bodyText = await response.text().catch(() => "");
    const rule = extractRule(bodyText);
    const detail = rule ? rule.code : extractDetail(bodyText);
    const error = new ApiError(
      response.status,
      detail,
      `API ${method} ${path} failed: ${response.status}${detail ? ` - ${detail}` : ""}`,
    );
    error.rule = rule;
    throw error;
  }
  return response;
}

/** GET /api/me - 로그인한 사람의 신원과 유효 권한. 직원 행이 없으면(HR 동기화 전 첫 로그인) 신원 칸은 빈 문자열, permissions는 빈 배열. */
export interface Me {
  login_id: string;
  name: string;
  korean_name: string;
  department: string;
  dept_path: string;
  is_sysadmin: boolean;
  permissions: string[];
  /** 권한 키 → 출처(유효 권한 조회와 같은 모양). sysadmin이면 빈 객체다. */
  sources: Record<string, EffectiveSource[]>;
  auth_mode: "keycloak" | "dev";
  ai_enabled: boolean;
  /** 오늘 이전 마지막 접속일의 첫 접속 시각(KST 하루 단위). 처음 쓰는 날은 null */
  last_login_at: string | null;
}

export function getMe(): Promise<Me> {
  return apiFetch<Me>("/me");
}

// ── 관리 화면 API (Task 10) - 필드 이름은 backend 응답 모델(routers/access.py·admin.py·directory.py) 그대로 ──

/** 부여 대상 종류 - user는 login_id, dept는 dept_code가 subject_id다. */
export type SubjectType = "user" | "dept";

/** GET /api/access/roles 한 줄 - permissions는 이름순(표시 순서는 화면이 카탈로그 순서로 다시 정한다). */
export interface Role {
  id: number;
  name: string;
  description: string;
  permissions: string[];
  grant_count: number;
}

export interface RoleInput {
  name: string;
  description: string;
  permissions: string[];
}

/** 대상이 사라진 부여(조직 개편·퇴직)는 지워지지 않고 subject_missing=true, subject_name=""로 온다. */
export interface Grant {
  id: number;
  subject_type: SubjectType;
  subject_id: string;
  subject_name: string;
  subject_missing: boolean;
  role_id: number | null;
  role_name: string | null;
  permission: string | null;
  created_by: string;
  created_at: string;
}

/** role_id와 permission 중 정확히 하나만 보낸다(둘 다·둘 다 없음은 422). */
export interface GrantInput {
  subject_type: SubjectType;
  subject_id: string;
  role_id?: number;
  permission?: string;
}

/** 변경 기록 한 줄 - action은 role.create|update|delete, grant.add|remove. detail 모양은 action마다 다르다. */
export interface AuditEvent {
  id: number;
  occurred_at: string;
  actor: string;
  action: string;
  detail: Record<string, unknown>;
}

export interface EffectiveSource {
  kind: SubjectType;
  subject_id: string;
  subject_name: string;
  /** 역할로 받았으면 역할 이름, 권한 직접 부여면 null */
  role: string | null;
}

/** 유효 권한 조회 - sysadmin이면 sources가 비고 permissions는 카탈로그 전부다. */
export interface EffectiveAccess {
  login_id: string;
  known: boolean;
  active: boolean;
  is_sysadmin: boolean;
  permissions: string[];
  sources: Record<string, EffectiveSource[]>;
}

export interface DirectoryUser {
  login_id: string;
  name: string;
  korean_name: string;
  department: string;
  dept_code: string | null;
  dept_path: string;
}

export interface Department {
  dept_code: string;
  parent_dept_code: string | null;
  name: string;
  name_ko: string;
  level: number;
}

export interface HrSyncSummary {
  scanned: number;
  upserted: number;
  deactivated: number;
  deleted: number;
  skipped: number;
  org_mismatches: number;
  truncated_levels: number;
  departments_upserted: number;
  aborted_reason: string | null;
  created: number;
  reactivated: number;
  duplicates: number;
  managed: number;
  mass_departure: boolean;
}

export interface HrSyncPreview {
  scanned: number;
  skipped: number;
  would_upsert: number;
  would_deactivate: number;
  would_delete: number;
  org_mismatches: number;
  truncated_levels: number;
  korean_overwrites: number;
  new_login_ids: string[];
  delete_login_ids: string[];
  case_mismatches: string[];
}

export interface HrSyncRun {
  id: number;
  ran_at: string;
  outcome: string;
  detail: string | null;
  scanned: number;
  created: number;
  deactivated: number;
  reactivated: number;
  deleted: number;
  skipped: number;
  duplicates: number;
  managed: number;
  mass_departure: boolean;
}

/** (job, outcome)별 최신 1행 */
export interface BatchRun {
  job: string;
  outcome: string;
  ran_at: string;
  detail: string | null;
}

export interface AiPing {
  ok: boolean;
  model: string;
  latency_ms: number;
  reply_ok: boolean;
}

/** KST 하루치 AI 호출 집계 - date는 YYYY-MM-DD */
export interface AiUsageDay {
  date: string;
  calls: number;
  failed: number;
  prompt_tokens: number;
  completion_tokens: number;
}

export function listRoles(): Promise<Role[]> {
  return apiFetch<Role[]>("/access/roles");
}

export function createRole(body: RoleInput): Promise<Role> {
  return apiFetch<Role>("/access/roles", { method: "POST", body: JSON.stringify(body) });
}

export function updateRole(id: number, body: RoleInput): Promise<Role> {
  return apiFetch<Role>(`/access/roles/${id}`, { method: "PUT", body: JSON.stringify(body) });
}

export function deleteRole(id: number): Promise<void> {
  return apiFetch<void>(`/access/roles/${id}`, { method: "DELETE" });
}

export function listGrants(): Promise<Grant[]> {
  return apiFetch<Grant[]>("/access/grants");
}

export function addGrant(body: GrantInput): Promise<Grant> {
  return apiFetch<Grant>("/access/grants", { method: "POST", body: JSON.stringify(body) });
}

export function removeGrant(id: number): Promise<void> {
  return apiFetch<void>(`/access/grants/${id}`, { method: "DELETE" });
}

/** limit을 생략하면 서버 기본(100). 서버는 500으로 자른다. */
export function listAudit(limit?: number): Promise<AuditEvent[]> {
  return apiFetch<AuditEvent[]>(limit === undefined ? "/access/audit" : `/access/audit?limit=${limit}`);
}

export function getEffective(loginId: string): Promise<EffectiveAccess> {
  return apiFetch<EffectiveAccess>(`/access/effective/${encodeURIComponent(loginId)}`);
}

// 디렉터리 검색 한 번에 받는 최대 인원 - 서버 상한(50)과 같다
export const DIRECTORY_SEARCH_LIMIT = 50;

export function searchDirectory(q: string): Promise<DirectoryUser[]> {
  return apiFetch<DirectoryUser[]>(`/directory?q=${encodeURIComponent(q)}&limit=${DIRECTORY_SEARCH_LIMIT}`);
}

export function listDepartments(): Promise<Department[]> {
  return apiFetch<Department[]>("/departments");
}

export function runHrSync(): Promise<HrSyncSummary> {
  return apiFetch<HrSyncSummary>("/admin/hr-sync", { method: "POST" });
}

export function getHrSyncPreview(): Promise<HrSyncPreview> {
  return apiFetch<HrSyncPreview>("/admin/hr-sync/preview");
}

export function listHrSyncRuns(): Promise<HrSyncRun[]> {
  return apiFetch<HrSyncRun[]>("/admin/hr-sync/runs");
}

export function listBatchRuns(): Promise<BatchRun[]> {
  return apiFetch<BatchRun[]>("/admin/batch-runs");
}

export function pingAi(): Promise<AiPing> {
  return apiFetch<AiPing>("/admin/ai/ping", { method: "POST" });
}

/** days를 생략하면 서버 기본(30), 범위는 1~365. */
export function getAiUsage(days?: number): Promise<AiUsageDay[]> {
  return apiFetch<AiUsageDay[]>(days === undefined ? "/admin/ai/usage" : `/admin/ai/usage?days=${days}`);
}
