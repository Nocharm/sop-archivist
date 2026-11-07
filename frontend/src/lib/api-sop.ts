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

// --- 문서 ---

export type DocSide = "old" | "new";
export type DocStatus = "ready" | "rejected" | "failed";
export type LanguageLayout = "ko_en_interleaved" | "ko_en_separate" | "en_only" | "ko_only";
export const LANGUAGE_LAYOUTS: readonly LanguageLayout[] = ["ko_en_interleaved", "ko_en_separate", "en_only", "ko_only"];
export type TargetDocType = "sop" | "wi";

export interface ExtractionWarning {
  id: number;
  kind: string;
  block_id: number | null;
  detail: Record<string, unknown>;
  needs_ack: boolean;
  acked_by: string | null;
  acked_at: string | null;
  ack_note: string;
}

export interface SopDocument {
  id: number;
  side: DocSide;
  file_name: string;
  file_format: string;
  size_bytes: number;
  doc_code: string;
  doc_version: string;
  title: string;
  language_layout: LanguageLayout;
  status: DocStatus;
  status_reason: string;
  revision: number;
  target_doc_id: number | null;
  uploaded_by: string;
  uploaded_at: string;
  extraction: { id: number; aux_status: "ok" | "failed"; warnings: ExtractionWarning[] } | null;
}

export interface DocumentUpdateInput {
  revision: number;
  doc_code?: string;
  doc_version?: string;
  title?: string;
  language_layout?: LanguageLayout;
}

export interface UploadInput {
  file: File;
  side: DocSide;
  docType?: TargetDocType;
  parentCode?: string;
}

export function listDocuments(bundleId: number): Promise<SopDocument[]> {
  return apiFetch<SopDocument[]>(`/bundles/${bundleId}/documents`);
}

export function uploadDocument(bundleId: number, { file, side, docType, parentCode }: UploadInput): Promise<SopDocument> {
  const form = new FormData();
  form.append("file", file);
  form.append("side", side);
  if (side === "new" && docType) form.append("doc_type", docType);
  if (side === "new" && parentCode) form.append("parent_code", parentCode);
  return apiFetch<SopDocument>(`/bundles/${bundleId}/documents`, { method: "POST", body: form });
}

export function updateDocument(bundleId: number, docId: number, body: DocumentUpdateInput): Promise<SopDocument> {
  return apiFetch<SopDocument>(`/bundles/${bundleId}/documents/${docId}`, { method: "PATCH", body: JSON.stringify(body) });
}

export function deleteDocument(bundleId: number, docId: number, revision: number, confirm = false): Promise<void> {
  const query = new URLSearchParams({ revision: String(revision), confirm: String(confirm) });
  return apiFetch<void>(`/bundles/${bundleId}/documents/${docId}?${query}`, { method: "DELETE" });
}
