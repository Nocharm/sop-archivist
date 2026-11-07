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

// --- 원문 보기와 쪼개기 편집 ---

export type UnitKind = "sentence" | "heading" | "figure" | "table" | "table_row" | "cell_sentence";
export type UnitLang = "ko" | "en" | "neutral";
export type CoverStatus = "unassigned" | "ai_suggested" | "confirmed" | "on_hold";
/** (블록 id, 시작, 끝) - 끝은 포함하지 않는다 */
export type UnitSpan = [number, number, number];

export interface ViewTable {
  id: number;
  table_index: number;
  parent_table_id: number | null;
  part: string;
  n_rows: number;
  n_cols: number;
  is_layout: boolean;
}

export interface ViewBlock {
  id: number;
  seq: number;
  part: string;
  kind: "paragraph" | "table_cell" | "figure";
  text: string;
  page: number | null;
  page_basis: string;
  section_label: string;
  heading_level: number | null;
  table_id: number | null;
  row_index: number | null;
  col_index: number | null;
  grid_span: number;
  row_span: number;
  flags: string[];
  has_image: boolean;
}

export interface ViewUnit {
  id: number;
  display_id: string;
  kind: UnitKind;
  spans: UnitSpan[];
  text: string;
  lang: UnitLang;
  table_id: number | null;
  row_index: number | null;
  group_unit_id: number | null;
  boundary_confirmed: boolean;
  status: CoverStatus | null;
  pair_id: number | null;
  pos_seq: number;
  block_id: number;
}

export interface ViewPair {
  id: number;
  status: "suggested" | "confirmed";
  source: string;
  unit_ids: number[];
}

export interface DocumentView {
  document: Omit<SopDocument, "extraction">;
  extraction: SopDocument["extraction"];
  tables: ViewTable[];
  blocks: ViewBlock[];
  units: ViewUnit[];
  pairs: ViewPair[];
  edits: { can_undo: boolean; can_redo: boolean };
}

export type EditOp =
  | { type: "split"; unit_id: number; at: number }
  | { type: "merge"; unit_ids: number[] }
  | { type: "move_boundary"; left_unit_id: number; right_unit_id: number; at: number }
  | { type: "carve"; block_id: number; start: number; end: number }
  | { type: "set_language"; unit_ids: number[]; lang: "ko" | "en" }
  | { type: "split_table_rows"; table_unit_id: number }
  | { type: "merge_table_rows"; table_id: number }
  | { type: "set_layout_table"; table_id: number; is_layout: boolean };

export interface EditResult {
  document_revision: number;
  created_unit_ids: number[];
  retired_unit_ids: number[];
}

export interface PairResult {
  document_revision: number;
  pair: ViewPair | null;
}

export function getDocumentView(bundleId: number, docId: number): Promise<DocumentView> {
  return apiFetch<DocumentView>(`/bundles/${bundleId}/documents/${docId}/view`);
}

const docPath = (bundleId: number, docId: number) => `/bundles/${bundleId}/documents/${docId}`;

export function editUnits(bundleId: number, docId: number, revision: number, op: EditOp, confirm = false): Promise<EditResult> {
  return apiFetch<EditResult>(`${docPath(bundleId, docId)}/edits`, { method: "POST", body: JSON.stringify({ revision, confirm, op }) });
}

export function undoEdit(bundleId: number, docId: number, revision: number, confirm = false): Promise<EditResult> {
  return apiFetch<EditResult>(`${docPath(bundleId, docId)}/edits/undo`, { method: "POST", body: JSON.stringify({ revision, confirm }) });
}

export function redoEdit(bundleId: number, docId: number, revision: number, confirm = false): Promise<EditResult> {
  return apiFetch<EditResult>(`${docPath(bundleId, docId)}/edits/redo`, { method: "POST", body: JSON.stringify({ revision, confirm }) });
}

export function setBoundaryConfirmed(bundleId: number, docId: number, unitIds: number[], confirmed: boolean): Promise<{ unit_ids: number[]; confirmed: boolean }> {
  return apiFetch(`${docPath(bundleId, docId)}/units/boundary`, { method: "POST", body: JSON.stringify({ unit_ids: unitIds, confirmed }) });
}

export function createPair(bundleId: number, docId: number, revision: number, unitIds: number[]): Promise<PairResult> {
  return apiFetch<PairResult>(`${docPath(bundleId, docId)}/pairs`, { method: "POST", body: JSON.stringify({ revision, unit_ids: unitIds }) });
}

export function confirmPair(bundleId: number, docId: number, pairId: number, revision: number): Promise<PairResult> {
  return apiFetch<PairResult>(`${docPath(bundleId, docId)}/pairs/${pairId}/confirm`, { method: "POST", body: JSON.stringify({ revision }) });
}

export function deletePair(bundleId: number, docId: number, pairId: number, revision: number): Promise<PairResult> {
  return apiFetch<PairResult>(`${docPath(bundleId, docId)}/pairs/${pairId}?revision=${revision}`, { method: "DELETE" });
}

export function ackWarning(bundleId: number, warningId: number, note = ""): Promise<ExtractionWarning> {
  return apiFetch<ExtractionWarning>(`/bundles/${bundleId}/warnings/${warningId}/ack`, { method: "POST", body: JSON.stringify({ note }) });
}
