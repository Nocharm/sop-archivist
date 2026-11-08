// 묶음 관리·AI 요청·관리자 묶음·AI 지침 API - 백엔드에는 있었지만 화면이 없던 엔드포인트의 프런트 계약.
// 모양은 backend routers/sop_bundles.py·sop_ai.py·sop_admin.py·sop_guidelines.py와 계획 2 문서 "API 계약"을 따른다.
import { apiFetch, apiFetchBlob } from "./api";
import type { AiSuggestion, Bundle, BundleMember, BundleProgress, BundleStatus, MemberRole } from "./api-sop";

// ---- 묶음 관리 -------------------------------------------------------------

export interface BundleUpdateInput {
  revision: number;
  title?: string;
  description?: string;
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
}

/** 최근 사건부터. 서버 상한은 500건이다 */
export function listBundleEvents(bundleId: number, limit = 500): Promise<BundleEvent[]> {
  return apiFetch<BundleEvent[]>(`/bundles/${bundleId}/events?limit=${limit}`);
}

export function downloadDocumentFile(bundleId: number, docId: number): Promise<Blob> {
  return apiFetchBlob(`/bundles/${bundleId}/documents/${docId}/file`);
}

// ---- AI 요청 ---------------------------------------------------------------

export type AiKind = "classify" | "translate" | "match" | "pair" | "split";

export interface AiRequestOut {
  queued: number;
  skipped_total: number;
  skipped: Array<{ unit_id: number; reason: string }>;
}

export interface AiScope {
  document_id?: number;
  unit_ids?: number[];
}

export function requestAi(bundleId: number, kind: AiKind, body: AiScope & { direction?: "ko_to_en" | "en_to_ko" } = {}): Promise<AiRequestOut> {
  return apiFetch<AiRequestOut>(`/bundles/${bundleId}/ai/${kind}`, { method: "POST", body: JSON.stringify(body) });
}

export function cancelAi(bundleId: number, kind?: AiKind): Promise<{ cancelled: number }> {
  return apiFetch(`/bundles/${bundleId}/ai/cancel`, { method: "POST", body: JSON.stringify(kind ? { kind } : {}) });
}

export function retryAi(bundleId: number, kind?: AiKind): Promise<{ queued: number }> {
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
  title: string;
  status: BundleStatus;
  revision: number;
  members: BundleMember[];
  has_active_author: boolean;
  created_at: string;
  progress: BundleProgress;
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
