// 묶음 안 화면 목록 - 레일·상단 2단·개요의 다음 행동이 같은 순서와 주소를 쓴다(디자인 문서 8절).

import type { NextAction } from "./api-sop";

export type StageKey = "overview" | "documents" | "assign" | "order" | "outputs" | "map" | "history";

/** Documents 화면 안 New 문서 목록(옛 To-Be 화면)의 자리 - 옛 주소 /tobe도 여기로 넘긴다 */
export const NEW_DOCUMENTS_ANCHOR = "new-documents";

export interface Stage {
  key: StageKey;
  /** 묶음 주소 뒤에 붙는 경로. 개요는 빈 문자열 */
  path: string;
  /** 단계 번호 칸에 쓰는 숫자. 없으면 아이콘 */
  step?: number;
  /** 화면이 아직 없으면 레일에서 비활성으로 둔다 */
  ready: boolean;
}

export const STAGES: readonly Stage[] = [
  { key: "overview", path: "", ready: true },
  // 1단계 - Old 문서 목록과 그 아래 New 문서 목록(옛 To-Be 화면, 네 단계 워크플로우 B1). 옛 /tobe는 여기로 넘긴다
  { key: "documents", path: "/documents", step: 1, ready: true },
  // 2단계 - 쪼개기와 배정을 한 걸음으로 센다. 배정을 확정하면 그 조각의 경계도 확인된 것으로 본다(네 단계 워크플로우 B2).
  // 옛 /classify·/match·/split은 여기로 넘긴다 - 쪼개기 화면은 이 화면 안의 "원문 고치기"(주소의 edit)가 되었다
  { key: "assign", path: "/assign", step: 2, ready: true },
  // 3단계 - New 문서별 문장 순서와 문단번호
  { key: "order", path: "/order", step: 3, ready: true },
  // 4단계 - 결과물과 검토. 검토 요청·완료·되돌림은 이 화면 위의 검토 띠에 있다(옛 /review는 여기로 넘긴다, B4)
  { key: "outputs", path: "/outputs", step: 4, ready: true },
  // 번호 없는 보는 화면 - 문서 사이 참조와 후속 문서(참조 지도). 내 문서가 없어도 남의 문서를 찾아볼 수 있어 잠그지 않는다
  { key: "map", path: "/map", ready: true },
  // 레일 맨 아래 - 작업 기록 전체(개요 Activity의 "모두 보기")
  { key: "history", path: "/history", ready: true },
];

// 문서가 하나도 없으면 들어가 봐야 할 일이 없는 단계. New 문서 목록은 Excel로 문서보다 먼저 채울 수 있고, Documents 화면에 있어 늘 열린다
const NEEDS_DOCUMENTS: ReadonlySet<StageKey> = new Set(["assign", "order", "outputs"]);

export function isStageLocked(key: StageKey, documentCount: number): boolean {
  return documentCount === 0 && NEEDS_DOCUMENTS.has(key);
}

const BUNDLE_PATH = /^\/bundles\/(\d+)(\/[a-z-]+)?\/?$/;

/** 주소에서 묶음 ID와 현재 단계를 읽는다. 묶음 밖이면 null */
export function parseBundlePath(pathname: string): { bundleId: number; stage: StageKey | null } | null {
  const match = BUNDLE_PATH.exec(pathname);
  if (!match) return null;
  const sub = match[2] ?? "";
  const stage = STAGES.find((item) => item.path === sub)?.key ?? null;
  return { bundleId: Number(match[1]), stage };
}

/** 문서 하나를 배정 화면의 한 단 보기로 여는 주소 값 - 문서 id, 또는 읽을 수 있는 첫 문서("first"). 옛 원문 고치기 화면의 주소였고, 배정 화면이 읽은 뒤 주소에서 뗀다 */
export const EDIT_ORIGINAL_PARAM = "edit";

/** 그 문서를 한 단으로 연 배정 화면 주소 - Old 문서면 넓게 보며 배정하고, 이미 쓴 New 문서면 그 원문을 다듬는다 */
export function getEditOriginalHref(bundleId: number, docId: number): string {
  return `${getStageHref(bundleId, "assign")}?${EDIT_ORIGINAL_PARAM}=${docId}`;
}

/** 줄 하나를 고른 채 배정 화면을 여는 주소 값 둘 - 그 줄의 Old 문서 id와 Unit id(참조 지도의 줄 끝 단추). 배정 화면이 읽은 뒤 주소에서 뗀다 */
export const ASSIGN_DOC_PARAM = "doc";
export const ASSIGN_UNIT_PARAM = "unit";

/** 그 Bundle의 배정 화면을 그 줄(Unit이 든 줄)을 고른 채 여는 주소 - 보기(한 단·양 단)는 바꾸지 않는다 */
export function getAssignLineHref(bundleId: number, docId: number, unitId: number): string {
  return `${getStageHref(bundleId, "assign")}?${ASSIGN_DOC_PARAM}=${docId}&${ASSIGN_UNIT_PARAM}=${unitId}`;
}

export function getStageHref(bundleId: number, key: StageKey): string {
  const stage = STAGES.find((item) => item.key === key);
  return `/bundles/${bundleId}${stage?.path ?? ""}`;
}

/** Documents 화면의 New 문서 목록으로 가는 주소 */
export function getNewDocumentsHref(bundleId: number): string {
  return `${getStageHref(bundleId, "documents")}#${NEW_DOCUMENTS_ANCHOR}`;
}

/** 다음 행동이 데려갈 화면. 없으면 개요 안에서 끝나는 일이다 */
export const NEXT_ACTION_STAGE: Record<NextAction, StageKey | null> = {
  upload_documents: "documents",
  resolve_documents: "documents",
  fill_doc_versions: "documents",
  fill_tobe: "documents",
  decide_units: "assign",
  // 누락 의심 경고는 배정 화면 위쪽 줄의 경고 표시에서 확인한다(전에는 쪼개기 화면)
  ack_warnings: "assign",
  fill_reasons: "assign",
  semantic_checks: "outputs",
  add_reviewer: null,
  request_review: null,
  await_review: "outputs",
  done: null,
};

/** 다음 행동의 주소 - New 문서 목록을 채우는 일은 Documents 화면의 그 자리로 간다. 개요 안에서 끝나는 일이면 null */
export function getNextActionHref(bundleId: number, action: NextAction): string | null {
  const stage = NEXT_ACTION_STAGE[action];
  if (stage === null) return null;
  return action === "fill_tobe" ? getNewDocumentsHref(bundleId) : getStageHref(bundleId, stage);
}
