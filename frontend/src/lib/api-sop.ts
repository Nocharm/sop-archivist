// SOP 재구성 API 호출과 응답 타입 - 백엔드 routers/sop_*.py의 응답 모델을 옮긴 것. 공용 래퍼는 api.ts의 apiFetch.

import { apiFetch, apiFetchBlob } from "./api";

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

// --- To-Be 목록 ---

export type Entrance = "assign" | "match";

export interface TargetDoc {
  id: number;
  code: string;
  title: string;
  doc_type: TargetDocType;
  parent_code: string | null;
  entrance: Entrance;
  is_equipment_sop: boolean;
  order_index: number;
  document_id: number | null;
}

export interface NaSlot {
  code: string;
  slot_key: string;
  reason: string;
}

export interface WiStep {
  code: string;
  step_no: number;
  title: string;
}

export interface ToBe {
  revision: number;
  docs: TargetDoc[];
  na_slots: NaSlot[];
  wi_steps: WiStep[];
}

export interface ToBeInput {
  revision: number;
  docs: Array<Pick<TargetDoc, "code" | "title" | "doc_type" | "parent_code" | "is_equipment_sop" | "order_index">>;
  na_slots: NaSlot[];
  wi_steps: WiStep[];
}

/** SOP 칸 - backend constants.SLOT_KEYS와 같은 값·순서. 점이 있으면 하위 칸 */
export const SLOT_KEYS = [
  "purpose",
  "scope",
  "definitions",
  "responsibilities",
  "general_requirements",
  "general_requirements.safety",
  "general_requirements.operation",
  "procedures",
  "procedures.procedure",
  "procedures.electronic_record_control",
  "procedures.troubleshooting",
  "procedures.maintenance",
  "document_relationships",
  "document_relationships.attachments",
  "document_relationships.appendices",
] as const;

export function getToBe(bundleId: number): Promise<ToBe> {
  return apiFetch<ToBe>(`/bundles/${bundleId}/tobe`);
}

export function putToBe(bundleId: number, body: ToBeInput): Promise<ToBe> {
  return apiFetch<ToBe>(`/bundles/${bundleId}/tobe`, { method: "PUT", body: JSON.stringify(body) });
}

export function importToBe(bundleId: number, file: File, revision: number): Promise<ToBe> {
  const form = new FormData();
  form.append("file", file);
  form.append("revision", String(revision));
  return apiFetch<ToBe>(`/bundles/${bundleId}/tobe/import`, { method: "POST", body: form });
}

export function downloadToBeTemplate(bundleId: number): Promise<Blob> {
  return apiFetchBlob(`/bundles/${bundleId}/tobe/template.xlsx`);
}

// --- 배정·확정(입구 1) ---

export type Disposition = "unassigned" | "assigned" | "delete" | "move_external";
export type ChangeType = "as_is" | "tone" | "rewritten" | "table_restructured" | "new";
export type WiPart = "instruction" | "why";

export interface Decision {
  disposition: Disposition;
  move_target_code: string;
  reason: string;
  status: CoverStatus;
  hold_reason: string;
  confirmed_by: string | null;
  confirmed_at: string | null;
  revision: number;
}

export interface UnitRow {
  unit_id: number;
  document_id: number;
  display_id: string;
  kind: UnitKind;
  lang: UnitLang;
  text: string;
  table_id: number | null;
  row_index: number | null;
  group_unit_id: number | null;
  status: CoverStatus;
  decision: Decision;
  target_ids: number[];
}

export interface GroupUnit {
  unit_id: number;
  display_id: string;
  document_id: number;
  kind: UnitKind;
  lang: UnitLang;
  text: string;
  group_id: string | null;
  decision: Decision;
  cell_unit_ids: number[];
}

export interface GroupTarget {
  id: number;
  target_doc_id: number;
  slot_key: string | null;
  wi_step: number | null;
  wi_part: WiPart | null;
  section_path: string;
  order_index: number;
  lang: UnitLang;
  kind: "sentence" | "table" | "figure";
  confirmed_text: string;
  ai_text: string;
  change_type: ChangeType | null;
  origin: string;
  new_unit_id: number | null;
  parent_target_id: number | null;
  cell_row: number | null;
  cell_col: number | null;
  grid: { rows: number; cols: number } | null;
  status: CoverStatus;
  hold_reason: string;
  warnings: Array<Record<string, string>>;
  source_unit_ids: number[];
  group_id: string | null;
  revision: number;
}

export interface Group {
  units: GroupUnit[];
  targets: GroupTarget[];
}

export interface TargetInput {
  key: string;
  id?: number;
  revision?: number;
  target_doc_id?: number;
  slot_key?: string | null;
  wi_step?: number | null;
  wi_part?: WiPart | null;
  kind?: "sentence" | "table" | "figure";
  lang?: UnitLang;
  text?: string;
  change_type?: ChangeType | null;
  source_unit_ids: number[];
  parent_key?: string | null;
  cell_row?: number | null;
  cell_col?: number | null;
  grid?: { rows: number; cols: number } | null;
}

export interface GroupSaveInput {
  action: "confirm" | "hold";
  hold_reason: string;
  units: Array<{ unit_id: number; revision: number; disposition: "assigned" | "delete" | "move_external"; move_target_code: string; reason: string }>;
  targets: TargetInput[];
  removed_target_ids: number[];
}

export async function listAllUnits(bundleId: number): Promise<UnitRow[]> {
  const items: UnitRow[] = [];
  // 한 번에 1000개까지 - 묶음이 크면 이어서 받는다
  for (let offset = 0; ; offset += 1000) {
    const page = await apiFetch<{ total: number; items: UnitRow[] }>(`/bundles/${bundleId}/units?limit=1000&offset=${offset}`);
    items.push(...page.items);
    if (items.length >= page.total || page.items.length === 0) return items;
  }
}

export function getGroupByUnit(bundleId: number, unitId: number): Promise<Group> {
  return apiFetch<Group>(`/bundles/${bundleId}/groups/by-unit/${unitId}`);
}

export function saveGroup(bundleId: number, body: GroupSaveInput): Promise<Group> {
  return apiFetch<Group>(`/bundles/${bundleId}/groups/save`, { method: "POST", body: JSON.stringify(body) });
}

export function bulkDecide(
  bundleId: number,
  body: { action: "delete" | "move_external"; reason: string; move_target_code: string; units: Array<{ unit_id: number; revision: number }> },
): Promise<Array<{ unit_id: number; decision: Decision }>> {
  return apiFetch(`/bundles/${bundleId}/decisions/bulk`, { method: "POST", body: JSON.stringify(body) });
}

export function clearDecision(bundleId: number, unitId: number, revision: number): Promise<unknown> {
  return apiFetch(`/bundles/${bundleId}/decisions/clear`, { method: "POST", body: JSON.stringify({ unit_id: unitId, revision }) });
}

// --- 입구 2 짝 맞추기 ---

export interface IdenticalCandidate {
  unit_id: number;
  target_id: number;
  lang: UnitLang;
  text: string;
}

export interface BulkMatchInput {
  identical: Array<{ unit_id: number; unit_revision: number; target_id: number; target_revision: number }>;
  new: Array<{ target_id: number; revision: number }>;
}

export function listIdenticalCandidates(bundleId: number): Promise<IdenticalCandidate[]> {
  return apiFetch<IdenticalCandidate[]>(`/bundles/${bundleId}/match/identical-candidates`);
}

export function confirmMatchesInBulk(bundleId: number, body: BulkMatchInput): Promise<Group> {
  return apiFetch<Group>(`/bundles/${bundleId}/match/bulk-confirm`, { method: "POST", body: JSON.stringify(body) });
}

export function getGroupByTarget(bundleId: number, targetId: number): Promise<Group> {
  return apiFetch<Group>(`/bundles/${bundleId}/groups/by-target/${targetId}`);
}

// --- 결과물 ---

export type OutputLang = "ko" | "en";

export interface OutputLocation {
  section: string;
  place: string;
  page: number | null;
  page_basis: string;
}

export interface OutputARow {
  row_kind: "unit" | "table" | "new";
  lang: string;
  old_doc_code: string;
  old_doc_version: string;
  location: OutputLocation;
  unit_id: number | null;
  display_id: string;
  source_text: string;
  dest_kind: string;
  dest_doc_code: string;
  dest_doc_title: string;
  dest_location: string;
  confirmed_text: string;
  ai_text: string;
  change_type: string;
  group_id: string | null;
  reason: string;
  status: string;
  confirmed_by: string | null;
  confirmed_at: string | null;
  warnings: Array<Record<string, string>>;
}

export interface FlowGraph {
  nodes: Array<{ id: string; kind: string; label: string; title: string; count: number }>;
  edges: Array<{ source: string; target: string; count: number }>;
}

export interface OutputCItem {
  target_id: number;
  kind: string;
  lang: string;
  text: string;
  ai_text: string;
  change_type: string | null;
  status: string;
  source_note: string;
  cell_row: number | null;
  cell_col: number | null;
  children: OutputCItem[];
}

export interface OutputC {
  docs: Array<{
    target_doc_id: number;
    code: string;
    title: string;
    doc_type: string;
    parent_code: string | null;
    entrance: string;
    sections: Array<{ location_key: string; label: string; na_reason: string | null; items: OutputCItem[] }>;
  }>;
  deleted: Array<{ display_id: string; doc_code: string; section: string; source_text: string; reason: string }>;
  moved: Array<{ display_id: string; doc_code: string; section: string; source_text: string; move_target_code: string; reason: string }>;
}

export interface OutputSummary {
  old_units: number;
  assigned: number;
  unassigned: number;
  duplicate: number;
  deleted: number;
  moved: number;
  new: number;
  translated: number;
  confirmed_rate: number;
}

export function getOutputA(bundleId: number, lang: OutputLang): Promise<OutputARow[]> {
  return apiFetch<OutputARow[]>(`/bundles/${bundleId}/outputs/a?lang=${lang}`);
}

export function getOutputB(bundleId: number, lang: OutputLang): Promise<FlowGraph> {
  return apiFetch<FlowGraph>(`/bundles/${bundleId}/outputs/b?lang=${lang}`);
}

export function getOutputC(bundleId: number, lang: OutputLang): Promise<OutputC> {
  return apiFetch<OutputC>(`/bundles/${bundleId}/outputs/c?lang=${lang}`);
}

export function getSummary(bundleId: number): Promise<Record<OutputLang, OutputSummary>> {
  return apiFetch(`/bundles/${bundleId}/summary`);
}

export function downloadExport(bundleId: number, lang: OutputLang): Promise<Blob> {
  return apiFetchBlob(`/bundles/${bundleId}/export.xlsx?lang=${lang}`);
}

export function putTargetOrder(bundleId: number, body: { revision: number; target_doc_id: number; items: Array<{ target_id: number; wi_step?: number | null }> }): Promise<unknown> {
  return apiFetch(`/bundles/${bundleId}/targets/order`, { method: "PUT", body: JSON.stringify(body) });
}

// --- 검토 ---

export function putSemanticChecks(bundleId: number, revision: number, checks: Record<string, boolean>): Promise<Bundle> {
  return apiFetch<Bundle>(`/bundles/${bundleId}/semantic-checks`, { method: "PUT", body: JSON.stringify({ revision, checks }) });
}

export function completeReview(bundleId: number, revision: number): Promise<Bundle> {
  return apiFetch<Bundle>(`/bundles/${bundleId}/review/complete`, { method: "POST", body: JSON.stringify({ revision }) });
}

export function returnReview(bundleId: number, revision: number, reason: string): Promise<Bundle> {
  return apiFetch<Bundle>(`/bundles/${bundleId}/review/return`, { method: "POST", body: JSON.stringify({ revision, reason }) });
}

export function reopenReview(bundleId: number, revision: number, reason: string): Promise<Bundle> {
  return apiFetch<Bundle>(`/bundles/${bundleId}/review/reopen`, { method: "POST", body: JSON.stringify({ revision, reason }) });
}
