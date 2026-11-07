// SOP 재구성 API 호출과 응답 타입 - 백엔드 routers/sop_*.py의 응답 모델을 옮긴 것. 공용 래퍼는 api.ts의 apiFetch.

import { apiFetch } from "./api";

/** 의미 검토 항목 - 백엔드 constants.SEMANTIC_CHECK_KEYS와 같은 값 */
export const SEMANTIC_CHECK_KEYS = ["numbers", "conditions", "tables", "figures"] as const;

export type BundleStatus = "in_progress" | "in_review" | "done";
export type MemberRole = "author" | "reviewer";

export interface LangProgress {
  total: number;
  unassigned: number;
  ai_suggested: number;
  confirmed: number;
  on_hold: number;
}

export interface BundleProgress {
  ko: LangProgress;
  en: LangProgress;
}

export interface BundleListItem {
  id: number;
  title: string;
  status: BundleStatus;
  my_role: MemberRole;
  updated_at: string;
  progress: BundleProgress;
}

export interface BundleMember {
  login_id: string;
  role: MemberRole;
  name: string;
  korean_name: string;
  active: boolean;
}

export type NextAction =
  | "upload_documents"
  | "resolve_documents"
  | "fill_tobe"
  | "decide_units"
  | "ack_warnings"
  | "fill_reasons"
  | "semantic_checks"
  | "add_reviewer"
  | "request_review"
  | "await_review"
  | "done";

export interface AiJobCounts {
  queued: number;
  running: number;
  done: number;
  failed: number;
  stale: number;
  cancelled: number;
}

export interface Bundle {
  id: number;
  title: string;
  description: string;
  status: BundleStatus;
  is_synthetic: boolean;
  semantic_checks: Record<string, unknown>;
  revision: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  my_role: MemberRole | null;
  members: BundleMember[];
  progress: BundleProgress;
  next_action: NextAction;
  ai_jobs: AiJobCounts;
}

/** 막는 이유·알림 한 건 - 코드마다 문맥 필드가 다르다(review.py) */
export interface ReadinessIssue {
  code: string;
  lang?: "ko" | "en";
  count?: number;
  missing?: string[];
  [key: string]: unknown;
}

export interface Readiness {
  ready: boolean;
  blockers: ReadinessIssue[];
  notices: ReadinessIssue[];
  next_action: NextAction;
}

export interface AiStatus {
  ai_enabled: boolean;
  embed_enabled: boolean;
  jobs: AiJobCounts;
}

export interface BundleCreateInput {
  title: string;
  description: string;
  is_synthetic: boolean;
}

export function listBundles(): Promise<BundleListItem[]> {
  return apiFetch<BundleListItem[]>("/bundles");
}

export function createBundle(body: BundleCreateInput): Promise<Bundle> {
  return apiFetch<Bundle>("/bundles", { method: "POST", body: JSON.stringify(body) });
}

export function getBundle(bundleId: number): Promise<Bundle> {
  return apiFetch<Bundle>(`/bundles/${bundleId}`);
}

export function getReadiness(bundleId: number): Promise<Readiness> {
  return apiFetch<Readiness>(`/bundles/${bundleId}/review/readiness`);
}

export function getAiStatus(bundleId: number): Promise<AiStatus> {
  return apiFetch<AiStatus>(`/bundles/${bundleId}/ai/status`);
}

export function requestReview(bundleId: number, revision: number): Promise<Bundle> {
  return apiFetch<Bundle>(`/bundles/${bundleId}/review/request`, { method: "POST", body: JSON.stringify({ revision }) });
}
