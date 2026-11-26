// SOP 재구성 API 호출과 응답 타입 - 백엔드 routers/sop_*.py의 응답 모델을 옮긴 것. 공용 래퍼는 api.ts의 apiFetch.

import { apiFetch, apiFetchBlob, apiFetchBlobWithName } from "./api";
import { sendDocWrite } from "./doc-revision";
import { genId } from "./id";

/** 의미 검토 항목 - 백엔드 constants.SEMANTIC_CHECK_KEYS와 같은 값 */
export const SEMANTIC_CHECK_KEYS = ["numbers", "conditions", "tables", "figures"] as const;

export type BundleStatus = "in_progress" | "in_review" | "done";
export type MemberRole = "author" | "reviewer";

/** 줄(한/영 짝 하나 또는 짝 없는 판단 단위 하나) 기준 진행 숫자 한 벌 */
export interface RowProgress {
  total: number;
  unassigned: number;
  /** 정한 줄 - assigned + deleted + moved */
  confirmed: number;
  on_hold: number;
  assigned: number;
  deleted: number;
  /** 다른 문서로 이동 - 화면에서 뺀 기능이라 옛 기록뿐이다 */
  moved: number;
  /** 그림 줄 - 위의 모든 숫자에서 빠지고 여기서만 센다(F3-R3) */
  figures_total: number;
  figures_decided: number;
  /** 한 언어만 있는 줄 - 보조 표시, 검토 요청 조건이 아니다 */
  single_language: number;
}

/** 개요의 남은 손질과 AI 제안 대기 - Assign 위쪽 줄의 표시와 같은 규칙을 묶음 전체로 센다 */
export interface TidyCounts {
  refs: number;
  captions: number;
  ai_waiting: number;
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
  | "fill_doc_versions"
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
  tidy: TidyCounts;
  next_action: NextAction;
  ai_jobs: AiJobCounts;
}

/** 막는 이유·알림 한 건 - 코드마다 문맥 필드가 다르다(review.py) */
export interface ReadinessIssue {
  code: string;
  count?: number;
  /** 막는 줄 가운데 그림 - units_*에만, 그림이 있을 때만 */
  figures?: number;
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
  /** 종류별 같은 모양(classify·translate·match·pair·split·unwrap_order) */
  by_kind: Record<string, AiJobCounts>;
  /** 실패 코드별 건수(timeout·server_error·connection·client_error·config·interrupted·no_candidates·internal) */
  failed_errors: Record<string, number>;
  /** 줄 서거나 도는 작업 가운데 사람 순위인 수(미리 돌리기에서 올라온 것 포함) - 0이면 미리 돌리기만 돈다 */
  user_active: number;
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

export type AiJobKind = "classify" | "translate" | "match_plan" | "match" | "pair" | "split" | "unwrap_order" | "doc_meta" | "tobe_list";
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
  /** 미리 돌리기 작업이 하나라도 있으면 참 - 순위를 올린 뒤에도 그대로다 */
  background: boolean;
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
  /** 업로드 응답에서만 - 서버가 미리 채운 칸이 어디서 왔는지(파일 이름·본문 첫 장). 목록 조회에서는 빈 객체 */
  prefill_sources?: Partial<Record<"doc_code" | "doc_version" | "language_layout", "file_name" | "content">>;
  /** 비어 있는 번호·버전에 대한 AI 제안(문서에 쓰지 않은 값). 누르면 사람이 저장한다 */
  ai_meta?: { doc_code: string | null; doc_version: string | null; suggestion_id: number } | null;
  /** 문서 번호의 EQUIS 표시 - 기능이 꺼졌거나 묻지 않는 번호(빈 칸·임시 번호)면 null */
  equis?: EquisInfo | null;
}

export interface EquisVersion {
  version: string;
  status: string;
  /** KST 날짜(YYYY-MM-DD) 또는 빈 글 */
  effective_date: string;
  retired_date: string;
}

/** 문서나 To-Be 줄 하나의 EQUIS 조회 결과 - backend app/equis/view.py EquisOut과 같은 모양 */
export interface EquisInfo {
  state: "pending" | "found" | "not_found" | "unavailable";
  /** 조회가 도는 중 - 화면이 조금 뒤 다시 읽는다 */
  refreshing: boolean;
  verdict: "ok" | "attention" | "in_equis" | null;
  /** old_number · retired · version_mismatch · newer_authorized · no_current */
  reasons: string[];
  /** 경고는 아니지만 알릴 진행 중인 판(In Review · In Approval) */
  notes: EquisVersion[];
  current: EquisVersion | null;
  in_progress: EquisVersion[];
  retired: EquisVersion | null;
  /** 지금 문서의 번호 - 물은 번호가 옛 번호면 다르다 */
  number: string;
  trail: string[];
  ambiguous: string[];
  name: string;
  subtype: string;
  owning_department: string;
  plant: string;
  area: string;
  legacy_numbers: string[];
  equipment_tag: string;
  doc_url: string | null;
  title_locked: boolean;
  fetched_at: string | null;
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

/** 이 Bundle에 있는 번호 하나를 EQUIS에 다시 묻는다 - requested가 false면 방금 조회했거나 조회 중이다 */
export function refreshEquis(bundleId: number, documentNumber: string): Promise<{ requested: boolean }> {
  return apiFetch<{ requested: boolean }>(`/bundles/${bundleId}/equis/refresh`, { method: "POST", body: JSON.stringify({ document_number: documentNumber }) });
}

export function deleteDocument(bundleId: number, docId: number, revision: number, confirm = false): Promise<void> {
  const query = new URLSearchParams({ revision: String(revision), confirm: String(confirm) });
  return apiFetch<void>(`/bundles/${bundleId}/documents/${docId}?${query}`, { method: "DELETE" });
}

// --- 원문 보기와 쪼개기 편집 ---

export type UnitKind = "sentence" | "heading" | "figure" | "table" | "cell_sentence" | "caption";
/** ref는 참조 줄(다른 문서를 번호로 가리키는 글) - 한/영 짝이 없다 */
export type UnitLang = "ko" | "en" | "ref" | "neutral";
/** 참조 줄 상태 - proposed는 앱의 제안(사람이 번호를 확인하기 전), confirmed는 REF로 확정된 것 */
export interface UnitRefMark {
  state: "proposed" | "confirmed";
  /** 다듬은 문서 번호(대문자) - 그 단위의 글 안에 있는 글자 */
  number: string;
}
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
  /** 띠 표 신호가 있다 - 바로 바깥 표를 벗기거나 다시 묶으면 함께 제목 줄 ↔ 표로 바뀐다(F2 · F4) */
  is_band: boolean;
  /** 안쪽 표가 놓인 바깥 칸 블록과 그 글에서 표 앞 글자 수(F2) - 바깥 표·옛 추출은 null */
  anchor: { block_id: number; at: number } | null;
  /** 칸 줄 언어가 많은 쪽 - 두 언어 표 · 빈 표는 null. 서버는 늘 싣는다(시험 자료가 줄여 쓰게 선택 칸) */
  lang?: "ko" | "en" | null;
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
  /**
   * 그림 블록만 - 문장 속 그림이 놓인 앞 글 블록(같은 문단 · 칸)과 그 text 안 글자 자리(시안 2 D3).
   * at은 block text(써 넣은 자동 번호 포함, 단위 spans와 같은 좌표) 안 자리. 그림만 든 문단 · 추출기 7 전의 추출은 null.
   * 서버는 늘 싣는다(시험 자료가 줄여 쓰게 선택 칸)
   */
  anchor?: { block_id: number; at: number } | null;
  /** 도형 그림(업무흐름도) 블록만 - 도형 안 글(위에서 아래). 단위가 아니라 배정 대상이 아니고 보기 · 찾기용(추출기 9부터). 서버는 늘 싣는다 */
  figure_texts?: string[];
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

/** 문단 번호 칸(서버 numbering.py) - 값과 내용 경계는 서버가 정한다. 원문 글자(text)는 번호를 품은 그대로다 */
export interface ViewNumber {
  /** 번호 칸에 보일 값 - 사람이 고친 값, 없으면 읽은 값(자동 번호·번호만 든 칸). 없으면 null */
  value: string | null;
  /** 추출기가 읽은 값 */
  read: string | null;
  source: "auto" | "typed" | "cell" | null;
  /** 사람이 고쳤다("번호 없음" 포함) */
  is_set: boolean;
  /** text에서 내용이 시작하는 자리 - 번호가 번호 칸으로 갔으면 그 뒤, 아니면 0 */
  content_start: number;
  /** 본문 줄의 번호를 글 앞 타자 번호에서 저절로 읽었다(사람이 고치지 않음, 서버 numbering.is_read_from_text) - 툴팁이 알린다 */
  from_text: boolean;
  /** 번호 노트 - 사람이 원문과 다르게 고쳤으면 원문(읽은) 번호(서버 numbering.get_number_note), 아니면 null */
  note: string | null;
}

export interface ViewUnit {
  id: number;
  display_id: string;
  kind: UnitKind;
  spans: UnitSpan[];
  text: string;
  lang: UnitLang;
  /** 번호 칸이 없는 단위(그림·표·캡션)는 null */
  number: ViewNumber | null;
  table_id: number | null;
  row_index: number | null;
  group_unit_id: number | null;
  status: CoverStatus | null;
  pair_id: number | null;
  pos_seq: number;
  block_id: number;
  /** 사람이 나누거나 합쳐 생긴 단위(되돌리지 않은 편집) */
  is_edited: boolean;
  /** 합치기로 생겨 그 뒤 바뀌지 않은 단위 - 합치기 전 단위들로 되돌릴 수 있다(편집 unmerge) */
  can_unmerge: boolean;
  /** can_unmerge인 단위의 조각(합치기 전 단위) 글 - 원문 순(switch_language piece 순번), 아니면 빈 목록 */
  merge_pieces?: string[];
  /** 사람이 아직 정하지 않은 AI 나누기 제안 */
  split_suggestion_id: number | null;
  /** 참조 줄 제안·확정 - 참조가 아니면 null */
  ref: UnitRefMark | null;
  /** 이 단위의 글이 가리키는 표·그림("표 3"·"아래 표") - 캡션 자기 머리 번호는 빠진다 */
  caption_refs: ViewCaptionRef[];
  /** 잡음 표시 - 저절로 삭제된 줄(목차 · 본문 앞부분 · 개정 이력): 배정 줄이 없고(남은 수에서 빠짐) Assign 용지가 블록으로 접는다. 편집 clear_noise가 비운다 */
  noise_kind?: "toc" | "front" | "history" | null;
  /** 저절로 삭제된 줄에 적은 사유 - 빈 글이면 종류마다 정한 문구. 편집 set_noise_reason이 쓴다 */
  noise_reason?: string;
  /** 제목 스타일 줄을 문장으로 바꾼 문장(F8b) - Assign의 "제목으로 되돌리기"와 묶음 머리 "[제목 → 문장]". 편집 set_heading이 오간다 */
  from_heading?: boolean;
  /** 캡션 하나를 같이 쓰는 그림 묶음(F7 ⑥)의 첫 그림 - 이 그림이 그 그림의 캡션을 같이 쓴다. 첫 그림 자신·묶이지 않은 단위는 null. 편집 group_figures·ungroup_figures가 오간다 */
  caption_figure_id?: number | null;
  /** 짝 카드 안 순서(lib/pair-order-model orderPairCard) - 편집 reorder_pair가 매긴다. 바꾼 적 없으면 null(원문 순서) */
  pair_seq?: number | null;
  /** 벗긴 표 덩이 안 줄 순서(lib/unwrap-order-model orderUnwrapped) - 편집 reorder_unwrapped가 매기고 다시 표로가 비운다. 없으면 원문 앞 줄의 값을 빌린다 */
  unwrap_seq?: number | null;
  /** 들여쓰기 차이(B8) - 셈한 단계(lib/strip-pill-model getRowLevels)에 더한다. 편집 set_indents · set_number의 indent_shift가 바꾼다. 없으면 0 */
  indent_shift?: number;
}

/** 표·그림 참조 하나 - number가 null이면 위치 참조("아래 표"), target_unit_id는 이은 표·그림 묶음 단위(못 찾으면 null) */
export interface ViewCaptionRef {
  id: number;
  kind: "table" | "figure";
  number: number | null;
  target_unit_id: number | null;
  state: "linked" | "detached";
  /** auto(올릴 때 잡음) | human(사람이 고침) */
  origin: string;
}

export interface CaptionRefResult {
  document_revision: number;
  ref: ViewCaptionRef;
}

/** 표·그림 번호 바뀜 - 원문 번호가 없어 머리 번호를 붙였으면 from_label이 빈 글 */
export interface RenumberChange {
  from_label: string;
  to_label: string;
}

/** 고른 단위의 참조 상태와 그 번호의 EQUIS 표시 - 참조가 아니면 state가 null */
export interface UnitRefDetail {
  state: UnitRefMark["state"] | null;
  number: string;
  /** EQUIS가 꺼져 있으면 null */
  equis: EquisInfo | null;
  /** 그 줄의 글을 EQUIS의 지금 번호·정식 이름으로 맞춘 글 - 새 문장에 쓸 제안. EQUIS가 모르는 번호거나 이미 같으면 null */
  suggested_text: string | null;
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
  /** 추출이 번호 범위 신호를 남겼다 - 거짓이면(옛 추출) 용지가 절 첫 줄의 번호만 가리는 옛 방식으로 그린다 */
  has_number_ranges: boolean;
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
  /** 언어를 바꿔 모양이 바뀌는 편집(B6) - 짝이 한 언어가 되면 합치거나(merge_pair) 짝만 풀고, piece면 합친 박스의 그 조각을 떼어 짝으로. 배정은 묻지 않고 푼다 */
  | { type: "switch_language"; unit_id: number; lang: "ko" | "en"; piece?: number; merge_pair?: boolean }
  | { type: "set_layout_table"; table_id: number; is_layout: boolean }
  /** 블록 자리 2 안(caption-slot-model CAPTION_REACH)의 묶이지 않은 글 단위를 표·그림의 캡션으로 - 사이 문단은 그대로,
   *  묶음마다 언어당 하나(caption_exists), 먼 글은 caption_not_adjacent, 다른 그림의 캡션을 같이 쓰는 그림은 caption_shared. 판단이 있는 묶음이면 서버가 묻는다 */
  | { type: "attach_caption"; unit_id: number; bundle_unit_id: number }
  /** 캡션을 같은 자리·언어의 묶이지 않은 문장으로 - 첫 행에서 올린 캡션은 그 표의 칸 문장으로 돌아간다 */
  | { type: "detach_caption"; unit_id: number }
  /** 표 첫 행 ↔ 캡션(F7 ③) - caption이면 첫 행 칸 문장이 그 표의 캡션이 되고, 아니면 칸 블록 위 캡션이 모두 첫 행으로 돌아간다(↩ 다시 첫 행으로) */
  | { type: "set_first_row_caption"; table_unit_id: number; caption: boolean }
  /** 그림 묶기(F7 ⑥) - 원문 순 첫 그림이 캡션을 갖고 나머지 그림이 그 캡션을 같이 쓴다 */
  | { type: "group_figures"; unit_ids: number[] }
  /** 그림 풀기 - 그 그림이 든 묶음의 그림이 모두 따로 선다(캡션은 첫 그림에 남는다) */
  | { type: "ungroup_figures"; unit_id: number }
  /** 참조 줄로 - 번호는 그 단위의 글 안에 있어야 한다. 이미 참조 줄이면 번호만 고친다 */
  | { type: "set_ref"; unit_id: number; number: string }
  /** 참조 아님 - 참조 줄이면 그 전 언어로 돌리고, 제안뿐이었으면 다시 제안하지 않는다 */
  | { type: "clear_ref"; unit_id: number }
  /** 문단 번호 고치기 - number가 null이면 번호 없음(번호 범위가 글로 돌아간다). follow면 같은 목록의 뒤 번호도 한 편집으로 따라 고친다.
   *  indent_shift를 주면 들여쓰기 차이도 같은 편집에서(기호를 고를 때 위 기호 줄 단계를 따름, B8 7-5) */
  | { type: "set_number"; unit_id: number; number: string | null; follow: boolean; indent_shift?: number }
  /** 들여쓰기 차이(B8) - 여러 줄을 한 편집으로(되돌리기 한 칸). 번호 칸이 있는 줄만, 값은 -9…9 */
  | { type: "set_indents"; units: { unit_id: number; indent_shift: number }[] }
  /** 삭제 취소(줄 하나 · 블록 전체) - 잡음 표시와 적은 사유만 비운다(단위는 그대로, 되돌리기가 다시 붙인다). 묶음은 구성원까지 */
  | { type: "clear_noise"; unit_ids: number[] }
  /** 저절로 삭제된 줄의 사유 쓰기 - 빈 글이면 정한 문구로. 보통 줄이 섞이면 422 not_a_noise_line. 묶음은 구성원까지 */
  | { type: "set_noise_reason"; unit_ids: number[]; reason: string }
  /** 여기부터 본문 - 그 줄 앞의 보통 줄을 본문 앞부분으로, 뒤로 이어진 앞부분 표시는 비운다(되돌리기 한 번). 보통 본문 줄이 아니면 422 invalid_body_start, 정한 줄이 끼면 409 unit_has_decision */
  | { type: "start_body"; unit_id: number }
  /** 제목 ↔ 문장(F8b) - heading이 거짓이면 제목을 문장마다 나눠 바꾼 표시를 단다(번역 조항은 앞 조항의 번호를 물려받는다).
   *  참이면 바꾼 문장은 그 조항 줄 전체가 제목 하나로 돌아가고, 보통 문장은 그 문장이 제목이 된다. 한/영 짝은 새 단위로 다시 선다 */
  | { type: "set_heading"; unit_ids: number[]; heading: boolean }
  /** 짝 카드 안 순서(설계 2026-11-20-assign-mockup1 D8) - 그 짝의 구성원 전부를 새 순서로. 끊김 없이 이어진 카드만(pair_not_adjacent), 배정이 걸리면 409 */
  | { type: "reorder_pair"; pair_id: number; unit_ids: number[] }
  /** 벗긴 표 덩이 안 줄 순서(설계 2026-11-20-assign-mockup2 D2) - 그 덩이의 줄 전부를 새 순서로(짝 카드 구성원은 붙여서). 판단이 걸린 줄도 받는다 */
  | { type: "reorder_unwrapped"; table_id: number; unit_ids: number[] };

export interface EditResult {
  document_revision: number;
  created_unit_ids: number[];
  retired_unit_ids: number[];
  /** 떼어 낸 배정 - 판단을 미배정으로 되돌린 단위(옛 문서)와 이음이 풀려 보류가 된 Old 단위(New 문서 편집). 없으면 null */
  detach?: Pick<DetachReport, "reset_unit_ids" | "held_unit_ids"> | null;
  /** switch_language가 바꾼 모양 - 다른 편집은 null */
  shape?: "merged" | "unpaired" | "split_pair" | null;
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

/** 단위가 가리키는 문서 번호와 그 번호의 EQUIS 표시 - 번호는 서버가 단위의 글에서 읽는다 */
export function getUnitRef(bundleId: number, docId: number, unitId: number): Promise<UnitRefDetail> {
  return apiFetch<UnitRefDetail>(`${buildDocPath(bundleId, docId)}/units/${unitId}/ref`);
}

/** 영어 Old 표의 짝 한글 표(11-23 명세 D2-R1~R3) - decided면 사람이 정한 답(source_table_id null = 짝 없음), 후보는 점수 큰 차례 */
export interface TableCounterpart {
  table_no: number;
  status: "matched" | "ambiguous" | "none";
  source_table_id: number | null;
  decided: boolean;
  candidates: { table_id: number; table_no: number; score: number }[];
}

export function getTableCounterpart(bundleId: number, docId: number, tableId: number): Promise<TableCounterpart> {
  return apiFetch<TableCounterpart>(`${buildDocPath(bundleId, docId)}/tables/${tableId}/counterpart`);
}

/** 사람이 짝 표를 정한다(null = 짝 없음) - 문서를 바꾸지 않아 revision · 되돌리기 단계가 없다 */
export function setTableCounterpart(bundleId: number, docId: number, tableId: number, sourceTableId: number | null): Promise<TableCounterpart> {
  return apiFetch<TableCounterpart>(`${buildDocPath(bundleId, docId)}/tables/${tableId}/counterpart`, { method: "PUT", body: JSON.stringify({ source_table_id: sourceTableId }) });
}

// 아래 문서 쓰기는 sendDocWrite로 보낸다 -다시 받기 전에 한 연달은 편집이 낡은 revision으로 409가 나지 않게(doc-revision.ts)
export function editUnits(bundleId: number, docId: number, revision: number, op: EditOp, confirm = false, undo?: UndoMeta): Promise<EditResult> {
  return sendDocWrite(docId, revision, (rev) => apiFetch<EditResult>(`${buildDocPath(bundleId, docId)}/edits`, { method: "POST", body: JSON.stringify({ revision: rev, confirm, op, undo }) }));
}

export function undoEdit(bundleId: number, docId: number, revision: number, confirm = false): Promise<EditStepResult> {
  return sendDocWrite(docId, revision, (rev) => apiFetch<EditStepResult>(`${buildDocPath(bundleId, docId)}/edits/undo`, { method: "POST", body: JSON.stringify({ revision: rev, confirm }) }));
}

export function redoEdit(bundleId: number, docId: number, revision: number, confirm = false): Promise<EditStepResult> {
  return sendDocWrite(docId, revision, (rev) => apiFetch<EditStepResult>(`${buildDocPath(bundleId, docId)}/edits/redo`, { method: "POST", body: JSON.stringify({ revision: rev, confirm }) }));
}

/** undo - Assign에서 맺으면 그 화면의 되돌리기 기록에 한 단계로 남는다(B6) */
export function createPair(bundleId: number, docId: number, revision: number, unitIds: number[], undo?: UndoMeta): Promise<PairResult> {
  return sendDocWrite(docId, revision, (rev) => apiFetch<PairResult>(`${buildDocPath(bundleId, docId)}/pairs`, { method: "POST", body: JSON.stringify({ revision: rev, unit_ids: unitIds, undo }) }));
}

/** 제안 짝(코드·AI)을 그대로 확정한다 - 이미 확정이면 서버는 아무것도 쓰지 않는다 */
export function confirmPair(bundleId: number, docId: number, pairId: number, revision: number, undo?: UndoMeta): Promise<PairResult> {
  return sendDocWrite(docId, revision, (rev) => apiFetch<PairResult>(`${buildDocPath(bundleId, docId)}/pairs/${pairId}/confirm`, { method: "POST", body: JSON.stringify({ revision: rev, undo }) }));
}

export function deletePair(bundleId: number, docId: number, pairId: number, revision: number, undo?: UndoMeta): Promise<PairResult> {
  return sendDocWrite(docId, revision, (rev) => apiFetch<PairResult>(`${buildDocPath(bundleId, docId)}/pairs/${pairId}?revision=${rev}`, { method: "DELETE", body: JSON.stringify({ undo }) }));
}

/** 표·그림 참조를 떼거나 다시 잇는다 - target_unit_id를 주면 그 묶음에 잇는다(state 생략 = linked) */
export function updateCaptionRef(
  bundleId: number,
  docId: number,
  refId: number,
  body: { revision: number; state?: "linked" | "detached"; target_unit_id?: number },
): Promise<CaptionRefResult> {
  return sendDocWrite(docId, body.revision, (rev) => apiFetch<CaptionRefResult>(`${buildDocPath(bundleId, docId)}/caption-refs/${refId}`, { method: "PATCH", body: JSON.stringify({ ...body, revision: rev }) }));
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
  /** 참조로 찾은 상위 SOP 번호(번호 순) - 상위를 고르지 않은 WI만, 올린 SOP의 확정 참조 줄로 서버가 읽을 때 센다. 직접 상위가 이긴다 */
  ref_parent_codes: string[];
  /** 줄 번호의 EQUIS 표시 - 기능이 꺼졌거나 묻지 않는 번호(임시 번호)면 null */
  equis?: EquisInfo | null;
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

/** 문장이 든 자리 - 단계가 없는 자리(SOP의 칸, 단계를 적지 않은 WI)는 wi_step이 null */
export interface PlaceCount {
  target_doc_id: number;
  wi_step: number | null;
  count: number;
}

/** 문장이나 칸 제목이 든 SOP 칸 - count는 그 칸의 최상위 항목 수(표 칸 문장·캡션 같은 딸린 줄은 뺀다. 결과물 C는 캡션 줄도 그리므로 C의 줄 수와 다를 수 있다), heading_count는 칸 제목에 이은 옛 제목 수 */
export interface SlotCount {
  target_doc_id: number;
  slot_key: string;
  count: number;
  heading_count: number;
}

/** 골격 항목의 종류 - backend app/sop/models.py OUTLINE_KINDS와 같은 값. 직접 배정·줄 세기는 서버가 is_assignable·counts_lines로 풀어 준다 */
export type OutlineKind = "general" | "category_table" | "named_children" | "auto_list" | "group";

/**
 * SOP 문서 하나의 골격 항목(칸) - 표준 골격을 문서마다 복사한 것이라 문서마다 다를 수 있다. 화면은 칸 목록을 따로 갖지 않고 이것만 읽는다.
 * 한 문서의 항목은 위계 순서로 온다(부모 바로 뒤에 하위). 수준은 둘로 정해져 있지 않다(level 0부터)
 */
export interface OutlineItem {
  /** 새 문서 코드 - NaSlot.code·WiStep.code와 같은 키 */
  code: string;
  /** 점으로 위계를 적은 키("procedures.maintenance") - 자리 키(slot_key·location_key)와 같은 값 */
  key: string;
  parent_key: string | null;
  level: number;
  /** "5"·"5.1" - 번호 없는 항목은 null */
  number: string | null;
  /** 번호를 이름 앞에 적는가 - 머리말을 쓰는 부모의 하위(부록)만 false: 이름(label "Appendix 2. …")에 번호가 이미 들어 있어 label만 적는다. number("2")는 줄 번호의 머리로 그대로 쓴다 */
  shows_number: boolean;
  title_en: string;
  title_ko: string;
  /** 조상까지 이은 이름 "General Requirements › Safety" - 부록은 "Appendix n. 제목" */
  label: string;
  kind: OutlineKind;
  is_required: boolean;
  default_style: NumberStyle;
  /** 문장을 직접 받는 항목인가 - 아니면 보낼 곳 목록에 없다 */
  is_assignable: boolean;
  /** 직접 놓인 줄에 번호를 세는가 - false면 줄의 표시와 상관없이 번호가 없다(하위 항목 번호와 겹치므로) */
  counts_lines: boolean;
  /** standard 표준에서 복사 · declared 문서가 선언(6장 절차 · 9장 부록 · 5장 범주) · custom 표준에서 벗어나 더한 항목 */
  origin: "standard" | "declared" | "custom";
  /** 이 문서에서 뺀 표준 항목 - 되살릴 수 있게 제자리로 실린다(번호 없음, 문장을 받지 않음, 하위는 함께 빠져 실리지 않는다). 칸 목록 · 나무는 거른다 */
  is_removed: boolean;
  /** 표준과 다른 까닭 - 사용자 항목, 이름을 바꾸거나 필수인데 뺀 표준 항목. 그 밖은 null */
  deviation_reason: string | null;
  /** 표준과 다름 - 선택 항목을 뺀 것 · N/A · 선언은 아니다 */
  is_deviation: boolean;
}

export interface ToBe {
  revision: number;
  docs: TargetDoc[];
  na_slots: NaSlot[];
  wi_steps: WiStep[];
  /** SOP 문서마다의 골격 항목 - 문서(code)별로 위계 순서. WI는 항목이 없다 */
  outline_items: OutlineItem[];
  /** 문서가 하위 항목을 선언할 때 권하는 이름 - 선언을 받는 부모 항목의 키마다(표준 골격의 것이라 문서와 상관없다). 없으면 빈 객체 */
  outline_suggestions: Record<string, string[]>;
  /** 문장이 든 자리만 실린다 - 배정 화면이 지울 수 없는 문서·단계의 지우기 단추를 잠근다 */
  sentence_counts?: PlaceCount[];
  /** 문장이나 칸 제목이 든 SOP 칸만 실린다 - N/A 칸 상태 표가 N/A로 둘 수 없는 칸을 가린다 */
  slot_counts?: SlotCount[];
}

export interface ToBeInput {
  revision: number;
  docs: Array<Pick<TargetDoc, "code" | "title" | "doc_type" | "parent_code" | "is_equipment_sop" | "order_index">>;
  na_slots: NaSlot[];
  wi_steps: WiStep[];
}

export function getToBe(bundleId: number): Promise<ToBe> {
  return apiFetch<ToBe>(`/bundles/${bundleId}/tobe`);
}

export function putToBe(bundleId: number, body: ToBeInput): Promise<ToBe> {
  return apiFetch<ToBe>(`/bundles/${bundleId}/tobe`, { method: "PUT", body: JSON.stringify(body) });
}

// 한 줄 추가·삭제(배정 화면) - revision을 보내지 않는다. 서버가 지금 목록에 한 줄을 더하거나 빼고 새 목록을 돌려준다
export interface NewToBeDoc {
  code: string;
  doc_type: TargetDocType;
  parent_code: string | null;
}

export function addToBeDoc(bundleId: number, body: NewToBeDoc): Promise<ToBe> {
  return apiFetch<ToBe>(`/bundles/${bundleId}/tobe/docs`, { method: "POST", body: JSON.stringify(body) });
}

export function removeToBeDoc(bundleId: number, targetDocId: number): Promise<ToBe> {
  return apiFetch<ToBe>(`/bundles/${bundleId}/tobe/docs/${targetDocId}`, { method: "DELETE" });
}

export function addWiStep(bundleId: number, targetDocId: number, title: string): Promise<ToBe> {
  return apiFetch<ToBe>(`/bundles/${bundleId}/tobe/docs/${targetDocId}/steps`, { method: "POST", body: JSON.stringify({ title }) });
}

export function removeWiStep(bundleId: number, targetDocId: number, stepNo: number): Promise<ToBe> {
  return apiFetch<ToBe>(`/bundles/${bundleId}/tobe/docs/${targetDocId}/steps/${stepNo}`, { method: "DELETE" });
}

// 줄 하나 고치기(Documents 화면) - 칸마다 바로 저장한다. 보낸 칸만 바뀌고 새 목록이 돌아온다(revision을 보내지 않는다)
export interface ToBeDocPatch {
  code?: string;
  title?: string;
  doc_type?: TargetDocType;
  /** null은 "상위 SOP 없음" */
  parent_code?: string | null;
  is_equipment_sop?: boolean;
}

export function updateToBeDoc(bundleId: number, targetDocId: number, patch: ToBeDocPatch): Promise<ToBe> {
  return apiFetch<ToBe>(`/bundles/${bundleId}/tobe/docs/${targetDocId}`, { method: "PATCH", body: JSON.stringify(patch) });
}

/** SOP의 칸 하나를 N/A로(사유와 함께) - 이미 N/A면 사유를 바꾼다 */
export function setNaSlot(bundleId: number, targetDocId: number, slotKey: string, reason: string): Promise<ToBe> {
  return apiFetch<ToBe>(`/bundles/${bundleId}/tobe/docs/${targetDocId}/na/${encodeURIComponent(slotKey)}`, { method: "PUT", body: JSON.stringify({ reason }) });
}

export function clearNaSlot(bundleId: number, targetDocId: number, slotKey: string): Promise<ToBe> {
  return apiFetch<ToBe>(`/bundles/${bundleId}/tobe/docs/${targetDocId}/na/${encodeURIComponent(slotKey)}`, { method: "DELETE" });
}

export function renameWiStep(bundleId: number, targetDocId: number, stepNo: number, title: string): Promise<ToBe> {
  return apiFetch<ToBe>(`/bundles/${bundleId}/tobe/docs/${targetDocId}/steps/${stepNo}`, { method: "PATCH", body: JSON.stringify({ title }) });
}

// SOP가 선언하는 골격 항목(6장 절차 · 9장 부록 · 5장 범주) - 한 번에 하나씩 쓰고 새 목록이 돌아온다(revision을 보내지 않는다)
/**
 * 골격 항목 고치기 - 보낸 칸만 바뀐다. position은 같은 부모의 항목들 안에서의 자리(0부터, 표준 항목은 422 outline_standard_item). 키는 그대로이고 번호만 따라간다.
 * is_removed는 표준 항목을 빼거나(true) 되살린다(false). reason은 표준에서 벗어나는 쓰기(표준 항목 영어 이름 바꾸기 · 필수 항목 빼기)의 사유 - 없으면 422 deviation_reason_required
 */
export interface OutlineItemPatch {
  title_en?: string;
  title_ko?: string;
  position?: number;
  is_removed?: boolean;
  reason?: string;
}

/**
 * 부모 항목 아래에 항목 하나를 더한다 - 끝자리에 놓이고 키는 서버가 정한다. 하위를 선언하는 부모(6장 · 9장 · 5장) 아래는 선언이고,
 * 묶음 제목 아래와 최상위(parentKey "")는 표준에서 벗어난 사용자 항목이라 reason이 있어야 한다
 */
export function addOutlineItem(bundleId: number, targetDocId: number, parentKey: string, titleEn: string, titleKo?: string, reason?: string): Promise<ToBe> {
  return apiFetch<ToBe>(`/bundles/${bundleId}/tobe/docs/${targetDocId}/outline`, { method: "POST", body: JSON.stringify({ parent_key: parentKey, title_en: titleEn, title_ko: titleKo, reason }) });
}

export function patchOutlineItem(bundleId: number, targetDocId: number, key: string, patch: OutlineItemPatch): Promise<ToBe> {
  return apiFetch<ToBe>(`/bundles/${bundleId}/tobe/docs/${targetDocId}/outline/${encodeURIComponent(key)}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function removeOutlineItem(bundleId: number, targetDocId: number, key: string): Promise<ToBe> {
  return apiFetch<ToBe>(`/bundles/${bundleId}/tobe/docs/${targetDocId}/outline/${encodeURIComponent(key)}`, { method: "DELETE" });
}

// 새 문서 목록 AI 읽기 - 템플릿에 맞지 않는 계획 파일이나 붙여 넣은 글에서 AI가 목록을 읽어 제안한다. AI는 목록에 쓰지 않는다
export interface ProposedDoc {
  code: string;
  title: string;
  /** 글이 종류를 말하지 않으면 null - 사람이 고른다 */
  doc_type: TargetDocType | null;
  parent_code: string | null;
  is_equipment_sop: boolean;
  steps: string[];
}

export interface ToBeProposal {
  suggestion_id: number;
  docs: ProposedDoc[];
  /** 이미 목록에 있는 번호 */
  listed_codes: string[];
  /** 글이 길어 앞부분만 읽었거나 제안이 많아 앞쪽만 남겼다 */
  truncated: boolean;
  /** 응답을 읽지 못했다 - 줄이 없다 */
  invalid: boolean;
}

/** 목록 파일 하나(xlsx·docx·txt·csv·md) 또는 붙여 넣은 글을 보내 AI 작업을 쌓는다 - 파일은 저장되지 않는다 */
export function requestToBeRead(bundleId: number, source: { file: File } | { text: string }): Promise<{ queued: number; request_id: string; truncated: boolean }> {
  const form = new FormData();
  if ("file" in source) form.append("file", source.file);
  else form.append("text", source.text);
  return apiFetch(`/bundles/${bundleId}/tobe/read`, { method: "POST", body: form });
}

/** 아직 정하지 않은 가장 새 제안 - 없으면 null */
export function getToBeRead(bundleId: number): Promise<ToBeProposal | null> {
  return apiFetch<ToBeProposal | null>(`/bundles/${bundleId}/tobe/read`);
}

/** 미리 보기를 닫는다 - 줄을 더했으면 as_is(그대로)·edited(고치거나 일부만), 버렸으면 rejected */
export function closeToBeRead(bundleId: number, suggestionId: number, adoption: "as_is" | "edited" | "rejected"): Promise<void> {
  return apiFetch<void>(`/bundles/${bundleId}/tobe/read/${suggestionId}/close`, { method: "POST", body: JSON.stringify({ adoption }) });
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
/** 새 문장의 변경 종류 - backend constants와 같은 값. 사람이 고르지 않고 서버가 구조 · 글 · 표 모양으로 정한다(저장 요청에 싣지 않는다) */
export type ChangeType = "as_is" | "rewritten" | "split" | "merged" | "translated" | "new" | "heading";
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
  /** text에서 내용이 시작하는 자리 - 문단 번호가 번호 칸으로 갔으면 그 뒤, 아니면 0(문서 보기의 number.content_start와 같다) */
  content_start: number;
  table_id: number | null;
  row_index: number | null;
  group_unit_id: number | null;
  status: CoverStatus;
  decision: Decision;
  target_ids: number[];
  /** 그 새 문장들이 있는 New 문서(target_docs) - Assign 문서 대시보드가 받는 New 문서를 센다 */
  target_doc_ids: number[];
  /** 한/영 짝(제안·확정 모두) - 문서 보기의 units[].pair_id와 같은 뜻, 짝이 없으면 null */
  pair_id: number | null;
  /** 표·그림 단위의 새 문장 아래 캡션 새 문장이 있다 - 써 넣은 캡션(캡션 단위 없음)도 센다 */
  has_caption_target?: boolean;
  /** 캡션 하나를 같이 쓰는 그림 묶음의 첫 그림(F7 ⑥) - 그 그림의 캡션이 이 그림의 캡션이다 */
  caption_figure_id?: number | null;
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
  kind: "sentence" | "table" | "figure" | "slot_heading";
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

/** 문장 사이에 놓은 자리 - 이 새 문장 id 뒤에 끼운다. null이면 칸의 맨 앞(자리 없음은 키를 넣지 않는다) */
export interface TargetPosition {
  after_target_id: number | null;
}

export interface TargetInput {
  key: string;
  id?: number;
  revision?: number;
  target_doc_id?: number;
  slot_key?: string | null;
  wi_step?: number | null;
  wi_part?: WiPart | null;
  kind?: "sentence" | "table" | "figure" | "slot_heading";
  lang?: UnitLang;
  text?: string;
  /** 비우면(undefined) 지금 값을 둔다 */
  remark?: string;
  source_unit_ids: number[];
  parent_key?: string | null;
  cell_row?: number | null;
  cell_col?: number | null;
  grid?: { rows: number; cols: number } | null;
  /** 놓은 자리 - 최상위 새 문장에만, 없으면 키를 넣지 않는다 */
  position?: TargetPosition;
}

export interface GroupSaveInput {
  action: "confirm" | "hold";
  hold_reason: string;
  /** unassigned는 보낼 곳 없는 보류 - action이 hold일 때만 된다 */
  units: Array<{ unit_id: number; revision: number; disposition: Disposition; move_target_code: string; reason: string }>;
  targets: TargetInput[];
  removed_target_ids: number[];
  /** 지울 새 문장 → 화면이 본 revision - 다르면 409(그 사이 남이 고친 것을 지우지 않는다). 싣지 않은 것은 견주지 않는다 */
  removed_revisions?: Record<number, number>;
  /** 짝의 한쪽만 이을 때 남는 단위 - 서버가 같은 저장 안에서 그 짝을 풀어 따로 줄로 남긴다 */
  release_unit_ids?: number[];
  /** Use로 받은 AI 제안 - 서버가 판단에 잇고 채택을 남긴다(이 묶음의 분류·묶기 제안이 아니면 404 suggestion_not_found) */
  suggestion_id?: number;
}

/** documentId - 그 Old 문서의 줄만(편집 뒤 그 문서만 다시 받는다) */
export async function listAllUnits(bundleId: number, documentId?: number): Promise<UnitRow[]> {
  const items: UnitRow[] = [];
  const scope = documentId === undefined ? "" : `&document_id=${documentId}`;
  // 한 번에 1000개까지 - 묶음이 크면 이어서 받는다
  for (let offset = 0; ; offset += 1000) {
    const page = await apiFetch<{ total: number; items: UnitRow[] }>(`/bundles/${bundleId}/units?limit=1000&offset=${offset}${scope}`);
    items.push(...page.items);
    if (items.length >= page.total || page.items.length === 0) return items;
  }
}

/** 확정하지 않은 번역(AI 제안 · 보류) 하나 - 출처 Old 단위가 은퇴했으면 source_* · row_unit_id · document_id가 빈다 */
export interface OpenTranslation {
  id: number;
  revision: number;
  status: CoverStatus;
  lang: UnitLang;
  text: string;
  target_doc_code: string;
  /** 표 칸의 번역이면 그 표 새 문장 - 저장이 표 묶음 전체를 실어야 한다 */
  parent_target_id: number | null;
  source_unit_id: number | null;
  source_display_id: string;
  source_text: string;
  /** 그 단위가 든 Assign 줄의 단위 - 칸 문장은 표 단위 */
  row_unit_id: number | null;
  document_id: number | null;
  /** 출처 새 문장과 단위가 모두 살아 있나 - 아니면 지우기만 한다 */
  can_confirm: boolean;
}

export function listOpenTranslations(bundleId: number): Promise<OpenTranslation[]> {
  return apiFetch<OpenTranslation[]>(`/bundles/${bundleId}/translations/open`);
}

export function getGroupByUnit(bundleId: number, unitId: number): Promise<Group> {
  return apiFetch<Group>(`/bundles/${bundleId}/groups/by-unit/${unitId}`);
}

/** Assign 되돌리기 기록 메타 - 저장 본문의 undo. 한 사용자 동작의 요청들은 같은 step_key를 쓴다(서버가 한 단계로 합친다) */
export type SaveOp = "confirm" | "hold" | "link" | "unlink" | "mark_new" | "link_source" | "split_new" | "merge_new" | "drop_translation";

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
  /** 판단 상태(배정 · 새 문장 · 짝)도 되썼나 - 편집 단계는 그 편집이 판단을 바꿨을 때만(B6) */
  restored_decisions: boolean;
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
 * 그렇게 바뀐 단위는 지우기 전에 묶음을 다시 읽어 지금 revision을 쓴다(낡은 revision이면 409). 판단이 바뀐 단위를 돌려준다(새 revision은 응답에 없다).
 */
export async function clearDecisions(bundleId: number, units: Array<{ unit_id: number; revision: number }>, undo?: UndoMeta): Promise<number[]> {
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
  return [...new Set([...reset, ...changed])];
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
  /** 이 문장이 온 새 문서 원문의 Unit - 원문 다듬기의 대상으로 고를 때 쓴다. 원문 없이 만든 문장은 null */
  new_unit_id?: number | null;
  /**
   * 참조 줄이면 가리키는 문서 - 출처가 참조 줄인 문장과, 출처 없이 이 문서에만 있는 참조 줄 둘 다(v1.0.18). 아니면 null.
   * 번호는 서버가 읽는다(출처 참조 줄의 번호, 없으면 이 문장의 글). equis는 참조 카드와 같은 모양이고 꺼져 있으면 null -
   * EQUIS가 모르는 번호(state "not_found")와 폐기된 문서(retired)는 여기서 읽는다. refreshing이면 조금 뒤 목록을 다시 읽는다
   */
  ref?: { number: string; equis: EquisInfo | null } | null;
  /** 참조 줄인데 이 문장의 번호(number)나 이름(title)이 EQUIS와 다르다 - 작은 주의. 참조 줄이 아니거나 견줄 것이 없으면 null */
  ref_issue?: "number" | "title" | null;
  /** 표 줄이면 칸 새 문장 격자 */
  table?: BundleTable | null;
  /** 그림 줄이고 출처 그림에 이미지가 있으면 그 블록 */
  figure?: BundleFigure | null;
  /** 표·그림 줄의 캡션 글(여러 언어는 한국어·영어 순 줄바꿈), 없으면 null */
  caption?: string | null;
}

/** New 칸 표 줄의 칸 새 문장 - 글은 확정 글, 없으면 AI 글 */
export interface BundleCell {
  /** 칸 새 문장 id - 칸 번역은 같은 (row, col)에 하나 더 있다 */
  target_id: number;
  row: number;
  col: number;
  lang: UnitLang;
  text: string;
  status: CoverStatus;
  /** 칸에 이은 Old 단위(출처 순서) - 칸 위 출처 칩 */
  source_unit_ids: number[];
  /** 이미 쓴 문서의 칸만 - 엮은 문서의 칸은 잇지 않아 null */
  revision?: number | null;
}

/** New 칸이 그리는 표 - 격자 크기와 칸 새 문장(행·열 순) */
export interface BundleTable {
  rows: number;
  cols: number;
  cells: BundleCell[];
}

/** New 칸이 그리는 그림 - 이미지를 받을 문서와 블록(getFigureImage) */
export interface BundleFigure {
  document_id: number;
  block_id: number;
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

export function listIdenticalCandidates(bundleId: number): Promise<IdenticalCandidate[]> {
  return apiFetch<IdenticalCandidate[]>(`/bundles/${bundleId}/match/identical-candidates`);
}

export function confirmMatchesInBulk(bundleId: number, body: BulkMatchInput, undo?: UndoMeta): Promise<Group> {
  return apiFetch<Group>(`/bundles/${bundleId}/match/bulk-confirm`, { method: "POST", body: JSON.stringify({ ...body, undo }) });
}

/** AI 제안 일괄 수락의 종류 - 분류(칸에 놓기)와 묶기(이미 쓴 New 문장에 잇기·신규)를 따로 받는다(설계 2026-11-19-ai-suggest-only D3) */
export type AcceptKind = "classify" | "match";

export interface AcceptItem {
  suggestion_id: number;
  /** 분류는 assigned·delete, 묶기는 제안 모양(one_to_one·merged·split·table·figure·new·delete_candidate) */
  shape: string;
  is_delete: boolean;
}

/** 지금 받을 수 있는 제안과 빼는 제안의 수 - 경고가 있는 것, 다듬기를 기다리는 묶기, AI가 본 뒤 바뀐 것은 사람이 본다 */
export interface AcceptPreview {
  kind: AcceptKind;
  document_id: number | null;
  items: AcceptItem[];
  excluded_warnings: number;
  excluded_changed: number;
  /** 받으면 저장 검사가 늘 거절하는 것 - 사유(두 New 문서에 걸친 나눔)나 캡션을 사람이 적어야 한다 */
  excluded_manual: number;
}

export interface AcceptResult {
  accepted: number;
  skipped: number;
}

/** 일괄 수락 요청 하나에 담는 제안 수 상한 - backend accept_suggestions.MAX_ACCEPT와 같은 값(넘으면 422) */
export const MAX_ACCEPT = 2000;

/** documentId가 null이면 Bundle 전체 - 신규(입구 2)는 Old 문서가 없어 Bundle 범위에만 든다 */
export function getAcceptPreview(bundleId: number, kind: AcceptKind, documentId: number | null): Promise<AcceptPreview> {
  const params = new URLSearchParams({ kind, ...(documentId !== null ? { document_id: String(documentId) } : {}) });
  return apiFetch<AcceptPreview>(`/bundles/${bundleId}/ai/accept-preview?${params}`);
}

export function acceptSuggestions(bundleId: number, body: { kind: AcceptKind; suggestion_ids: number[]; delete_reason?: string }, undo?: UndoMeta): Promise<AcceptResult> {
  return apiFetch<AcceptResult>(`/bundles/${bundleId}/ai/accept`, { method: "POST", body: JSON.stringify({ ...body, undo }) });
}

export function getGroupByTarget(bundleId: number, targetId: number): Promise<Group> {
  return apiFetch<Group>(`/bundles/${bundleId}/groups/by-target/${targetId}`);
}

// --- 결과물 ---

/** 결과물 라벨 언어(위치 표기·칸 이름) - 화면 UI 언어를 보낸다. 내용은 한 벌이다 */
export type OutputLang = "ko" | "en";

export interface OutputLocation {
  section: string;
  place: string;
  page: number | null;
  page_basis: string;
}

/** 결과물 A 한 줄 - 의미 묶음(짝 하나·짝 없는 판단 단위 하나·고아 번역·입구 2 신규 짝) 안에서 문장마다 한 줄 */
export interface OutputARow {
  /** 묶음 번호(1부터) - 묶음의 모든 줄에 같은 값 */
  row_no: number;
  is_group_start: boolean;
  /** caption - 표·그림 줄 바로 뒤의 캡션 단위 줄 */
  row_kind: "unit" | "table" | "caption" | "cell" | "translation" | "new";
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
  /** 저장한 변경 종류, 그리고 표시 전용 translated_added·heading */
  change_type: string;
  /** 묶음의 Remark - 묶음의 모든 줄에 같은 값 */
  remark: string;
  /** 옛 단위 줄은 커버 상태, 번역·신규 줄은 새 문장 상태 - 줄마다 자기 값 */
  status: string;
  /** "이름 (ID)", 디렉터리에 없으면 ID만 */
  confirmed_by: string | null;
  confirmed_at: string | null;
  group_id: string | null;
  warnings: Array<Record<string, string>>;
  /** 저절로 삭제된 줄("toc" · "front" · "history") - 보낸 곳 Deleted, status "deleted"(판단 상태가 아니다) */
  noise_kind?: string | null;
}

export interface FlowGraph {
  nodes: Array<{ id: string; kind: string; label: string; title: string; count: number }>;
  edges: Array<{ source: string; target: string; count: number }>;
}

/** 줄 번호 표시 - backend app/sop/constants.py NumberStyle과 같은 값 */
export type NumberStyle = "numbered" | "bullet" | "omitted" | "note";

/** 앱이 채우는 목록 절(auto_list)의 한 줄 - 그 SOP의 자식 WI. 사람이 고치지 않는다 */
export interface AutoItem {
  code: string;
  title: string;
}

/** 결과물 C·Assign New 칸의 절이 골격에서 받아 오는 것 - 화면이 칸 키로 규칙을 다시 풀지 않는다 */
export interface SectionOutline {
  /** 골격 항목의 종류 - WI 단계·입구 2 문서의 절(path:)은 null. group·auto_list 절은 문장을 받지 않는다(items가 늘 비어 있다) */
  kind: OutlineKind | null;
  level: number;
  /** 이 절에 직접 놓인 줄에 번호를 세는가(OutlineItem.counts_lines) */
  counts_lines: boolean;
  default_style: NumberStyle;
  /** 절 머리에 번호를 적는가(OutlineItem.shows_number) - 부록만 false이고 머리는 label만 적는다. 그때도 절의 number는 줄 번호의 머리다. WI 단계·path: 절은 true */
  shows_number: boolean;
  /** 앱이 채우는 목록 절(auto_list)의 줄 - To-Be 순서. 그 밖의 절은 빈 배열 */
  auto_items: AutoItem[];
  /** 표준과 다른 SOP 절(사용자 항목 · 이름을 바꾼 표준 항목)의 사유 - 그 밖은 null */
  deviation_reason: string | null;
  /** 필수 절인데 비었다(자기와 하위에 줄이 없고 N/A도 아니다, 자동 목록은 자식 WI가 없다) - 알림일 뿐 검토 요청을 막지 않는다 */
  is_empty_required: boolean;
}

export interface OutputCItem {
  target_id: number;
  kind: string;
  /** 글꼴용 - 한 칸에 두 언어가 섞여 나온다 */
  lang: string;
  text: string;
  ai_text: string;
  change_type: string | null;
  status: string;
  source_note: string;
  /** 줄이 받은 옛 단위 수 - 2 이상(N:1)이면 C 화면이 줄에 올리거나 고를 때 source_note를 꼬리표로 보인다 */
  source_count: number;
  /** units | translation | new_doc - AI 번역(translation)은 깊이가 출처를 따른다 */
  origin: string;
  /** 굵은 선 묶음 키(A와 같은 묶음) - "old:…" | "new:…", 출처가 은퇴한 번역은 null */
  meaning_key: string | null;
  /** 섹션 번호(칸 번호 + 들여쓰기, 6.1.2) - 표 칸은 표의 번호, 입구 2 문서·단계 없는 WI·하위 칸이 있는 칸에 직접 놓인 줄은 null */
  number: string | null;
  /** 사람이 정한 깊이 그대로 - 번호는 서버가 앞 번호 줄 깊이 + 1까지로 눌러 읽어 센다 */
  indent_level: number;
  /** 번호 표시 - 생략·주석 줄은 number가 null이고 세지 않는다. 표 칸은 표의 값 */
  number_style: NumberStyle;
  cell_row: number | null;
  cell_col: number | null;
  /** 표·그림의 자식 - 캡션 새 문장(칸 좌표 없음, 한국어·영어 순)이 먼저, 그다음 칸 새 문장(행·열 순) */
  children: OutputCItem[];
  /** 표·그림의 캡션 글(그림은 text도 이 글), 없으면 null */
  caption?: string | null;
  /** 새 문서에서 다시 매긴 표·그림 번호 - 같으면 null */
  renumber?: RenumberChange | null;
}

export interface OutputC {
  docs: Array<{
    target_doc_id: number;
    code: string;
    title: string;
    doc_type: string;
    parent_code: string | null;
    entrance: string;
    /**
     * number: SOP 칸 번호(5.1)·WI 단계 번호(3), 번호가 없는 칸은 null.
     * heading_note: 칸 제목에 이은 옛 제목 "← OLD-1 §5", 없으면 빈 글 - 칸 제목은 items에 넣지 않는다
     */
    sections: Array<SectionOutline & { location_key: string; label: string; number: string | null; na_reason: string | null; heading_note: string; items: OutputCItem[] }>;
  }>;
  /** 삭제·이동은 옛 줄마다 한 번 - 짝이면 표시 ID·원문이 줄바꿈으로 이어진다 */
  deleted: Array<{ display_id: string; doc_code: string; section: string; source_text: string; reason: string }>;
  moved: Array<{ display_id: string; doc_code: string; section: string; source_text: string; move_target_code: string; reason: string }>;
}

/** 요약 숫자 한 벌 - 옛 쪽은 줄로 센다. no_destination은 처분 기준이라 진행 숫자의 Unassigned(상태 기준)와 다르다 */
export interface OutputSummary {
  old_rows: number;
  assigned: number;
  no_destination: number;
  duplicate: number;
  deleted: number;
  moved: number;
  new: number;
  translated: number;
  confirmed_rate: number;
  single_language: number;
  /** 저절로 삭제된 줄 수 - 목차 · 본문 앞부분 · 개정 이력(old_rows·assigned에 들고 deleted에는 들지 않는다) */
  toc_deleted: number;
  front_deleted: number;
  history_deleted: number;
  /** 풀린 표에서 온 줄 - 벗긴 표(레이아웃 표)의 칸 줄이 든 줄(MD 1 F11) */
  unwrapped_rows: number;
}

export function getOutputA(bundleId: number, labelLang: OutputLang): Promise<OutputARow[]> {
  return apiFetch<OutputARow[]>(`/bundles/${bundleId}/outputs/a?lang=${labelLang}`);
}

export function getOutputB(bundleId: number, labelLang: OutputLang): Promise<FlowGraph> {
  return apiFetch<FlowGraph>(`/bundles/${bundleId}/outputs/b?lang=${labelLang}`);
}

export function getOutputC(bundleId: number, labelLang: OutputLang): Promise<OutputC> {
  return apiFetch<OutputC>(`/bundles/${bundleId}/outputs/c?lang=${labelLang}`);
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
  /** 아래 셋은 결과물 C 항목(OutputCItem)과 같은 값 - 템플릿 보기가 글머리 기호 깊이·주석 줄과 한/영 짝(같은 묶음 키)을 읽는다 */
  number_style: NumberStyle;
  indent_level: number;
  meaning_key: string | null;
  /** 출처 Old 단위 - 번역은 번역 출처 단위 */
  source_unit_ids: number[];
  table?: BundleTable | null;
  figure?: BundleFigure | null;
  /** 표·그림 줄의 캡션 글(결과물 C와 같은 규칙), 없으면 null */
  caption?: string | null;
  /** 새 문서에서 다시 매긴 표·그림 번호 - 같으면 null */
  renumber?: RenumberChange | null;
}

export interface ComposedSection extends SectionOutline {
  location_key: string;
  label: string;
  number: string | null;
  na_reason: string | null;
  /** 칸 제목 출처 - 결과물 C 칸 머리와 같은 "← OLD-1 §5", 없으면 빈 글 */
  heading_note: string;
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

/** lang은 라벨 언어만(화면 언어) - 번호는 결과물 C와 같은 한 줄 세기 */
export function getComposedDoc(bundleId: number, docId: number, lang: OutputLang): Promise<ComposedDoc> {
  return apiFetch<ComposedDoc>(`/bundles/${bundleId}/outputs/c/docs/${docId}?lang=${lang}`);
}

export function getSummary(bundleId: number): Promise<OutputSummary> {
  return apiFetch<OutputSummary>(`/bundles/${bundleId}/summary`);
}

/** 미리보기 칸 - 모양 판정은 서버 시트 모델이 끝냈다(그리기만 한다) */
export interface PreviewCell {
  text: string;
  faint: boolean;
  italic: boolean;
  bold: boolean;
  head: boolean;
  numeric: boolean;
  /** 칸 안 들여쓰기 단계 - C 시트 글머리 기호 줄의 Item 칸 · 문단 Excel Text 칸 */
  indent: number;
  /** 취소선 - 문단 Excel의 지운 줄 Text 칸(흐림과 함께) */
  strike: boolean;
  /** 색 칩으로 그리는 칸(A의 Status)의 색 - 확정 · AI 제안 · 삭제(흐림) · 미배정. 칩이 아닌 칸은 null */
  tone: PreviewTone | null;
}

export type PreviewTone = "ok" | "ai" | "del" | "un";

export type PreviewRowKind = "status" | "header" | "group_start" | "in_group" | "doc" | "section" | "plain";

export interface PreviewRow {
  kind: PreviewRowKind;
  wrap: boolean;
  cells: PreviewCell[];
  /** 이 줄의 옛 단위와 관계 묶음(A의 자료 줄에만) - 고른 줄 · 같은 무리를 칸 글이 아니라 이 값으로 맞춘다 */
  unit_id: number | null;
  group_id: string | null;
  /** 저절로 삭제된 줄 - 같은 종류가 연달아 오면 한 줄로 접어 그린다 */
  toc: boolean;
  /** 그 종류("toc" · "front" · "history") - 접기는 종류가 바뀌면 끊는다 */
  noise?: string | null;
  /** 지운 줄(문단 Excel) - 화면은 숨기고, 그 줄을 고른 동안만 빨간 음영으로 보인다 */
  deleted: boolean;
  /** 한 줄로 묶은 옛 단위 전부(문단 Excel - 이어진 줄이 같은 새 문장 하나로 감). unit_id는 그 첫 단위, 한 단위 줄은 빈 목록 */
  unit_ids: number[];
}

/** 머리 위 열 무리 띠 한 칸 */
export interface PreviewBand {
  label: string;
  span: number;
  tone: "asis" | "tobe" | "decision" | "tracking";
}

export interface PreviewSheet {
  name: string;
  widths: number[];
  rows: PreviewRow[];
  freeze: string | null;
  filter_columns: number;
  image_png: string | null;
  image_row: number | null;
  total_rows: number;
  truncated: boolean;
  /** 실린 첫 자료 줄 앞에서 뺀 줄 수(머리 줄 다음부터) - Assign 미리보기의 가운데 창만 0보다 크다 */
  offset: number;
  /** 아래 셋은 미리보기에만 있다(A에만, 파일에는 쓰지 않는다) - 폭에 맞춘 열 비율(null이면 widths가 비율) · 열 무리 띠 · 열의 뜻 */
  fit_widths: number[] | null;
  bands: PreviewBand[];
  column_keys: string[] | null;
}

export interface WorkbookPreview {
  file_name: string;
  sheets: PreviewSheet[];
}

export function getExportPreview(bundleId: number): Promise<WorkbookPreview> {
  return apiFetch<WorkbookPreview>(`/bundles/${bundleId}/export/preview`);
}

/** Assign Space 미리보기 - Old 문서 하나의 A 시트를 고른 단위를 가운데로 500줄 창까지(파일과 같은 줄) */
export function getAssignSheetPreview(bundleId: number, docId: number, aroundUnitId: number | null): Promise<PreviewSheet> {
  const around = aroundUnitId !== null ? `&around_unit_id=${aroundUnitId}` : "";
  return apiFetch<PreviewSheet>(`/bundles/${bundleId}/export/preview/a?doc_id=${docId}${around}`);
}

/** Assign Space 미리보기(한 단 보기) - 문서 하나(Old · 이미 쓴 New)의 문단 Excel 시트를 고른 단위를 가운데로 500줄 창까지(받을 파일과 같은 줄, 표 포함) */
export function getParagraphSheetPreview(bundleId: number, docId: number, aroundUnitId: number | null): Promise<PreviewSheet> {
  const around = aroundUnitId !== null ? `&around=${aroundUnitId}` : "";
  return apiFetch<PreviewSheet>(`/bundles/${bundleId}/documents/${docId}/paragraphs/preview?tables=true${around}`);
}

/** 묶음당 파일 하나 - 판(lang)이 없다. 저장 이름은 서버가 짓는다(Content-Disposition) */
export function downloadExport(bundleId: number): Promise<{ blob: Blob; fileName: string | null }> {
  return apiFetchBlobWithName(`/bundles/${bundleId}/export.xlsx`);
}

/** 문단 Excel 받을 때 넣을 것 넷(서버 ParagraphInclude) - 표 · 삭제한 줄 · 그림 자리 · 옛 문서 목차 */
export interface ParagraphInclude {
  tables: boolean;
  deleted: boolean;
  figures: boolean;
  toc: boolean;
}

/** 처음 값 - 지금 파일에서 옛 문서 목차만 뺀 것 */
export const DEFAULT_INCLUDE: ParagraphInclude = { tables: true, deleted: true, figures: true, toc: false };

/** 문단 Excel - 쪼갠 단위 한 줄씩 한 열(docId가 null이면 Old 문서 모두, 문서마다 시트). 넣을 것은 include로 고른다 */
export function downloadParagraphs(bundleId: number, docId: number | null, include: ParagraphInclude): Promise<{ blob: Blob; fileName: string | null }> {
  const path = docId === null ? `/bundles/${bundleId}/old-paragraphs.xlsx` : `/bundles/${bundleId}/documents/${docId}/paragraphs.xlsx`;
  const query = `tables=${include.tables}&deleted=${include.deleted}&figures=${include.figures}&toc=${include.toc}`;
  return apiFetchBlobWithName(`${path}?${query}`);
}

/** 순서 바꾸기 요청 한 줄 - 뺀 값은 그대로 둔다. 깊이·번호 표시는 그 줄에만 붙는다(짝 상대·번역이 따라 바뀌지 않는다) */
export interface TargetOrderItem {
  target_id: number;
  /** 다른 칸으로 옮길 때만 - SOP 칸 키. null은 보내지 않는다(서버가 unknown_slot) */
  slot_key?: string;
  /** 다른 단계로 옮길 때만 - null은 "단계 없음"이라 키째 보낸다 */
  wi_step?: number | null;
  indent_level?: number;
  number_style?: NumberStyle;
}

/** 결과물 C의 새 문서 하나 */
export type OutputCDoc = OutputC["docs"][number];

/** backend OrderItemOut - 저장 뒤 그 줄의 값 */
export interface TargetOrderItemOut {
  target_id: number;
  order_index: number;
  wi_step: number | null;
  slot_key: string | null;
  indent_level: number;
  number_style: NumberStyle;
}

/** 순서 저장 응답 - doc은 저장 뒤 그 문서의 C 모양(같은 라벨 언어의 결과물 C에서 그 문서와 같은 값). 화면은 C 전체를 다시 받지 않는다 */
export interface TargetOrderResult {
  revision: number;
  target_doc_id: number;
  items: TargetOrderItemOut[];
  doc: OutputCDoc;
}

/** labelLang은 응답 doc의 칸 이름·출처 표기 언어만 고른다 */
export function putTargetOrder(bundleId: number, labelLang: OutputLang, body: { revision: number; target_doc_id: number; items: TargetOrderItem[] }): Promise<TargetOrderResult> {
  return apiFetch<TargetOrderResult>(`/bundles/${bundleId}/targets/order?lang=${labelLang}`, { method: "PUT", body: JSON.stringify(body) });
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

export async function listSuggestions(bundleId: number, kind: string, result: "applied" | "invalid" = "applied"): Promise<AiSuggestion[]> {
  const items: AiSuggestion[] = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await apiFetch<{ total: number; items: AiSuggestion[] }>(`/bundles/${bundleId}/ai/suggestions?kind=${kind}&result=${result}&limit=1000&offset=${offset}`);
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

// --- 참조 지도 (GET /bundles/{id}/map, 서버 app/sop/ref_map.py의 MapOut) ---

export type MapScope = "linked" | "all";
export type MapRelation = "self" | "member" | "summary";
export interface MapBundle {
  id: number;
  code: string;
  /** summary면 빈 글 - 구성원이 아닌 Bundle의 제목은 응답에 없다 */
  title: string;
  status: BundleStatus;
  relation: MapRelation;
  document_count: number;
}
export interface MapBecomes {
  /** 임시 번호면 빈 글 */
  code: string;
  title: string;
  doc_type: "sop" | "wi";
}
export interface MapNode {
  id: string;
  kind: "old" | "target" | "num";
  bundle_id: number | null;
  number: string;
  title: string;
  doc_type: "sop" | "wi" | null;
  becomes: MapBecomes[];
}
export interface MapEdge {
  source: string;
  target: string;
  kind: "ref" | "moved";
  state: "confirmed" | "proposed";
  lines: number;
}
export interface RefMap {
  scope: MapScope;
  truncated: boolean;
  bundles: MapBundle[];
  nodes: MapNode[];
  edges: MapEdge[];
}

export function getRefMap(bundleId: number, scope: MapScope): Promise<RefMap> {
  return apiFetch<RefMap>(`/bundles/${bundleId}/map?scope=${scope}`);
}

// --- 참조 지도의 줄 문장 (GET /bundles/{id}/map/lines, 서버 ref_map.py의 MapLinesOut) ---

/** 보는 사람이 그 줄이 든 Bundle의 구성원일 때만 오는 줄 하나 */
export interface MapLine {
  bundle_id: number;
  document_id: number;
  unit_id: number;
  display_id: string;
  kind: "ref" | "moved";
  state: "confirmed" | "proposed";
  number: string;
  /** 그 줄의 문서 마디(old:<document_id>) */
  source: string;
  /** 그 줄이 닿는 마디 */
  target: string;
  /** 300자까지 */
  text: string;
  text_truncated: boolean;
}
/** 구성원이 아닌 Bundle의 줄 - 선 하나에 든 줄 수만(글·표시 ID·Unit id 없음) */
export interface MapWithheld {
  source: string;
  target: string;
  kind: "ref" | "moved";
  state: "confirmed" | "proposed";
  lines: number;
}
export interface MapLines {
  /** 요청한 마디 id 그대로 */
  node: string;
  out: MapLine[];
  in: MapLine[];
  withheld_out: MapWithheld[];
  withheld_in: MapWithheld[];
  /** 한쪽 200줄을 넘어 싣지 않은 문장 줄 수 */
  more_out: number;
  more_in: number;
}

export function getMapLines(bundleId: number, node: string, scope: MapScope): Promise<MapLines> {
  return apiFetch<MapLines>(`/bundles/${bundleId}/map/lines?${new URLSearchParams({ node, scope })}`);
}
