// 묶음 관리·AI 요청·관리자 묶음·AI 지침 API - 백엔드에는 있었지만 화면이 없던 엔드포인트의 프런트 계약.
// 모양은 backend routers/sop_bundles.py·sop_ai.py·sop_admin.py·sop_guidelines.py와 계획 2 문서 "API 계약"을 따른다.
import { apiFetch, apiFetchBlob } from "./api";
import type { AiJobKind, AiSuggestion, Bundle, BundleMember, BundleStatus, MemberRole, RowProgress } from "./api-sop";

// ---- 묶음 관리 -------------------------------------------------------------

export interface BundleUpdateInput {
  revision: number;
  title?: string;
  description?: string;
  is_synthetic?: boolean;
}

export function updateBundle(bundleId: number, body: BundleUpdateInput): Promise<Bundle> {
  return apiFetch<Bundle>(`/bundles/${bundleId}`, { method: "PATCH", body: JSON.stringify(body) });
}

export function deleteBundle(bundleId: number, revision: number): Promise<void> {
  return apiFetch<void>(`/bundles/${bundleId}?revision=${revision}`, { method: "DELETE" });
}

export interface MemberInput {
  login_id: string;
  role: MemberRole;
}

export function putMembers(bundleId: number, revision: number, members: MemberInput[]): Promise<Bundle> {
  return apiFetch<Bundle>(`/bundles/${bundleId}/members`, { method: "PUT", body: JSON.stringify({ revision, members }) });
}

export interface BundleEvent {
  id: number;
  occurred_at: string;
  actor: string;
  action: string;
  target_type: string;
  target_ids: Array<number | string>;
  reason: string;
  /** 바뀐 값의 전/후(이름·설명·시험용 표시, 멤버 변경). 지난 사건과 다른 종류는 빈 객체 */
  detail: EventDetail;
}

export interface EventChange {
  from: string | boolean;
  to: string | boolean;
}

export interface EventDetail {
  title?: EventChange;
  description?: EventChange;
  is_synthetic?: EventChange;
  added?: Array<{ login_id: string; role: string }>;
  removed?: string[];
  role_changed?: Array<{ login_id: string; from: string; to: string }>;
}

/** 최근 사건부터. beforeId를 주면 그보다 오래된 쪽(History 화면의 다음 쪽). 서버 상한은 한 번에 500건이다 */
export function listBundleEvents(bundleId: number, limit = 500, beforeId?: number): Promise<BundleEvent[]> {
  const before = beforeId === undefined ? "" : `&before_id=${beforeId}`;
  return apiFetch<BundleEvent[]>(`/bundles/${bundleId}/events?limit=${limit}${before}`);
}

/** 가장 최근 검토 기록 하나(요청·완료·되돌림·다시 열기) - 편집 기록에 묻히지 않게 서버가 검토 기록만 고른다. 없으면 null */
export async function getLatestReviewEvent(bundleId: number): Promise<BundleEvent | null> {
  const events = await apiFetch<BundleEvent[]>(`/bundles/${bundleId}/events?limit=1&action_prefix=review.`);
  return events[0] ?? null;
}

export function downloadDocumentFile(bundleId: number, docId: number): Promise<Blob> {
  return apiFetchBlob(`/bundles/${bundleId}/documents/${docId}/file`);
}

// ---- AI 요청 ---------------------------------------------------------------

export type AiKind = "classify" | "translate" | "match" | "pair" | "split";

export interface AiRequestOut {
  queued: number;
  /** 이번 요청이 쌓은 작업들의 묶음 값(상단 바 작업 목록의 한 줄) - queued가 0이면 null */
  request_id: string | null;
  skipped_total: number;
  skipped: Array<{ unit_id: number; reason: string }>;
  /** 건너뛴 까닭별 수 - 합이 skipped_total, 없으면 빈 객체 */
  skipped_by_reason: Record<string, number>;
}

export interface AiScope {
  document_id?: number;
  unit_ids?: number[];
}

export function requestAi(bundleId: number, kind: AiKind, body: AiScope & { direction?: "ko_to_en" | "en_to_ko" } = {}): Promise<AiRequestOut> {
  return apiFetch<AiRequestOut>(`/bundles/${bundleId}/ai/${kind}`, { method: "POST", body: JSON.stringify(body) });
}

export function cancelAi(bundleId: number, kind?: AiJobKind): Promise<{ cancelled: number }> {
  return apiFetch(`/bundles/${bundleId}/ai/cancel`, { method: "POST", body: JSON.stringify(kind ? { kind } : {}) });
}

export function retryAi(bundleId: number, kind?: AiJobKind): Promise<{ queued: number }> {
  return apiFetch(`/bundles/${bundleId}/ai/retry`, { method: "POST", body: JSON.stringify(kind ? { kind } : {}) });
}


/** 한 종류의 적용된 제안 - 문서 하나로 좁힐 수 있다. 서버 쪽은 페이지로 주므로 다 모은다 */
export async function listAppliedSuggestions(bundleId: number, kind: AiKind, documentId?: number): Promise<AiSuggestion[]> {
  const items: AiSuggestion[] = [];
  const doc = documentId === undefined ? "" : `&document_id=${documentId}`;
  for (let offset = 0; ; offset += 500) {
    const page = await apiFetch<{ total: number; items: AiSuggestion[] }>(`/bundles/${bundleId}/ai/suggestions?kind=${kind}&result=applied&limit=500&offset=${offset}${doc}`);
    items.push(...page.items);
    if (items.length >= page.total || page.items.length === 0) return items;
  }
}

export function setSuggestionAdoption(bundleId: number, suggestionId: number, adoption: string): Promise<AiSuggestion> {
  return apiFetch<AiSuggestion>(`/bundles/${bundleId}/ai/suggestions/${suggestionId}/adoption`, { method: "POST", body: JSON.stringify({ adoption }) });
}

// ---- 관리자: 모든 묶음 ------------------------------------------------------

export interface AdminBundle {
  id: number;
  code: string;
  title: string;
  status: BundleStatus;
  revision: number;
  members: BundleMember[];
  has_active_author: boolean;
  created_at: string;
  progress: RowProgress;
}

export function listAdminBundles(): Promise<AdminBundle[]> {
  return apiFetch<AdminBundle[]>("/admin/bundles");
}

export function putAdminMembers(bundleId: number, revision: number, members: MemberInput[]): Promise<AdminBundle> {
  return apiFetch<AdminBundle>(`/admin/bundles/${bundleId}/members`, { method: "PUT", body: JSON.stringify({ revision, members }) });
}

// ---- 관리자: AI 지침·프롬프트 버전 -------------------------------------------

export interface GuidelineVersionMeta {
  version: number;
  note: string;
  is_active: boolean;
  created_by: string;
  created_at: string;
  activated_by: string | null;
  activated_at: string | null;
}

export interface GuidelineVersion extends GuidelineVersionMeta {
  key: string;
  content: string;
}

export interface Guideline {
  key: string;
  active_version: number | null;
  /** 최신 버전부터 */
  versions: GuidelineVersionMeta[];
}

export function listGuidelines(): Promise<Guideline[]> {
  return apiFetch<Guideline[]>("/admin/guidelines");
}

export function getGuidelineVersion(key: string, version: number): Promise<GuidelineVersion> {
  return apiFetch<GuidelineVersion>(`/admin/guidelines/${encodeURIComponent(key)}/versions/${version}`);
}

export function createGuidelineVersion(key: string, content: string, note: string): Promise<GuidelineVersion> {
  return apiFetch<GuidelineVersion>(`/admin/guidelines/${encodeURIComponent(key)}/versions`, { method: "POST", body: JSON.stringify({ content, note }) });
}

export function activateGuidelineVersion(key: string, version: number): Promise<GuidelineVersion> {
  return apiFetch<GuidelineVersion>(`/admin/guidelines/${encodeURIComponent(key)}/versions/${version}/activate`, { method: "POST" });
}
