// SOP 재구성 API 호출과 응답 타입 - 백엔드 routers/sop_*.py의 응답 모델을 옮긴 것. 공용 래퍼는 api.ts의 apiFetch.

import { apiFetch, apiFetchBlob } from "./api";
import { genId } from "./id";

/** 의미 검토 항목 - 백엔드 constants.SEMANTIC_CHECK_KEYS와 같은 값 */
export const SEMANTIC_CHECK_KEYS = ["numbers", "conditions", "tables", "figures"] as const;

export type BundleStatus = "in_progress" | "in_review" | "done";
export type MemberRole = "author" | "reviewer";

/** 줄(한/영 짝 하나 또는 짝 없는 판단 단위 하나) 기준 진행 숫자 한 벌 */
export interface RowProgress {
  total: number;
  unassigned: number;
  ai_suggested: number;
  confirmed: number;
  on_hold: number;
  /** 한 언어만 있는 줄 - 보조 표시, 검토 요청 조건이 아니다 */
  single_language: number;
}

export interface BundleListItem {
  id: number;
  /** 순차 코드(BND-0013) - 이름이 비었을 때 이름 자리에 보인다 */
  code: string;
  title: string;
  /** 합성 데이터 묶음 - 목록에서도 합성으로 보인다 */
  is_synthetic: boolean;
  status: BundleStatus;
  my_role: MemberRole;
  updated_at: string;
  progress: RowProgress;
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
  | "check_boundaries"
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
  code: string;
  title: string;
  /** 올린 문서 수 - 0이면 Split~Review 단계가 잠긴다 */
  document_count: number;
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
  progress: RowProgress;
  next_action: NextAction;
  ai_jobs: AiJobCounts;
}

/** 막는 이유·알림 한 건 - 코드마다 문맥 필드가 다르다(review.py) */
export interface ReadinessIssue {
  code: string;
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

export interface AdoptionStats {
  applied: number;
  as_is: number;
  edited: number;
  rejected: number;
  pending: number;
  adoption_rate: number | null;
}

export interface AiStatus {
  ai_enabled: boolean;
  embed_enabled: boolean;
  jobs: AiJobCounts;
  /** 종류별 같은 모양(classify·translate·match·pair·split) */
  by_kind: Record<string, AiJobCounts>;
  /** 실패 코드별 건수(timeout·server_error·connection·client_error·config·interrupted·no_candidates·internal) */
  failed_errors: Record<string, number>;
  adoption: Record<string, AdoptionStats>;
}

export interface BundleCreateInput {
  title?: string;
  description?: string;
  is_synthetic?: boolean;
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

export type AiJobKind = "classify" | "translate" | "match_plan" | "match" | "pair" | "split" | "doc_meta";
export type AiJobStatus = keyof AiJobCounts;

/** 요청 한 번(같은 request_id)의 집계 - total은 24시간 범위와 상관없이 센다. 짝 맞추기는 도중에 total이 는다 */
export interface RecentAiRequest {
  request_id: string;
  bundle_id: number;
  bundle_code: string;
  bundle_title: string;
  /** 요청의 첫 작업 종류(짝 맞추기는 match_plan) */
  kind: AiJobKind;
  kinds: AiJobKind[];
  requested_by_me: boolean;
  total: number;
  jobs: AiJobCounts;
  /** 실패 코드별 건수(failed만) */
  error_counts: Record<string, number>;
  created_at: string;
  started_at: string | null;
  /** 지금 실행 중인 작업의 가장 이른 시작 - 실행 중이 없으면 null. "오래 걸림"을 잰다 */
  running_started_at: string | null;
  /** 대기·실행 중이 하나라도 있으면 null */
  finished_at: string | null;
  /** 모든 작업이 같은 한 문서일 때만 그 문서, 아니면 null(지워졌으면 제목·파일 이름이 "") */
  document_id: number | null;
  document_title: string;
  document_file_name: string;
}

/** 내가 멤버인 묶음의 대기·실행 중 작업과 하루 안에 끝난 작업을 요청별로 - 도는 요청 먼저, 그다음 최신 순으로 100건 */
export interface RecentAiJobs {
  /** 서버 시각(KST ISO) - "오래 도는 중"은 클라이언트 시계 대신 이것으로 잰다 */
  server_time: string;
  requests: RecentAiRequest[];
  requests_total: number;
}

export function getRecentAiJobs(): Promise<RecentAiJobs> {
  return apiFetch<RecentAiJobs>("/ai/jobs/recent");
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
  /** 경계를 아직 확인하지 않은 단위 수 - 0이 아니면 검토 요청이 막힌다 */
  unchecked_boundaries: number;
  /** 업로드 응답에서만 - 서버가 미리 채운 칸이 어디서 왔는지(파일 이름·본문 첫 장). 목록 조회에서는 빈 객체 */
  prefill_sources?: Partial<Record<"doc_code" | "doc_version" | "language_layout", "file_name" | "content">>;
  /** 비어 있는 번호·버전에 대한 AI 제안(문서에 쓰지 않은 값). 누르면 사람이 저장한다 */
  ai_meta?: { doc_code: string | null; doc_version: string | null; suggestion_id: number } | null;
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
  /** 이 블록이 속한 부분 묶음(DocumentView.part_groups의 key) - 머리말·꼬리말은 부분 파일마다, 나머지는 part와 같다 */
  part_group: string;
}

/** 머리말·꼬리말을 쓰는 구역(1부터)과 종류 */
export interface PartRef {
  section: number;
  type: "default" | "first" | "even";
}

export interface ViewPartGroup {
  key: string;
  part: string;
  /** 옛 추출·PDF는 빈 목록 */
  refs: PartRef[];
  block_count: number;
  /** 같은 부분에서 내용이 같은 앞 묶음의 key(머리말·꼬리말만) */
  same_as: string | null;
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
  /** 사람이 나누거나 합쳐 생긴 단위(되돌리지 않은 편집) */
  is_edited: boolean;
  /** 합치기로 생겨 그 뒤 바뀌지 않은 단위 - 합치기 전 단위들로 되돌릴 수 있다(편집 unmerge) */
  can_unmerge: boolean;
  /** 사람이 아직 정하지 않은 AI 나누기 제안 */
  split_suggestion_id: number | null;
}

export interface ViewPair {
  id: number;
  status: "suggested" | "confirmed";
  source: string;
  unit_ids: number[];
}

export interface DocumentView {
  document: Omit<SopDocument, "extraction" | "unchecked_boundaries">;
  extraction: SopDocument["extraction"];
  tables: ViewTable[];
  blocks: ViewBlock[];
  /** 처음 나온 순서 */
  part_groups: ViewPartGroup[];
  units: ViewUnit[];
  pairs: ViewPair[];
  edits: { can_undo: boolean; can_redo: boolean };
}

export type EditOp =
  | { type: "split"; unit_id: number; at: number }
  | { type: "merge"; unit_ids: number[] }
  | { type: "unmerge"; unit_id: number }
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

/** 되돌리기·다시 하기 응답 - 무엇을 거꾸로(다시) 했는지. 경계 확인 기록이면 바뀐 단위와 바뀐 뒤 값 */
export interface EditStepResult extends EditResult {
  op: string;
  boundary_unit_ids: number[];
  confirmed: boolean | null;
}

export interface PairResult {
  document_revision: number;
  pair: ViewPair | null;
}

export function getDocumentView(bundleId: number, docId: number): Promise<DocumentView> {
  return apiFetch<DocumentView>(`/bundles/${bundleId}/documents/${docId}/view`);
}

const buildDocPath = (bundleId: number, docId: number) => `/bundles/${bundleId}/documents/${docId}`;

export function editUnits(bundleId: number, docId: number, revision: number, op: EditOp, confirm = false, undo?: UndoMeta): Promise<EditResult> {
  return apiFetch<EditResult>(`${buildDocPath(bundleId, docId)}/edits`, { method: "POST", body: JSON.stringify({ revision, confirm, op, undo }) });
}

export function undoEdit(bundleId: number, docId: number, revision: number, confirm = false): Promise<EditStepResult> {
  return apiFetch<EditStepResult>(`${buildDocPath(bundleId, docId)}/edits/undo`, { method: "POST", body: JSON.stringify({ revision, confirm }) });
}

export function redoEdit(bundleId: number, docId: number, revision: number, confirm = false): Promise<EditStepResult> {
  return apiFetch<EditStepResult>(`${buildDocPath(bundleId, docId)}/edits/redo`, { method: "POST", body: JSON.stringify({ revision, confirm }) });
}

export function setBoundaryConfirmed(bundleId: number, docId: number, unitIds: number[], confirmed: boolean): Promise<{ unit_ids: number[]; confirmed: boolean }> {
  return apiFetch(`${buildDocPath(bundleId, docId)}/units/boundary`, { method: "POST", body: JSON.stringify({ unit_ids: unitIds, confirmed }) });
}

/** 문서에 남은 단위의 경계를 한 번에 확인한다 - 하나씩 확인하는 길은 요청당 단위 수 상한이 있다 */
export function confirmAllBoundaries(bundleId: number, docId: number): Promise<{ confirmed_count: number }> {
  return apiFetch(`${buildDocPath(bundleId, docId)}/units/boundary/all`, { method: "POST" });
}

export function createPair(bundleId: number, docId: number, revision: number, unitIds: number[]): Promise<PairResult> {
  return apiFetch<PairResult>(`${buildDocPath(bundleId, docId)}/pairs`, { method: "POST", body: JSON.stringify({ revision, unit_ids: unitIds }) });
}

export function deletePair(bundleId: number, docId: number, pairId: number, revision: number): Promise<PairResult> {
  return apiFetch<PairResult>(`${buildDocPath(bundleId, docId)}/pairs/${pairId}?revision=${revision}`, { method: "DELETE" });
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
/** 새 문장의 변경 종류 - backend constants와 같은 값. 나눔·합침·번역·신규는 서버가 구조에서 정한다 */
export type ChangeType = "as_is" | "tone" | "rewritten" | "table_restructured" | "split" | "merged" | "translated" | "new";
/** 저장 요청에 보낼 수 있는 종류 - backend TargetIn.change_type */
export type ChangeTypeInput = "as_is" | "tone" | "rewritten" | "table_restructured";
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
  /** 한/영 짝(제안·확정 모두) - 문서 보기의 units[].pair_id와 같은 뜻, 짝이 없으면 null */
  pair_id: number | null;
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
  /** 번역이 옮긴 Old 단위 - 번역은 출처 연결이 없다 */
  translation_source_unit_id: number | null;
  parent_target_id: number | null;
  cell_row: number | null;
  cell_col: number | null;
  grid: { rows: number; cols: number } | null;
  status: CoverStatus;
  hold_reason: string;
  /** 사람이 적는 메모 - 출처 없는 새 문장에도 적을 수 있다 */
  remark: string;
  warnings: Array<Record<string, string>>;
  source_unit_ids: number[];
  group_id: string | null;
  revision: number;
  indent_level: number;
}

export interface Group {
  units: GroupUnit[];
  targets: GroupTarget[];
  /** 묶음 저장 응답에만 - 이 저장으로 확정된 짝·풀린 짝(서버가 판단을 보고 정한다) */
  pairs_confirmed?: number[];
  pairs_dissolved?: number[];
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
  change_type?: ChangeTypeInput | null;
  /** 비우면(undefined) 지금 값을 둔다 */
  remark?: string;
  source_unit_ids: number[];
  parent_key?: string | null;
  cell_row?: number | null;
  cell_col?: number | null;
  grid?: { rows: number; cols: number } | null;
}

export interface GroupSaveInput {
  action: "confirm" | "hold";
  hold_reason: string;
  /** unassigned는 보낼 곳 없는 보류 - action이 hold일 때만 된다 */
  units: Array<{ unit_id: number; revision: number; disposition: Disposition; move_target_code: string; reason: string }>;
  targets: TargetInput[];
  removed_target_ids: number[];
  /** 짝의 한쪽만 이을 때 남는 단위 - 서버가 같은 저장 안에서 그 짝을 풀어 따로 줄로 남긴다 */
  release_unit_ids?: number[];
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

/** Assign 되돌리기 기록 메타 - 저장 본문의 undo. 한 사용자 동작의 요청들은 같은 step_key를 쓴다(서버가 한 단계로 합친다) */
export type SaveOp = "confirm" | "hold" | "link" | "unlink" | "mark_new" | "link_source";

export interface UndoMeta {
  session: string;
  op?: SaveOp;
  focus_unit_id?: number;
  focus_target_id?: number;
  step_key?: string;
  scope_label?: string;
}

/** 되돌리기·다시 하기 응답 - backend decision_steps */
export interface DecisionStepResult {
  op: string;
  unit_ids: number[];
  focus_unit_id: number | null;
  focus_target_id: number | null;
  scope_label: string | null;
  can_undo: boolean;
  can_redo: boolean;
}

export function undoDecision(bundleId: number, session: string): Promise<DecisionStepResult> {
  return apiFetch<DecisionStepResult>(`/bundles/${bundleId}/decisions/undo`, { method: "POST", body: JSON.stringify({ session }) });
}

export function redoDecision(bundleId: number, session: string): Promise<DecisionStepResult> {
  return apiFetch<DecisionStepResult>(`/bundles/${bundleId}/decisions/redo`, { method: "POST", body: JSON.stringify({ session }) });
}

export function saveGroup(bundleId: number, body: GroupSaveInput, undo?: UndoMeta): Promise<Group> {
  return apiFetch<Group>(`/bundles/${bundleId}/groups/save`, { method: "POST", body: JSON.stringify({ ...body, undo }) });
}

export function bulkDecide(
  bundleId: number,
  body: { action: "delete" | "move_external"; reason: string; move_target_code: string; units: Array<{ unit_id: number; revision: number }> },
  undo?: UndoMeta,
): Promise<Array<{ unit_id: number; decision: Decision }>> {
  return apiFetch(`/bundles/${bundleId}/decisions/bulk`, { method: "POST", body: JSON.stringify({ ...body, undo }) });
}

/** 배정 지우기 결과 - backend detach.DetachReport */
export interface DetachReport {
  reset_unit_ids: number[];
  deleted_target_ids: number[];
  held_unit_ids: number[];
  held_target_ids: number[];
}

export function clearDecision(bundleId: number, unitId: number, revision: number, undo?: UndoMeta): Promise<DetachReport> {
  return apiFetch<DetachReport>(`/bundles/${bundleId}/decisions/clear`, { method: "POST", body: JSON.stringify({ unit_id: unitId, revision, undo }) });
}

/**
 * 여러 단위를 차례로 지운다 - 앞 단위를 지우면 같은 관계 묶음의 나머지가 보류로 바뀌며 revision이 오르므로,
 * 그렇게 바뀐 단위는 지우기 전에 묶음을 다시 읽어 지금 revision을 쓴다(낡은 revision이면 409).
 */
export async function clearDecisions(bundleId: number, units: Array<{ unit_id: number; revision: number }>, undo?: UndoMeta): Promise<void> {
  // 모든 단위 요청이 같은 step_key를 써 Ctrl+Z 한 번에 한꺼번에 되돌아간다
  const stepUndo = undo ? { ...undo, step_key: undo.step_key ?? genId() } : undefined;
  const reset = new Set<number>();
  const changed = new Set<number>();
  for (const unit of units) {
    if (reset.has(unit.unit_id)) continue;
    let revision = unit.revision;
    if (changed.has(unit.unit_id)) {
      const group = await getGroupByUnit(bundleId, unit.unit_id);
      revision = group.units.find((item) => item.unit_id === unit.unit_id)?.decision.revision ?? revision;
    }
    const report = await clearDecision(bundleId, unit.unit_id, revision, stepUndo);
    for (const id of report.reset_unit_ids) reset.add(id);
    for (const id of report.held_unit_ids) changed.add(id);
  }
}

/** 배정 초기화 건수 - dry_run이면 하게 될 건수(같은 길을 돌고 되돌려 실제와 같다) */
export interface ResetReport {
  dry_run: boolean;
  unassigned_units: number;
  deleted_targets: number;
  held_units: number;
  held_targets: number;
}

/** Old 문서 하나(document_id) 또는 묶음 전체의 배정을 한 번에 지운다 - revision은 묶음 revision이고 초기화는 올리지 않는다 */
export function resetAssignments(bundleId: number, body: { revision: number; document_id?: number; dry_run?: boolean }, undo?: UndoMeta): Promise<ResetReport> {
  return apiFetch<ResetReport>(`/bundles/${bundleId}/decisions/reset`, { method: "POST", body: JSON.stringify({ ...body, undo }) });
}

// --- 입구 2 짝 맞추기 ---

export interface IdenticalCandidate {
  unit_id: number;
  target_id: number;
  lang: UnitLang;
  text: string;
  unit_revision: number;
  target_revision: number;
}

export interface BulkMatchInput {
  identical: Array<{ unit_id: number; unit_revision: number; target_id: number; target_revision: number }>;
  new: Array<{ target_id: number; revision: number }>;
}

/** 이미 쓴 문서(입구 2)의 최상위 문장 - Assign 화면의 New 원문 */
export interface WrittenSentence {
  target_id: number;
  target_doc_id: number;
  doc_code: string;
  section_path: string;
  order_index: number;
  lang: UnitLang;
  kind: "sentence" | "table" | "figure";
  text: string;
  status: CoverStatus;
  change_type: ChangeType | null;
  source_unit_ids: number[];
  /** 같은 New 문서의 한/영 짝 상대가 만든 문장 */
  partner_target_id: number | null;
  /** 사람이 적는 메모(출처 없는 새 문장의 Remark) */
  remark: string;
  revision: number;
}

/** Old 단위 하나에 가까운 이미 쓴 문서 문장 - 유사도는 확률로 보이지 않는다 */
export interface NewCandidate {
  target_id: number;
  target_doc_id: number;
  doc_code: string;
  section_path: string;
  text: string;
  basis: "embedding" | "text";
}

export function listWrittenSentences(bundleId: number): Promise<WrittenSentence[]> {
  return apiFetch<WrittenSentence[]>(`/bundles/${bundleId}/written-sentences`);
}

export function listNewCandidates(bundleId: number, unitId: number): Promise<NewCandidate[]> {
  return apiFetch<NewCandidate[]>(`/bundles/${bundleId}/units/${unitId}/new-candidates`);
}

/** 내가 쓴 사유 - 최근 것부터, 모든 Bundle, 같은 글은 한 번(서버 상한 10) */
export interface RecentRemark {
  text: string;
  used_at: string;
}

export function listRecentRemarks(limit = 10): Promise<RecentRemark[]> {
  return apiFetch<RecentRemark[]>(`/sop/remarks/recent?limit=${limit}`);
}

/** 외부 이동 대상 후보 - 내가 멤버인 다른 Bundle의 To-Be 문서와 전에 쓴 이동 코드 */
export interface MoveTarget {
  code: string;
  title: string;
  /** 이 코드를 가진 To-Be 문서의 Bundle 코드 - 전에 쓴 코드뿐이면 null */
  bundle_code: string | null;
  /** bundle = 이 Bundle에서 쓴 코드, mine = 내가 다른 Bundle에서 쓴 코드 */
  used: "bundle" | "mine" | null;
}

export function listMoveTargets(bundleId: number, query: string): Promise<MoveTarget[]> {
  return apiFetch<MoveTarget[]>(`/bundles/${bundleId}/move-targets?${new URLSearchParams({ q: query })}`);
}

export function listIdenticalCandidates(bundleId: number): Promise<IdenticalCandidate[]> {
  return apiFetch<IdenticalCandidate[]>(`/bundles/${bundleId}/match/identical-candidates`);
}

export function confirmMatchesInBulk(bundleId: number, body: BulkMatchInput, undo?: UndoMeta): Promise<Group> {
  return apiFetch<Group>(`/bundles/${bundleId}/match/bulk-confirm`, { method: "POST", body: JSON.stringify({ ...body, undo }) });
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
  row_kind: "unit" | "table" | "translation" | "new";
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
  /** 새 문서 안 섹션 번호 - 번호 없는 곳은 빈 글, 새 문장이 여럿이면 "① 1.1\n② 2.1"(번호 없는 새 문장은 "② " 뒤가 빈다) */
  dest_number: string;
  /** 보낸 새 문장이 모두 주석 줄이면 true - 확정 문장을 기울여 보인다 */
  dest_is_note: boolean;
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

/** 줄 번호 표시 - backend app/sop/constants.py NumberStyle과 같은 값 */
export type NumberStyle = "numbered" | "omitted" | "note";

export interface OutputCItem {
  target_id: number;
  kind: string;
  lang: string;
  text: string;
  ai_text: string;
  change_type: string | null;
  status: string;
  source_note: string;
  /** 섹션 번호(칸 번호 + 들여쓰기, 6.1.2) - 표 칸은 표의 번호, 입구 2 문서·단계 없는 WI는 null */
  number: string | null;
  /** 사람이 정한 깊이 그대로 - 번호는 서버가 앞 번호 줄 깊이 + 1까지로 눌러 읽어 센다 */
  indent_level: number;
  /** 번호 표시 - 생략·주석 줄은 number가 null이고 세지 않는다. 표 칸은 표의 값 */
  number_style: NumberStyle;
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
    /** number: SOP 칸 번호(5.1)·WI 단계 번호(3), 번호가 없는 칸은 null */
    sections: Array<{ location_key: string; label: string; number: string | null; na_reason: string | null; items: OutputCItem[] }>;
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

/** Assign New 칸의 아직 쓰지 않은 문서 - 결과물 C와 같은 칸·순서에 두 언어 새 문장을 함께(서버 outputs.build_composed_doc) */
export interface ComposedItem {
  target_id: number;
  kind: "sentence" | "table" | "figure";
  lang: UnitLang;
  /** 고쳐 쓴 글, 없으면 AI 글, 그것도 없으면 출처 원문 */
  text: string;
  status: CoverStatus;
  change_type: ChangeType | null;
  number: string | null;
  /** 출처 Old 단위 - 번역은 번역 출처 단위 */
  source_unit_ids: number[];
}

export interface ComposedSection {
  location_key: string;
  label: string;
  number: string | null;
  na_reason: string | null;
  items: ComposedItem[];
}

export interface ComposedDoc {
  target_doc_id: number;
  code: string;
  title: string;
  doc_type: TargetDocType;
  entrance: Entrance;
  sections: ComposedSection[];
}

/** lang은 칸 이름의 언어(화면 언어) */
export function getComposedDoc(bundleId: number, docId: number, lang: OutputLang): Promise<ComposedDoc> {
  return apiFetch<ComposedDoc>(`/bundles/${bundleId}/outputs/c/docs/${docId}?lang=${lang}`);
}

export function getSummary(bundleId: number): Promise<Record<OutputLang, OutputSummary>> {
  return apiFetch(`/bundles/${bundleId}/summary`);
}

export function downloadExport(bundleId: number, lang: OutputLang): Promise<Blob> {
  return apiFetchBlob(`/bundles/${bundleId}/export.xlsx?lang=${lang}`);
}

/** 순서 바꾸기 요청 한 줄 - 뺀 값은 그대로 둔다. number_style은 서버가 한/영 짝 상대와 번역 줄에 함께 옮긴다 */
export interface TargetOrderItem {
  target_id: number;
  wi_step?: number | null;
  indent_level?: number;
  number_style?: NumberStyle;
}

export function putTargetOrder(bundleId: number, body: { revision: number; target_doc_id: number; items: TargetOrderItem[] }): Promise<unknown> {
  return apiFetch(`/bundles/${bundleId}/targets/order`, { method: "PUT", body: JSON.stringify(body) });
}

// --- 검토 ---

export function putSemanticChecks(bundleId: number, revision: number, checks: Record<string, boolean>): Promise<Bundle> {
  return apiFetch<Bundle>(`/bundles/${bundleId}/semantic-checks`, { method: "PUT", body: JSON.stringify({ revision, checks }) });
}

export function withdrawReview(bundleId: number, revision: number): Promise<Bundle> {
  return apiFetch<Bundle>(`/bundles/${bundleId}/review/withdraw`, { method: "POST", body: JSON.stringify({ revision }) });
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

// --- AI 제안(계획 2) ---

export interface AiSuggestion {
  id: number;
  job_id: number;
  kind: string;
  document_id: number | null;
  result: "applied" | "stale" | "invalid";
  content: {
    unit_ids?: number[];
    disposition?: string;
    target_doc_id?: number | null;
    slot_key?: string | null;
    wi_step?: number | null;
    wi_part?: string | null;
    reason?: string;
    rule_ids?: string[];
    evidence?: Array<{ unit_id: number; quote: string }>;
    change_type?: string;
    retrieval?: string;
    [key: string]: unknown;
  };
  warnings: Array<Record<string, unknown>>;
  guideline_versions: Record<string, number>;
  model: string;
  adoption: string | null;
  created_at: string;
}

export async function listSuggestions(bundleId: number, kind: string): Promise<AiSuggestion[]> {
  const items: AiSuggestion[] = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await apiFetch<{ total: number; items: AiSuggestion[] }>(`/bundles/${bundleId}/ai/suggestions?kind=${kind}&result=applied&limit=1000&offset=${offset}`);
    items.push(...page.items);
    if (items.length >= page.total || page.items.length === 0) return items;
  }
}

export function requestClassify(bundleId: number, unitIds: number[]): Promise<{ queued: number; skipped_total: number }> {
  return apiFetch(`/bundles/${bundleId}/ai/classify`, { method: "POST", body: JSON.stringify({ unit_ids: unitIds }) });
}

export function getFigureImage(bundleId: number, docId: number, blockId: number): Promise<Blob> {
  return apiFetchBlob(`/bundles/${bundleId}/documents/${docId}/figures/${blockId}`);
}
